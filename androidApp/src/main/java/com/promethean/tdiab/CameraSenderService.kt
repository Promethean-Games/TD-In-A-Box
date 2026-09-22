package com.promethean.tdiab

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.webrtc.Camera1Enumerator
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RendererCommon
import org.webrtc.RtpSender
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoCapturer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import java.util.concurrent.CopyOnWriteArraySet
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

enum class SenderConnectionState {
    DISCONNECTED,
    CONNECTING,
    CONNECTED
}

data class SenderUiState(
    val pairCode: String = "",
    val statusText: String = "Idle",
    val errorText: String? = null,
    val connectionState: SenderConnectionState = SenderConnectionState.DISCONNECTED,
    val isStreaming: Boolean = false,
    val previewAttached: Boolean = false
)

class CameraSenderService : Service() {
    private val senderPrefs by lazy { getSharedPreferences(SENDER_PREFS_NAME, MODE_PRIVATE) }
    private val serviceExceptionHandler = CoroutineExceptionHandler { _, throwable ->
        runCatching {
            ApplicationReportHub.recordCrash("CameraSenderService", throwable)
        }
    }
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate + serviceExceptionHandler)
    private val sessionMutex = Mutex()
    private val _uiState = MutableStateFlow(SenderUiState())
    private val localBinder = LocalBinder()
    private val previewRenderers = CopyOnWriteArraySet<SurfaceViewRenderer>()
    private val pendingRemoteIce = mutableListOf<IceCandidate>()
    private var manualDisconnect = false
    private var reconnectJob: Job? = null
    private var readyAnnouncementJob: Job? = null
    private var offerTimeoutJob: Job? = null
    private var postOfferConnectionTimeoutJob: Job? = null
    private var hasReceivedHostOffer = false
    private var hasLoggedInboundIce = false
    private var hasLoggedOutboundIce = false
    private var signalSequence = 0
    private var localIceSequence = 0
    private var activePairCode: String? = null
    private var activeSessionId: String? = null
    private var stickySessionId: String? = null
    private var activeHostSessionId: String? = null
    private val connectStartupLock = Any()
    private var startupPairCode: String? = null
    private var signalTransportRestartJob: Job? = null

    private var powerWakeLock: PowerManager.WakeLock? = null
    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var eglBase: EglBase? = null
    private var surfaceTextureHelper: SurfaceTextureHelper? = null
    private var videoCapturer: VideoCapturer? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null
    private var peerConnection: PeerConnection? = null
    private var videoSender: RtpSender? = null
    private var signalClient: NativePairSignalClient? = null
    private var notificationManager: NotificationManager? = null

    override fun onCreate() {
        super.onCreate()
        notificationManager = getSystemService(NotificationManager::class.java)
        ensureNotificationChannel()
        restoreStickySessionFromStorage()
    }

    override fun onBind(intent: Intent?): IBinder = localBinder

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: "none"
        val nextPairCode = intent?.getStringExtra(EXTRA_PAIR_CODE)?.trim()?.uppercase().orEmpty()
        logConnectionReport(
            stage = "service-start-command",
            detail = "onStartCommand action=$action; startId=$startId; flags=$flags; pairCode=${nextPairCode.ifBlank { "none" }}; activePairCode=${activePairCode ?: "none"}; activeSession=${activeSessionId ?: "none"}; startupPairCode=${startupPairCode ?: "none"}; state=${_uiState.value.connectionState.name.lowercase()}."
        )
        when (intent?.action) {
            ACTION_CONNECT -> {
                if (nextPairCode.isNotBlank()) {
                    serviceScope.launch {
                        connect(nextPairCode, source = "service-intent")
                    }
                }
            }

            ACTION_DISCONNECT -> {
                serviceScope.launch {
                    disconnectAndStop()
                }
            }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        runBlocking {
            shutdownSession(notifyStop = false, clearPairCode = false, stopForegroundSession = false)
        }
        peerConnectionFactory?.dispose()
        peerConnectionFactory = null
        eglBase?.release()
        eglBase = null
        serviceScope.cancel()
        super.onDestroy()
    }

    inner class LocalBinder : Binder() {
        val uiState: StateFlow<SenderUiState>
            get() = _uiState

        fun connect(pairCode: String) {
            serviceScope.launch {
                this@CameraSenderService.connect(pairCode, source = "binder")
            }
        }

        fun disconnect() {
            serviceScope.launch {
                disconnectAndStop()
            }
        }

        fun attachPreview(renderer: SurfaceViewRenderer) {
            attachPreviewRenderer(renderer)
        }

        fun detachPreview(renderer: SurfaceViewRenderer) {
            detachPreviewRenderer(renderer)
        }
    }

    private fun initializePeerFactory() {
        if (peerConnectionFactory != null && eglBase != null) return
        runCatching {
            PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(applicationContext)
                    .createInitializationOptions()
            )
        }
        val createdEglBase = runCatching { EglBase.create() }.getOrNull()
        if (createdEglBase == null) {
            updateState(
                pairCode = _uiState.value.pairCode,
                statusText = "Native camera is unavailable on this device.",
                connectionState = SenderConnectionState.DISCONNECTED,
                isStreaming = false,
                errorText = "Unable to initialize the WebRTC rendering stack."
            )
            return
        }
        eglBase = createdEglBase
        peerConnectionFactory = runCatching {
            PeerConnectionFactory.builder()
                .setVideoEncoderFactory(
                    DefaultVideoEncoderFactory(
                        eglBase?.eglBaseContext,
                        true,
                        true
                    )
                )
                .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase?.eglBaseContext))
                .createPeerConnectionFactory()
        }.getOrNull()
        if (peerConnectionFactory == null) {
            eglBase?.release()
            eglBase = null
            updateState(
                pairCode = _uiState.value.pairCode,
                statusText = "Native camera is unavailable on this device.",
                connectionState = SenderConnectionState.DISCONNECTED,
                isStreaming = false,
                errorText = "WebRTC factory creation failed."
            )
        }
    }

    private suspend fun connect(pairCode: String, source: String, preservedSessionId: String? = null) {
        if (BuildConfig.SUPABASE_URL.isBlank() || BuildConfig.SUPABASE_ANON_KEY.isBlank()) {
            logConnectionReport(
                stage = "config-missing",
                detail = "Supabase configuration is missing for native sender startup.",
                severity = "WARN",
                pairCode = pairCode
            )
            updateState(
                pairCode = pairCode,
                statusText = "Native sender is missing Supabase config.",
                connectionState = SenderConnectionState.DISCONNECTED,
                isStreaming = false,
                errorText = "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for the Android build."
            )
            return
        }
        val claimedStartup = claimConnectStartup(pairCode)
        if (!claimedStartup) {
            logConnectionReport(
                stage = "connect-ignored-startup-in-progress",
                detail = "Ignored connect request from $source because sender startup is already in progress for this pair code.",
                severity = "WARN",
                pairCode = pairCode
            )
            return
        }
        val currentState = _uiState.value.connectionState
        val hasActiveSessionForPair = activePairCode == pairCode &&
            activeSessionId != null &&
            !manualDisconnect &&
            (currentState == SenderConnectionState.CONNECTING ||
                currentState == SenderConnectionState.CONNECTED ||
                peerConnection != null ||
                hasReceivedHostOffer)
        if (hasActiveSessionForPair) {
            releaseConnectStartup(pairCode)
            logConnectionReport(
                stage = "connect-ignored-active-session",
                detail = "Ignored connect request from $source because this pair code already has an active sender session in progress.",
                severity = "WARN",
                pairCode = pairCode
            )
            return
        }
        val hasLinkedSessionForPair = activePairCode == pairCode &&
            signalClient != null &&
            (peerConnection?.remoteDescription != null || hasReceivedHostOffer)
        if (hasLinkedSessionForPair) {
            releaseConnectStartup(pairCode)
            logConnectionReport(
                stage = "connect-ignored-linked-session",
                detail = "Ignored connect request from $source because this pair code already has an active linked sender session.",
                severity = "WARN",
                pairCode = pairCode
            )
            return
        }
        if (activePairCode == pairCode &&
            signalClient != null &&
            (currentState == SenderConnectionState.CONNECTING || currentState == SenderConnectionState.CONNECTED)
        ) {
            releaseConnectStartup(pairCode)
            logConnectionReport(
                stage = "connect-ignored-duplicate",
                detail = "Ignored duplicate connect request from $source while sender was already active for this pair code.",
                severity = "WARN",
                pairCode = pairCode
            )
            return
        }

        manualDisconnect = false
        hasReceivedHostOffer = false
        hasLoggedInboundIce = false
        hasLoggedOutboundIce = false
        signalSequence = 0
        localIceSequence = 0
        activePairCode = pairCode
        activeHostSessionId = null
        reconnectJob?.cancel()
        val reusedSessionId = preservedSessionId ?: stickySessionId
        logConnectionReport(
            stage = "connect-requested",
            detail = "Connect requested from $source; senderSession=${reusedSessionId ?: "new"}.",
            pairCode = pairCode
        )
        initializePeerFactory()
        if (peerConnectionFactory == null || eglBase == null) {
            releaseConnectStartup(pairCode)
            logConnectionReport(
                stage = "webrtc-init-failed",
                detail = "WebRTC initialization did not complete.",
                severity = "ERROR",
                pairCode = pairCode
            )
            updateState(
                pairCode = pairCode,
                statusText = "Native camera is unavailable on this device.",
                connectionState = SenderConnectionState.DISCONNECTED,
                isStreaming = false,
                errorText = "WebRTC initialization did not complete."
            )
            return
        }
        startForeground(NOTIFICATION_ID, buildNotification("Starting native sender…"))
        acquireWakeLock()
        updateState(
            pairCode = pairCode,
            statusText = "Opening native camera…",
            connectionState = SenderConnectionState.CONNECTING,
            isStreaming = true,
            errorText = null
        )

        try {
            shutdownSession(notifyStop = false, clearPairCode = false, stopForegroundSession = false)
            activeSessionId = reusedSessionId ?: java.util.UUID.randomUUID().toString()
            stickySessionId = activeSessionId
            persistStickySession(pairCode, activeSessionId!!)
            val track = startLocalVideoCapture()
            val rtcPeer = createPeerConnection()
            peerConnection = rtcPeer
            videoSender = rtcPeer.addTrack(track)
            attachTrackToPreviews(track)

            val nextSignalClient = NativePairSignalClient(
                supabaseUrl = BuildConfig.SUPABASE_URL,
                apiKey = BuildConfig.SUPABASE_ANON_KEY,
                pairCode = pairCode,
                scope = serviceScope,
                onSignalMessage = ::handleSignalMessage,
                onTransportFailure = ::handleSignalTransportFailure
            )
            signalClient = nextSignalClient
            logConnectionReport(
                stage = "signal-connecting",
                detail = "Opening Supabase realtime channel for pairing.",
                pairCode = pairCode
            )
            withContext(Dispatchers.IO) {
                nextSignalClient.connect()
            }

            logConnectionReport(
                stage = "waiting-host-offer",
                detail = "Camera is ready and waiting for host offer.",
                pairCode = pairCode
            )
            updateState(
                pairCode = pairCode,
                statusText = "Native camera ready. Waiting for host offer…",
                connectionState = SenderConnectionState.CONNECTING,
                isStreaming = true,
                errorText = null
            )
            startReadyAnnouncements(nextSignalClient, pairCode)
            startOfferTimeoutMonitor(pairCode)
            releaseConnectStartup(pairCode)
        } catch (error: Throwable) {
            releaseConnectStartup(pairCode)
            logConnectionReport(
                stage = "connect-failed",
                detail = error.message ?: "Unknown startup failure.",
                severity = "ERROR",
                pairCode = pairCode
            )
            updateState(
                pairCode = pairCode,
                statusText = "Native sender failed to start.",
                connectionState = SenderConnectionState.DISCONNECTED,
                isStreaming = false,
                errorText = error.message ?: "Unknown startup failure."
            )
            shutdownSession(notifyStop = false, clearPairCode = false, stopForegroundSession = false)
            releaseWakeLock()
        }
    }

    private fun createSignalClient(pairCode: String): NativePairSignalClient {
        return NativePairSignalClient(
            supabaseUrl = BuildConfig.SUPABASE_URL,
            apiKey = BuildConfig.SUPABASE_ANON_KEY,
            pairCode = pairCode,
            scope = serviceScope,
            onSignalMessage = ::handleSignalMessage,
            onTransportFailure = ::handleSignalTransportFailure
        )
    }

    private fun handleSignalTransportFailure(reason: String?) {
        if (manualDisconnect) return
        val pairCode = activePairCode ?: return
        val detail = reason ?: "Signaling transport dropped."
        logConnectionReport(
            stage = "signal-transport-failure",
            detail = detail,
            severity = "WARN",
            pairCode = pairCode
        )
        if (signalTransportRestartJob?.isActive == true) {
            logConnectionReport(
                stage = "signal-transport-restart-already-running",
                detail = "A signaling transport restart is already in progress.",
                severity = "INFO",
                pairCode = pairCode
            )
            return
        }
        signalTransportRestartJob = serviceScope.launch(Dispatchers.IO) {
            try {
                restartSignalTransport(detail)
            } finally {
                signalTransportRestartJob = null
            }
        }
    }

    private suspend fun restartSignalTransport(reason: String) {
        val pairCode = activePairCode ?: return
        val sessionId = activeSessionId ?: stickySessionId
        val previousClient = signalClient
        if (previousClient == null) {
            logConnectionReport(
                stage = "signal-transport-restart-skipped",
                detail = "Skipping signaling restart because no active signaling client exists.",
                severity = "WARN",
                pairCode = pairCode
            )
            return
        }
        logConnectionReport(
            stage = "signal-transport-restart-start",
            detail = "$reason Reconnecting signaling without changing sender session ${sessionId ?: "none"}.",
            severity = "WARN",
            pairCode = pairCode
        )
        readyAnnouncementJob?.cancel()
        readyAnnouncementJob = null
        val replacementClient = createSignalClient(pairCode)
        signalClient = replacementClient
        runCatching { previousClient.close() }
        if (manualDisconnect || activePairCode != pairCode) {
            return
        }
        try {
            withContext(Dispatchers.IO) {
                replacementClient.connect()
            }
            logConnectionReport(
                stage = "signal-transport-restart-complete",
                detail = "Signaling transport restored for sender session ${sessionId ?: "none"}.",
                pairCode = pairCode
            )
            if (!hasReceivedHostOffer) {
                startReadyAnnouncements(replacementClient, pairCode)
            }
        } catch (error: Throwable) {
            logConnectionReport(
                stage = "signal-transport-restart-failed",
                detail = error.message ?: "Failed to restart signaling transport.",
                severity = "ERROR",
                pairCode = pairCode
            )
            if (!manualDisconnect) {
                signalTransportRestartJob = serviceScope.launch(Dispatchers.IO) {
                    delay(2_000)
                    if (!manualDisconnect && activePairCode == pairCode && signalClient === replacementClient) {
                        try {
                            restartSignalTransport("Retrying signaling transport restart.")
                        } finally {
                            signalTransportRestartJob = null
                        }
                    }
                }
            }
        }
    }

    private suspend fun startLocalVideoCapture(): VideoTrack {
        val factory = peerConnectionFactory ?: error("PeerConnectionFactory was not initialized.")
        val eglContext = eglBase?.eglBaseContext ?: error("EGL context unavailable.")
        val capturer = createVideoCapturer() ?: error("No usable Android camera was found.")
        try {
            val helper = SurfaceTextureHelper.create("TDIAB-CameraCapture", eglContext)
                ?: error("Failed to create SurfaceTextureHelper.")
            val source = factory.createVideoSource(false)
            capturer.initialize(helper, applicationContext, source.capturerObserver)
            capturer.startCapture(1280, 720, 30)

            val track = factory.createVideoTrack("tdiab-native-camera", source).apply {
                setEnabled(true)
            }

            videoCapturer = capturer
            surfaceTextureHelper = helper
            videoSource = source
            videoTrack = track
            return track
        } catch (error: Throwable) {
            runCatching { capturer.dispose() }
            throw error
        }
    }

    private fun createVideoCapturer(): CameraVideoCapturer? {
        val enumerator = if (Camera2Enumerator.isSupported(applicationContext)) {
            Camera2Enumerator(applicationContext)
        } else {
            Camera1Enumerator(true)
        }

        val preferredDevice = enumerator.deviceNames.firstOrNull { enumerator.isBackFacing(it) }
            ?: enumerator.deviceNames.firstOrNull()
            ?: return null

        return enumerator.createCapturer(preferredDevice, null)
    }

    private fun createPeerConnection(): PeerConnection {
        val rtcConfig = PeerConnection.RTCConfiguration(buildIceServers())
        rtcConfig.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        val connection = peerConnectionFactory?.createPeerConnection(
            rtcConfig,
            object : PeerConnection.Observer {
                override fun onIceCandidate(candidate: IceCandidate) {
                    runCatching {
                        val currentSignalClient = signalClient ?: return@runCatching
                        localIceSequence += 1
                        if (!hasLoggedOutboundIce) {
                            hasLoggedOutboundIce = true
                            logConnectionReport(
                                stage = "sender-ice-generated",
                                detail = "Local ICE candidates are being generated and sent; sequence=$localIceSequence; ${describePeerState(peerConnection)}."
                            )
                        } else {
                            logConnectionReport(
                                stage = "sender-ice-generated",
                                detail = "Local ICE candidate #$localIceSequence generated; mid=${candidate.sdpMid ?: "none"}; index=${candidate.sdpMLineIndex}; ${describePeerState(peerConnection)}."
                            )
                        }
                        serviceScope.launch {
                            runCatching {
                                currentSignalClient.send(
                                    PairSignalMessagePayload(
                                        type = "ice",
                                        from = "sender",
                                        ts = System.currentTimeMillis(),
                                        sessionId = activeSessionId,
                                        payload = buildJsonObject {
                                            put("candidate", candidate.sdp)
                                            candidate.sdpMid?.let { put("sdpMid", it) } ?: put("sdpMid", JsonNull)
                                            put("sdpMLineIndex", candidate.sdpMLineIndex)
                                        }
                                    )
                                )
                                logConnectionReport(
                                    stage = "sender-ice-dispatched",
                                    detail = "Local ICE candidate #$localIceSequence dispatched to host; mid=${candidate.sdpMid ?: "none"}; index=${candidate.sdpMLineIndex}; session=${activeSessionId ?: "none"}; ${describePeerState(peerConnection)}."
                                )
                            }.onFailure { error ->
                                logConnectionReport(
                                    stage = "ice-send-failed",
                                    detail = "Failed to send ICE candidate #$localIceSequence; mid=${candidate.sdpMid ?: "none"}; index=${candidate.sdpMLineIndex}; ${error.message ?: "unknown error"}; ${describePeerState(peerConnection)}.",
                                    severity = "WARN",
                                    pairCode = activePairCode
                                )
                            }
                        }
                    }.onFailure { error ->
                        logConnectionReport(
                            stage = "ice-callback-crashed",
                            detail = error.message ?: "Unhandled exception in ICE callback.",
                            severity = "ERROR",
                            pairCode = activePairCode
                        )
                    }
                }

                override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
                    runCatching {
                        logConnectionReport(
                            stage = "peer-connection-state",
                            detail = "PeerConnection state=${newState.name.lowercase()}; ${describePeerState(peerConnection)}.",
                            severity = if (newState == PeerConnection.PeerConnectionState.FAILED) "WARN" else "INFO",
                            pairCode = activePairCode
                        )
                        when (newState) {
                            PeerConnection.PeerConnectionState.CONNECTED -> {
                                postOfferConnectionTimeoutJob?.cancel()
                                postOfferConnectionTimeoutJob = null
                                logConnectionReport(
                                    stage = "peer-connected",
                                    detail = "WebRTC peer connection reached CONNECTED state."
                                )
                                updateState(
                                    pairCode = activePairCode.orEmpty(),
                                    statusText = "Native stream live.",
                                    connectionState = SenderConnectionState.CONNECTED,
                                    isStreaming = true,
                                    errorText = null
                                )
                            }

                            PeerConnection.PeerConnectionState.FAILED -> {
                                if (!manualDisconnect) {
                                    scheduleReconnect("WebRTC connection ${newState.name.lowercase()}.")
                                }
                            }

                            else -> Unit
                        }
                    }.onFailure { error ->
                        logConnectionReport(
                            stage = "connection-change-callback-crashed",
                            detail = error.message ?: "Unhandled exception in connection change callback.",
                            severity = "ERROR",
                            pairCode = activePairCode
                        )
                    }
                }

                override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
                    runCatching {
                        logConnectionReport(
                            stage = "ice-connection-state",
                            detail = "ICE connection state changed to ${state.name.lowercase()}; ${describePeerState(peerConnection)}.",
                            severity = if (state == PeerConnection.IceConnectionState.FAILED) "WARN" else "INFO"
                        )
                        if (state == PeerConnection.IceConnectionState.FAILED && !manualDisconnect) {
                            scheduleReconnect("ICE ${state.name.lowercase()}.")
                        }
                    }.onFailure { error ->
                        logConnectionReport(
                            stage = "ice-connection-change-callback-crashed",
                            detail = error.message ?: "Unhandled exception in ICE connection change callback.",
                            severity = "ERROR",
                            pairCode = activePairCode
                        )
                    }
                }

                override fun onSignalingChange(newState: PeerConnection.SignalingState) = Unit
                override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
                override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState) = Unit
                override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
                override fun onAddStream(stream: org.webrtc.MediaStream) = Unit
                override fun onRemoveStream(stream: org.webrtc.MediaStream) = Unit
                override fun onDataChannel(dataChannel: org.webrtc.DataChannel) = Unit
                override fun onRenegotiationNeeded() = Unit
                override fun onAddTrack(receiver: org.webrtc.RtpReceiver, mediaStreams: Array<out org.webrtc.MediaStream>) = Unit
            }
        )

        return connection ?: error("Unable to create native WebRTC peer connection.")
    }

    private suspend fun handleSignalMessage(message: PairSignalMessagePayload) {
        if (message.from != "host") return

        val pairCode = activePairCode.orEmpty()
        val currentPeer = peerConnection
        val currentSignalClient = signalClient
        signalSequence += 1
        logConnectionReport(
            stage = "host-signal-received",
            detail = "Received host signal #$signalSequence: type=${message.type}; session=${message.sessionId ?: "none"}; activeHostSession=${activeHostSessionId ?: "none"}; activeSenderSession=${activeSessionId ?: "none"}; ${describePeerState(currentPeer)}",
            pairCode = pairCode
        )
        if (message.sessionId != null && activeHostSessionId != null && message.sessionId != activeHostSessionId) {
            if (currentPeer?.remoteDescription != null ||
                hasReceivedHostOffer ||
                _uiState.value.connectionState == SenderConnectionState.CONNECTED
            ) {
                logConnectionReport(
                    stage = "host-session-stale",
                    detail = "Ignoring stale host signal session ${message.sessionId}; active session is ${activeHostSessionId}.",
                    severity = "WARN",
                    pairCode = pairCode
                )
                return
            }
            logConnectionReport(
                stage = "host-session-adopted",
                detail = "Adopting refreshed host session ${message.sessionId}; previous session was ${activeHostSessionId}.",
                severity = "INFO",
                pairCode = pairCode
            )
        }
        if (message.sessionId != null) {
            activeHostSessionId = message.sessionId
        }
        val rtcPeer = currentPeer ?: return
        val signalTransportClient = currentSignalClient ?: return
        var stopRequested = false

        sessionMutex.withLock {
            when (message.type) {
                "offer" -> {
                    if (rtcPeer.signalingState() != PeerConnection.SignalingState.STABLE || rtcPeer.remoteDescription != null) {
                        logConnectionReport(
                            stage = "offer-ignored",
                            detail = "Host offer ignored because peer state was not stable (${rtcPeer.signalingState()}) or remote description already existed; ${describePeerState(rtcPeer)}.",
                            severity = "WARN",
                            pairCode = pairCode
                        )
                        return@withLock
                    }
                    logConnectionReport(
                        stage = "offer-received",
                        detail = "Host offer received; preparing answer for host session ${activeHostSessionId ?: "unknown"}; ${describePeerState(rtcPeer)}."
                    )
                    try {
                        val payload = message.payload as? JsonObject ?: run {
                            logConnectionReport(
                                stage = "offer-payload-missing",
                                detail = "Host offer payload was missing or malformed.",
                                severity = "ERROR",
                                pairCode = pairCode
                            )
                            return@withLock
                        }
                        val sdp = payload["sdp"]?.jsonPrimitive?.content ?: run {
                            logConnectionReport(
                                stage = "offer-sdp-missing",
                                detail = "Host offer was missing the SDP payload.",
                                severity = "ERROR",
                                pairCode = pairCode
                            )
                            return@withLock
                        }
                        logConnectionReport(
                            stage = "remote-description-start",
                            detail = "Applying remote host offer to the peer connection; ${describePeerState(rtcPeer)}.",
                            pairCode = pairCode
                        )
                        val remoteDescriptionResult = runCatching {
                            withTimeout(10_000) {
                                rtcPeer.setRemoteDescriptionAwait(SessionDescription(SessionDescription.Type.OFFER, sdp))
                            }
                        }
                        if (remoteDescriptionResult.isFailure) {
                            logConnectionReport(
                                stage = "remote-description-failed",
                                detail = remoteDescriptionResult.exceptionOrNull()?.message
                                    ?: "Failed to apply remote host offer.",
                                severity = "ERROR",
                                pairCode = pairCode
                            )
                            if (!manualDisconnect) {
                                startReadyAnnouncements(signalTransportClient, pairCode)
                            }
                            return@withLock
                        }
                        hasReceivedHostOffer = true
                        readyAnnouncementJob?.cancel()
                        readyAnnouncementJob = null
                        offerTimeoutJob?.cancel()
                        offerTimeoutJob = null
                        logConnectionReport(
                            stage = "remote-description-set",
                            detail = "Remote host offer applied successfully; ${describePeerState(rtcPeer)}.",
                            pairCode = pairCode
                        )
                        drainPendingIce(rtcPeer)
                        logConnectionReport(
                            stage = "answer-create-start",
                            detail = "Creating local answer from the applied host offer; ${describePeerState(rtcPeer)}.",
                            pairCode = pairCode
                        )
                        val answerResult = runCatching {
                            withTimeout(10_000) {
                                rtcPeer.createAnswerAwait()
                            }
                        }
                        if (answerResult.isFailure) {
                            logConnectionReport(
                                stage = "answer-create-failed",
                                detail = answerResult.exceptionOrNull()?.message
                                    ?: "Failed to create local answer.",
                                severity = "ERROR",
                                pairCode = pairCode
                            )
                            hasReceivedHostOffer = false
                            if (!manualDisconnect) {
                                startReadyAnnouncements(signalTransportClient, pairCode)
                            }
                            return@withLock
                        }
                        val answer = answerResult.getOrThrow()
                        logConnectionReport(
                            stage = "answer-created",
                            detail = "Local answer created; applying local description; ${describePeerState(rtcPeer)}.",
                            pairCode = pairCode
                        )
                        val answerToSend = PairSignalMessagePayload(
                            type = "answer",
                            from = "sender",
                            ts = System.currentTimeMillis(),
                            sessionId = activeSessionId ?: message.sessionId,
                            payload = buildJsonObject {
                                put("type", answer.type.canonicalForm())
                                put("sdp", answer.description)
                            }
                        )
                        runCatching { drainPendingIce(rtcPeer) }
                        applyLocalDescriptionAndSendAnswer(
                            rtcPeer = rtcPeer,
                            signalClient = signalTransportClient,
                            answer = answer,
                            answerMessage = answerToSend,
                            pairCode = pairCode
                        )
                    } catch (error: Throwable) {
                        logConnectionReport(
                            stage = "offer-handling-failed",
                            detail = error.message ?: "Offer handling failed.",
                            severity = "ERROR",
                            pairCode = pairCode
                        )
                        if (!manualDisconnect) {
                            scheduleReconnect("Offer handling failed.")
                        }
                    }
                }

                "ice" -> {
                    val payload = message.payload as? JsonObject ?: return@withLock
                    val candidate = payload.toIceCandidate() ?: return@withLock
                    if (!hasLoggedInboundIce) {
                        hasLoggedInboundIce = true
                        logConnectionReport(
                            stage = "host-ice-received",
                            detail = "Host ICE candidates are being received; ${describePeerState(rtcPeer)}.",
                            pairCode = pairCode
                        )
                    }
                    if (rtcPeer.remoteDescription != null) {
                        logConnectionReport(
                            stage = "host-ice-apply-start",
                            detail = "Applying host ICE candidate; mid=${candidate.sdpMid ?: "none"}; index=${candidate.sdpMLineIndex}; ${describePeerState(rtcPeer)}.",
                            pairCode = pairCode
                        )
                        runCatching { rtcPeer.addIceCandidate(candidate) }
                            .onSuccess {
                                logConnectionReport(
                                    stage = "host-ice-applied",
                                    detail = "Applied host ICE candidate; mid=${candidate.sdpMid ?: "none"}; index=${candidate.sdpMLineIndex}; ${describePeerState(rtcPeer)}.",
                                    pairCode = pairCode
                                )
                            }
                            .onFailure { error ->
                                logConnectionReport(
                                    stage = "host-ice-apply-failed",
                                    detail = "Failed to apply remote ICE candidate; mid=${candidate.sdpMid ?: "none"}; index=${candidate.sdpMLineIndex}; ${error.message ?: "unknown error"}; ${describePeerState(rtcPeer)}.",
                                    severity = "WARN",
                                    pairCode = pairCode
                                )
                                pendingRemoteIce += candidate
                            }
                    } else {
                        pendingRemoteIce += candidate
                        logConnectionReport(
                            stage = "host-ice-queued",
                            detail = "Queued host ICE candidate until remote description is set; mid=${candidate.sdpMid ?: "none"}; index=${candidate.sdpMLineIndex}; ${describePeerState(rtcPeer)}.",
                            pairCode = pairCode
                        )
                    }
                }

                "stop" -> {
                    logConnectionReport(
                        stage = "host-stop",
                        detail = "Host requested sender stop.",
                        severity = "WARN"
                    )
                    manualDisconnect = true
                    stopRequested = true
                }
            }
        }

        if (stopRequested) {
            shutdownSession(notifyStop = false)
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private suspend fun drainPendingIce(connection: PeerConnection) {
        if (pendingRemoteIce.isEmpty()) return
        val queued = pendingRemoteIce.toList()
        pendingRemoteIce.clear()
        logConnectionReport(
            stage = "pending-ice-drain",
            detail = "Draining ${queued.size} queued remote ICE candidates; ${describePeerState(connection)}.",
            pairCode = activePairCode.orEmpty()
        )
        queued.forEachIndexed { index, candidate ->
            runCatching { connection.addIceCandidate(candidate) }
                .onSuccess {
                    logConnectionReport(
                        stage = "pending-ice-applied",
                        detail = "Applied queued remote ICE candidate #${index + 1}/${queued.size}; mid=${candidate.sdpMid ?: "none"}; index=${candidate.sdpMLineIndex}; ${describePeerState(connection)}.",
                        pairCode = activePairCode.orEmpty()
                    )
                }
                .onFailure { error ->
                    pendingRemoteIce += candidate
                    logConnectionReport(
                        stage = "pending-ice-requeue",
                        detail = "Queued remote ICE candidate #${index + 1}/${queued.size} could not be applied; mid=${candidate.sdpMid ?: "none"}; index=${candidate.sdpMLineIndex}; ${error.message ?: "unknown error"}; ${describePeerState(connection)}.",
                        severity = "WARN",
                        pairCode = activePairCode.orEmpty()
                    )
                }
        }
    }

    private fun applyLocalDescriptionAndSendAnswer(
        rtcPeer: PeerConnection,
        signalClient: NativePairSignalClient,
        answer: SessionDescription,
        answerMessage: PairSignalMessagePayload,
        pairCode: String
    ) {
        serviceScope.launch(Dispatchers.IO) {
            try {
                logConnectionReport(
                    stage = "local-description-native-call-start",
                    detail = "Calling PeerConnection.setLocalDescription with the created local answer.",
                    pairCode = pairCode
                )
                rtcPeer.setLocalDescriptionAwait(answer)
                logConnectionReport(
                    stage = "local-description-callback-success",
                    detail = "PeerConnection.setLocalDescription reported success.",
                    pairCode = pairCode
                )
                runCatching { drainPendingIce(rtcPeer) }
                logConnectionReport(
                    stage = "local-description-set",
                    detail = "Local answer applied successfully.",
                    pairCode = pairCode
                )
                sendAnswerToHost(rtcPeer, signalClient, answerMessage, pairCode)
            } catch (error: Throwable) {
                logConnectionReport(
                    stage = "local-description-failed",
                    detail = error.message ?: "PeerConnection.setLocalDescription reported failure.",
                    severity = "ERROR",
                    pairCode = pairCode
                )
                if (!manualDisconnect) {
                    scheduleReconnect("Local answer application failed.")
                }
            }
        }
    }

    private suspend fun sendAnswerToHost(
        rtcPeer: PeerConnection,
        signalClient: NativePairSignalClient,
        answerMessage: PairSignalMessagePayload,
        pairCode: String
    ) {
        val transportClient = this.signalClient ?: signalClient
        if (manualDisconnect || activePairCode != pairCode) {
            logConnectionReport(
                stage = "answer-send-skipped-stale",
                detail = "Skipping answer publish because the sender session is no longer active for this pair code.",
                severity = "WARN",
                pairCode = pairCode
            )
            return
        }

        logConnectionReport(
            stage = "answer-send-start",
            detail = "Local answer prepared; sending payload to host; ${describePeerState(rtcPeer)}.",
            pairCode = pairCode
        )
        runCatching {
            updateState(
                pairCode = pairCode,
                statusText = "Sending answer to host…",
                connectionState = SenderConnectionState.CONNECTING,
                isStreaming = true,
                errorText = null
            )
        }.onFailure { error ->
            logConnectionReport(
                stage = "answer-send-status-update-failed",
                detail = error.message ?: "Failed to update sender status before answer publish.",
                severity = "WARN",
                pairCode = pairCode
            )
        }
        startPostOfferConnectionTimeout(pairCode)

        try {
            withTimeout(6_000) {
                transportClient.send(answerMessage)
            }
            logConnectionReport(
                stage = "answer-sent",
                detail = "Local answer sent to host; waiting for ICE/connection completion; ${describePeerState(rtcPeer)}.",
                pairCode = pairCode
            )
            runCatching {
                updateState(
                    pairCode = pairCode,
                    statusText = "Answer sent. Finishing secure connection…",
                    connectionState = SenderConnectionState.CONNECTING,
                    isStreaming = true,
                    errorText = null
                )
            }.onFailure { error ->
                logConnectionReport(
                    stage = "answer-send-status-update-failed",
                    detail = error.message ?: "Failed to update sender status after answer publish.",
                    severity = "WARN",
                    pairCode = pairCode
                )
            }
        } catch (error: Throwable) {
            logConnectionReport(
                stage = "answer-send-failed",
                detail = error.message ?: "Failed to send answer payload.",
                severity = "ERROR",
                pairCode = pairCode
            )
            if (!manualDisconnect) {
                scheduleReconnect("Failed to send answer payload.")
            }
        }
    }

    private fun scheduleReconnect(reason: String) {
        val pairCode = activePairCode ?: return
        val hasLinkedSession = peerConnection?.remoteDescription != null ||
            hasReceivedHostOffer ||
            _uiState.value.connectionState == SenderConnectionState.CONNECTED
        if (hasLinkedSession) {
            logConnectionReport(
                stage = "reconnect-skipped-linked-session",
                detail = "Skipped reconnect because sender already has an active linked session.",
                severity = "INFO",
                pairCode = pairCode
            )
            return
        }
        val scheduledSessionId = activeSessionId
        val stickyReconnectSessionId = stickySessionId
        logConnectionReport(
            stage = "reconnect-scheduled",
            detail = "$reason Preserving sender session ${scheduledSessionId ?: stickyReconnectSessionId ?: "none"}.",
            severity = "WARN",
            pairCode = pairCode
        )
        reconnectJob?.cancel()
        updateState(
            pairCode = pairCode,
            statusText = "Connection stalled. Reconnecting…",
            connectionState = SenderConnectionState.CONNECTING,
            isStreaming = true,
            errorText = reason
        )
        updateNotification("Reconnecting native sender…")
        reconnectJob = serviceScope.launch {
            delay(1_500)
            if (manualDisconnect || activePairCode != pairCode) {
                return@launch
            }
            if (scheduledSessionId != null && activeSessionId != scheduledSessionId) {
                logConnectionReport(
                    stage = "reconnect-skipped-session-changed",
                    detail = "Skipped reconnect because a newer sender session became active.",
                    severity = "INFO",
                    pairCode = pairCode
                )
                return@launch
            }
            if (_uiState.value.connectionState == SenderConnectionState.CONNECTED) {
                logConnectionReport(
                    stage = "reconnect-skipped-connected",
                    detail = "Skipped reconnect because sender is already connected.",
                    severity = "INFO",
                    pairCode = pairCode
                )
                return@launch
            }
            if (hasReceivedHostOffer || peerConnection?.remoteDescription != null) {
                logConnectionReport(
                    stage = "reconnect-skipped-negotiated",
                    detail = "Skipped reconnect because sender already negotiated a host offer.",
                    severity = "INFO",
                    pairCode = pairCode
                )
                return@launch
            }
            shutdownSession(notifyStop = false, clearPairCode = false, stopForegroundSession = false)
            if (!manualDisconnect && activePairCode == pairCode) {
                connect(
                    pairCode = pairCode,
                    source = "auto-reconnect",
                    preservedSessionId = scheduledSessionId ?: stickyReconnectSessionId
                )
            }
        }
    }

    private suspend fun disconnectAndStop() {
        logConnectionReport(
            stage = "manual-disconnect",
            detail = "Sender disconnect requested from app UI."
        )
        manualDisconnect = true
        activePairCode = null
        stickySessionId = null
        clearPersistedSession()
        shutdownSession(notifyStop = true)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private suspend fun shutdownSession(
        notifyStop: Boolean,
        clearPairCode: Boolean = true,
        stopForegroundSession: Boolean = false
    ) {
        val currentSignalClient: NativePairSignalClient?
        val stopSessionId: String?
        val activePeerConnection: PeerConnection?

        sessionMutex.withLock {
            readyAnnouncementJob?.cancel()
            readyAnnouncementJob = null
            offerTimeoutJob?.cancel()
            offerTimeoutJob = null
            postOfferConnectionTimeoutJob?.cancel()
            postOfferConnectionTimeoutJob = null
            hasReceivedHostOffer = false
            hasLoggedInboundIce = false
            hasLoggedOutboundIce = false
            signalSequence = 0
            localIceSequence = 0
            stopSessionId = activeSessionId
            activeSessionId = null
            activeHostSessionId = null
            reconnectJob?.cancel()
            reconnectJob = null
            signalTransportRestartJob?.cancel()
            signalTransportRestartJob = null

            currentSignalClient = signalClient
            signalClient = null
            pendingRemoteIce.clear()
            videoSender = null
            activePeerConnection = peerConnection
            peerConnection = null

            runCatching { videoCapturer?.stopCapture() }
            runCatching { videoCapturer?.dispose() }
            videoCapturer = null

            videoTrack?.let { track ->
                previewRenderers.forEach { renderer ->
                    track.removeSink(renderer)
                }
                track.dispose()
            }
            videoTrack = null

            runCatching { surfaceTextureHelper?.dispose() }
            surfaceTextureHelper = null
            runCatching { videoSource?.dispose() }
            videoSource = null

            if (clearPairCode) {
                activePairCode = null
                stickySessionId = null
                clearPersistedSession()
            }

            updateState(
                pairCode = if (clearPairCode) "" else activePairCode.orEmpty(),
                statusText = "Disconnected",
                connectionState = SenderConnectionState.DISCONNECTED,
                isStreaming = false,
                errorText = null
            )
            releaseWakeLock()

            if (stopForegroundSession) {
                stopForeground(STOP_FOREGROUND_REMOVE)
            } else {
                updateNotification("Native sender idle")
            }
        }

        if (notifyStop && currentSignalClient != null) {
            runCatching {
                currentSignalClient.send(
                    PairSignalMessagePayload(
                        type = "stop",
                        from = "sender",
                        ts = System.currentTimeMillis(),
                        sessionId = stopSessionId
                    )
                )
            }
        }
        runCatching { currentSignalClient?.close() }
        runCatching { activePeerConnection?.dispose() }
    }

    private fun attachPreviewRenderer(renderer: SurfaceViewRenderer) {
        if (previewRenderers.contains(renderer)) return
        val currentEglBase = eglBase ?: return
        renderer.init(currentEglBase.eglBaseContext, null)
        renderer.setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
        renderer.setMirror(false)
        renderer.setEnableHardwareScaler(true)
        previewRenderers += renderer
        videoTrack?.addSink(renderer)
        _uiState.value = _uiState.value.copy(previewAttached = true)
    }

    private fun detachPreviewRenderer(renderer: SurfaceViewRenderer) {
        videoTrack?.removeSink(renderer)
        previewRenderers -= renderer
        renderer.clearImage()
        renderer.release()
        _uiState.value = _uiState.value.copy(previewAttached = previewRenderers.isNotEmpty())
    }

    private fun attachTrackToPreviews(track: VideoTrack) {
        previewRenderers.forEach { renderer ->
            track.addSink(renderer)
        }
    }

    private fun acquireWakeLock() {
        if (powerWakeLock?.isHeld == true) return
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        powerWakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "tdiab:camera-sender").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    private fun releaseWakeLock() {
        powerWakeLock?.takeIf { it.isHeld }?.release()
        powerWakeLock = null
    }

    private fun buildIceServers(): List<PeerConnection.IceServer> {
        val servers = mutableListOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer()
        )
        if (BuildConfig.TURN_URL.isNotBlank()) {
            servers += PeerConnection.IceServer.builder(BuildConfig.TURN_URL)
                .setUsername(BuildConfig.TURN_USERNAME)
                .setPassword(BuildConfig.TURN_CREDENTIAL)
                .createIceServer()
        }
        return servers
    }

    private fun updateState(
        pairCode: String = _uiState.value.pairCode,
        statusText: String = _uiState.value.statusText,
        connectionState: SenderConnectionState = _uiState.value.connectionState,
        isStreaming: Boolean = _uiState.value.isStreaming,
        errorText: String? = _uiState.value.errorText
    ) {
        _uiState.value = _uiState.value.copy(
            pairCode = pairCode,
            statusText = statusText,
            connectionState = connectionState,
            isStreaming = isStreaming,
            errorText = errorText
        )
        updateNotification(
            when (connectionState) {
                SenderConnectionState.CONNECTED -> "Native stream live"
                SenderConnectionState.CONNECTING -> statusText
                SenderConnectionState.DISCONNECTED -> "Native sender idle"
            }
        )
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            "TDTV camera sender",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Keeps the native TDTV phone camera sender alive while broadcasting."
        }
        notificationManager?.createNotificationChannel(channel)
    }

    private fun buildNotification(contentText: String): Notification {
        val openAppIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, CameraSenderActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, CameraSenderService::class.java).apply {
                action = ACTION_DISCONNECT
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.presence_video_online)
            .setContentTitle("TDTV native camera sender")
            .setContentText(contentText)
            .setContentIntent(openAppIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(android.R.drawable.ic_media_pause, "Stop", stopIntent)
            .build()
    }

    private fun updateNotification(contentText: String) {
        notificationManager?.notify(NOTIFICATION_ID, buildNotification(contentText))
    }

    private fun startReadyAnnouncements(signalClient: NativePairSignalClient, pairCode: String) {
        readyAnnouncementJob?.cancel()
        readyAnnouncementJob = serviceScope.launch {
            var announceCount = 0
            while (!manualDisconnect && !hasReceivedHostOffer && activePairCode == pairCode) {
                try {
                    signalClient.send(
                        PairSignalMessagePayload(
                            type = "ready",
                            from = "sender",
                            ts = System.currentTimeMillis(),
                            sessionId = activeSessionId
                        )
                    )
                    announceCount += 1
                    if (announceCount == 1) {
                        logConnectionReport(
                            stage = "ready-sent",
                            detail = "Ready signal sent; waiting for host offer.",
                            pairCode = pairCode
                        )
                    }
                } catch (error: Throwable) {
                    logConnectionReport(
                        stage = "ready-send-failed",
                        detail = error.message ?: "Failed to send ready signal.",
                        severity = "WARN",
                        pairCode = pairCode
                    )
                    if (!manualDisconnect) {
                        scheduleReconnect("Failed to send ready signal.")
                    }
                    return@launch
                }
                delay(2_500)
            }
        }
    }

    private fun startOfferTimeoutMonitor(pairCode: String) {
        offerTimeoutJob?.cancel()
        offerTimeoutJob = serviceScope.launch {
            delay(18_000)
            if (!manualDisconnect && !hasReceivedHostOffer && activePairCode == pairCode) {
                logConnectionReport(
                    stage = "offer-timeout",
                    detail = "No host offer received after waiting for signaling handshake.",
                    severity = "WARN",
                    pairCode = pairCode
                )
                updateState(
                    pairCode = pairCode,
                    statusText = "Waiting for host offer…",
                    connectionState = SenderConnectionState.CONNECTING,
                    isStreaming = true,
                    errorText = "Still waiting for host offer. Confirm host broadcast pairing is active."
                )
            }
        }
    }

    private fun startPostOfferConnectionTimeout(pairCode: String) {
        postOfferConnectionTimeoutJob?.cancel()
        postOfferConnectionTimeoutJob = serviceScope.launch {
            delay(20_000)
            if (!manualDisconnect && activePairCode == pairCode && _uiState.value.connectionState != SenderConnectionState.CONNECTED) {
                logConnectionReport(
                    stage = "post-offer-timeout",
                    detail = "Offer/answer exchange happened, but peer connection did not reach CONNECTED.",
                    severity = "WARN",
                    pairCode = pairCode
                )
            }
        }
    }

    private fun claimConnectStartup(pairCode: String): Boolean {
        synchronized(connectStartupLock) {
            if (startupPairCode == pairCode) {
                return false
            }
            startupPairCode = pairCode
            return true
        }
    }

    private fun releaseConnectStartup(pairCode: String) {
        synchronized(connectStartupLock) {
            if (startupPairCode == pairCode) {
                startupPairCode = null
            }
        }
    }

    private fun logConnectionReport(
        stage: String,
        detail: String,
        severity: String = "INFO",
        pairCode: String? = activePairCode
    ) {
        ApplicationReportHub.recordConnection(
            pairCode = pairCode,
            stage = stage,
            detail = detail,
            severity = severity
        )
    }

    private fun restoreStickySessionFromStorage() {
        val storedPairCode = senderPrefs.getString(KEY_PAIR_CODE, null)
        val storedSessionId = senderPrefs.getString(KEY_SESSION_ID, null)
        if (!storedPairCode.isNullOrBlank() && !storedSessionId.isNullOrBlank()) {
            stickySessionId = storedSessionId
            activePairCode = storedPairCode
        }
    }

    private fun persistStickySession(pairCode: String, sessionId: String) {
        senderPrefs.edit()
            .putString(KEY_PAIR_CODE, pairCode)
            .putString(KEY_SESSION_ID, sessionId)
            .commit()
    }

    private fun clearPersistedSession() {
        senderPrefs.edit()
            .remove(KEY_PAIR_CODE)
            .remove(KEY_SESSION_ID)
            .commit()
    }

    companion object {
        private const val NOTIFICATION_CHANNEL_ID = "tdiab-camera-sender"
        private const val NOTIFICATION_ID = 4307
        private const val SENDER_PREFS_NAME = "tdiab_sender_service_prefs"
        private const val KEY_PAIR_CODE = "sender_pair_code"
        private const val KEY_SESSION_ID = "sender_session_id"
        const val ACTION_CONNECT = "com.promethean.tdiab.action.CONNECT_NATIVE_SENDER"
        const val ACTION_DISCONNECT = "com.promethean.tdiab.action.DISCONNECT_NATIVE_SENDER"
        const val EXTRA_PAIR_CODE = "pair_code"

        fun startSender(context: Context, pairCode: String) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, CameraSenderService::class.java).apply {
                    action = ACTION_CONNECT
                    putExtra(EXTRA_PAIR_CODE, pairCode)
                }
            )
        }

        fun stopSender(context: Context) {
            context.startService(
                Intent(context, CameraSenderService::class.java).apply {
                    action = ACTION_DISCONNECT
                }
            )
        }
    }
}

private fun JsonObject.toIceCandidate(): IceCandidate? {
    val candidate = this["candidate"]?.jsonPrimitive?.content ?: return null
    val sdpMid = this["sdpMid"]?.takeUnless { it is JsonNull }?.jsonPrimitive?.content
    val sdpMLineIndex = this["sdpMLineIndex"]?.jsonPrimitive?.int ?: return null
    return IceCandidate(sdpMid, sdpMLineIndex, candidate)
}

private fun describePeerState(peer: PeerConnection?): String {
    if (peer == null) return "peer=null"
    return "signaling=${peer.signalingState().name.lowercase()}; connection=${peer.connectionState().name.lowercase()}; ice=${peer.iceConnectionState().name.lowercase()}"
}

private fun SessionDescription.Type.canonicalForm(): String = when (this) {
    SessionDescription.Type.OFFER -> "offer"
    SessionDescription.Type.PRANSWER -> "pranswer"
    SessionDescription.Type.ANSWER -> "answer"
    SessionDescription.Type.ROLLBACK -> "rollback"
}

private suspend fun PeerConnection.setRemoteDescriptionAwait(description: SessionDescription) {
    suspendCancellableCoroutine { continuation ->
        setRemoteDescription(object : SdpObserver {
            override fun onCreateSuccess(sessionDescription: SessionDescription?) = Unit
            override fun onSetSuccess() {
                continuation.resume(Unit)
            }

            override fun onCreateFailure(error: String?) = Unit
            override fun onSetFailure(error: String?) {
                continuation.resumeWithException(IllegalStateException(error ?: "Remote description failed."))
            }
        }, description)
    }
}

private suspend fun PeerConnection.setLocalDescriptionAwait(description: SessionDescription) {
    suspendCancellableCoroutine { continuation ->
        setLocalDescription(object : SdpObserver {
            override fun onCreateSuccess(sessionDescription: SessionDescription?) = Unit
            override fun onSetSuccess() {
                continuation.resume(Unit)
            }

            override fun onCreateFailure(error: String?) = Unit
            override fun onSetFailure(error: String?) {
                continuation.resumeWithException(IllegalStateException(error ?: "Local description failed."))
            }
        }, description)
    }
}

private suspend fun PeerConnection.createAnswerAwait(): SessionDescription {
    return suspendCancellableCoroutine { continuation ->
        createAnswer(object : SdpObserver {
            override fun onCreateSuccess(sessionDescription: SessionDescription?) {
                if (sessionDescription == null) {
                    continuation.resumeWithException(IllegalStateException("Answer description was empty."))
                    return
                }
                continuation.resume(sessionDescription)
            }

            override fun onSetSuccess() = Unit
            override fun onCreateFailure(error: String?) {
                continuation.resumeWithException(IllegalStateException(error ?: "Create answer failed."))
            }

            override fun onSetFailure(error: String?) = Unit
        }, MediaConstraints())
    }
}
