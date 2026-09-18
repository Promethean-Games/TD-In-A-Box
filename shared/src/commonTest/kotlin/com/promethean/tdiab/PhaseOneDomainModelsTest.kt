package com.promethean.tdiab

import com.promethean.tdiab.account.AccountRole
import com.promethean.tdiab.account.User
import com.promethean.tdiab.broadcast.BroadcastConfiguration
import com.promethean.tdiab.broadcast.BroadcastState
import com.promethean.tdiab.domain.Payout
import com.promethean.tdiab.domain.TournamentConfiguration
import com.promethean.tdiab.domain.TournamentFormat
import com.promethean.tdiab.domain.TournamentHistoryEvent
import com.promethean.tdiab.domain.TournamentStatus
import com.promethean.tdiab.templates.TournamentTemplate
import com.promethean.tdiab.venue.Venue
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PhaseOneDomainModelsTest {
    @Test
    fun tournamentConfigurationAndTemplateAreStable() {
        val config = TournamentConfiguration(
            name = "Spring Showdown",
            format = TournamentFormat.SINGLE_ELIMINATION,
            numberOfTables = 6,
            playerCapacity = 16,
            payoutStructure = listOf(Payout(1, amount = 100.0), Payout(2, amount = 50.0)),
            formatSettings = mapOf("modificationPoint" to "2")
        )

        val template = TournamentTemplate(
            id = "tpl-1",
            name = "Spring Showdown Template",
            configuration = config,
            createdByUserId = "user-1"
        )

        assertEquals("Spring Showdown", template.configuration.name)
        assertEquals(16, template.configuration.playerCapacity)
        assertEquals(2, template.configuration.payoutStructure.size)
    }

    @Test
    fun accountVenueAndBroadcastModelsHoldRequiredCoreData() {
        val user = User(
            id = "user-1",
            displayName = "Alan",
            email = "alan@example.com",
            role = AccountRole.TD
        )

        val venue = Venue(
            id = "venue-1",
            name = "North Hall",
            adminUserId = user.id,
            tdUserIds = listOf(user.id)
        )

        val broadcast = BroadcastConfiguration(
            enabled = true,
            currentScene = "LEADERBOARD",
            sceneDurationSeconds = 20,
            sponsorIds = listOf("sponsor-1")
        )

        val state = BroadcastState(
            tournamentId = "t-1",
            currentScene = broadcast.currentScene,
            status = TournamentStatus.READY,
            leaderboardSnapshot = listOf("Alan", "Sara")
        )

        assertEquals("North Hall", venue.name)
        assertEquals(AccountRole.TD, user.role)
        assertTrue(broadcast.enabled)
        assertEquals("LEADERBOARD", state.currentScene)
    }

    @Test
    fun historyEventKeepsAnAuditTrail() {
        val event = TournamentHistoryEvent(
            id = "evt-1",
            type = "player_added",
            description = "Alice registered",
            timestampUtc = "2026-01-01T00:00:00Z"
        )

        assertEquals("player_added", event.type)
        assertEquals("Alice registered", event.description)
    }
}
