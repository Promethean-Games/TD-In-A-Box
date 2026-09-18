package com.promethean.tdiab

import com.promethean.tdiab.domain.Capability
import com.promethean.tdiab.domain.EntitlementPolicy
import com.promethean.tdiab.domain.Entitlements
import com.promethean.tdiab.domain.FeatureAccessState
import com.promethean.tdiab.domain.DomainResult
import com.promethean.tdiab.domain.InMemoryPlayerRepository
import com.promethean.tdiab.domain.Player
import com.promethean.tdiab.domain.PlayerIdentityDecision
import com.promethean.tdiab.domain.PlayerIdentityService
import com.promethean.tdiab.domain.PlayerSelectionWorkflow
import com.promethean.tdiab.domain.TournamentCommand
import com.promethean.tdiab.domain.TournamentRosterService
import com.promethean.tdiab.domain.WorkspaceSnapshot
import kotlinx.coroutines.runBlocking
import com.promethean.tdiab.domain.SubscriptionTier
import com.promethean.tdiab.domain.Tournament
import com.promethean.tdiab.domain.TournamentCsv
import com.promethean.tdiab.domain.TournamentFormat
import com.promethean.tdiab.domain.TournamentJson
import com.promethean.tdiab.domain.TournamentEngine
import com.promethean.tdiab.domain.TournamentState
import com.promethean.tdiab.domain.TournamentStatus
import com.promethean.tdiab.domain.WorkspaceWorkflow
import com.promethean.tdiab.domain.InMemoryWorkspaceStore
import com.promethean.tdiab.broadcast.FeaturedTableScoringMode
import com.promethean.tdiab.broadcast.FeaturedTableScoringService
import com.promethean.tdiab.broadcast.FeaturedTableScoringState
import com.promethean.tdiab.broadcast.FeaturedTableScoringStatus
import com.promethean.tdiab.broadcast.VenueBroadcastPreferences
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class SharedBusinessRulesTest {
    @Test
    fun latePlayerEntryIsRejectedOnceTournamentStarts() {
        val engine = TournamentEngine()
        val tournament = Tournament(
            id = "t-2",
            name = "Late Entry",
            players = listOf(Player("p1", "Alice", 1), Player("p2", "Bob", 2)),
            status = TournamentStatus.ACTIVE,
            bracketGenerated = true
        )

        val result = engine.process(TournamentState(tournament), TournamentCommand.AddLatePlayer(Player("p3", "Will", 3)))
        assertIs<DomainResult.Failure>(result)
    }

    @Test
    fun entitlementPolicyMatchesSubscriptionCapabilities() {
        val pro = Entitlements(tier = SubscriptionTier.TD_PRO)
        val proPlus = Entitlements(tier = SubscriptionTier.TD_PRO_PLUS)
        val venue = Entitlements(tier = SubscriptionTier.VENUE)

        assertTrue(EntitlementPolicy.can(pro, Capability.CAN_BROADCAST))
        assertFalse(EntitlementPolicy.can(pro, Capability.CAN_USE_TDIAB_TV))
        assertTrue(EntitlementPolicy.can(proPlus, Capability.CAN_USE_TDIAB_TV))
        assertTrue(EntitlementPolicy.can(proPlus, Capability.CAN_USE_MULTI_CAMERA))
        assertTrue(EntitlementPolicy.can(venue, Capability.CAN_USE_TDIAB_TV))
        assertTrue(EntitlementPolicy.can(venue, Capability.CAN_MANAGE_VENUE))
        assertEquals(5000, EntitlementPolicy.limit(venue, Capability.MAX_TOURNAMENT_HISTORY))
        assertEquals(1, EntitlementPolicy.limit(pro, Capability.MAX_CAMERAS))
        assertEquals(10, EntitlementPolicy.limit(proPlus, Capability.MAX_ACTIVE_TOURNAMENTS))
    }

    @Test
    fun featureUpgradeStateExplainsLockedPremiumCapabilities() {
        val free = Entitlements(tier = SubscriptionTier.FREE)
        val locked = EntitlementPolicy.upgradeState(free, Capability.CAN_USE_TDIAB_TV)
        val available = EntitlementPolicy.upgradeState(Entitlements(tier = SubscriptionTier.TD_PRO_PLUS), Capability.CAN_USE_TDIAB_TV)

        assertEquals(FeatureAccessState.LOCKED, locked.state)
        assertEquals(SubscriptionTier.TD_PRO_PLUS, locked.requiredTier)
        assertEquals(FeatureAccessState.AVAILABLE, available.state)
        assertTrue(locked.upgradeCta.contains("TD PRO PLUS"))
    }

    @Test
    fun universalPlayerIdentityRequiresProPlusOrVenue() {
        val free = Entitlements(tier = SubscriptionTier.FREE)
        val pro = Entitlements(tier = SubscriptionTier.TD_PRO)
        val proPlus = Entitlements(tier = SubscriptionTier.TD_PRO_PLUS)
        val venue = Entitlements(tier = SubscriptionTier.VENUE)

        assertFalse(PlayerIdentityService.canUseUniversalIdentity(free))
        assertFalse(PlayerIdentityService.canUseUniversalIdentity(pro))
        assertTrue(PlayerIdentityService.canUseUniversalIdentity(proPlus))
        assertTrue(PlayerIdentityService.canUseUniversalIdentity(venue))
        assertTrue(EntitlementPolicy.can(proPlus, Capability.CAN_USE_UNIVERSAL_PLAYER_IDENTITY))
        assertTrue(EntitlementPolicy.can(venue, Capability.CAN_USE_UNIVERSAL_PLAYER_IDENTITY))
    }

    @Test
    fun featuredTableScoringRequiresProPlusOrVenue() {
        val free = Entitlements(tier = SubscriptionTier.FREE)
        val pro = Entitlements(tier = SubscriptionTier.TD_PRO)
        val proPlus = Entitlements(tier = SubscriptionTier.TD_PRO_PLUS)
        val venue = Entitlements(tier = SubscriptionTier.VENUE)

        assertFalse(EntitlementPolicy.can(free, Capability.CAN_USE_FEATURED_TABLE_SCORING))
        assertFalse(EntitlementPolicy.can(pro, Capability.CAN_USE_FEATURED_TABLE_SCORING))
        assertTrue(EntitlementPolicy.can(proPlus, Capability.CAN_USE_FEATURED_TABLE_SCORING))
        assertTrue(EntitlementPolicy.can(venue, Capability.CAN_USE_FEATURED_TABLE_SCORING))
    }

    @Test
    fun venueFeaturedTableScoringIsOffByDefault() {
        val preferences = VenueBroadcastPreferences()

        assertFalse(preferences.featuredTableScoringEnabled)
    }

    @Test
    fun playerIdentityCreatesGloballyUniqueRecordsAndSearchesByNormalizedName() {
        val playerA = PlayerIdentityService.createPlayer("John Smith", createdBy = "td-austin")
        val playerB = PlayerIdentityService.createPlayer("  JOHN   SMITH  ", createdBy = "td-tulsa")

        assertTrue(playerA.id.startsWith("player_"))
        assertTrue(playerB.id.startsWith("player_"))
        assertNotEquals(playerA.id, playerB.id)
        assertEquals(playerA.normalizedName, PlayerIdentityService.normalizeName("John Smith"))
        assertEquals(playerB.normalizedName, playerA.normalizedName)
        assertTrue(PlayerIdentityService.searchPlayers(listOf(playerA, playerB), "John Smith").isNotEmpty())
    }

    @Test
    fun playerRepositoryPersistsUniqueRecordsAndAllowsDuplicateNames() = runBlocking {
        val repo = InMemoryPlayerRepository()
        val austin = PlayerIdentityService.createPlayer("John Smith", createdBy = "td-austin", location = "Austin, TX")
        val tulsa = PlayerIdentityService.createPlayer("John Smith", createdBy = "td-tulsa", location = "Tulsa, OK")

        repo.save(austin)
        repo.save(tulsa)

        val results = repo.search("John Smith")
        assertIs<DomainResult.Success<List<Player>>>(results)
        assertEquals(2, results.value.size)
        assertTrue(austin.id.startsWith("player_"))
        assertTrue(tulsa.id.startsWith("player_"))
        assertNotEquals(austin.id, tulsa.id)
    }

    @Test
    fun playerSelectionWorkflowRequiresExplicitChoiceForDuplicateMatches() {
        val existingPlayers = listOf(
            Player("player_01", "John Smith", displayName = "John Smith", normalizedName = "john smith", location = "Austin, TX"),
            Player("player_02", "John Smith", displayName = "John Smith", normalizedName = "john smith", location = "Tulsa, OK")
        )

        val evaluated = PlayerSelectionWorkflow.evaluate(
            query = "John Smith",
            knownPlayers = existingPlayers,
            selectedPlayerId = null,
            decision = PlayerIdentityDecision.SELECT_EXISTING_PLAYER
        )

        assertEquals(2, evaluated.results.size)
        assertTrue(evaluated.hasDuplicateWarning)
        assertEquals(null, evaluated.selectedPlayerId)
        assertTrue(evaluated.error?.contains("Select an existing player") == true)
    }

    @Test
    fun tournamentEntryReferencesPlayerIdInsteadOfName() {
        val player = PlayerIdentityService.createPlayer("John Smith", createdBy = "td-austin", location = "Austin, TX")
        val entry = com.promethean.tdiab.domain.TournamentEntry(
            id = "entry-1",
            tournamentId = "t-3",
            playerId = player.id,
            displayName = "John Smith"
        )

        assertEquals(player.id, entry.playerId)
        assertEquals("John Smith", entry.displayName)
        assertTrue(entry.playerId.startsWith("player_"))
    }

    @Test
    fun rosterServiceAddsSelectedPlayerByPlayerId() {
        val player = PlayerIdentityService.createPlayer("John Smith", createdBy = "td-austin", location = "Austin, TX")
        val tournament = Tournament(id = "t-3", name = "Roster Test")

        val result = TournamentRosterService.addPlayerToTournament(tournament, player)

        assertIs<DomainResult.Success<Tournament>>(result)
        assertEquals(1, result.value.entries.size)
        assertEquals(player.id, result.value.entries.first().playerId)
        assertEquals(player.displayName, result.value.entries.first().displayName)
    }

    @Test
    fun tournamentEngineAddPlayerCreatesRosterEntry() {
        val player = PlayerIdentityService.createPlayer("John Smith", createdBy = "td-austin", location = "Austin, TX")
        val state = TournamentState(Tournament(id = "t-5", name = "Engine Roster"))
        val engine = TournamentEngine()

        val result = engine.process(state, TournamentCommand.AddPlayer(player))

        assertIs<DomainResult.Success<TournamentState>>(result)
        assertEquals(1, result.value.tournament.entries.size)
        assertEquals(player.id, result.value.tournament.entries.first().playerId)
    }

    @Test
    fun jsonRoundTripPreservesTournamentData() {
        val tournament = Tournament(
            id = "t-3",
            name = "JSON Check",
            players = listOf(Player("p1", "Alice", 1), Player("p2", "Bob", 2)),
            format = TournamentFormat.DOUBLE_ELIMINATION
        )

        val payload = TournamentJson.encode(tournament)
        val decoded = TournamentJson.decode(payload)

        assertEquals(tournament.id, decoded.id)
        assertEquals(tournament.name, decoded.name)
        assertEquals(tournament.format, decoded.format)
        assertTrue(payload.contains("schemaVersion"))
    }

    @Test
    fun csvExportContainsPlayerRows() {
        val tournament = Tournament(
            id = "t-4",
            name = "CSV Sample",
            players = listOf(Player("p1", "Alice", 1), Player("p2", "Bob", 2))
        )

        val csv = TournamentCsv.toCsv(tournament)
        assertTrue(csv.contains("player_id"))
        assertTrue(csv.contains("Alice"))
        assertTrue(csv.contains("Bob"))
    }

    @Test
    fun workspaceSnapshotRoundTripsWithTournamentAndPlayers() {
        val snapshot = WorkspaceSnapshot(
            tournament = Tournament(id = "t-6", name = "Snapshot Test"),
            players = listOf(PlayerIdentityService.createPlayer("Alice", createdBy = "td-austin"))
        )

        val json = Json.encodeToString(WorkspaceSnapshot.serializer(), snapshot)
        val decoded = Json.decodeFromString(WorkspaceSnapshot.serializer(), json)

        assertEquals(snapshot.tournament.id, decoded.tournament.id)
        assertEquals(snapshot.players.first().displayName, decoded.players.first().displayName)
    }

    @Test
    fun workspaceWorkflowUpdatesTournamentAndRosterTogether() {
        val workflow = WorkspaceWorkflow()
        val created = workflow.createTournament(name = "Shared Workflow", playerCapacity = 16, numberOfTables = 4)
        val player = PlayerIdentityService.createPlayer("Alice", createdBy = "td-austin")

        val added = workflow.addPlayer(created, player)
        assertIs<DomainResult.Success<WorkspaceSnapshot>>(added)
        assertEquals(1, added.value.players.size)
        assertEquals(player.id, added.value.tournament.entries.first().playerId)

        val store = InMemoryWorkspaceStore()
        val saveResult = runBlocking { store.save(added.value) }
        assertIs<DomainResult.Success<Unit>>(saveResult)
        val loadResult = runBlocking { store.load() }
        assertIs<DomainResult.Success<WorkspaceSnapshot>>(loadResult)
        assertEquals(added.value.tournament.id, loadResult.value.tournament.id)
    }

    @Test
    fun featuredTableScoringTapsIncrementOnlyTheFeaturedMatch() {
        val state = FeaturedTableScoringService.enable(
            currentTableId = "table-1",
            matchId = "match-1",
            playerAId = "player-a",
            playerAName = "Player A",
            playerBId = "player-b",
            playerBName = "Player B",
            targetScore = 3,
            source = FeaturedTableScoringMode.MANUAL
        )

        val afterA = FeaturedTableScoringService.recordRackWinner(state, "player-a")
        val afterB = FeaturedTableScoringService.recordRackWinner(afterA, "player-b")
        val overlay = FeaturedTableScoringService.overlaySnapshot(afterB)

        assertEquals(1, afterA.playerAScore)
        assertEquals(1, afterB.playerBScore)
        assertEquals(3, afterB.currentRack)
        assertEquals(FeaturedTableScoringStatus.ACTIVE, afterB.status)
        assertTrue(overlay.contains("Player A"))
        assertTrue(overlay.contains("Player B"))
    }

    @Test
    fun featuredTableScoringCompletesAtTargetAndCanReset() {
        val state = FeaturedTableScoringService.enable(
            currentTableId = "table-1",
            matchId = "match-1",
            playerAId = "player-a",
            playerAName = "Player A",
            playerBId = "player-b",
            playerBName = "Player B",
            targetScore = 2,
            source = FeaturedTableScoringMode.MANUAL
        )

        val afterA1 = FeaturedTableScoringService.recordRackWinner(state, "player-a")
        val afterA2 = FeaturedTableScoringService.recordRackWinner(afterA1, "player-a")
        val reset = FeaturedTableScoringService.reset(afterA2)

        assertEquals(FeaturedTableScoringStatus.COMPLETE, afterA2.status)
        assertEquals("Complete", afterA2.matchStatus)
        assertEquals(0, reset.playerAScore)
        assertEquals(1, reset.currentRack)
        assertEquals(FeaturedTableScoringStatus.READY, reset.status)
    }
}
