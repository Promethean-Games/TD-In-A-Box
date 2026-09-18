package com.promethean.tdiab.tournament

import com.promethean.tdiab.domain.DomainError
import com.promethean.tdiab.domain.DomainResult
import com.promethean.tdiab.domain.Player
import com.promethean.tdiab.domain.Table
import com.promethean.tdiab.domain.Tournament
import com.promethean.tdiab.domain.TournamentCommand
import com.promethean.tdiab.domain.TournamentConfiguration
import com.promethean.tdiab.domain.TournamentEngine
import com.promethean.tdiab.domain.TournamentHistoryEvent
import com.promethean.tdiab.domain.TournamentState
import com.promethean.tdiab.domain.TournamentStatus
import com.promethean.tdiab.domain.TournamentValidator

class TournamentStateEngine(private val coreEngine: TournamentEngine = TournamentEngine()) {
    fun createTournament(configuration: TournamentConfiguration): TournamentState {
        val safeName = configuration.name.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')
        val tournament = Tournament(
            id = "tournament-$safeName",
            name = configuration.name,
            format = configuration.format,
            playerCapacity = configuration.playerCapacity,
            entryFee = configuration.entryFee,
            tables = List(configuration.numberOfTables) { index ->
                Table(id = "table-${index + 1}", label = "Table ${index + 1}")
            },
            payoutStructure = configuration.payoutStructure.associate { it.placement to it.amount },
            formatSettings = configuration.formatSettings,
            result = com.promethean.tdiab.domain.TournamentResult()
        )
        return TournamentState(tournament = tournament, errors = emptyList())
    }

    fun validate(state: TournamentState): List<DomainError> = TournamentValidator.validate(state.tournament)

    fun apply(state: TournamentState, command: TournamentCommand): DomainResult<TournamentState> {
        val validationErrors = validate(state)
        if (validationErrors.isNotEmpty() && command !is TournamentCommand.AddPlayer && command !is TournamentCommand.RemovePlayer) {
            return DomainResult.Failure(validationErrors.first())
        }

        val nextState = coreEngine.process(state, command)
        return when (nextState) {
            is DomainResult.Success -> {
                val history = nextState.value.tournament.result.standings
                DomainResult.Success(nextState.value.copy(errors = emptyList()))
            }
            is DomainResult.Failure -> nextState
        }
    }

    fun recordHistoryEntry(state: TournamentState, eventType: String, description: String): TournamentState {
        val currentHistory = state.tournament.result.standings
        return state.copy(
            tournament = state.tournament.copy(
                result = com.promethean.tdiab.domain.TournamentResult(
                    winnerId = state.tournament.result.winnerId,
                    standings = currentHistory
                )
            )
        )
    }

    fun finalizeSeeds(state: TournamentState): DomainResult<TournamentState> {
        val seeded = state.tournament.players.sortedBy { it.seed }
        val updated = state.tournament.copy(players = seeded, seedOrder = seeded.map { it.id })
        return DomainResult.Success(state.copy(tournament = updated))
    }

    fun startTournament(state: TournamentState): DomainResult<TournamentState> = apply(state, TournamentCommand.StartTournament)
    fun generateBracket(state: TournamentState): DomainResult<TournamentState> = apply(state, TournamentCommand.GenerateBracket)
    fun addPlayer(state: TournamentState, player: Player): DomainResult<TournamentState> = apply(state, TournamentCommand.AddPlayer(player))
    fun addLatePlayer(state: TournamentState, player: Player): DomainResult<TournamentState> = apply(state, TournamentCommand.AddLatePlayer(player))
    fun checkInPlayer(state: TournamentState, playerId: String, checkedIn: Boolean = true): DomainResult<TournamentState> = apply(state, TournamentCommand.CheckInPlayer(playerId, checkedIn))
    fun assignTable(state: TournamentState, matchId: String, tableId: String): DomainResult<TournamentState> = apply(state, TournamentCommand.AssignTable(matchId, tableId))
    fun startMatch(state: TournamentState, matchId: String): DomainResult<TournamentState> = apply(state, TournamentCommand.StartMatch(matchId))
    fun completeMatch(state: TournamentState, matchId: String, winnerId: String, score: String = ""): DomainResult<TournamentState> = apply(state, TournamentCommand.CompleteMatch(matchId, winnerId, score))
    fun correctMatchResult(state: TournamentState, matchId: String, winnerId: String, score: String = ""): DomainResult<TournamentState> = apply(state, TournamentCommand.CorrectMatchResult(matchId, winnerId, score))
    fun archiveTournament(state: TournamentState): DomainResult<TournamentState> = apply(state, TournamentCommand.ArchiveTournament())
    fun currentStatus(state: TournamentState): TournamentStatus = state.tournament.status
}

object TournamentEventTypes {
    const val PLAYER_ADDED = "player_added"
    const val CHECK_IN = "check_in"
    const val TOURNAMENT_STARTED = "tournament_started"
    const val RESULT_ENTERED = "result_entered"
    const val TABLE_ASSIGNED = "table_assigned"
    const val TOURNAMENT_ARCHIVED = "tournament_archived"
}
