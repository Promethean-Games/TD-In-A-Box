package com.promethean.tdiab.templates

import com.promethean.tdiab.domain.TournamentConfiguration
import kotlinx.serialization.Serializable

@Serializable
data class TournamentTemplate(
    val id: String,
    val name: String,
    val configuration: TournamentConfiguration,
    val createdByUserId: String? = null,
    val createdAtUtc: String = "",
    val updatedAtUtc: String = ""
)
