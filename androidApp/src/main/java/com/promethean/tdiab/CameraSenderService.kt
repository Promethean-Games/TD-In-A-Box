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
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val localBinder = LocalBinder()
    private val _uiState = MutableStateFlow(SenderUiState())
    private val previewRenderers = CopyOnWriteArraySet<SurfaceViewRenderer>()
    private val pendingRemoteIce = mutableListOf<IceCandidate>()
    private var manualDisconnect = false
    private var reconnectJob: Job? = null
    private var activePairCode: String? = null

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
        initializePeerFactory()
    }

    override fun onBind(intent: Intent?): IBinder = localBinder

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CONNECT -> {
                val nextPairCode = intent.getStringExtra(EXTRA_PAIR_CODE)?.trim()?.uppercase().orEmpty()
                if (nextPairCode.isNotBlank()) {
                    serviceScope.launch {
                        connect(nextPairCode)
                    }
                }
            }

            ACTION_DISCONNECT -> {
                serviceScope.launch {
                    disconnectAndStop()
                }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        runBlocking {
            shutdownSession(notifyStop = false)
        }
        peerConnectionFactory?.dispose()
        peerConnectionFactory = null
        eglBase?.release()
        eglBase = null
        serviceScope.cancel()
        super.onDestroy()
    }

    inner class LocalBinder : Binder() {
        val uiState: StateFlow<SenderUiState> = _uiState.asStateFlow()

        fun connect(pairCode: String) {
            serviceScope.launch {
                this@CameraSenderService.connect(pairCode)
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
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(applicationContext)
                .createInitializationOptions()
        )
        eglBase = EglBase.create()
        peerConnectionFactory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(
                DefaultVideoEncoderFactory(
                    eglBase?.eglBaseContext,
                    true,
                    true
                )
            )
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase?.eglBaseContext))
            .createPeerConnectionFactory()
    }

    private suspend fun connect(pairCode: String) {
        if (BuildConfig.SUPABASE_URL.isBlank() || BuildConfig.SUPABASE_ANON_KEY.isBlank()) {
            updateState(
                pairCode = pairCode,
                statusText = "Native sender is missing Supabase config.",
                connectionState = SenderConnectionState.DISCONNECTED,
                isStreaming = false,
                errorText = "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for the Android build."
            )
            return
        }

        manualDisconnect = false
        activePairCode = pairCode
        reconnectJob?.cancel()
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
                onTransportFailure = { reason ->
                    if (manualDisconnect) return@NativePairSignalClient
                    scheduleReconnect(reason ?: "Signaling dropped.")
                }
            )
            signalClient = nextSignalClient
            withContext(Dispatchers.IO) {
                nextSignalClient.connect()
            }

            updateState(
                pairCode = pairCode,
                statusText = "Native camera ready. Waiting for host offer…",
                connectionState = SenderConnectionState.CONNECTING,
                isStreaming = true,
                errorText = null
            )
            repeat(3) { attempt ->
                nextSignalClient.send(PairSignalMessagePayload(type = "ready", from = "sender", ts = System.currentTimeMillis()))
                if (attempt < 2) delay(1_200)
            }
        } catch (error: Throwable) {
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

    private suspend fun startLocalVideoCapture(): VideoTrack {
        val factory = peerConnectionFactory ?: error("PeerConnectionFactory was not initialized.")
        val eglContext = eglBase?.eglBaseContext ?: error("EGL context unavailable.")
        val capturer = createVideoCapturer() ?: error("No usable Android camera was found.")
        val helper = SurfaceTextureHelper.create("TDIAB-CameraCapture", eglContext)
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
                    val currentSignalClient = signalClient ?: return
                    serviceScope.launch {
                        currentSignalClient.send(
                            PairSignalMessagePayload(
                                type = "ice",
                                from = "sender",
                                ts = System.currentTimeMillis(),
                                payload = buildJsonObject {
                                    put("candidate", candidate.sdp)
                                    candidate.sdpMid?.let { put("sdpMid", it) } ?: put("sdpMid", JsonNull)
                                    put("sdpMLineIndex", candidate.sdpMLineIndex)
                                }
                            )
                        )
                    }
                }

                override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
                    when (newState) {
                        PeerConnection.PeerConnectionState.CONNECTED -> {
                            updateState(
                                pairCode = activePairCode.orEmpty(),
                                statusText = "Native stream live.",
                                connectionState = SenderConnectionState.CONNECTED,
                                isStreaming = true,
                                errorText = null
                            )
                        }

                        PeerConnection.PeerConnectionState.DISCONNECTED,
                        PeerConnection.PeerConnectionState.FAILED -> {
                            if (!manualDisconnect) {
                                scheduleReconnect("WebRTC connection ${newState.name.lowercase()}.")
                            }
                        }

                        else -> Unit
                    }
                }

                override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
                    if ((state == PeerConnection.IceConnectionState.FAILED || state == PeerConnection.IceConnectionState.DISCONNECTED) && !manualDisconnect) {
                        scheduleReconnect("ICE ${state.name.lowercase()}.")
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
        val rtcPeer = peerConnection ?: return
        val currentSignalClient = signalClient ?: return

        when (message.type) {
            "offer" -> {
                if (rtcPeer.signalingState() != PeerConnection.SignalingState.STABLE || rtcPeer.remoteDescription != null) {
                    return
                }
                val payload = message.payload as? JsonObject ?: return
                val sdp = payload["sdp"]?.jsonPrimitive?.content ?: return
                rtcPeer.setRemoteDescriptionAwait(SessionDescription(SessionDescription.Type.OFFER, sdp))
                drainPendingIce(rtcPeer)
                val answer = rtcPeer.createAnswerAwait()
                rtcPeer.setLocalDescriptionAwait(answer)
                currentSignalClient.send(
                    PairSignalMessagePayload(
                        type = "answer",
                        from = "sender",
                        ts = System.currentTimeMillis(),
                        payload = buildJsonObject {
                            put("type", answer.type.canonicalForm())
                            put("sdp", answer.description)
                        }
                    )
                )
                updateState(
                    pairCode = activePairCode.orEmpty(),
                    statusText = "Answer sent. Finishing secure connection…",
                    connectionState = SenderConnectionState.CONNECTING,
                    isStreaming = true,
                    errorText = null
                )
            }

            "ice" -> {
                val payload = message.payload as? JsonObject ?: return
                val candidate = payload.toIceCandidate() ?: return
                if (rtcPeer.remoteDescription != null) {
                    rtcPeer.addIceCandidate(candidate)
                } else {
                    pendingRemoteIce += candidate
                }
            }

            "stop" -> {
                manualDisconnect = true
                shutdownSession(notifyStop = false)
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
    }

    private suspend fun drainPendingIce(connection: PeerConnection) {
        if (pendingRemoteIce.isEmpty()) return
        val queued = pendingRemoteIce.toList()
        pendingRemoteIce.clear()
        queued.forEach { connection.addIceCandidate(it) }
    }

    private fun scheduleReconnect(reason: String) {
        val pairCode = activePairCode ?: return
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
            shutdownSession(notifyStop = false, clearPairCode = false, stopForegroundSession = false)
            delay(1_500)
            if (!manualDisconnect && activePairCode == pairCode) {
                connect(pairCode)
            }
        }
    }

    private suspend fun disconnectAndStop() {
        manualDisconnect = true
        activePairCode = null
        shutdownSession(notifyStop = true)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private suspend fun shutdownSession(
        notifyStop: Boolean,
        clearPairCode: Boolean = true,
        stopForegroundSession: Boolean = false
    ) {
        reconnectJob?.cancel()
        reconnectJob = null

        val currentSignalClient = signalClient
        signalClient = null
        if (notifyStop) {
            runCatching {
                currentSignalClient?.send(
                    PairSignalMessagePayload(
                        type = "stop",
                        from = "sender",
                        ts = System.currentTimeMillis()
                    )
                )
            }
        }
        runCatching {
            currentSignalClient?.close()
        }

        pendingRemoteIce.clear()
        videoSender?.dispose()
        videoSender = null
        peerConnection?.dispose()
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

        surfaceTextureHelper?.dispose()
        surfaceTextureHelper = null
        videoSource?.dispose()
        videoSource = null

        if (clearPairCode) {
            activePairCode = null
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

    companion object {
        private const val NOTIFICATION_CHANNEL_ID = "tdiab-camera-sender"
        private const val NOTIFICATION_ID = 4307
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
