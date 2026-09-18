package com.promethean.tdiab

import com.promethean.tdiab.domain.DomainResult
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

class PhaseThreeSingleEliminationTest {
    @Test
    fun eightPlayerBracketBuildsSevenMatchesWithSeededPairs() {
        val engine = TournamentEngine()
        val tournament = tournament("t-8", 8)

        val result = engine.process(TournamentState(tournament), TournamentCommand.GenerateBracket)
        assertIs<DomainResult.Success<TournamentState>>(result)

        val matches = result.value.tournament.matches
        assertEquals(7, matches.size)
        assertEquals(listOf("p1", "p8"), matches[0].entrants)
        assertEquals(listOf("p2", "p7"), matches[1].entrants)
        assertEquals(listOf("p3", "p6"), matches[2].entrants)
        assertEquals(listOf("p4", "p5"), matches[3].entrants)
    }

    @Test
    fun thirteenPlayerBracketPlacesThreeByesOnTopSeeds() {
        val engine = TournamentEngine()
        val tournament = tournament("t-13", 13)

        val result = engine.process(TournamentState(tournament), TournamentCommand.GenerateBracket)
        assertIs<DomainResult.Success<TournamentState>>(result)

        val matches = result.value.tournament.matches
        val openingRound = matches.filter { it.round == 1 }
        assertEquals(8, openingRound.size)
        assertEquals(3, openingRound.count { it.state == MatchState.COMPLETE })
        assertEquals("p1", openingRound[0].winnerId)
        assertEquals("p2", openingRound[1].winnerId)
        assertEquals("p3", openingRound[2].winnerId)

        val secondRound = matches.filter { it.round == 2 }
        assertEquals(listOf("p1", "p2"), secondRound[0].entrants)
    }

    @Test
    fun sixteenPlayerBracketBuildsFullOpeningRoundWithoutByes() {
        val engine = TournamentEngine()
        val tournament = tournament("t-16", 16)

        val result = engine.process(TournamentState(tournament), TournamentCommand.GenerateBracket)
        assertIs<DomainResult.Success<TournamentState>>(result)

        val matches = result.value.tournament.matches
        assertEquals(15, matches.size)
        assertEquals(8, matches.count { it.round == 1 })
        assertTrue(matches.filter { it.round == 1 }.none { it.state == MatchState.COMPLETE })
    }

    @Test
    fun matchCompletionAdvancesIntoTheNextRound() {
        val engine = TournamentEngine()
        val tournament = tournament("t-adv", 4)

        val generated = engine.process(TournamentState(tournament), TournamentCommand.GenerateBracket)
        val started = engine.process(generated.success(), TournamentCommand.StartTournament)

        val firstRound = started.success().tournament.matches.filter { it.round == 1 }
        val firstCompleted = engine.process(started.success(), TournamentCommand.CompleteMatch(firstRound[0].id, firstRound[0].entrants.first()))
        val secondCompleted = engine.process(firstCompleted.success(), TournamentCommand.CompleteMatch(firstRound[1].id, firstRound[1].entrants.first()))

        val finalMatch = secondCompleted.success().tournament.matches.first { it.round == 2 }
        assertEquals(MatchState.READY, finalMatch.state)
        assertEquals(listOf("p1", "p2"), finalMatch.entrants)

        val winner = engine.process(secondCompleted.success(), TournamentCommand.CompleteMatch(finalMatch.id, finalMatch.entrants.first()))
        assertEquals(TournamentStatus.COMPLETED, winner.success().tournament.status)
        assertEquals(finalMatch.entrants.first(), winner.success().tournament.result.winnerId)
    }

    @Test
    fun bracketGenerationIsDeterministicForTheSameSeedOrder() {
        val engine = TournamentEngine()
        val tournament = tournament("t-repeat", 8)

        val first = engine.process(TournamentState(tournament), TournamentCommand.GenerateBracket).success().tournament.matches
        val second = engine.process(TournamentState(tournament), TournamentCommand.GenerateBracket).success().tournament.matches

        assertEquals(first.map { it.id to it.entrants }, second.map { it.id to it.entrants })
    }

    @Test
    fun correctingAnAlreadyCompletedResultWithTheSameWinnerDoesNotChangeState() {
        val engine = TournamentEngine()
        val tournament = tournament("t-correct", 4)

        val generated = engine.process(TournamentState(tournament), TournamentCommand.GenerateBracket)
        val started = engine.process(generated.success(), TournamentCommand.StartTournament)
        val firstRound = started.success().tournament.matches.filter { it.round == 1 }

        val completed = engine.process(started.success(), TournamentCommand.CompleteMatch(firstRound[0].id, firstRound[0].entrants.first()))
        val corrected = engine.process(completed.success(), TournamentCommand.CorrectMatchResult(firstRound[0].id, firstRound[0].entrants.first()))

        assertIs<DomainResult.Success<TournamentState>>(corrected)
        assertEquals(completed.success().tournament.matches, corrected.success().tournament.matches)
    }

    private fun tournament(id: String, size: Int): Tournament {
        return Tournament(
            id = id,
            name = id,
            format = TournamentFormat.SINGLE_ELIMINATION,
            players = (1..size).map { index -> Player("p$index", "Player $index", index) }
        )
    }

    private fun DomainResult<TournamentState>.success(): TournamentState {
        return (this as DomainResult.Success<TournamentState>).value
    }
}
