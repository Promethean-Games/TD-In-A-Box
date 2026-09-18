package com.promethean.tdiab.domain

import kotlinx.datetime.Clock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import com.promethean.tdiab.tournament.TournamentFormatEngineRegistry
import kotlin.random.Random

@Serializable
data class Player(
    val id: String,
    val name: String,
    val seed: Int = 0,
    val state: PlayerState = PlayerState.REGISTERED,
    val registrationState: RegistrationState = RegistrationState.REGISTERED,
    val checkInState: CheckInState = CheckInState.NOT_CHECKED_IN,
    val status: PlayerStatus = PlayerStatus.REGISTERED,
    val wins: Int = 0,
    val losses: Int = 0,
    val currentMatchId: String? = null,
    val eliminated: Boolean = false,
    val placement: Int? = null,
    val chips: Int = 0,
    val displayName: String = name,
    val normalizedName: String = name.trim().replace(Regex("\\s+"), " ").lowercase(),
    val createdAt: String = "",
    val createdBy: String = "",
    val updatedAt: String = "",
    val location: String? = null,
    val profilePhotoUrl: String? = null,
    val bio: String? = null
) {
    val isUniversalIdentity: Boolean get() = id.startsWith("player_")
}

@Serializable
data class TournamentEntry(
    val id: String,
    val tournamentId: String,
    val playerId: String,
    val displayName: String,
    val seed: Int = 0,
    val status: PlayerStatus = PlayerStatus.REGISTERED,
    val createdAt: String = "",
    val updatedAt: String = ""
)

@Serializable
data class PlayerSearchQuery(
    val rawName: String,
    val normalizedName: String = rawName.trim().replace(Regex("\\s+"), " ").lowercase(),
    val selectedPlayerId: String? = null,
    val decision: PlayerIdentityDecision = PlayerIdentityDecision.SELECT_EXISTING_PLAYER
)

enum class PlayerIdentityDecision {
    SELECT_EXISTING_PLAYER,
    CREATE_NEW_PLAYER
}

@Serializable
data class PlayerSearchResult(
    val player: Player,
    val matchScore: Int = 0,
    val displayLocation: String? = null
)

object PlayerIdentityService {
    fun canUseUniversalIdentity(entitlements: Entitlements): Boolean =
        EntitlementPolicy.can(entitlements, Capability.CAN_USE_UNIVERSAL_PLAYER_IDENTITY)

    fun normalizeName(name: String): String =
        name.trim().replace(Regex("\\s+"), " ").lowercase()

    fun generatePlayerId(): String {
        val id = Random.Default.nextBytes(16).joinToString("") { "%02x".format(it) }
        return "player_$id"
    }

    fun createPlayer(
        displayName: String,
        createdBy: String = "",
        location: String? = null,
        profilePhotoUrl: String? = null,
        bio: String? = null
    ): Player {
        val normalized = normalizeName(displayName)
        val stamp = Clock.System.now().toString()
        return Player(
            id = generatePlayerId(),
            name = displayName.trim(),
            displayName = displayName.trim(),
            normalizedName = normalized,
            createdAt = stamp,
            createdBy = createdBy,
            updatedAt = stamp,
            location = location,
            profilePhotoUrl = profilePhotoUrl,
            bio = bio
        )
    }

    fun searchPlayers(players: List<Player>, query: String): List<PlayerSearchResult> {
        val normalized = normalizeName(query)
        if (normalized.isBlank()) return emptyList()
        return players
            .map { player ->
                val matchScore = when {
                    player.normalizedName == normalized -> 100
                    player.normalizedName.startsWith(normalized) -> 80
                    player.normalizedName.contains(normalized) -> 60
                    else -> 0
                }
                PlayerSearchResult(player = player, matchScore = matchScore, displayLocation = player.location)
            }
            .filter { it.matchScore > 0 }
            .sortedByDescending { it.matchScore }
    }
}

@Serializable
data class PlayerSelectionState(
    val query: String = "",
    val results: List<PlayerSearchResult> = emptyList(),
    val selectedPlayerId: String? = null,
    val decision: PlayerIdentityDecision = PlayerIdentityDecision.SELECT_EXISTING_PLAYER,
    val hasDuplicateWarning: Boolean = false,
    val requiresExplicitCreationConfirmation: Boolean = false,
    val createdPlayer: Player? = null,
    val error: String? = null
)

object PlayerSelectionWorkflow {
    fun evaluate(
        query: String,
        knownPlayers: List<Player>,
        selectedPlayerId: String? = null,
        decision: PlayerIdentityDecision = PlayerIdentityDecision.SELECT_EXISTING_PLAYER
    ): PlayerSelectionState {
        val normalized = PlayerIdentityService.normalizeName(query)
        val matches = PlayerIdentityService.searchPlayers(knownPlayers, query)
        val duplicateWarning = matches.isNotEmpty() && normalized.isNotBlank()
        val selected = if (selectedPlayerId != null) matches.firstOrNull { it.player.id == selectedPlayerId }?.player else null

        return PlayerSelectionState(
            query = query,
            results = matches,
            selectedPlayerId = selected?.id ?: selectedPlayerId,
            decision = decision,
            hasDuplicateWarning = duplicateWarning,
            requiresExplicitCreationConfirmation = decision == PlayerIdentityDecision.CREATE_NEW_PLAYER && duplicateWarning,
            createdPlayer = null,
            error = when {
                selected == null && decision == PlayerIdentityDecision.SELECT_EXISTING_PLAYER && query.isNotBlank() && matches.isEmpty() ->
                    "No matching player found. Create a new player record to continue."
                selected == null && decision == PlayerIdentityDecision.SELECT_EXISTING_PLAYER && matches.isNotEmpty() ->
                    "Select an existing player or explicitly create a new player."
                else -> null
            }
        )
    }

    fun createPlayerWithSelection(
        query: String,
        knownPlayers: List<Player>,
        createdBy: String = "",
        location: String? = null
    ): PlayerSelectionState {
        val created = PlayerIdentityService.createPlayer(query, createdBy = createdBy, location = location)
        val matches = PlayerIdentityService.searchPlayers(knownPlayers, query)
        return PlayerSelectionState(
            query = query,
            results = matches,
            selectedPlayerId = created.id,
            decision = PlayerIdentityDecision.CREATE_NEW_PLAYER,
            hasDuplicateWarning = matches.isNotEmpty(),
            requiresExplicitCreationConfirmation = matches.isNotEmpty(),
            createdPlayer = created,
            error = null
        )
    }
}

@Serializable
data class WorkspaceSnapshot(
    val tournament: Tournament = Tournament(id = "workspace", name = "Untitled Tournament"),
    val players: List<Player> = emptyList()
)

interface WorkspaceStore {
    suspend fun load(): DomainResult<WorkspaceSnapshot>
    suspend fun save(snapshot: WorkspaceSnapshot): DomainResult<Unit>
}

object TournamentRosterService {
    fun addPlayerToTournament(tournament: Tournament, player: Player): DomainResult<Tournament> {
        if (tournament.players.any { it.id == player.id } || tournament.entries.any { it.playerId == player.id }) {
            return DomainResult.Failure(DomainError.PlayerAlreadyAssigned("Player is already on this tournament roster."))
        }

        val timestamp = Clock.System.now().toString()
        val entry = TournamentEntry(
            id = "entry_${tournament.id}_${player.id}",
            tournamentId = tournament.id,
            playerId = player.id,
            displayName = player.displayName,
            seed = if (player.seed > 0) player.seed else tournament.entries.size + 1,
            status = player.status,
            createdAt = timestamp,
            updatedAt = timestamp
        )

        return DomainResult.Success(
            tournament.copy(
                players = tournament.players + player,
                entries = tournament.entries + entry,
                seedOrder = if (tournament.seedOrder.contains(player.id)) tournament.seedOrder else tournament.seedOrder + player.id,
                tournamentPhase = TournamentPhase.REGISTRATION
            )
        )
    }
}

interface PlayerRepository {
    suspend fun save(player: Player): DomainResult<Player>
    suspend fun findById(id: String): DomainResult<Player?>
    suspend fun search(query: String): DomainResult<List<Player>>
    suspend fun listAll(): DomainResult<List<Player>>
}

class InMemoryPlayerRepository(initialPlayers: List<Player> = emptyList()) : PlayerRepository {
    private val players = linkedMapOf<String, Player>().apply {
        initialPlayers.forEach { put(it.id, it) }
    }

    override suspend fun save(player: Player): DomainResult<Player> {
        players[player.id] = player
        return DomainResult.Success(player)
    }

    override suspend fun findById(id: String): DomainResult<Player?> {
        return DomainResult.Success(players[id])
    }

    override suspend fun search(query: String): DomainResult<List<Player>> {
        val normalized = PlayerIdentityService.normalizeName(query)
        if (normalized.isBlank()) {
            return DomainResult.Success(players.values.toList().sortedBy { it.displayName })
        }

        val matches = players.values.filter { player ->
            val candidate = PlayerIdentityService.normalizeName(player.displayName)
            candidate == normalized || candidate.startsWith(normalized) || candidate.contains(normalized)
        }
        return DomainResult.Success(matches.sortedByDescending { player ->
            when {
                PlayerIdentityService.normalizeName(player.displayName) == normalized -> 3
                PlayerIdentityService.normalizeName(player.displayName).startsWith(normalized) -> 2
                else -> 1
            }
        })
    }

    override suspend fun listAll(): DomainResult<List<Player>> {
        return DomainResult.Success(players.values.toList().sortedBy { it.displayName })
    }
}

@Serializable
data class Match(
    val id: String,
    val round: Int,
    val entrants: List<String> = emptyList(),
    val winnerId: String? = null,
    val loserId: String? = null,
    val tableId: String? = null,
    val state: MatchState = MatchState.PENDING,
    val stage: MatchStage = MatchStage.WINNERS,
    val result: MatchResult? = null,
    val winnerDestination: String? = null,
    val loserDestination: String? = null
)

@Serializable
data class Table(
    val id: String,
    val label: String,
    val available: Boolean = true
)

@Serializable
data class Tournament(
    val id: String,
    val name: String,
    val format: TournamentFormat = TournamentFormat.SINGLE_ELIMINATION,
    val status: TournamentStatus = TournamentStatus.DRAFT,
    val players: List<Player> = emptyList(),
    val entries: List<TournamentEntry> = emptyList(),
    val tables: List<Table> = emptyList(),
    val matches: List<Match> = emptyList(),
    val seedOrder: List<String> = emptyList(),
    val currentRound: Int = 1,
    val bracketGenerated: Boolean = false,
    val result: TournamentResult = TournamentResult(),
    val tournamentPhase: TournamentPhase = TournamentPhase.SETUP,
    val venueId: String? = null,
    val entryFee: Double = 0.0,
    val playerCapacity: Int = 0,
    val payoutStructure: Map<Int, Double> = emptyMap(),
    val formatSettings: Map<String, String> = emptyMap()
)

@Serializable
data class TournamentResult(
    val winnerId: String? = null,
    val standings: List<String> = emptyList()
)

data class TournamentState(
    val tournament: Tournament,
    val errors: List<DomainError> = emptyList()
)

@Serializable
data class Product(
    val id: String,
    val name: String,
    val tier: SubscriptionTier
)

@Serializable
data class Purchase(
    val productId: String,
    val status: SubscriptionStatus,
    val entitlementSnapshot: Entitlements
)

@Serializable
data class Entitlements(
    val tier: SubscriptionTier = SubscriptionTier.FREE,
    val customCapabilities: Map<Capability, Int> = emptyMap()
)

enum class TournamentFormat {
    SINGLE_ELIMINATION,
    DOUBLE_ELIMINATION,
    RESET_FINAL,
    MODIFIED_ELIMINATION,
    CHIP_TOURNAMENT
}

enum class TournamentStatus {
    DRAFT,
    READY,
    ACTIVE,
    COMPLETED
}

enum class PlayerState {
    REGISTERED,
    CHECKED_IN,
    ELIMINATED
}

enum class MatchState {
    PENDING,
    READY,
    CALLED,
    IN_PROGRESS,
    COMPLETE,
    BYE
}

enum class SubscriptionTier {
    FREE,
    TD_PRO,
    TD_PRO_PLUS,
    VENUE
}

enum class SubscriptionStatus {
    ACTIVE,
    PAST_DUE,
    CANCELLED,
    TRIALING
}

enum class Capability {
    CAN_CREATE_TOURNAMENT,
    CAN_SAVE_TEMPLATE,
    CAN_CREATE_PROFILE,
    CAN_BROADCAST,
    CAN_USE_TDIAB_TV,
    CAN_USE_UNIVERSAL_PLAYER_IDENTITY,
    CAN_USE_FEATURED_TABLE_SCORING,
    CAN_USE_TOURNAMENT_BRANDING,
    CAN_USE_SPONSORSHIP,
    CAN_USE_MULTI_CAMERA,
    CAN_MANAGE_VENUE,
    CAN_USE_VENUE_CALENDAR,
    CAN_USE_VENUE_ANALYTICS,
    MAX_ACTIVE_TOURNAMENTS,
    MAX_SAVED_TOURNAMENT_RECORDS,
    MAX_TOURNAMENT_TEMPLATES,
    MAX_OPERATORS,
    MAX_TOURNAMENT_HISTORY,
    MAX_VENUE_USERS,
    MAX_CAMERAS
}

enum class RegistrationState {
    REGISTERED,
    CHECKED_IN,
    NO_SHOW,
    WITHDRAWN,
    ACTIVE,
    ELIMINATED,
    COMPLETE
}

enum class CheckInState {
    NOT_CHECKED_IN,
    CHECKED_IN,
    NO_SHOW,
    WITHDRAWN
}

enum class PlayerStatus {
    REGISTERED,
    ACTIVE,
    ELIMINATED,
    COMPLETE
}

enum class TournamentPhase {
    SETUP,
    REGISTRATION,
    CHECK_IN,
    BRACKET,
    TABLES,
    MATCHES,
    SCORING,
    RESULTS,
    PAYOUT,
    ARCHIVE
}

enum class MatchStage {
    WINNERS,
    LOSERS,
    MODIFIED,
    FINAL,
    RESET_FINAL,
    CHIP
}

@Serializable
data class MatchResult(
    val winnerId: String? = null,
    val loserId: String? = null,
    val score: String = "",
    val completedAt: String = ""
)

sealed interface DomainResult<out T> {
    data class Success<T>(val value: T) : DomainResult<T>
    data class Failure(val error: DomainError) : DomainResult<Nothing>
}

sealed interface DomainError {
    val message: String

    data class TournamentAlreadyStarted(override val message: String = "Tournament has already started.") : DomainError
    data class InvalidPlayer(override val message: String = "Invalid player.") : DomainError
    data class InvalidMatch(override val message: String = "Invalid match.") : DomainError
    data class PlayerAlreadyAssigned(override val message: String = "Player is already assigned.") : DomainError
    data class TableUnavailable(override val message: String = "Table is unavailable.") : DomainError
    data class TournamentConfigurationLocked(override val message: String = "Tournament configuration is locked.") : DomainError
    data class InvalidResult(override val message: String = "Invalid result.") : DomainError
    data class InvalidLateEntry(override val message: String = "Late entry is invalid.") : DomainError
    data class StorageLimitReached(override val message: String = "Storage limit reached.") : DomainError
    data class FeatureNotAvailable(override val message: String = "Feature is not available.") : DomainError
    data class InvalidImport(override val message: String = "Imported data is invalid.") : DomainError
    data class InvalidTournamentConfiguration(override val message: String = "Tournament configuration is invalid.") : DomainError
}

sealed interface TournamentCommand {
    data class AddPlayer(val player: Player) : TournamentCommand
    data class CheckInPlayer(val playerId: String, val checkedIn: Boolean = true) : TournamentCommand
    data class RemovePlayer(val playerId: String) : TournamentCommand
    data object GenerateBracket : TournamentCommand
    data object StartTournament : TournamentCommand
    data class AssignTable(val matchId: String, val tableId: String) : TournamentCommand
    data class StartMatch(val matchId: String) : TournamentCommand
    data class CompleteMatch(val matchId: String, val winnerId: String, val score: String = "") : TournamentCommand
    data class CorrectMatchResult(val matchId: String, val winnerId: String, val score: String = "") : TournamentCommand
    data class AddLatePlayer(val player: Player) : TournamentCommand
    data class CreateTemplate(val name: String) : TournamentCommand
    data class ArchiveTournament(val reason: String = "Archived") : TournamentCommand
}

data class SubscriptionTierConfig(
    val tier: SubscriptionTier,
    val monthlyPrice: String,
    val maxActiveTournaments: Int,
    val maxSavedTournamentRecords: Int,
    val maxTournamentTemplates: Int,
    val maxOperators: Int,
    val maxCameras: Int,
    val allowsLocalBroadcast: Boolean = false,
    val allowsPublicBroadcast: Boolean = false,
    val allowsTournamentBranding: Boolean = false,
    val allowsSponsorship: Boolean = false,
    val allowsVenueFeatures: Boolean = false,
    val allowsTemplateSaving: Boolean = false,
    val allowsMultiCamera: Boolean = false,
    val allowsUniversalPlayerIdentity: Boolean = false
)

enum class FeatureAccessState {
    AVAILABLE,
    LOCKED
}

data class FeatureAccess(
    val feature: Capability,
    val requiredTier: SubscriptionTier,
    val state: FeatureAccessState,
    val label: String,
    val description: String,
    val upgradeCta: String
)

object SubscriptionCatalog {
    val tiers: Map<SubscriptionTier, SubscriptionTierConfig> = mapOf(
        SubscriptionTier.FREE to SubscriptionTierConfig(
            tier = SubscriptionTier.FREE,
            monthlyPrice = "$0/month",
            maxActiveTournaments = 1,
            maxSavedTournamentRecords = 5,
            maxTournamentTemplates = 0,
            maxOperators = 1,
            maxCameras = 0,
            allowsTemplateSaving = false,
            allowsLocalBroadcast = false,
            allowsPublicBroadcast = false,
            allowsTournamentBranding = false,
            allowsSponsorship = false,
            allowsVenueFeatures = false,
            allowsMultiCamera = false,
            allowsUniversalPlayerIdentity = false
        ),
        SubscriptionTier.TD_PRO to SubscriptionTierConfig(
            tier = SubscriptionTier.TD_PRO,
            monthlyPrice = "$4.99/month",
            maxActiveTournaments = 3,
            maxSavedTournamentRecords = 25,
            maxTournamentTemplates = 5,
            maxOperators = 1,
            maxCameras = 1,
            allowsTemplateSaving = true,
            allowsLocalBroadcast = true,
            allowsPublicBroadcast = false,
            allowsTournamentBranding = false,
            allowsSponsorship = false,
            allowsVenueFeatures = false,
            allowsMultiCamera = false,
            allowsUniversalPlayerIdentity = false
        ),
        SubscriptionTier.TD_PRO_PLUS to SubscriptionTierConfig(
            tier = SubscriptionTier.TD_PRO_PLUS,
            monthlyPrice = "$9.99/month",
            maxActiveTournaments = 10,
            maxSavedTournamentRecords = 100,
            maxTournamentTemplates = 25,
            maxOperators = 2,
            maxCameras = Int.MAX_VALUE,
            allowsTemplateSaving = true,
            allowsLocalBroadcast = true,
            allowsPublicBroadcast = true,
            allowsTournamentBranding = true,
            allowsSponsorship = true,
            allowsVenueFeatures = false,
            allowsMultiCamera = true,
            allowsUniversalPlayerIdentity = true
        ),
        SubscriptionTier.VENUE to SubscriptionTierConfig(
            tier = SubscriptionTier.VENUE,
            monthlyPrice = "$24.99/month",
            maxActiveTournaments = Int.MAX_VALUE,
            maxSavedTournamentRecords = Int.MAX_VALUE,
            maxTournamentTemplates = Int.MAX_VALUE,
            maxOperators = Int.MAX_VALUE,
            maxCameras = Int.MAX_VALUE,
            allowsTemplateSaving = true,
            allowsLocalBroadcast = true,
            allowsPublicBroadcast = true,
            allowsTournamentBranding = true,
            allowsSponsorship = true,
            allowsVenueFeatures = true,
            allowsMultiCamera = true,
            allowsUniversalPlayerIdentity = true
        )
    )

    fun configFor(tier: SubscriptionTier): SubscriptionTierConfig = tiers[tier] ?: tiers[SubscriptionTier.FREE]!!

    fun visibleUpgradePlan(feature: Capability): SubscriptionTier = when (feature) {
        Capability.CAN_BROADCAST -> SubscriptionTier.TD_PRO
        Capability.CAN_USE_TDIAB_TV -> SubscriptionTier.TD_PRO_PLUS
        Capability.CAN_USE_UNIVERSAL_PLAYER_IDENTITY -> SubscriptionTier.TD_PRO_PLUS
        Capability.CAN_USE_FEATURED_TABLE_SCORING -> SubscriptionTier.TD_PRO_PLUS
        Capability.CAN_USE_TOURNAMENT_BRANDING -> SubscriptionTier.TD_PRO_PLUS
        Capability.CAN_USE_SPONSORSHIP -> SubscriptionTier.TD_PRO_PLUS
        Capability.CAN_USE_MULTI_CAMERA -> SubscriptionTier.TD_PRO_PLUS
        Capability.CAN_MANAGE_VENUE, Capability.CAN_USE_VENUE_CALENDAR, Capability.CAN_USE_VENUE_ANALYTICS -> SubscriptionTier.VENUE
        else -> SubscriptionTier.FREE
    }
}

object EntitlementPolicy {
    private val defaultLimits: Map<Capability, Int> = mapOf(
        Capability.CAN_CREATE_TOURNAMENT to 1,
        Capability.CAN_SAVE_TEMPLATE to 1,
        Capability.CAN_CREATE_PROFILE to 1,
        Capability.CAN_BROADCAST to 0,
        Capability.CAN_USE_TDIAB_TV to 0,
        Capability.CAN_USE_UNIVERSAL_PLAYER_IDENTITY to 0,
        Capability.CAN_USE_FEATURED_TABLE_SCORING to 0,
        Capability.CAN_USE_TOURNAMENT_BRANDING to 0,
        Capability.CAN_USE_SPONSORSHIP to 0,
        Capability.CAN_USE_MULTI_CAMERA to 0,
        Capability.CAN_MANAGE_VENUE to 0,
        Capability.CAN_USE_VENUE_CALENDAR to 0,
        Capability.CAN_USE_VENUE_ANALYTICS to 0,
        Capability.MAX_ACTIVE_TOURNAMENTS to 1,
        Capability.MAX_SAVED_TOURNAMENT_RECORDS to 5,
        Capability.MAX_TOURNAMENT_TEMPLATES to 0,
        Capability.MAX_OPERATORS to 1,
        Capability.MAX_TOURNAMENT_HISTORY to 25,
        Capability.MAX_VENUE_USERS to 5,
        Capability.MAX_CAMERAS to 0
    )

    private val featureRequirements: Map<Capability, SubscriptionTier> = mapOf(
        Capability.CAN_CREATE_TOURNAMENT to SubscriptionTier.FREE,
        Capability.CAN_SAVE_TEMPLATE to SubscriptionTier.TD_PRO,
        Capability.CAN_CREATE_PROFILE to SubscriptionTier.FREE,
        Capability.CAN_BROADCAST to SubscriptionTier.TD_PRO,
        Capability.CAN_USE_TDIAB_TV to SubscriptionTier.TD_PRO_PLUS,
        Capability.CAN_USE_UNIVERSAL_PLAYER_IDENTITY to SubscriptionTier.TD_PRO_PLUS,
        Capability.CAN_USE_FEATURED_TABLE_SCORING to SubscriptionTier.TD_PRO_PLUS,
        Capability.CAN_USE_TOURNAMENT_BRANDING to SubscriptionTier.TD_PRO_PLUS,
        Capability.CAN_USE_SPONSORSHIP to SubscriptionTier.TD_PRO_PLUS,
        Capability.CAN_USE_MULTI_CAMERA to SubscriptionTier.TD_PRO_PLUS,
        Capability.CAN_MANAGE_VENUE to SubscriptionTier.VENUE,
        Capability.CAN_USE_VENUE_CALENDAR to SubscriptionTier.VENUE,
        Capability.CAN_USE_VENUE_ANALYTICS to SubscriptionTier.VENUE,
        Capability.MAX_ACTIVE_TOURNAMENTS to SubscriptionTier.FREE,
        Capability.MAX_SAVED_TOURNAMENT_RECORDS to SubscriptionTier.FREE,
        Capability.MAX_TOURNAMENT_TEMPLATES to SubscriptionTier.FREE,
        Capability.MAX_OPERATORS to SubscriptionTier.FREE,
        Capability.MAX_TOURNAMENT_HISTORY to SubscriptionTier.FREE,
        Capability.MAX_VENUE_USERS to SubscriptionTier.FREE,
        Capability.MAX_CAMERAS to SubscriptionTier.TD_PRO
    )

    fun can(entitlements: Entitlements, capability: Capability): Boolean {
        val explicitRequirement = featureRequirements[capability]
        if (explicitRequirement != null) {
            val tierOrder = SubscriptionTier.values().toList()
            val requiredIndex = tierOrder.indexOf(explicitRequirement)
            val currentIndex = tierOrder.indexOf(entitlements.tier)
            return currentIndex >= requiredIndex
        }

        return defaultLimits.containsKey(capability)
    }

    fun limit(entitlements: Entitlements, capability: Capability): Int {
        val explicit = entitlements.customCapabilities[capability]
        if (explicit != null) {
            return explicit
        }

        val config = SubscriptionCatalog.configFor(entitlements.tier)
        return when (capability) {
            Capability.MAX_ACTIVE_TOURNAMENTS -> config.maxActiveTournaments
            Capability.MAX_SAVED_TOURNAMENT_RECORDS -> config.maxSavedTournamentRecords
            Capability.MAX_TOURNAMENT_TEMPLATES -> config.maxTournamentTemplates
            Capability.MAX_OPERATORS -> config.maxOperators
            Capability.MAX_TOURNAMENT_HISTORY -> when (entitlements.tier) {
                SubscriptionTier.FREE -> 25
                SubscriptionTier.TD_PRO -> 100
                SubscriptionTier.TD_PRO_PLUS -> 500
                SubscriptionTier.VENUE -> 5000
            }
            Capability.MAX_VENUE_USERS -> when (entitlements.tier) {
                SubscriptionTier.FREE -> 5
                SubscriptionTier.TD_PRO -> 15
                SubscriptionTier.TD_PRO_PLUS -> 30
                SubscriptionTier.VENUE -> 250
            }
            Capability.MAX_CAMERAS -> config.maxCameras
            else -> defaultLimits[capability] ?: 0
        }
    }

    fun upgradeState(entitlements: Entitlements, capability: Capability): FeatureAccess {
        val requiredTier = SubscriptionCatalog.visibleUpgradePlan(capability)
        val available = can(entitlements, capability)
        val label = when (capability) {
            Capability.CAN_BROADCAST -> "Broadcast"
            Capability.CAN_USE_TDIAB_TV -> "TDTV publishing"
            Capability.CAN_USE_UNIVERSAL_PLAYER_IDENTITY -> "Universal player identity"
            Capability.CAN_USE_FEATURED_TABLE_SCORING -> "Featured table scoring"
            Capability.CAN_USE_TOURNAMENT_BRANDING -> "Tournament branding"
            Capability.CAN_USE_SPONSORSHIP -> "Sponsorship"
            Capability.CAN_USE_MULTI_CAMERA -> "Multi-camera"
            Capability.CAN_MANAGE_VENUE -> "Venue management"
            Capability.CAN_USE_VENUE_CALENDAR -> "Venue calendar"
            Capability.CAN_USE_VENUE_ANALYTICS -> "Venue analytics"
            else -> capability.name
        }
        val description = when (capability) {
            Capability.CAN_BROADCAST -> "Broadcast locally with a single camera and live overlays."
            Capability.CAN_USE_TDIAB_TV -> "Publish matches to the public TDTV network."
            Capability.CAN_USE_UNIVERSAL_PLAYER_IDENTITY -> "Create and reuse globally unique player records across tournaments and venues."
            Capability.CAN_USE_FEATURED_TABLE_SCORING -> "Run one-tap scoring for the currently featured match and update the broadcast overlay."
            Capability.CAN_USE_TOURNAMENT_BRANDING -> "Add logos, colors, and tournament-specific graphics."
            Capability.CAN_USE_SPONSORSHIP -> "Create sponsor placements and sponsor graphics."
            Capability.CAN_USE_MULTI_CAMERA -> "Broadcast multiple tables and switch between live camera feeds."
            Capability.CAN_MANAGE_VENUE -> "Operate a venue-wide tournament and broadcast platform."
            Capability.CAN_USE_VENUE_CALENDAR -> "Manage tournaments and broadcasts across the venue."
            Capability.CAN_USE_VENUE_ANALYTICS -> "Track venue performance and tournament trends."
            else -> "Feature access."
        }
        val experience = if (available) {
            FeatureAccessState.AVAILABLE
        } else {
            FeatureAccessState.LOCKED
        }
        return FeatureAccess(
            feature = capability,
            requiredTier = requiredTier,
            state = experience,
            label = label,
            description = description,
            upgradeCta = if (available) "Available" else "Available with ${requiredTier.name.replace('_', ' ')}"
        )
    }
}

interface BillingProvider {
    fun products(): List<Product>
    fun purchase(product: Product): DomainResult<Purchase>
    fun syncEntitlements(): DomainResult<Entitlements>
}

interface TournamentRepository {
    suspend fun save(tournament: Tournament): DomainResult<Unit>
    suspend fun load(id: String): DomainResult<Tournament?>
}

interface TemplateRepository {
    suspend fun saveTemplate(name: String, tournament: Tournament): DomainResult<Unit>
    suspend fun loadTemplates(): DomainResult<List<Tournament>>
}

interface VenueRepository {
    suspend fun saveVenue(name: String): DomainResult<Unit>
    suspend fun loadVenues(): DomainResult<List<String>>
}

object TournamentValidator {
    fun validate(tournament: Tournament): List<DomainError> {
        val issues = mutableListOf<DomainError>()

        if (tournament.players.size < 2) {
            issues += DomainError.InvalidTournamentConfiguration("At least two players are required.")
        }

        if (tournament.format == TournamentFormat.SINGLE_ELIMINATION && tournament.matches.isNotEmpty()) {
            val entrantCount = tournament.matches.flatMap { it.entrants }.toSet().size
            if (entrantCount != tournament.players.size) {
                issues += DomainError.InvalidTournamentConfiguration("Match entrants do not match player count.")
            }
        }

        return issues
    }
}

class TournamentEngine {
    fun process(state: TournamentState, command: TournamentCommand): DomainResult<TournamentState> {
        val tournament = state.tournament

        return when (command) {
            is TournamentCommand.AddPlayer -> {
                if (tournament.status == TournamentStatus.ACTIVE || tournament.status == TournamentStatus.COMPLETED) {
                    DomainResult.Failure(DomainError.TournamentConfigurationLocked())
                } else if (tournament.players.any { it.id == command.player.id }) {
                    DomainResult.Failure(DomainError.PlayerAlreadyAssigned())
                } else {
                    val entry = TournamentEntry(
                        id = "entry_${tournament.id}_${command.player.id}",
                        tournamentId = tournament.id,
                        playerId = command.player.id,
                        displayName = command.player.displayName,
                        seed = if (command.player.seed > 0) command.player.seed else tournament.entries.size + 1,
                        status = command.player.status,
                        createdAt = Clock.System.now().toString(),
                        updatedAt = Clock.System.now().toString()
                    )
                    val updated = tournament.copy(
                        players = tournament.players + command.player,
                        entries = tournament.entries + entry,
                        seedOrder = tournament.seedOrder + command.player.id,
                        tournamentPhase = TournamentPhase.REGISTRATION
                    )
                    DomainResult.Success(state.copy(tournament = updated, errors = emptyList()))
                }
            }

            is TournamentCommand.CheckInPlayer -> {
                val player = tournament.players.firstOrNull { it.id == command.playerId }
                    ?: return DomainResult.Failure(DomainError.InvalidPlayer())
                val updatedPlayers = tournament.players.map {
                    if (it.id == player.id) {
                        it.copy(
                            state = if (command.checkedIn) PlayerState.CHECKED_IN else PlayerState.REGISTERED,
                            registrationState = if (command.checkedIn) RegistrationState.CHECKED_IN else RegistrationState.REGISTERED,
                            checkInState = if (command.checkedIn) CheckInState.CHECKED_IN else CheckInState.NOT_CHECKED_IN
                        )
                    } else it
                }
                DomainResult.Success(state.copy(tournament = tournament.copy(players = updatedPlayers, tournamentPhase = TournamentPhase.CHECK_IN), errors = emptyList()))
            }

            is TournamentCommand.RemovePlayer -> {
                val playerExists = tournament.players.any { it.id == command.playerId }
                if (!playerExists) {
                    DomainResult.Failure(DomainError.InvalidPlayer())
                } else {
                    val updated = tournament.copy(
                        players = tournament.players.filter { it.id != command.playerId },
                        entries = tournament.entries.filter { it.playerId != command.playerId },
                        seedOrder = tournament.seedOrder.filter { it != command.playerId }
                    )
                    DomainResult.Success(state.copy(tournament = updated, errors = emptyList()))
                }
            }

            is TournamentCommand.GenerateBracket -> {
                val formatEngine = TournamentFormatEngineRegistry.forFormat(tournament.format)
                    ?: return DomainResult.Failure(DomainError.FeatureNotAvailable("Format ${tournament.format} is not supported yet."))
                formatEngine.generateBracket(tournament).mapTournamentState(state)
            }

            is TournamentCommand.StartTournament -> {
                if (!tournament.bracketGenerated) {
                    DomainResult.Failure(DomainError.InvalidTournamentConfiguration("Generate the bracket before starting the tournament."))
                } else if (tournament.status == TournamentStatus.ACTIVE || tournament.status == TournamentStatus.COMPLETED) {
                    DomainResult.Failure(DomainError.TournamentAlreadyStarted())
                } else {
                    val updated = tournament.copy(status = TournamentStatus.ACTIVE, tournamentPhase = TournamentPhase.MATCHES)
                    DomainResult.Success(state.copy(tournament = updated, errors = emptyList()))
                }
            }

            is TournamentCommand.AssignTable -> {
                val match = tournament.matches.firstOrNull { it.id == command.matchId }
                if (match == null) {
                    DomainResult.Failure(DomainError.InvalidMatch())
                } else {
                    val table = tournament.tables.firstOrNull { it.id == command.tableId }
                    if (table == null || !table.available) {
                        DomainResult.Failure(DomainError.TableUnavailable())
                    } else {
                        val updatedMatches = tournament.matches.map {
                            if (it.id == command.matchId) it.copy(tableId = command.tableId, state = MatchState.READY) else it
                        }
                        val updated = tournament.copy(matches = updatedMatches, tournamentPhase = TournamentPhase.TABLES)
                        DomainResult.Success(state.copy(tournament = updated, errors = emptyList()))
                    }
                }
            }

            is TournamentCommand.StartMatch -> {
                val match = tournament.matches.firstOrNull { it.id == command.matchId }
                if (match == null) {
                    DomainResult.Failure(DomainError.InvalidMatch())
                } else {
                    val updatedMatches = tournament.matches.map {
                        if (it.id == command.matchId) it.copy(state = MatchState.IN_PROGRESS) else it
                    }
                    val updated = tournament.copy(matches = updatedMatches)
                    DomainResult.Success(state.copy(tournament = updated, errors = emptyList()))
                }
            }

            is TournamentCommand.CompleteMatch -> {
                val formatEngine = TournamentFormatEngineRegistry.forFormat(tournament.format)
                    ?: return DomainResult.Failure(DomainError.FeatureNotAvailable("Format ${tournament.format} is not supported yet."))
                formatEngine.completeMatch(tournament, command.matchId, command.winnerId, command.score).mapTournamentState(state)
            }

            is TournamentCommand.CorrectMatchResult -> {
                val formatEngine = TournamentFormatEngineRegistry.forFormat(tournament.format)
                    ?: return DomainResult.Failure(DomainError.FeatureNotAvailable("Format ${tournament.format} is not supported yet."))
                formatEngine.correctMatchResult(tournament, command.matchId, command.winnerId, command.score).mapTournamentState(state)
            }

            is TournamentCommand.AddLatePlayer -> {
                if (tournament.status == TournamentStatus.ACTIVE || tournament.status == TournamentStatus.COMPLETED) {
                    DomainResult.Failure(DomainError.InvalidLateEntry())
                } else {
                    val entry = TournamentEntry(
                        id = "entry_${tournament.id}_${command.player.id}",
                        tournamentId = tournament.id,
                        playerId = command.player.id,
                        displayName = command.player.displayName,
                        seed = if (command.player.seed > 0) command.player.seed else tournament.entries.size + 1,
                        status = command.player.status,
                        createdAt = Clock.System.now().toString(),
                        updatedAt = Clock.System.now().toString()
                    )
                    val updated = tournament.copy(
                        players = tournament.players + command.player,
                        entries = tournament.entries + entry,
                        seedOrder = tournament.seedOrder + command.player.id,
                        matches = if (tournament.bracketGenerated) emptyList() else tournament.matches,
                        bracketGenerated = if (tournament.bracketGenerated) false else tournament.bracketGenerated,
                        result = if (tournament.bracketGenerated) TournamentResult() else tournament.result,
                        currentRound = if (tournament.bracketGenerated) 1 else tournament.currentRound,
                        status = if (tournament.bracketGenerated) TournamentStatus.DRAFT else tournament.status,
                        tournamentPhase = TournamentPhase.REGISTRATION
                    )
                    DomainResult.Success(state.copy(tournament = updated, errors = emptyList()))
                }
            }

            is TournamentCommand.CreateTemplate -> {
                val generated = tournament.copy(name = command.name)
                DomainResult.Success(state.copy(tournament = generated, errors = emptyList()))
            }

            is TournamentCommand.ArchiveTournament -> {
                val updated = tournament.copy(status = TournamentStatus.COMPLETED, tournamentPhase = TournamentPhase.ARCHIVE)
                DomainResult.Success(state.copy(tournament = updated, errors = emptyList()))
            }
        }
    }

    private fun DomainResult<Tournament>.mapTournamentState(state: TournamentState): DomainResult<TournamentState> {
        return when (this) {
            is DomainResult.Success -> DomainResult.Success(state.copy(tournament = value, errors = emptyList()))
            is DomainResult.Failure -> this
        }
    }
}

@Serializable
data class TournamentExport(
    val schemaVersion: Int = 1,
    val tournamentVersion: String = "1.0.0",
    val tournament: Tournament,
    val exportedAtUtc: String = ""
)

object TournamentJson {
    private val json = Json {
        prettyPrint = true
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    fun encode(tournament: Tournament): String {
        val export = TournamentExport(tournament = tournament, exportedAtUtc = "2026-01-01T00:00:00Z")
        return json.encodeToString(TournamentExport.serializer(), export)
    }

    fun decode(payload: String): Tournament {
        val export = json.decodeFromString(TournamentExport.serializer(), payload)
        return export.tournament
    }
}

object TournamentCsv {
    fun toCsv(tournament: Tournament): String {
        val header = listOf("id", "name", "player_id", "player_name", "seed", "status")
        val rows = tournament.players.map { player ->
            listOf(
                tournament.id,
                tournament.name,
                player.id,
                player.name,
                player.seed.toString(),
                player.state.name
            )
        }

        return buildString {
            appendLine(header.joinToString(","))
            rows.forEach { appendLine(it.joinToString(",")) }
        }
    }
}
