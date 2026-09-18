package com.promethean.tdiab.broadcast

import com.promethean.tdiab.domain.TournamentStatus
import kotlinx.serialization.Serializable

@Serializable
data class BroadcastConfiguration(
    val enabled: Boolean = false,
    val sceneDurationSeconds: Int = 15,
    val currentScene: String = "LIVE_VIDEO",
    val autoCycle: Boolean = true,
    val sponsorRotationEnabled: Boolean = true,
    val sponsorIds: List<String> = emptyList()
)

@Serializable
data class VenueBroadcastPreferences(
    val featuredTableScoringEnabled: Boolean = false
)

@Serializable
data class BroadcastState(
    val tournamentId: String,
    val currentMatchId: String? = null,
    val currentTableId: String? = null,
    val currentScene: String = "LIVE_VIDEO",
    val status: TournamentStatus = TournamentStatus.READY,
    val leaderboardSnapshot: List<String> = emptyList(),
    val sponsorRotationIndex: Int = 0,
    val overlayVisible: Boolean = true
)

@Serializable
enum class FeaturedTableScoringStatus {
    OFF,
    READY,
    ACTIVE,
    COMPLETE
}

@Serializable
enum class FeaturedTableScoringMode {
    MANUAL,
    TOURNAMENT_TARGET,
    VENUE_DEFAULT
}

@Serializable
data class FeaturedTableScoringState(
    val enabled: Boolean = false,
    val featuredTableId: String? = null,
    val matchId: String? = null,
    val playerAId: String? = null,
    val playerAName: String = "",
    val playerAScore: Int = 0,
    val playerBId: String? = null,
    val playerBName: String = "",
    val playerBScore: Int = 0,
    val targetScore: Int? = null,
    val currentRack: Int = 1,
    val matchStatus: String = "Not started",
    val status: FeaturedTableScoringStatus = FeaturedTableScoringStatus.OFF,
    val mode: FeaturedTableScoringMode = FeaturedTableScoringMode.MANUAL
)

object FeaturedTableScoringService {
    fun enable(
        currentTableId: String?,
        matchId: String,
        playerAId: String,
        playerAName: String,
        playerBId: String,
        playerBName: String,
        targetScore: Int? = null,
        source: FeaturedTableScoringMode = FeaturedTableScoringMode.MANUAL
    ): FeaturedTableScoringState {
        return FeaturedTableScoringState(
            enabled = true,
            featuredTableId = currentTableId,
            matchId = matchId,
            playerAId = playerAId,
            playerAName = playerAName,
            playerAScore = 0,
            playerBId = playerBId,
            playerBName = playerBName,
            playerBScore = 0,
            targetScore = targetScore,
            currentRack = 1,
            matchStatus = "Ready",
            status = FeaturedTableScoringStatus.READY,
            mode = source
        )
    }

    fun setMatchStatus(state: FeaturedTableScoringState, matchStatus: String): FeaturedTableScoringState {
        if (!state.enabled) {
            return state
        }
        val nextStatus = if (state.status == FeaturedTableScoringStatus.OFF) FeaturedTableScoringStatus.READY else state.status
        return state.copy(matchStatus = matchStatus, status = nextStatus)
    }

    fun recordRackWinner(state: FeaturedTableScoringState, playerId: String): FeaturedTableScoringState {
        if (!state.enabled || state.status == FeaturedTableScoringStatus.COMPLETE) {
            return state
        }

        val nextState = when (playerId) {
            state.playerAId -> state.copy(playerAScore = state.playerAScore + 1)
            state.playerBId -> state.copy(playerBScore = state.playerBScore + 1)
            else -> state
        }

        if (nextState == state) {
            return state
        }

        val totalScore = nextState.playerAScore + nextState.playerBScore
        val reachedTarget = nextState.targetScore != null &&
            (nextState.playerAScore >= nextState.targetScore || nextState.playerBScore >= nextState.targetScore)

        return nextState.copy(
            currentRack = totalScore + 1,
            status = if (reachedTarget) FeaturedTableScoringStatus.COMPLETE else FeaturedTableScoringStatus.ACTIVE,
            matchStatus = if (reachedTarget) "Complete" else "In progress"
        )
    }

    fun reset(state: FeaturedTableScoringState): FeaturedTableScoringState {
        return state.copy(
            playerAScore = 0,
            playerBScore = 0,
            currentRack = 1,
            matchStatus = "Not started",
            status = if (state.enabled) FeaturedTableScoringStatus.READY else FeaturedTableScoringStatus.OFF
        )
    }

    fun overlaySnapshot(state: FeaturedTableScoringState): List<String> {
        if (!state.enabled) {
            return emptyList()
        }
        return listOf(
            state.playerAName,
            state.playerAScore.toString(),
            state.playerBName,
            state.playerBScore.toString(),
            state.targetScore?.toString() ?: "",
            state.currentRack.toString(),
            state.matchStatus
        )
    }
}
