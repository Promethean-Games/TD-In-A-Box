package com.promethean.tdiab

import com.promethean.tdiab.domain.DomainResult
import com.promethean.tdiab.domain.MatchStage
import com.promethean.tdiab.domain.MatchState
import com.promethean.tdiab.domain.Player
import com.promethean.tdiab.domain.Tournament
import com.promethean.tdiab.domain.TournamentCommand
import com.promethean.tdiab.domain.TournamentEngine
import com.promethean.tdiab.domain.TournamentFormat
import com.promethean.tdiab.domain.TournamentState
import com.promethean.tdiab.domain.TournamentStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class PhaseFourDoubleEliminationTest {
    @Test
    fun fourPlayerDoubleEliminationBuildsWinnersLosersAndGrandFinalMatches() {
        val engine = TournamentEngine()
        val tournament = tournament("de-4", 4)

        val result = engine.process(TournamentState(tournament), TournamentCommand.GenerateBracket)
        assertIs<DomainResult.Success<TournamentState>>(result)

        val matches = result.value.tournament.matches
        assertEquals(6, matches.size)
        assertEquals(3, matches.count { it.stage == MatchStage.WINNERS })
        assertEquals(2, matches.count { it.stage == MatchStage.LOSERS })
        assertEquals(1, matches.count { it.stage == MatchStage.FINAL })
        assertTrue(matches.any { it.id == "final-grand" })
    }

    @Test
    fun losersBracketChampionCanTriggerAResetFinal() {
        val engine = TournamentEngine()
        val tournament = tournament("de-reset", 4)

        val generated = engine.process(TournamentState(tournament), TournamentCommand.GenerateBracket)
        val state = generated.success()

        val wb1 = state.tournament.matches.filter { it.stage == MatchStage.WINNERS && it.round == 1 }
        val wbFinal = state.tournament.matches.first { it.stage == MatchStage.WINNERS && it.round == 2 }

        val afterWb1A = engine.process(state, TournamentCommand.CompleteMatch(wb1[0].id, wb1[0].entrants.first()))
        val afterWb1B = engine.process(afterWb1A.success(), TournamentCommand.CompleteMatch(wb1[1].id, wb1[1].entrants.first()))
        val afterWbFinal = engine.process(afterWb1B.success(), TournamentCommand.CompleteMatch(wbFinal.id, "p1"))

        val lbStage1 = afterWbFinal.success().tournament.matches.first { it.stage == MatchStage.LOSERS && it.round == 1 }
        val afterLb1 = engine.process(afterWbFinal.success(), TournamentCommand.CompleteMatch(lbStage1.id, "p3"))
        val lbStage2 = afterLb1.success().tournament.matches.first { it.stage == MatchStage.LOSERS && it.round == 2 }
        val afterLb2 = engine.process(afterLb1.success(), TournamentCommand.CompleteMatch(lbStage2.id, "p3"))

        val grandFinal = afterLb2.success().tournament.matches.first { it.stage == MatchStage.FINAL }
        val resetNeeded = engine.process(afterLb2.success(), TournamentCommand.CompleteMatch(grandFinal.id, "p3"))
        assertIs<DomainResult.Success<TournamentState>>(resetNeeded)
        assertEquals(TournamentStatus.ACTIVE, resetNeeded.value.tournament.status)
        assertTrue(resetNeeded.value.tournament.matches.any { it.stage == MatchStage.RESET_FINAL && it.state == MatchState.READY })

        val resetFinal = resetNeeded.value.tournament.matches.first { it.stage == MatchStage.RESET_FINAL }
        val finished = engine.process(resetNeeded.value, TournamentCommand.CompleteMatch(resetFinal.id, "p3"))
        assertEquals(TournamentStatus.COMPLETED, finished.success().tournament.status)
        assertEquals("p3", finished.success().tournament.result.winnerId)
    }

    private fun tournament(id: String, size: Int): Tournament {
        return Tournament(
            id = id,
            name = id,
            format = TournamentFormat.DOUBLE_ELIMINATION,
            players = (1..size).map { index -> Player("p$index", "Player $index", index) }
        )
    }

    private fun DomainResult<TournamentState>.success(): TournamentState {
        return (this as DomainResult.Success<TournamentState>).value
    }
}
