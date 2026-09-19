package com.promethean.tdiab

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.PowerManager
import android.provider.Settings
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Expand
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.webrtc.SurfaceViewRenderer
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class CameraSenderActivity : ComponentActivity() {
    private val prefsName = "tdiab_sender_prefs"
    private val pairCodeKey = "last_pair_code"
    private lateinit var sharedPreferences: SharedPreferences
    private var senderBinder: CameraSenderService.LocalBinder? = null
    private var binderCollectionJob: Job? = null
    private var isServiceBound = false
    private var localStatusText by mutableStateOf("Idle")
    private var localErrorText by mutableStateOf<String?>(null)
    private var serviceUiState by mutableStateOf(SenderUiState())
    private var pendingConnectPairCode: String? = null

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as? CameraSenderService.LocalBinder ?: run {
                senderBinder = null
                isServiceBound = false
                localStatusText = "Camera service unavailable"
                localErrorText = "Unable to bind the live camera sender service."
                return
            }
            senderBinder = binder
            isServiceBound = true
            binderCollectionJob?.cancel()
            val stateFlow = runCatching { binder.uiState }.getOrNull()
            if (stateFlow == null) {
                localStatusText = "Camera service state unavailable"
                localErrorText = "Unable to subscribe to camera service state."
                return
            }
            binderCollectionJob = lifecycleScope.launch {
                stateFlow.collect { nextState ->
                    serviceUiState = nextState
                    if (nextState.errorText != null) {
                        localErrorText = nextState.errorText
                    }
                }
            }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            binderCollectionJob?.cancel()
            binderCollectionJob = null
            senderBinder = null
            isServiceBound = false
        }
    }

    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        val pairCode = pendingConnectPairCode
        pendingConnectPairCode = null
        if (!granted) {
            localErrorText = "Camera permission is required to stream from this device."
            return@registerForActivityResult
        }
        if (!pairCode.isNullOrBlank()) {
            startNativeSender(pairCode)
        }
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* foreground service can still run; no-op */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        sharedPreferences = getSharedPreferences(prefsName, MODE_PRIVATE)

        setContent {
            CameraSenderScreen(
                initialPairCode = sharedPreferences.getString(pairCodeKey, "").orEmpty(),
                batteryOptimizationsIgnored = batteryOptimizationsIgnored(),
                batteryPercent = readBatteryPercent(),
                uiState = serviceUiState,
                fallbackStatusText = localStatusText,
                fallbackErrorText = localErrorText,
                binder = senderBinder,
                onPersistPairCode = { nextPairCode ->
                    sharedPreferences.edit().putString(pairCodeKey, nextPairCode).apply()
                },
                onRequestBatteryExemption = ::requestBatteryOptimizationExemption,
                onConnect = ::prepareNativeConnect,
                onDisconnect = {
                    localStatusText = "Stopping native sender…"
                    CameraSenderService.stopSender(this)
                }
            )
        }
    }

    override fun onStart() {
        super.onStart()
        if (!isServiceBound) {
            runCatching {
                val bound = bindService(
                    Intent(this, CameraSenderService::class.java),
                    serviceConnection,
                    Context.BIND_AUTO_CREATE
                )
                isServiceBound = bound
                if (!bound) {
                    localStatusText = "Camera service unavailable"
                }
            }.onFailure {
                isServiceBound = false
                localStatusText = "Launcher could not bind to the camera service"
                localErrorText = it.message ?: "Service binding failed."
            }
        }
    }

    override fun onStop() {
        binderCollectionJob?.cancel()
        binderCollectionJob = null
        if (isServiceBound) {
            runCatching { unbindService(serviceConnection) }
            isServiceBound = false
        }
        senderBinder = null
        super.onStop()
    }

    private fun prepareNativeConnect(pairCode: String) {
        val normalized = pairCode.trim().uppercase().filter { it.isLetterOrDigit() }.take(8)
        if (normalized.isBlank()) {
            localErrorText = "Enter a valid pair code."
            return
        }

        sharedPreferences.edit().putString(pairCodeKey, normalized).apply()
        localErrorText = null
        localStatusText = "Preparing native sender…"

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            pendingConnectPairCode = normalized
            localStatusText = "Requesting camera permission…"
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        startNativeSender(normalized)
    }

    private fun startNativeSender(pairCode: String) {
        localStatusText = "Starting native foreground sender…"
        runCatching {
            CameraSenderService.startSender(this, pairCode)
        }.onFailure {
            localStatusText = "Unable to start the camera sender"
            localErrorText = it.message ?: "Service start failed."
        }
    }

    private fun batteryOptimizationsIgnored(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
        val powerManager = getSystemService(PowerManager::class.java)
        return powerManager?.isIgnoringBatteryOptimizations(packageName) == true
    }

    private fun requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        try {
            startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = android.net.Uri.parse("package:$packageName")
                }
            )
        } catch (_: ActivityNotFoundException) {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }
}

@Composable
private fun CameraSenderScreen(
    initialPairCode: String,
    batteryOptimizationsIgnored: Boolean,
    batteryPercent: Int?,
    uiState: SenderUiState,
    fallbackStatusText: String,
    fallbackErrorText: String?,
    binder: CameraSenderService.LocalBinder?,
    onPersistPairCode: (String) -> Unit,
    onRequestBatteryExemption: () -> Unit,
    onConnect: (String) -> Unit,
    onDisconnect: () -> Unit
) {
    var pairCode by remember { mutableStateOf(initialPairCode) }
    var isPreviewFullscreen by remember { mutableStateOf(false) }
    var pairSectionExpanded by remember { mutableStateOf(true) }
    var guideSectionExpanded by remember { mutableStateOf(true) }
    var previewSectionExpanded by remember { mutableStateOf(true) }
    var connectionSectionExpanded by remember { mutableStateOf(false) }
    var advancedSectionExpanded by remember { mutableStateOf(false) }
    var currentTimeLabel by remember { mutableStateOf(formattedClock()) }

    val effectiveStatus = if (uiState.statusText != "Idle" || uiState.isStreaming || uiState.pairCode.isNotBlank()) {
        uiState.statusText
    } else {
        fallbackStatusText
    }
    val effectiveError = uiState.errorText ?: fallbackErrorText
    val isConnected = uiState.connectionState == SenderConnectionState.CONNECTED
    val isConnecting = uiState.connectionState == SenderConnectionState.CONNECTING && !isConnected
    val effectivePairCode = uiState.pairCode.ifBlank { pairCode }
    val qualityLabel = when (uiState.connectionState) {
        SenderConnectionState.CONNECTED -> "Excellent"
        SenderConnectionState.CONNECTING -> "Linking"
        SenderConnectionState.DISCONNECTED -> if (effectiveError != null) "Needs attention" else "Ready"
    }
    val liveLabel = when {
        isConnected -> "LIVE"
        isConnecting -> "LINKING"
        effectiveError != null -> "ALERT"
        else -> "READY"
    }
    val liveColor = when {
        isConnected -> Color(0xFF27F08E)
        isConnecting -> Color(0xFF64D7FF)
        effectiveError != null -> Color(0xFFFF96A2)
        else -> Color(0xFFE2E8F0)
    }
    val primaryActionLabel = when {
        isConnected -> "Stop Camera"
        isConnecting -> "Connecting…"
        else -> "Connect Camera"
    }

    LaunchedEffect(Unit) {
        while (true) {
            currentTimeLabel = formattedClock()
            delay(30_000)
        }
    }

    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                Color(0xFF040812),
                                Color(0xFF050B16),
                                Color(0xFF03070F)
                            )
                        )
                    )
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp, vertical = 14.dp)
                        .padding(bottom = 32.dp)
                        .statusBarsPadding(),
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    StatusBarRow(
                        timeLabel = currentTimeLabel,
                        batteryPercent = batteryPercent,
                        qualityLabel = qualityLabel
                    )

                    BrandHeader()

                    HeroCard(
                        liveLabel = liveLabel,
                        liveColor = liveColor,
                        qualityLabel = qualityLabel,
                        effectiveStatus = effectiveStatus,
                        pairCode = effectivePairCode,
                        batteryPercent = batteryPercent,
                        isConnected = isConnected,
                        isConnecting = isConnecting
                    )

                    Button(
                        onClick = {
                            if (isConnected) {
                                onDisconnect()
                            } else {
                                onConnect(pairCode)
                            }
                        },
                        enabled = !isConnecting || isConnected,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(68.dp),
                        shape = RoundedCornerShape(24.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (isConnected) Color(0xFFE11D37) else Color(0xFF10B86C),
                            disabledContainerColor = if (isConnected) Color(0xFF9F1239) else Color(0xFF0E7A49)
                        )
                    ) {
                        Text(
                            primaryActionLabel,
                            fontSize = 24.sp,
                            fontWeight = FontWeight.ExtraBold
                        )
                    }

                    if (effectiveError != null) {
                        ErrorCard(effectiveError)
                    }

                    CollapsibleSection(
                        title = if (isConnected) "Pair Code (Not Needed)" else "Pair Code",
                        subtitle = if (isConnected) {
                            "Camera is currently connected."
                        } else {
                            "Use the code from the tournament broadcast host."
                        },
                        expanded = pairSectionExpanded,
                        onToggle = { pairSectionExpanded = !pairSectionExpanded }
                    ) {
                        if (isConnected) {
                            StatusInfoCard("Pair code entry hides while the native camera sender is already live.")
                        } else {
                            PairCodePanel(
                                pairCode = pairCode,
                                onPairCodeChange = { next ->
                                    val sanitized = next.uppercase().filter { it.isLetterOrDigit() }.take(8)
                                    pairCode = sanitized
                                    onPersistPairCode(sanitized)
                                },
                                onConnect = { onConnect(pairCode) }
                            )
                        }
                    }

                    CollapsibleSection(
                        title = "Setup Guide",
                        subtitle = "3 quick steps to get this phone live.",
                        expanded = guideSectionExpanded,
                        onToggle = { guideSectionExpanded = !guideSectionExpanded }
                    ) {
                        SetupGuideSection()
                    }

                    CollapsibleSection(
                        title = "Camera Preview",
                        subtitle = "Frame the table so overlays stay readable.",
                        expanded = previewSectionExpanded,
                        onToggle = { previewSectionExpanded = !previewSectionExpanded }
                    ) {
                        PreviewCard(
                            binder = binder,
                            isStreaming = uiState.isStreaming,
                            onFullscreen = { isPreviewFullscreen = true }
                        )
                    }

                    CollapsibleSection(
                        title = "Connection",
                        subtitle = "Current link health and sender state.",
                        expanded = connectionSectionExpanded,
                        onToggle = { connectionSectionExpanded = !connectionSectionExpanded }
                    ) {
                        ConnectionTiles(
                            status = effectiveStatus,
                            quality = qualityLabel,
                            pairCode = effectivePairCode.ifBlank { "Waiting" },
                            batteryPercent = batteryPercent
                        )
                    }

                    CollapsibleSection(
                        title = "Advanced / Troubleshooting",
                        subtitle = "Diagnostics, compatibility, and support actions.",
                        expanded = advancedSectionExpanded,
                        onToggle = { advancedSectionExpanded = !advancedSectionExpanded }
                    ) {
                        AdvancedSection(
                            batteryOptimizationsIgnored = batteryOptimizationsIgnored,
                            pairCode = effectivePairCode,
                            onRequestBatteryExemption = onRequestBatteryExemption,
                            onReconnect = { onConnect(pairCode) },
                            onDisconnect = onDisconnect
                        )
                    }
                }
            }
        }
    }

    if (isPreviewFullscreen) {
        androidx.compose.ui.window.Dialog(onDismissRequest = { isPreviewFullscreen = false }) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black)
            ) {
                PreviewSurface(
                    binder = binder,
                    modifier = Modifier.fillMaxSize()
                )
                OverlayGuides(compact = false, modifier = Modifier.fillMaxSize())
                TextButton(
                    onClick = { isPreviewFullscreen = false },
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(16.dp)
                ) {
                    Text("Close")
                }
            }
        }
    }
}

@Composable
private fun StatusBarRow(
    timeLabel: String,
    batteryPercent: Int?,
    qualityLabel: String
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            timeLabel,
            color = Color.White,
            fontWeight = FontWeight.Bold,
            fontSize = 18.sp
        )
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                qualityLabel,
                color = Color(0xFFD7E3F3),
                fontSize = 13.sp
            )
            Text(
                batteryPercent?.let { "$it%" } ?: "--%",
                color = Color.White,
                fontWeight = FontWeight.SemiBold
            )
        }
    }
}

@Composable
private fun BrandHeader() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(
            modifier = Modifier
                .weight(0.42f)
                .border(1.dp, Color(0x2FFFFFFF), RoundedCornerShape(24.dp))
                .padding(horizontal = 14.dp, vertical = 12.dp)
        ) {
            Text(
                "TDTV",
                color = Color(0xFFFF425B),
                fontSize = 34.sp,
                fontWeight = FontWeight.Black,
                lineHeight = 32.sp
            )
            Text(
                "TDIAB NETWORK",
                color = Color(0xFFB9C6D8),
                fontSize = 10.sp,
                letterSpacing = 2.sp
            )
        }
        Column(
            modifier = Modifier.weight(0.58f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                "REMOTE CAMERA",
                color = Color.White,
                fontWeight = FontWeight.Bold,
                letterSpacing = 2.sp,
                fontSize = 22.sp
            )
            Text(
                "CAPTURE • STREAM • TDTV",
                color = Color(0xFF90A1B8),
                fontSize = 11.sp,
                letterSpacing = 3.sp
            )
        }
    }
}

@Composable
private fun HeroCard(
    liveLabel: String,
    liveColor: Color,
    qualityLabel: String,
    effectiveStatus: String,
    pairCode: String,
    batteryPercent: Int?,
    isConnected: Boolean,
    isConnecting: Boolean
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFF0A101A)),
        shape = RoundedCornerShape(28.dp),
        modifier = Modifier.fillMaxWidth(),
        elevation = CardDefaults.cardElevation(defaultElevation = 12.dp)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    Brush.horizontalGradient(
                        colors = listOf(Color(0xFF0B121D), Color(0xFF0A1018), Color(0xFF121318))
                    )
                )
                .padding(18.dp)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(Color(0x16000000))
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(16.dp)
                                .clip(CircleShape)
                                .background(liveColor)
                        )
                        Text(
                            liveLabel,
                            color = liveColor,
                            fontWeight = FontWeight.Black,
                            fontSize = 24.sp,
                            letterSpacing = 2.sp
                        )
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(
                            qualityLabel,
                            color = Color(0xFF39F39F),
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp
                        )
                        Text(
                            if (isConnected) "Connected to TDTV" else if (isConnecting) "Negotiating link" else "Waiting for host",
                            color = Color(0xFF91A0B2),
                            fontSize = 11.sp
                        )
                    }
                }

                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        if (isConnected) "REMOTE CAMERA" else "REMOTE CAMERA STANDBY",
                        color = Color.White,
                        fontSize = 24.sp,
                        fontWeight = FontWeight.ExtraBold,
                        letterSpacing = 1.sp
                    )
                    Text(
                        effectiveStatus,
                        color = Color(0xFFAAB6C5),
                        fontSize = 13.sp,
                        letterSpacing = 2.sp
                    )
                }

                ConnectionTiles(
                    status = pairCode.ifBlank { "Waiting" },
                    quality = if (isConnected) "Camera Active" else if (isConnecting) "Connecting" else "Ready",
                    pairCode = batteryPercent?.let { "$it%" } ?: "--%",
                    batteryPercent = null,
                    compact = true
                )
            }
        }
    }
}

@Composable
private fun CollapsibleSection(
    title: String,
    subtitle: String,
    expanded: Boolean,
    onToggle: () -> Unit,
    content: @Composable () -> Unit
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFF09111B)),
        shape = RoundedCornerShape(24.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            TextButton(
                onClick = onToggle,
                modifier = Modifier.fillMaxWidth(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(18.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.Top
                ) {
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text(
                            title,
                            color = Color.White,
                            fontWeight = FontWeight.SemiBold,
                            textAlign = TextAlign.Start
                        )
                        Text(
                            subtitle,
                            color = Color(0xFF8E9EB4),
                            textAlign = TextAlign.Start,
                            fontSize = 13.sp
                        )
                    }
                    Text(
                        if (expanded) "Hide" else "Show",
                        color = Color(0xFFBFCBDD),
                        fontSize = 12.sp
                    )
                }
            }
            if (expanded) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 18.dp)
                        .padding(bottom = 18.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    content()
                }
            }
        }
    }
}

@Composable
private fun PairCodePanel(
    pairCode: String,
    onPairCodeChange: (String) -> Unit,
    onConnect: () -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedTextField(
            value = pairCode,
            onValueChange = onPairCodeChange,
            label = { Text("Pair code") },
            modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
            colors = senderFieldColors()
        )
        Button(
            onClick = onConnect,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(18.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF11B76B))
        ) {
            Text("Connect Camera", fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun SetupGuideSection() {
    val steps = listOf(
        "Open Tournament Broadcast" to "Start a broadcast from the TDIAB app on the host device.",
        "Get Pair Code" to "Copy the code from the broadcast tab so this phone can join the session.",
        "Connect Camera" to "Enter the code here and tap Connect Camera."
    )

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        steps.forEachIndexed { index, (title, body) ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                Box(
                    modifier = Modifier
                        .size(42.dp)
                        .clip(CircleShape)
                        .border(2.dp, Color(0xFFFF3C57), CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Text("${index + 1}", color = Color.White, fontWeight = FontWeight.Bold)
                }
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(title, color = Color.White, fontWeight = FontWeight.SemiBold)
                    Text(body, color = Color(0xFF92A2B8), fontSize = 13.sp)
                }
            }
        }
    }
}

@Composable
private fun ErrorCard(message: String) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFF32131A)),
        shape = RoundedCornerShape(22.dp)
    ) {
        Text(
            message,
            color = Color(0xFFFFC1C8),
            modifier = Modifier
                .fillMaxWidth()
                .padding(18.dp)
        )
    }
}

@Composable
private fun StatusInfoCard(message: String) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFF101822)),
        shape = RoundedCornerShape(18.dp)
    ) {
        Text(
            message,
            color = Color(0xFFB7C0CD),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        )
    }
}

@Composable
private fun PreviewCard(
    binder: CameraSenderService.LocalBinder?,
    isStreaming: Boolean,
    onFullscreen: () -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                "Live preview",
                color = Color.White,
                fontWeight = FontWeight.Bold
            )
            TextButton(onClick = onFullscreen, enabled = isStreaming) {
                androidx.compose.material3.Icon(
                    painter = rememberVectorPainter(Icons.Outlined.Expand),
                    contentDescription = null,
                    tint = Color(0xFFBFD0E4)
                )
                Spacer(Modifier.width(6.dp))
                Text("Fullscreen", color = Color(0xFFBFD0E4))
            }
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(10f / 16f)
                .clip(RoundedCornerShape(24.dp))
                .background(Color(0xFF04070C))
        ) {
            if (isStreaming) {
                PreviewSurface(
                    binder = binder,
                    modifier = Modifier.fillMaxSize()
                )
            } else {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        "Connect the sender to load the native camera preview.",
                        color = Color(0xFF97A4B7),
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 18.dp)
                    )
                }
            }
            OverlayGuides(compact = true, modifier = Modifier.fillMaxSize())
        }

        Text(
            "Keep the table centered with extra room around the rails so the TDTV lower-thirds stay readable.",
            color = Color(0xFF92A2B8),
            fontSize = 13.sp
        )
    }
}

@Composable
private fun ConnectionTiles(
    status: String,
    quality: String,
    pairCode: String,
    batteryPercent: Int?,
    compact: Boolean = false
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            InfoTile(
                title = if (compact) "Camera" else "Host link",
                value = status,
                modifier = Modifier.weight(1f),
                highlight = compact
            )
            InfoTile(
                title = if (compact) "Signal" else "Network quality",
                value = quality,
                modifier = Modifier.weight(1f)
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            InfoTile(
                title = if (compact) "Battery" else "Pair code",
                value = pairCode,
                modifier = Modifier.weight(1f)
            )
            InfoTile(
                title = if (compact) "Status" else "Battery",
                value = batteryPercent?.let { "$it%" } ?: if (compact) "Strong" else "--%",
                modifier = Modifier.weight(1f)
            )
        }
    }
}

@Composable
private fun InfoTile(
    title: String,
    value: String,
    modifier: Modifier = Modifier,
    highlight: Boolean = false
) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (highlight) Color(0xFF09281A) else Color(0xFF0D1621)
        ),
        shape = RoundedCornerShape(18.dp),
        modifier = modifier
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(
                title.uppercase(Locale.getDefault()),
                color = Color(0xFF7E92AC),
                fontSize = 11.sp,
                letterSpacing = 1.sp
            )
            Text(
                value,
                color = if (highlight) Color(0xFF5DFFB1) else Color.White,
                fontWeight = FontWeight.Bold
            )
        }
    }
}

@Composable
private fun AdvancedSection(
    batteryOptimizationsIgnored: Boolean,
    pairCode: String,
    onRequestBatteryExemption: () -> Unit,
    onReconnect: () -> Unit,
    onDisconnect: () -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        StatusInfoCard(
            if (batteryOptimizationsIgnored) {
                "Battery optimization is already relaxed for this app."
            } else {
                "Battery optimization can still interrupt long broadcasts on some devices."
            }
        )

        if (!batteryOptimizationsIgnored && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Button(
                onClick = onRequestBatteryExemption,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2A170B))
            ) {
                Text("Allow background exemption", color = Color(0xFFFFE8C9))
            }
        }

        Button(
            onClick = onReconnect,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(18.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF132334))
        ) {
            Text("Retry Camera Link${if (pairCode.isNotBlank()) " • $pairCode" else ""}")
        }

        Button(
            onClick = onDisconnect,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(18.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3B1620))
        ) {
            Text("Stop Camera", color = Color(0xFFFFCFD6))
        }
    }
}

@Composable
private fun PreviewSurface(
    binder: CameraSenderService.LocalBinder?,
    modifier: Modifier = Modifier
) {
    var renderer by remember { mutableStateOf<SurfaceViewRenderer?>(null) }
    val currentBinder = binder

    AndroidView(
        modifier = modifier,
        factory = { context ->
            SurfaceViewRenderer(context).also { created ->
                renderer = created
                currentBinder?.attachPreview(created)
            }
        },
        update = { view ->
            renderer = view
            currentBinder?.attachPreview(view)
        }
    )

    DisposableEffect(currentBinder, renderer) {
        onDispose {
            val activeRenderer = renderer ?: return@onDispose
            currentBinder?.detachPreview(activeRenderer)
            renderer = null
        }
    }
}

@Composable
private fun OverlayGuides(compact: Boolean, modifier: Modifier = Modifier) {
    Box(modifier = modifier.padding(if (compact) 14.dp else 24.dp)) {
        Row(
            modifier = Modifier
                .align(Alignment.TopStart)
                .clip(RoundedCornerShape(999.dp))
                .background(Color(0xAA111827))
                .padding(horizontal = 10.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(Color(0xFFFF4D5D))
            )
            Text(
                if (compact) "LIVE LINKED" else "TDTV PREVIEW",
                color = Color.White,
                fontSize = if (compact) 11.sp else 13.sp,
                letterSpacing = 1.sp
            )
        }

        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .clip(RoundedCornerShape(20.dp))
                .background(Color(0x9A0B1017))
                .padding(if (compact) 10.dp else 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                "FEATURED TABLE",
                color = Color(0xFFD6E3F3),
                fontSize = if (compact) 10.sp else 12.sp,
                letterSpacing = 2.sp
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OverlayPlayerCard(
                    label = "Red",
                    player = "Player A",
                    color = Brush.horizontalGradient(listOf(Color(0xFFB91C1C), Color(0xFFEF4444))),
                    modifier = Modifier.weight(1f)
                )
                Text(
                    "VS",
                    color = Color.White,
                    fontSize = if (compact) 11.sp else 14.sp,
                    letterSpacing = 2.sp
                )
                OverlayPlayerCard(
                    label = "Blue",
                    player = "Player B",
                    color = Brush.horizontalGradient(listOf(Color(0xFF1D4ED8), Color(0xFF60A5FA))),
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }
}

@Composable
private fun OverlayPlayerCard(
    label: String,
    player: String,
    color: Brush,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(16.dp))
            .background(color)
            .padding(horizontal = 12.dp, vertical = 10.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                label.uppercase(Locale.getDefault()),
                color = Color(0xFFF8FAFC),
                fontSize = 10.sp,
                letterSpacing = 1.sp
            )
            Text(
                player,
                color = Color.White,
                fontWeight = FontWeight.Bold
            )
        }
    }
}

@Composable
private fun senderFieldColors() = TextFieldDefaults.colors(
    focusedContainerColor = Color(0xFF0F151B),
    unfocusedContainerColor = Color(0xFF0F151B),
    disabledContainerColor = Color(0xFF0F151B),
    focusedIndicatorColor = Color(0xFFDF1E2D),
    unfocusedIndicatorColor = Color(0xFF394860),
    focusedTextColor = Color.White,
    unfocusedTextColor = Color.White,
    focusedLabelColor = Color(0xFFFFD5D8),
    unfocusedLabelColor = Color(0xFF8F9BAB)
)

private fun Context.readBatteryPercent(): Int? {
    val batteryManager = getSystemService(BatteryManager::class.java) ?: return null
    val value = batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    return if (value in 1..100) value else null
}

private fun formattedClock(): String {
    return SimpleDateFormat("h:mm", Locale.getDefault()).format(Date())
}
