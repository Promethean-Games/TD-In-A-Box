package com.promethean.tdiab

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.webrtc.PeerConnection
import java.util.concurrent.TimeUnit

@Serializable
private data class TurnIceFunctionResponse(
    val iceServers: List<TurnIceServerPayload> = emptyList()
)

@Serializable
private data class TurnIceServerPayload(
    val urls: JsonElement,
    val username: String? = null,
    val credential: String? = null
)

class TurnIceService(
    private val supabaseUrl: String = BuildConfig.SUPABASE_URL,
    private val supabaseAnonKey: String = BuildConfig.SUPABASE_ANON_KEY
) {
    private val client = OkHttpClient.Builder()
        .callTimeout(8, TimeUnit.SECONDS)
        .build()
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    suspend fun fetchIceServers(): List<PeerConnection.IceServer>? = withContext(Dispatchers.IO) {
        val normalizedSupabaseUrl = supabaseUrl.trim().removeSuffix("/")
        val anonKey = supabaseAnonKey.trim()
        if (normalizedSupabaseUrl.isBlank() || anonKey.isBlank()) {
            return@withContext null
        }

        val request = Request.Builder()
            .url("$normalizedSupabaseUrl/functions/v1/turn-ice")
            .addHeader("apikey", anonKey)
            .addHeader("Authorization", "Bearer $anonKey")
            .addHeader("Content-Type", "application/json")
            .post("""{"ttl":86400}""".toRequestBody("application/json".toMediaType()))
            .build()

        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                return@withContext null
            }

            val body = response.body?.string().orEmpty()
            val parsed = runCatching {
                json.decodeFromString<TurnIceFunctionResponse>(body)
            }.getOrNull() ?: return@withContext null

            val iceServers = parsed.iceServers.mapNotNull { payload ->
                payload.toIceServerOrNull()
            }
            return@withContext iceServers.ifEmpty { null }
        }
    }
}

private fun TurnIceServerPayload.toIceServerOrNull(): PeerConnection.IceServer? {
    val resolvedUrls = when (urls) {
        is JsonPrimitive -> listOfNotNull(urls.content.takeIf { it.isNotBlank() })
        is JsonArray -> urls.mapNotNull { element ->
            (element as? JsonPrimitive)?.content?.takeIf { it.isNotBlank() }
        }
        else -> emptyList()
    }
    if (resolvedUrls.isEmpty()) {
        return null
    }

    val builder = if (resolvedUrls.size == 1) {
        PeerConnection.IceServer.builder(resolvedUrls.first())
    } else {
        PeerConnection.IceServer.builder(resolvedUrls)
    }

    if (!username.isNullOrBlank()) {
        builder.setUsername(username)
    }
    if (!credential.isNullOrBlank()) {
        builder.setPassword(credential)
    }
    return builder.createIceServer()
}
