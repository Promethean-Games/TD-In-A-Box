package com.promethean.tdiab.domain

import kotlinx.serialization.Serializable

@Serializable
data class TournamentConfiguration(
    val name: String,
    val dateUtc: String = "",
    val venueId: String? = null,
    val format: TournamentFormat = TournamentFormat.SINGLE_ELIMINATION,
    val playerCapacity: Int = 0,
    val entryFee: Double = 0.0,
    val numberOfTables: Int = 0,
    val payoutStructure: List<Payout> = emptyList(),
    val seedingMethod: String = "manual",
    val notes: String = "",
    val formatSettings: Map<String, String> = emptyMap(),
    val modificationPoint: Int? = null
)

@Serializable
data class Payout(
    val placement: Int,
    val playerId: String? = null,
    val amount: Double = 0.0,
    val currency: String = "USD"
)

@Serializable
data class Sponsor(
    val id: String,
    val name: String,
    val tier: String = "standard",
    val logoUrl: String? = null,
    val active: Boolean = true
)

@Serializable
data class TournamentHistoryEvent(
    val id: String,
    val type: String,
    val description: String,
    val timestampUtc: String = "",
    val source: String = "engine"
)

@Serializable
data class TournamentSnapshot(
    val tournamentId: String,
    val name: String,
    val format: TournamentFormat,
    val phase: TournamentPhase,
    val status: TournamentStatus,
    val playersCount: Int,
    val matchesCount: Int,
    val lastUpdatedUtc: String = ""
)
