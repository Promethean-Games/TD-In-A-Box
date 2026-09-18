package com.promethean.tdiab.persistence

import android.content.Context
import com.promethean.tdiab.domain.DomainError
import com.promethean.tdiab.domain.DomainResult
import com.promethean.tdiab.domain.WorkspaceSnapshot
import com.promethean.tdiab.domain.WorkspaceStore
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

class AndroidFileWorkspaceStore(context: Context) : WorkspaceStore {
    private val file = File(context.filesDir, "tdiab-workspace.json")
    private val json = Json {
        prettyPrint = true
        encodeDefaults = true
        ignoreUnknownKeys = true
        classDiscriminator = "type"
    }

    override suspend fun load(): DomainResult<WorkspaceSnapshot> {
        return try {
            if (!file.exists()) {
                DomainResult.Success(WorkspaceSnapshot())
            } else {
                DomainResult.Success(json.decodeFromString<WorkspaceSnapshot>(file.readText()))
            }
        } catch (_: Throwable) {
            DomainResult.Failure(DomainError.InvalidImport("Unable to load workspace snapshot."))
        }
    }

    override suspend fun save(snapshot: WorkspaceSnapshot): DomainResult<Unit> {
        return try {
            file.writeText(json.encodeToString(snapshot))
            DomainResult.Success(Unit)
        } catch (_: Throwable) {
            DomainResult.Failure(DomainError.StorageLimitReached("Unable to persist workspace snapshot."))
        }
    }
}
