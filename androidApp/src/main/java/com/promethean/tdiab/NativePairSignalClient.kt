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
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.ArrayDeque
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

@Serializable
data class PairSignalMessagePayload(
    val type: String,
    val from: String,
    val payload: JsonElement? = null,
    val ts: Long,
    val sessionId: String? = null
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
    private data class ParsedPhoenixFrame(
        val topic: String,
        val event: String,
        val payload: JsonObject,
        val ref: String?
    )

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
        val socket = webSocket ?: throw IllegalStateException("Supabase signaling socket is not connected.")
        val frame = PhoenixFrame(
            topic = topic,
            event = "broadcast",
            payload = buildJsonObject {
                put("type", "broadcast")
                put("event", "signal")
                put(
                    "payload",
                    buildJsonObject {
                        put("version", 1)
                        put("pairCode", pairCode)
                        put("sessionId", message.sessionId)
                        put("message", json.encodeToJsonElement(PairSignalMessagePayload.serializer(), message))
                    }
                )
            },
            ref = nextRef(),
            joinRef = joinRef
        )
        val encodedFrame = json.encodeToString(PhoenixFrame.serializer(), frame)
        val queued = socket.send(encodedFrame)
        if (!queued) {
            throw IllegalStateException("Supabase signaling socket rejected the outbound signal.")
        }
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

    private fun enqueueJsonCandidate(queue: ArrayDeque<JsonElement>, candidate: JsonElement?) {
        if (candidate == null || candidate is kotlinx.serialization.json.JsonNull) return
        queue.add(candidate)

        val primitive = candidate as? JsonPrimitive ?: return
        if (!primitive.isString) return

        val raw = primitive.content.trim()
        if (raw.isEmpty() || (raw.first() != '{' && raw.first() != '[')) return

        runCatching {
            json.parseToJsonElement(raw)
        }.getOrNull()?.let { parsed ->
            queue.add(parsed)
        }
    }

    private fun extractSignalPayload(element: JsonElement?): JsonElement? {
        if (element == null) return null

        val queue = ArrayDeque<JsonElement>()
        queue.add(element)

        while (queue.isNotEmpty()) {
            val current = queue.removeFirst()
            val currentObject = current as? JsonObject ?: continue
            val typeName = currentObject["type"]?.jsonPrimitive?.content
            val fromName = currentObject["from"]?.jsonPrimitive?.content
            val hasSignalShape = typeName in setOf("ready", "offer", "answer", "ice", "stop", "error") || !fromName.isNullOrBlank()
            val hasPayload = currentObject["payload"] != null || currentObject["ts"] != null || currentObject["message"] != null

            if (hasSignalShape && hasPayload) {
                return currentObject
            }

            currentObject.values.forEach { value -> enqueueJsonCandidate(queue, value) }
        }

        return element
    }

    private fun decodeSignalMessage(rawPayload: JsonElement?): PairSignalMessagePayload? {
        if (rawPayload == null) return null

        val queue = ArrayDeque<JsonElement>()
        queue.add(rawPayload)

        while (queue.isNotEmpty()) {
            val current = queue.removeFirst()
            val objectCandidate = current as? JsonObject ?: continue
            val typeName = objectCandidate["type"]?.jsonPrimitive?.content
            val fromName = objectCandidate["from"]?.jsonPrimitive?.content

            if (typeName in setOf("ready", "offer", "answer", "ice", "stop", "error") || !fromName.isNullOrBlank()) {
                val normalized = try {
                    json.decodeFromJsonElement(PairSignalMessagePayload.serializer(), objectCandidate)
                } catch (_: Throwable) {
                    null
                }
                if (normalized != null) return normalized
            }

            objectCandidate.values.forEach { value -> enqueueJsonCandidate(queue, value) }
        }

        return null
    }

    private fun decodePhoenixFrame(text: String): ParsedPhoenixFrame? {
        val parsed = runCatching { json.parseToJsonElement(text) }.getOrNull() ?: return null
        val parsedObject = parsed as? JsonObject
        if (parsedObject != null) {
            val topic = parsedObject["topic"]?.jsonPrimitive?.contentOrNull ?: return null
            val event = parsedObject["event"]?.jsonPrimitive?.contentOrNull ?: return null
            val payload = parsedObject["payload"] as? JsonObject ?: buildJsonObject { }
            val ref = parsedObject["ref"]?.jsonPrimitive?.contentOrNull
            return ParsedPhoenixFrame(topic = topic, event = event, payload = payload, ref = ref)
        }

        val parsedArray = parsed as? JsonArray ?: return null
        if (parsedArray.size < 5) return null
        val topic = parsedArray.getOrNull(2)?.jsonPrimitive?.contentOrNull ?: return null
        val event = parsedArray.getOrNull(3)?.jsonPrimitive?.contentOrNull ?: return null
        val payload = parsedArray.getOrNull(4) as? JsonObject ?: buildJsonObject { }
        val ref = parsedArray.getOrNull(1)?.jsonPrimitive?.contentOrNull
        return ParsedPhoenixFrame(topic = topic, event = event, payload = payload, ref = ref)
    }

    private fun logSignalTrace(stage: String, detail: String, severity: String = "INFO") {
        ApplicationReportHub.recordConnection(
            pairCode = pairCode,
            stage = stage,
            detail = detail,
            severity = severity
        )
    }

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
            val frame = decodePhoenixFrame(text)
            if (frame == null) {
                logSignalTrace(
                    "native-signal-frame-decode-failed",
                    "Unable to decode inbound realtime frame; rawPrefix=${text.take(240)}",
                    "WARN"
                )
                return
            }

            if (frame.event == "phx_reply" && frame.ref == joinRef) {
                val status = frame.payload["status"]?.jsonPrimitive?.contentOrNull
                if (status == "ok" && !joined.isCompleted) {
                    joined.complete(Unit)
                    startHeartbeat()
                } else if (status != "ok" && !joined.isCompleted) {
                    joined.completeExceptionally(IllegalStateException("Supabase signaling join failed."))
                }
                return
            }

            if (frame.event == "broadcast" || frame.event == "signal") {
                logSignalTrace(
                    "native-signal-frame-received",
                    "Received realtime broadcast on ${frame.topic}; event=${frame.event}; payloadKeys=${frame.payload.keys.joinToString()}"
                )
                val normalizedPayload = extractSignalPayload(frame.payload)
                if (normalizedPayload == null) {
                    logSignalTrace(
                        "native-signal-payload-normalization-failed",
                        "Realtime broadcast payload was present but could not be normalized.",
                        "WARN"
                    )
                    return
                }

                val message = decodeSignalMessage(normalizedPayload)
                if (message == null) {
                    logSignalTrace(
                        "native-signal-decode-failed",
                        "Realtime broadcast payload decode failed; keys=${normalizedPayload.let { if (it is JsonObject) it.keys.joinToString() else it.toString() }}",
                        "ERROR"
                    )
                    return
                }
                logSignalTrace(
                    "native-signal-dispatched",
                    "Dispatching host signal type=${message.type}; from=${message.from}; session=${message.sessionId ?: "none"}"
                )
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
