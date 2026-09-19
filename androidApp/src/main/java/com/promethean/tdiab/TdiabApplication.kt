package com.promethean.tdiab

import android.app.Application
import android.content.Context
import android.os.Build
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.Locale
import java.util.UUID
import kotlin.system.exitProcess

@Serializable
data class ApplicationCrashReport(
    val id: String,
    @SerialName("occurred_at") val occurredAt: String,
    val source: String,
    val severity: String,
    val title: String,
    val summary: String,
    @SerialName("exception_class") val exceptionClass: String,
    val message: String? = null,
    @SerialName("stack_trace") val stackTrace: String,
    @SerialName("thread_name") val threadName: String,
    @SerialName("package_name") val packageName: String,
    @SerialName("app_name") val appName: String,
    @SerialName("version_name") val versionName: String,
    @SerialName("version_code") val versionCode: Int,
    @SerialName("build_type") val buildType: String,
    @SerialName("device_model") val deviceModel: String,
    @SerialName("device_manufacturer") val deviceManufacturer: String,
    @SerialName("android_version") val androidVersion: String,
    @SerialName("sdk_int") val sdkInt: Int,
    @SerialName("file_path") val filePath: String,
    @SerialName("upload_status") val uploadStatus: String = "pending"
)

object ApplicationReportHub {
    @Volatile
    private var manager: CrashReportManager? = null

    fun initialize(nextManager: CrashReportManager) {
        manager = nextManager
    }

    fun recordCrash(threadName: String, throwable: Throwable) {
        manager?.recordCrash(threadName, throwable)
    }

    fun recordConnection(pairCode: String?, stage: String, detail: String, severity: String = "INFO") {
        manager?.recordConnectionEvent(pairCode, stage, detail, severity)
    }
}

class TdiabApplication : Application() {
    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var crashReportManager: CrashReportManager
    private val previousHandler = Thread.getDefaultUncaughtExceptionHandler()

    override fun onCreate() {
        super.onCreate()
        crashReportManager = CrashReportManager(this, applicationScope)
        ApplicationReportHub.initialize(crashReportManager)
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            runCatching {
                ApplicationReportHub.recordCrash(thread.name, throwable)
            }
            previousHandler?.uncaughtException(thread, throwable) ?: run {
                android.os.Process.killProcess(android.os.Process.myPid())
                exitProcess(10)
            }
        }
        crashReportManager.syncPendingReports()
    }
}

class CrashReportManager(
    context: Context,
    private val scope: CoroutineScope
) {
    private val store = CrashReportStore(context)
    private val transport = CrashReportTransport()

    fun recordCrash(threadName: String, throwable: Throwable) {
        val report = buildReport(threadName, throwable)
        persistAndSync(report)
    }

    fun recordConnectionEvent(pairCode: String?, stage: String, detail: String, severity: String = "INFO") {
        val report = buildConnectionReport(pairCode, stage, detail, severity)
        persistAndSync(report)
    }

    fun syncPendingReports() {
        scope.launch {
            transport.syncPendingReports(store)
        }
    }

    private fun buildReport(threadName: String, throwable: Throwable): ApplicationCrashReport {
        val createdAt = synchronized(ISO_FORMAT) {
            ISO_FORMAT.format(java.util.Date())
        }
        val reportId = crashReportId(createdAt)
        val filePath = store.pendingFileFor(reportId = reportId).absolutePath
        return ApplicationCrashReport(
            id = reportId,
            occurredAt = createdAt,
            source = "android",
            severity = "FATAL",
            title = "Unhandled exception",
            summary = throwable.message?.takeIf { it.isNotBlank() }
                ?: throwable::class.java.simpleName,
            exceptionClass = throwable::class.java.name,
            message = throwable.message,
            stackTrace = throwable.stackTraceToString(),
            threadName = threadName,
            packageName = BuildConfig.APPLICATION_ID,
            appName = "TD in a Box",
            versionName = BuildConfig.VERSION_NAME,
            versionCode = BuildConfig.VERSION_CODE,
            buildType = BuildConfig.BUILD_TYPE,
            deviceModel = Build.MODEL.orEmpty(),
            deviceManufacturer = Build.MANUFACTURER.orEmpty(),
            androidVersion = Build.VERSION.RELEASE.orEmpty(),
            sdkInt = Build.VERSION.SDK_INT,
            filePath = filePath
        )
    }

    private fun buildConnectionReport(
        pairCode: String?,
        stage: String,
        detail: String,
        severity: String
    ): ApplicationCrashReport {
        val createdAt = synchronized(ISO_FORMAT) {
            ISO_FORMAT.format(java.util.Date())
        }
        val reportId = crashReportId(createdAt)
        val filePath = store.pendingFileFor(reportId = reportId).absolutePath
        val normalizedPairCode = pairCode?.ifBlank { "unknown" } ?: "unknown"
        return ApplicationCrashReport(
            id = reportId,
            occurredAt = createdAt,
            source = "android-connection",
            severity = severity.uppercase(Locale.US),
            title = "Connection event: $stage",
            summary = detail,
            exceptionClass = "ConnectionEvent",
            message = detail,
            stackTrace = "stage=$stage; pairCode=$normalizedPairCode; detail=$detail",
            threadName = Thread.currentThread().name,
            packageName = BuildConfig.APPLICATION_ID,
            appName = "TD in a Box",
            versionName = BuildConfig.VERSION_NAME,
            versionCode = BuildConfig.VERSION_CODE,
            buildType = BuildConfig.BUILD_TYPE,
            deviceModel = Build.MODEL.orEmpty(),
            deviceManufacturer = Build.MANUFACTURER.orEmpty(),
            androidVersion = Build.VERSION.RELEASE.orEmpty(),
            sdkInt = Build.VERSION.SDK_INT,
            filePath = filePath
        )
    }

    private fun persistAndSync(report: ApplicationCrashReport) {
        store.writePending(report)
        scope.launch {
            transport.syncPendingReports(store)
        }
    }
}

private class CrashReportStore(context: Context) {
    private val rootDir = File(context.filesDir, "crash-reports")
    private val pendingDir = File(rootDir, "pending")
    private val syncedDir = File(rootDir, "synced")
    private val json = Json {
        prettyPrint = true
        encodeDefaults = true
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    fun pendingFileFor(reportId: String): File {
        ensureDirectories()
        return File(pendingDir, "$reportId.json")
    }

    fun writePending(report: ApplicationCrashReport) {
        val file = pendingFileFor(report.id)
        file.writeText(json.encodeToString(report))
    }

    fun loadPendingReports(): List<StoredCrashReport> {
        ensureDirectories()
        return pendingDir
            .listFiles { file -> file.isFile && file.extension == "json" }
            ?.sortedBy { it.name }
            ?.mapNotNull { file ->
                runCatching {
                    StoredCrashReport(file, json.decodeFromString(ApplicationCrashReport.serializer(), file.readText()))
                }.getOrNull()
            }
            .orEmpty()
    }

    fun markSynced(storedReport: StoredCrashReport) {
        ensureDirectories()
        val destination = File(syncedDir, storedReport.file.name)
        if (destination.exists()) {
            destination.delete()
        }
        if (!storedReport.file.renameTo(destination)) {
            storedReport.file.copyTo(destination, overwrite = true)
            storedReport.file.delete()
        }
    }

    private fun ensureDirectories() {
        pendingDir.mkdirs()
        syncedDir.mkdirs()
    }
}

private data class StoredCrashReport(
    val file: File,
    val report: ApplicationCrashReport
)

private class CrashReportTransport {
    private val client = OkHttpClient()
    private val supabaseUrl = BuildConfig.SUPABASE_URL.trim().removeSuffix("/")
    private val supabaseAnonKey = BuildConfig.SUPABASE_ANON_KEY
    private val json = Json {
        prettyPrint = true
        encodeDefaults = true
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    suspend fun syncPendingReports(store: CrashReportStore) {
        if (supabaseUrl.isBlank() || supabaseAnonKey.isBlank()) return
        withContext(Dispatchers.IO) {
            store.loadPendingReports().forEach { storedReport ->
                if (uploadReport(storedReport.report.copy(uploadStatus = "synced"))) {
                    store.markSynced(storedReport)
                }
            }
        }
    }

    private fun uploadReport(report: ApplicationCrashReport): Boolean {
        val payload = json.encodeToString(report)
        val request = Request.Builder()
            .url("$supabaseUrl/rest/v1/application_reports")
            .addHeader("apikey", supabaseAnonKey)
            .addHeader("Authorization", "Bearer $supabaseAnonKey")
            .addHeader("Content-Type", "application/json")
            .addHeader("Prefer", "return=minimal")
            .post(payload.toRequestBody("application/json".toMediaType()))
            .build()

        client.newCall(request).execute().use { response ->
            return response.isSuccessful
        }
    }
}

private fun crashReportId(createdAt: String): String {
    return "crash-${createdAt.replace(':', '-').replace('.', '-')}-${UUID.randomUUID().toString().take(8)}"
}

private val ISO_FORMAT = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
    timeZone = java.util.TimeZone.getTimeZone("UTC")
}
