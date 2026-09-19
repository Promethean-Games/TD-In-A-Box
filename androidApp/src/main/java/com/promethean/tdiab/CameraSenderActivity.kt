package com.promethean.tdiab

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.WindowManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView

class CameraSenderActivity : ComponentActivity() {
    private val prefsName = "tdiab_sender_prefs"
    private val pairCodeKey = "last_pair_code"
    private var senderWebView: WebView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val powerManager = getSystemService(PowerManager::class.java)
        val ignoringBatteryOptimizations = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            powerManager?.isIgnoringBatteryOptimizations(packageName) == true
        } else {
            true
        }

        val lastPairCode = getSharedPreferences(prefsName, MODE_PRIVATE).getString(pairCodeKey, "") ?: ""

        setContent {
            SenderScreen(
                initialPairCode = lastPairCode,
                batteryOptimizationsIgnored = ignoringBatteryOptimizations,
                onPairCodePersist = { nextCode ->
                    getSharedPreferences(prefsName, MODE_PRIVATE)
                        .edit()
                        .putString(pairCodeKey, nextCode)
                        .apply()
                },
                onRequestBatteryExemption = ::requestBatteryOptimizationExemption
            ) { pairCode, statusUpdater ->
                val normalizedCode = pairCode.trim().uppercase()
                if (normalizedCode.isBlank()) {
                    statusUpdater("Enter a valid pair code.")
                    return@SenderScreen
                }
                val senderUrl = "https://promethean-games.github.io/TD-In-A-Box/#/camera-link/$normalizedCode"
                statusUpdater("Opening sender link…")
                senderWebView?.loadUrl(senderUrl)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        senderWebView?.onResume()
        senderWebView?.resumeTimers()
    }

    override fun onPause() {
        super.onPause()
        // Keep timers alive for short task switches; the OS may still suspend the process if resources are constrained.
        senderWebView?.onPause()
    }

    override fun onDestroy() {
        senderWebView?.apply {
            stopLoading()
            loadUrl("about:blank")
            removeAllViews()
            destroy()
        }
        senderWebView = null
        super.onDestroy()
    }

    private fun requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        try {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:$packageName")
            }
            startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    @Composable
    private fun SenderScreen(
        initialPairCode: String,
        batteryOptimizationsIgnored: Boolean,
        onPairCodePersist: (String) -> Unit,
        onRequestBatteryExemption: () -> Unit,
        onConnect: (pairCode: String, statusUpdater: (String) -> Unit) -> Unit
    ) {
        var pairCode by remember { mutableStateOf(initialPairCode) }
        var statusText by remember { mutableStateOf("Idle") }

        MaterialTheme {
            Surface(modifier = Modifier.fillMaxSize()) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(
                            Brush.verticalGradient(
                                colors = listOf(Color(0xFF0E1117), Color(0xFF0A0D12), Color(0xFF05070B))
                            )
                        )
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text(
                            "TDTV Camera Sender (Android MVP)",
                            color = Color.White,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            "Use the pair code from the Tournament Broadcast tab, then tap Connect.",
                            color = Color(0xFFB7C0CD)
                        )

                        OutlinedTextField(
                            value = pairCode,
                            onValueChange = {
                                val sanitized = it.uppercase().filter { ch -> ch.isLetterOrDigit() }.take(8)
                                pairCode = sanitized
                                onPairCodePersist(sanitized)
                            },
                            label = { Text("Pair code") },
                            modifier = Modifier.fillMaxWidth(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                            colors = senderFieldColors()
                        )

                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Button(
                                onClick = {
                                    onPairCodePersist(pairCode)
                                    onConnect(pairCode) { statusText = it }
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDF1E2D))
                            ) {
                                Text("Connect")
                            }
                            Button(
                                onClick = {
                                    senderWebView?.reload()
                                    statusText = "Reloading sender page…"
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1F6ECF))
                            ) {
                                Text("Reload")
                            }
                        }

                        if (!batteryOptimizationsIgnored && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            Column(
                                modifier = Modifier.fillMaxWidth(),
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Text(
                                    "Battery optimization can suspend streaming.",
                                    color = Color(0xFFFFD8AA),
                                    modifier = Modifier.fillMaxWidth()
                                )
                                Button(onClick = onRequestBatteryExemption, modifier = Modifier.fillMaxWidth()) {
                                    Text("Allow")
                                }
                            }
                        }

                        Text("Status: $statusText", color = Color(0xFFD4DFEE))
                        Text(
                            "This app keeps the screen awake and auto-grants camera access to the sender page.",
                            color = Color(0xFF8F9BAB)
                        )

                        AndroidView(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(520.dp),
                            factory = { context ->
                                WebView(context).apply {
                                    configureSenderWebView(
                                        onStatus = { statusText = it }
                                    )
                                    senderWebView = this
                                }
                            },
                            update = { senderWebView = it }
                        )
                    }
                }
            }
        }
    }

    private fun WebView.configureSenderWebView(onStatus: (String) -> Unit) {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.loadsImagesAutomatically = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.allowContentAccess = true
        settings.allowFileAccess = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.safeBrowsingEnabled = true
        }

        webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val origin = request.origin.toString()
                if (origin.startsWith("https://promethean-games.github.io")) {
                    request.grant(request.resources)
                    onStatus("Camera permission granted for sender origin.")
                    return
                }
                request.deny()
                onStatus("Blocked media permission for untrusted origin.")
            }
        }

        webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                onStatus("Sender page loaded.")
                super.onPageFinished(view, url)
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    onStatus("Page load failed: ${error?.description ?: "unknown error"}")
                }
                super.onReceivedError(view, request, error)
            }
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
    disabledIndicatorColor = Color(0xFF394860),
    focusedTextColor = Color.White,
    unfocusedTextColor = Color.White,
    disabledTextColor = Color(0xFFDDE4EE)
)
