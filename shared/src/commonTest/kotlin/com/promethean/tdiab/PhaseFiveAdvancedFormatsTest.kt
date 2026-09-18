package com.promethean.tdiab

import com.promethean.tdiab.domain.DomainResult
import com.promethean.tdiab.domain.MatchStage
import com.promethean.tdiab.domain.Player
import com.promethean.tdiab.domain.Tournament
import com.promethean.tdiab.domain.TournamentCommand
import com.promethean.tdiab.domain.TournamentEngine
import com.promethean.tdiab.domain.TournamentFormat
import com.promethean.tdiab.domain.TournamentInterchange
import com.promethean.tdiab.domain.TournamentState
import com.promethean.tdiab.domain.TournamentStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class PhaseFiveAdvancedFormatsTest {
    @Test
    fun lateEntryInvalidatesGeneratedBracketBeforeTheTournamentStarts() {
        val engine = TournamentEngine()
        val tournament = tournament("late-entry", TournamentFormat.SINGLE_ELIMINATION)

        val generated = engine.process(TournamentState(tournament), TournamentCommand.GenerateBracket)
        val result = engine.process(generated.success(), TournamentCommand.AddLatePlayer(Player("p3", "Late", 3)))

        assertIs<DomainResult.Success<TournamentState>>(result)
        assertEquals(false, result.value.tournament.bracketGenerated)
        assertTrue(result.value.tournament.matches.isEmpty())
        assertEquals(TournamentStatus.DRAFT, result.value.tournament.status)
    }

    @Test
    fun modifiedEliminationUsesModifiedStages() {
        val engine = TournamentEngine()
        val tournament = tournament("modified", TournamentFormat.MODIFIED_ELIMINATION, 4)

        val result = engine.process(TournamentState(tournament), TournamentCommand.GenerateBracket)
        assertIs<DomainResult.Success<TournamentState>>(result)
        assertTrue(result.value.tournament.matches.all { it.stage == MatchStage.MODIFIED })
    }

    @Test
    fun chipTournamentTracksChipChangesOnMatchCompletion() {
        val engine = TournamentEngine()
        val tournament = tournament("chips", TournamentFormat.CHIP_TOURNAMENT, 4)

        val generated = engine.process(TournamentState(tournament), TournamentCommand.GenerateBracket)
        val firstMatch = generated.success().tournament.matches.first()
        val completed = engine.process(generated.success(), TournamentCommand.CompleteMatch(firstMatch.id, firstMatch.entrants.first()))

        assertIs<DomainResult.Success<TournamentState>>(completed)
        assertTrue(completed.value.tournament.matches.all { it.stage == MatchStage.CHIP || it.stage == MatchStage.WINNERS })
        assertTrue(completed.value.tournament.players.any { it.chips > 100 })
    }

    @Test
    fun jsonAndCsvInterchangeRoundTripTournamentData() {
        val tournament = Tournament(
            id = "interchange",
            name = "Interchange",
            players = listOf(Player("p1", "Alice", 1), Player("p2", "Bob", 2))
        )

        val json = TournamentInterchange.exportJson(tournament)
        val jsonImported = TournamentInterchange.importJson(json)
        assertIs<DomainResult.Success<Tournament>>(jsonImported)
        assertEquals(tournament.id, jsonImported.value.id)

        val csv = TournamentInterchange.exportCsv(tournament)
        val csvImported = TournamentInterchange.importCsv(csv)
        assertIs<DomainResult.Success<Tournament>>(csvImported)
        assertEquals(2, csvImported.value.players.size)
    }

    private fun tournament(id: String, format: TournamentFormat, size: Int = 2): Tournament {
        return Tournament(
            id = id,
            name = id,
            format = format,
            players = (1..size).map { index -> Player("p$index", "Player $index", index) }
        )
    }

    private fun DomainResult<TournamentState>.success(): TournamentState {
        return (this as DomainResult.Success<TournamentState>).value
    }
}
