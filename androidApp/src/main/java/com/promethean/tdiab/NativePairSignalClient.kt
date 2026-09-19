package com.promethean.tdiab

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

@Serializable
data class PairSignalMessagePayload(
    val type: String,
    val from: String,
    val payload: JsonElement? = null,
    val ts: Long
)

@Serializable
private data class PhoenixFrame(
    val topic: String,
    val event: String,
    val payload: JsonObject = buildJsonObject { },
    val ref: String? = null,
    @SerialName("join_ref")
    val joinRef: String? = null
)

@Serializable
private data class PhoenixBroadcastEnvelope(
    val type: String,
    val event: String,
    val payload: PairSignalMessagePayload
)

class NativePairSignalClient(
    private val supabaseUrl: String,
    private val apiKey: String,
    private val pairCode: String,
    private val scope: CoroutineScope,
    private val onSignalMessage: suspend (PairSignalMessagePayload) -> Unit,
    private val onTransportFailure: (String?) -> Unit
) {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }
    private val refCounter = AtomicInteger(1)
    private val topic = "realtime:webrtc-pair-$pairCode"
    private val joinRef = nextRef()
    private val joined = CompletableDeferred<Unit>()
    private val okHttpClient = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()
    private var webSocket: WebSocket? = null
    private var heartbeatJob: Job? = null
    @Volatile
    private var closedExplicitly = false

    suspend fun connect() {
        closedExplicitly = false
        val websocketUrl = buildWebsocketUrl(supabaseUrl, apiKey)
        withContext(Dispatchers.IO) {
            webSocket = okHttpClient.newWebSocket(
                Request.Builder()
                    .url(websocketUrl)
                    .build(),
                Listener()
            )
        }
        joined.await()
    }

    suspend fun send(message: PairSignalMessagePayload) {
        joined.await()
        val frame = PhoenixFrame(
            topic = topic,
            event = "broadcast",
            payload = buildJsonObject {
                put("type", "broadcast")
                put("event", "signal")
                put("payload", json.encodeToJsonElement(PairSignalMessagePayload.serializer(), message))
            },
            ref = nextRef(),
            joinRef = joinRef
        )
        webSocket?.send(json.encodeToString(PhoenixFrame.serializer(), frame))
    }

    suspend fun close() {
        closedExplicitly = true
        heartbeatJob?.cancelAndJoin()
        heartbeatJob = null
        val leaveFrame = PhoenixFrame(
            topic = topic,
            event = "phx_leave",
            payload = buildJsonObject { },
            ref = nextRef(),
            joinRef = joinRef
        )
        webSocket?.send(json.encodeToString(PhoenixFrame.serializer(), leaveFrame))
        webSocket?.close(1000, "client closing")
        webSocket = null
        okHttpClient.dispatcher.executorService.shutdown()
    }

    private fun buildWebsocketUrl(url: String, key: String): String {
        val normalized = url.trim().removeSuffix("/")
        val websocketBase = when {
            normalized.startsWith("https://") -> normalized.replaceFirst("https://", "wss://")
            normalized.startsWith("http://") -> normalized.replaceFirst("http://", "ws://")
            else -> normalized
        }
        return "$websocketBase/realtime/v1/websocket?apikey=$key&vsn=1.0.0"
    }

    private fun nextRef(): String = refCounter.getAndIncrement().toString()

    private fun startHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = scope.launch {
            while (true) {
                delay(25_000)
                val heartbeatFrame = PhoenixFrame(
                    topic = "phoenix",
                    event = "heartbeat",
                    payload = buildJsonObject { },
                    ref = nextRef()
                )
                webSocket?.send(json.encodeToString(PhoenixFrame.serializer(), heartbeatFrame))
            }
        }
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            val joinFrame = PhoenixFrame(
                topic = topic,
                event = "phx_join",
                payload = buildJsonObject {
                    put(
                        "config",
                        buildJsonObject {
                            put(
                                "broadcast",
                                buildJsonObject {
                                    put("ack", false)
                                    put("self", true)
                                }
                            )
                            put(
                                "presence",
                                buildJsonObject {
                                    put("enabled", false)
                                    put("key", "")
                                }
                            )
                            put("postgres_changes", json.parseToJsonElement("[]"))
                            put("private", false)
                        }
                    )
                },
                ref = joinRef,
                joinRef = joinRef
            )
            webSocket.send(json.encodeToString(PhoenixFrame.serializer(), joinFrame))
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val frame = try {
                json.decodeFromString(PhoenixFrame.serializer(), text)
            } catch (_: Throwable) {
                return
            }

            if (frame.event == "phx_reply" && frame.ref == joinRef) {
                val status = frame.payload["status"]?.toString()?.trim('"')
                if (status == "ok" && !joined.isCompleted) {
                    joined.complete(Unit)
                    startHeartbeat()
                } else if (status != "ok" && !joined.isCompleted) {
                    joined.completeExceptionally(IllegalStateException("Supabase signaling join failed."))
                }
                return
            }

            if (frame.event == "broadcast") {
                val broadcastEvent = frame.payload["event"]?.toString()?.trim('"')
                if (broadcastEvent != "signal") return
                val payloadElement = frame.payload["payload"] ?: return
                val message = try {
                    json.decodeFromJsonElement(PairSignalMessagePayload.serializer(), payloadElement)
                } catch (_: Throwable) {
                    return
                }
                scope.launch {
                    onSignalMessage(message)
                }
            }
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            scope.launch {
                heartbeatJob?.cancelAndJoin()
                heartbeatJob = null
            }
            if (!closedExplicitly) {
                onTransportFailure(reason.ifBlank { "Supabase signaling closed." })
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (!joined.isCompleted) {
                joined.completeExceptionally(t)
            }
            if (!closedExplicitly) {
                onTransportFailure(t.message ?: "Supabase signaling failed.")
            }
        }
    }
}
