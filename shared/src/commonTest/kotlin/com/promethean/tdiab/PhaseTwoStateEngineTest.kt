package com.promethean.tdiab

import com.promethean.tdiab.domain.DomainResult
import com.promethean.tdiab.domain.Player
import com.promethean.tdiab.domain.TournamentConfiguration
import com.promethean.tdiab.domain.TournamentFormat
import com.promethean.tdiab.domain.TournamentState
import com.promethean.tdiab.tournament.TournamentStateEngine
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class PhaseTwoStateEngineTest {
    @Test
    fun createTournamentBuildsDeterministicState() {
        val engine = TournamentStateEngine()
        val config = TournamentConfiguration(
            name = "Spring Showdown",
            format = TournamentFormat.SINGLE_ELIMINATION,
            playerCapacity = 16,
            numberOfTables = 4,
            entryFee = 20.0
        )

        val state = engine.createTournament(config)
        assertEquals("Spring Showdown", state.tournament.name)
        assertEquals(TournamentFormat.SINGLE_ELIMINATION, state.tournament.format)
        assertEquals(4, state.tournament.tables.size)
        assertEquals(16, state.tournament.playerCapacity)
    }

    @Test
    fun seedFinalizationAndBracketGenerationAreDeterministic() {
        val engine = TournamentStateEngine()
        val config = TournamentConfiguration(name = "Seeded Bracket", format = TournamentFormat.SINGLE_ELIMINATION)
        val state = engine.createTournament(config)

        val playerState = engine.addPlayer(state, Player("p1", "Alice", seed = 2))
        val withSecond = engine.addPlayer(playerState.getSuccess(), Player("p2", "Bob", seed = 1))
        val finalized = engine.finalizeSeeds(withSecond.getSuccess())
        assertIs<DomainResult.Success<TournamentState>>(finalized)
        assertEquals(listOf("p2", "p1"), finalized.value.tournament.seedOrder)

        val bracketed = engine.generateBracket(finalized.value)
        assertIs<DomainResult.Success<TournamentState>>(bracketed)
        assertTrue(bracketed.value.tournament.bracketGenerated)
        assertTrue(bracketed.value.tournament.matches.isNotEmpty())
    }

    @Test
    fun invalidMatchCompletionFailsValidation() {
        val engine = TournamentStateEngine()
        val config = TournamentConfiguration(name = "Invalid Result", format = TournamentFormat.SINGLE_ELIMINATION)
        val state = engine.createTournament(config)
        val ready = engine.addPlayer(state, Player("p1", "Alice", 1))
        val withOther = engine.addPlayer(ready.getSuccess(), Player("p2", "Bob", 2))
        val generated = engine.generateBracket(withOther.getSuccess())
        val result = engine.completeMatch(generated.getSuccess(), generated.getSuccess().tournament.matches.first().id, "ghost")
        assertIs<DomainResult.Failure>(result)
    }
}

private fun DomainResult<TournamentState>.getSuccess(): TournamentState {
    return (this as DomainResult.Success<TournamentState>).value
}
