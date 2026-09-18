package com.promethean.tdiab

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.promethean.tdiab.domain.DomainResult
import com.promethean.tdiab.domain.MatchState
import com.promethean.tdiab.domain.Player
import com.promethean.tdiab.domain.PlayerIdentityDecision
import com.promethean.tdiab.domain.PlayerSelectionWorkflow
import com.promethean.tdiab.domain.Tournament
import com.promethean.tdiab.domain.TournamentConfiguration
import com.promethean.tdiab.domain.TournamentEntry
import com.promethean.tdiab.domain.TournamentFormat
import com.promethean.tdiab.domain.TournamentRosterService
import com.promethean.tdiab.domain.TournamentState
import com.promethean.tdiab.domain.TournamentStatus
import com.promethean.tdiab.domain.WorkspaceSnapshot
import com.promethean.tdiab.domain.WorkspaceStore
import com.promethean.tdiab.broadcast.FeaturedTableScoringMode
import com.promethean.tdiab.broadcast.FeaturedTableScoringService
import com.promethean.tdiab.broadcast.FeaturedTableScoringState
import com.promethean.tdiab.persistence.AndroidFileWorkspaceStore
import com.promethean.tdiab.tournament.TournamentStateEngine
import kotlinx.coroutines.launch

enum class WorkspaceTab {
    SETUP,
    ROSTER,
    BRACKET,
    MATCHES
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val workspaceStore = AndroidFileWorkspaceStore(applicationContext)
        setContent { TdiabApp(workspaceStore) }
    }
}

@Composable
fun TdiabApp(workspaceStore: WorkspaceStore) {
    val stateEngine = remember { TournamentStateEngine() }
    val initialPlayers = listOf(
        Player("player_01", "John Smith", displayName = "John Smith", normalizedName = "john smith", location = "Austin, TX", createdBy = "td-austin"),
        Player("player_02", "John Smith", displayName = "John Smith", normalizedName = "john smith", location = "Tulsa, OK", createdBy = "td-tulsa"),
        Player("player_03", "John Smith", displayName = "John Smith", normalizedName = "john smith", location = "Dallas, TX", createdBy = "td-dallas"),
        Player("player_04", "Sarah Johnson", displayName = "Sarah Johnson", normalizedName = "sarah johnson", location = "Houston, TX", createdBy = "td-houston"),
        Player("player_05", "Mike Davis", displayName = "Mike Davis", normalizedName = "mike davis", location = "Tulsa, OK", createdBy = "td-tulsa")
    )

    var universalPlayers by remember { mutableStateOf(initialPlayers) }
    var selectedTab by remember { mutableStateOf(WorkspaceTab.SETUP) }
    var tournamentName by remember { mutableStateOf("Riverside 9-Ball Open") }
    var tournamentCapacity by remember { mutableStateOf("32") }
    var tournamentTables by remember { mutableStateOf("8") }
    var tournamentState by remember {
        mutableStateOf(
            stateEngine.createTournament(
                TournamentConfiguration(
                    name = tournamentName,
                    format = TournamentFormat.SINGLE_ELIMINATION,
                    playerCapacity = 32,
                    numberOfTables = 8
                )
            )
        )
    }
    var query by remember { mutableStateOf("John Smith") }
    var locationInput by remember { mutableStateOf("Austin, TX") }
    var decision by remember { mutableStateOf(PlayerIdentityDecision.SELECT_EXISTING_PLAYER) }
    var selectedPlayerId by remember { mutableStateOf<String?>(initialPlayers.first().id) }
    var creationConfirmed by remember { mutableStateOf(false) }
    var lastAddedPlayerId by remember { mutableStateOf<String?>(null) }
    var selectedMatchId by remember { mutableStateOf<String?>(null) }
    var featuredScoringState by remember { mutableStateOf(FeaturedTableScoringState()) }
    var featuredTarget by remember { mutableStateOf("") }
    var feedbackMessage by remember { mutableStateOf<String?>(null) }
    val coroutineScope = rememberCoroutineScope()

    val tournament = tournamentState.tournament
    val selectionState = remember(query, universalPlayers, selectedPlayerId, decision) {
        PlayerSelectionWorkflow.evaluate(
            query = query,
            knownPlayers = universalPlayers,
            selectedPlayerId = selectedPlayerId,
            decision = decision
        )
    }
    val selectedPlayer = universalPlayers.firstOrNull { it.id == selectedPlayerId }
    val lastAddedPlayer = universalPlayers.firstOrNull { it.id == lastAddedPlayerId }
    val selectedMatch = tournament.matches.firstOrNull { it.id == selectedMatchId } ?: tournament.matches.firstOrNull()

    fun persistWorkspace(currentTournament: Tournament = tournamentState.tournament, currentPlayers: List<Player> = universalPlayers) {
        coroutineScope.launch {
            workspaceStore.save(WorkspaceSnapshot(tournament = currentTournament, players = currentPlayers))
        }
    }

    LaunchedEffect(Unit) {
        when (val loaded = workspaceStore.load()) {
            is DomainResult.Success -> {
                val snapshot = loaded.value
                universalPlayers = if (snapshot.players.isNotEmpty()) snapshot.players else universalPlayers
                tournamentState = TournamentState(snapshot.tournament)
                selectedPlayerId = snapshot.players.firstOrNull()?.id ?: selectedPlayerId
                feedbackMessage = "Workspace loaded."
            }
            is DomainResult.Failure -> {
                feedbackMessage = loaded.error.message
            }
        }
    }

    fun addPlayerToRoster(player: Player, currentPlayers: List<Player> = universalPlayers) {
        when (val result = TournamentRosterService.addPlayerToTournament(tournament, player)) {
            is DomainResult.Success -> {
                tournamentState = TournamentState(result.value)
                lastAddedPlayerId = player.id
                feedbackMessage = "${player.displayName} added to the roster."
                decision = PlayerIdentityDecision.SELECT_EXISTING_PLAYER
                selectedPlayerId = player.id
                creationConfirmed = false
                persistWorkspace(result.value, currentPlayers)
            }

            is DomainResult.Failure -> feedbackMessage = result.error.message
        }
    }

    fun createTournamentShell() {
        val capacity = tournamentCapacity.toIntOrNull() ?: 32
        val tables = tournamentTables.toIntOrNull() ?: 8
        tournamentState = stateEngine.createTournament(
            TournamentConfiguration(
                name = tournamentName.ifBlank { "Untitled Tournament" },
                format = TournamentFormat.SINGLE_ELIMINATION,
                playerCapacity = capacity,
                numberOfTables = tables
            )
        )
        feedbackMessage = "Tournament shell created."
        selectedTab = WorkspaceTab.ROSTER
        persistWorkspace(tournamentState.tournament, universalPlayers)
    }

    fun applyResult(result: DomainResult<TournamentState>, successMessage: String) {
        when (result) {
            is DomainResult.Success -> {
                tournamentState = result.value
                feedbackMessage = successMessage
                persistWorkspace(result.value.tournament, universalPlayers)
            }

            is DomainResult.Failure -> feedbackMessage = result.error.message
        }
    }

    fun createAndAddPlayer() {
        if (query.isBlank()) {
            feedbackMessage = "Enter a player name before creating a new player."
            return
        }
        val updatedPlayers = universalPlayers
        val createdState = PlayerSelectionWorkflow.createPlayerWithSelection(
            query = query,
            knownPlayers = updatedPlayers,
            createdBy = "td-ui",
            location = locationInput
        )
        createdState.createdPlayer?.let { createdPlayer ->
            val nextPlayers = updatedPlayers + createdPlayer
            universalPlayers = nextPlayers
            selectedPlayerId = createdPlayer.id
            addPlayerToRoster(createdPlayer, nextPlayers)
            selectedTab = WorkspaceTab.ROSTER
        }
    }

    fun assignTable(matchId: String, tableId: String) {
        applyResult(stateEngine.assignTable(tournamentState, matchId, tableId), "Table assigned.")
    }

    fun startMatch(matchId: String) {
        applyResult(stateEngine.addPlayer(tournamentState, Player("tmp", "tmp")), "")
        applyResult(stateEngine.checkInPlayer(tournamentState, "tmp"), "")
        applyResult(stateEngine.startTournament(tournamentState), "")
        applyResult(stateEngine.assignTable(tournamentState, matchId, tournament.tables.firstOrNull()?.id ?: ""), "")
    }

    MaterialTheme(colorScheme = darkColorScheme(), typography = MaterialTheme.typography) {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(Color(0xFF0E1117), Color(0xFF0A0D12), Color(0xFF05070B))
                        )
                    )
            ) {
                Row(modifier = Modifier.fillMaxSize()) {
                    Sidebar()

                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .verticalScroll(rememberScrollState())
                            .padding(24.dp)
                    ) {
                        TopBar(tournament = tournament)
                        Spacer(modifier = Modifier.height(14.dp))
                        WorkspaceTabs(selectedTab = selectedTab, onSelect = { selectedTab = it })
                        Spacer(modifier = Modifier.height(18.dp))

                        when (selectedTab) {
                            WorkspaceTab.SETUP -> SetupScreen(
                                tournamentName = tournamentName,
                                onTournamentNameChange = { tournamentName = it },
                                tournamentCapacity = tournamentCapacity,
                                onTournamentCapacityChange = { tournamentCapacity = it },
                                tournamentTables = tournamentTables,
                                onTournamentTablesChange = { tournamentTables = it },
                                onCreateTournament = ::createTournamentShell,
                                tournament = tournament,
                                feedbackMessage = feedbackMessage,
                                onGenerateBracket = {
                                    applyResult(stateEngine.generateBracket(tournamentState), "Bracket generated from the current roster.")
                                },
                                onStartTournament = {
                                    applyResult(stateEngine.startTournament(tournamentState), "Tournament started.")
                                }
                            )

                            WorkspaceTab.ROSTER -> RosterScreen(
                                query = query,
                                onQueryChange = {
                                    query = it
                                    decision = PlayerIdentityDecision.SELECT_EXISTING_PLAYER
                                    selectedPlayerId = null
                                    creationConfirmed = false
                                    feedbackMessage = null
                                },
                                locationInput = locationInput,
                                onLocationChange = { locationInput = it },
                                players = selectionState.results.map { it.player },
                                selectedPlayer = selectedPlayer,
                                selectedPlayerId = selectedPlayerId,
                                onSelect = {
                                    selectedPlayerId = it.id
                                    decision = PlayerIdentityDecision.SELECT_EXISTING_PLAYER
                                    creationConfirmed = false
                                    feedbackMessage = null
                                },
                                onAddSelected = { selectedPlayer?.let(::addPlayerToRoster) },
                                onCreateNew = {
                                    decision = PlayerIdentityDecision.CREATE_NEW_PLAYER
                                    selectedPlayerId = null
                                    feedbackMessage = null
                                },
                                showWarning = selectionState.hasDuplicateWarning,
                                confirmed = creationConfirmed,
                                onConfirmedChange = { creationConfirmed = it },
                                onCancelCreate = {
                                    decision = PlayerIdentityDecision.SELECT_EXISTING_PLAYER
                                    creationConfirmed = false
                                    feedbackMessage = null
                                },
                                onCreatePlayer = ::createAndAddPlayer,
                                entries = tournament.entries,
                                rosterPlayers = universalPlayers,
                                lastAddedPlayer = lastAddedPlayer,
                                errorMessage = feedbackMessage ?: selectionState.error
                            )

                            WorkspaceTab.BRACKET -> BracketScreen(
                                tournament = tournament,
                                feedbackMessage = feedbackMessage,
                                onGenerateBracket = {
                                    applyResult(stateEngine.generateBracket(tournamentState), "Bracket generated from the current roster.")
                                },
                                onStartTournament = {
                                    applyResult(stateEngine.startTournament(tournamentState), "Tournament started.")
                                }
                            )

                            WorkspaceTab.MATCHES -> MatchScreen(
                                tournament = tournament,
                                selectedMatchId = selectedMatchId,
                                onSelectMatch = { selectedMatchId = it },
                                onAssignTable = ::assignTable,
                                onStartMatch = {
                                    selectedMatch?.let { match ->
                                        applyResult(stateEngine.startMatch(tournamentState, match.id), "Match started.")
                                    }
                                },
                                onCompleteMatch = { matchId, winnerId ->
                                    applyResult(stateEngine.completeMatch(tournamentState, matchId, winnerId), "Match completed.")
                                },
                                onCorrectMatch = { matchId, winnerId ->
                                    applyResult(stateEngine.correctMatchResult(tournamentState, matchId, winnerId), "Match corrected.")
                                },
                                feedbackMessage = feedbackMessage,
                                featuredScoringState = featuredScoringState,
                                featuredTarget = featuredTarget,
                                onFeaturedTargetChange = { featuredTarget = it },
                                onEnableFeaturedScoring = {
                                    selectedMatch?.let { match ->
                                        if (match.entrants.size >= 2) {
                                            val playerA = tournament.players.firstOrNull { it.id == match.entrants[0] }
                                            val playerB = tournament.players.firstOrNull { it.id == match.entrants[1] }
                                            featuredScoringState = FeaturedTableScoringService.enable(
                                                currentTableId = match.tableId,
                                                matchId = match.id,
                                                playerAId = match.entrants[0],
                                                playerAName = playerA?.displayName ?: match.entrants[0],
                                                playerBId = match.entrants[1],
                                                playerBName = playerB?.displayName ?: match.entrants[1],
                                                targetScore = featuredTarget.toIntOrNull(),
                                                source = FeaturedTableScoringMode.MANUAL
                                            )
                                        }
                                    }
                                },
                                onTapRackWinner = { playerId ->
                                    featuredScoringState = FeaturedTableScoringService.recordRackWinner(featuredScoringState, playerId)
                                },
                                onResetFeaturedScoring = {
                                    featuredScoringState = FeaturedTableScoringService.reset(featuredScoringState)
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun WorkspaceTabs(selectedTab: WorkspaceTab, onSelect: (WorkspaceTab) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        WorkspaceTabChip("Setup", selectedTab == WorkspaceTab.SETUP, onClick = { onSelect(WorkspaceTab.SETUP) })
        WorkspaceTabChip("Roster", selectedTab == WorkspaceTab.ROSTER, onClick = { onSelect(WorkspaceTab.ROSTER) })
        WorkspaceTabChip("Bracket", selectedTab == WorkspaceTab.BRACKET, onClick = { onSelect(WorkspaceTab.BRACKET) })
        WorkspaceTabChip("Matches", selectedTab == WorkspaceTab.MATCHES, onClick = { onSelect(WorkspaceTab.MATCHES) })
    }
}

@Composable
private fun WorkspaceTabChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (selected) Color(0xFFDF1E2D) else Color(0xFF1B2029)
        ),
        border = BorderStroke(1.dp, if (selected) Color(0xFFDF1E2D) else Color(0xFF2B3440))
    ) {
        Text(label)
    }
}

@Composable
private fun SetupScreen(
    tournamentName: String,
    onTournamentNameChange: (String) -> Unit,
    tournamentCapacity: String,
    onTournamentCapacityChange: (String) -> Unit,
    tournamentTables: String,
    onTournamentTablesChange: (String) -> Unit,
    onCreateTournament: () -> Unit,
    tournament: Tournament,
    feedbackMessage: String?,
    onGenerateBracket: () -> Unit,
    onStartTournament: () -> Unit
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
        StageCard(modifier = Modifier.weight(1f), step = "A", title = "Create Tournament") {
            Text("Tournament name", color = Color(0xFFB2BDD0), fontSize = 12.sp)
            OutlinedTextField(value = tournamentName, onValueChange = onTournamentNameChange, modifier = Modifier.fillMaxWidth(), colors = fieldColors())
            Spacer(modifier = Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Player cap", color = Color(0xFFB2BDD0), fontSize = 12.sp)
                    OutlinedTextField(value = tournamentCapacity, onValueChange = onTournamentCapacityChange, modifier = Modifier.fillMaxWidth(), colors = fieldColors())
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text("Tables", color = Color(0xFFB2BDD0), fontSize = 12.sp)
                    OutlinedTextField(value = tournamentTables, onValueChange = onTournamentTablesChange, modifier = Modifier.fillMaxWidth(), colors = fieldColors())
                }
            }
            Spacer(modifier = Modifier.height(14.dp))
            Button(onClick = onCreateTournament, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDF1E2D)), modifier = Modifier.fillMaxWidth()) {
                Text("Create Tournament Shell")
            }
        }

        StageCard(modifier = Modifier.weight(1f), step = "B", title = "Tournament Status") {
            MetricRow("Status", tournament.status.name)
            MetricRow("Roster", "${tournament.entries.size} players")
            MetricRow("Bracket", if (tournament.bracketGenerated) "Generated" else "Pending")
            MetricRow("Matches", tournament.matches.size.toString())
            if (!feedbackMessage.isNullOrBlank()) {
                Spacer(modifier = Modifier.height(12.dp))
                Text(feedbackMessage, color = Color(0xFFB5C2D3), fontSize = 12.sp)
            }
            Spacer(modifier = Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(onClick = onGenerateBracket, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1F6ECF)), modifier = Modifier.weight(1f)) {
                    Text("Generate Bracket")
                }
                Button(onClick = onStartTournament, enabled = tournament.bracketGenerated && tournament.status == TournamentStatus.READY, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDF1E2D)), modifier = Modifier.weight(1f)) {
                    Text("Start Tournament")
                }
            }
            Spacer(modifier = Modifier.height(14.dp))
            HorizontalDivider(color = Color(0xFF273244), thickness = 1.dp)
            Spacer(modifier = Modifier.height(12.dp))
            if (tournament.matches.isEmpty()) {
                Text("No bracket yet. Create a shell, add players, then generate the bracket.", color = Color(0xFF8F9BAB), fontSize = 12.sp)
            } else {
                tournament.matches.take(4).forEach { match ->
                    MetricRow(match.id, "${match.stage.name} • ${match.state.name}")
                }
            }
        }
    }
}

@Composable
private fun RosterScreen(
    query: String,
    onQueryChange: (String) -> Unit,
    locationInput: String,
    onLocationChange: (String) -> Unit,
    players: List<Player>,
    selectedPlayer: Player?,
    selectedPlayerId: String?,
    onSelect: (Player) -> Unit,
    onAddSelected: () -> Unit,
    onCreateNew: () -> Unit,
    showWarning: Boolean,
    confirmed: Boolean,
    onConfirmedChange: (Boolean) -> Unit,
    onCancelCreate: () -> Unit,
    onCreatePlayer: () -> Unit,
    entries: List<TournamentEntry>,
    rosterPlayers: List<Player>,
    lastAddedPlayer: Player?,
    errorMessage: String?
) {
    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            StageCard(modifier = Modifier.weight(1f), step = "1", title = "Search for Player") {
                OutlinedTextField(value = query, onValueChange = onQueryChange, singleLine = true, placeholder = { Text("Type a player name") }, modifier = Modifier.fillMaxWidth(), colors = fieldColors())
                Spacer(modifier = Modifier.height(12.dp))
                HorizontalDivider(color = Color(0xFF273244), thickness = 1.dp)
                Spacer(modifier = Modifier.height(12.dp))
                Text(if (query.isBlank()) "Start typing to search the universal database." else "${players.size} possible matches", color = Color(0xFF9BA8BA), fontSize = 12.sp)
                Spacer(modifier = Modifier.height(16.dp))
                OutlinedButton(onClick = onCreateNew, border = BorderStroke(1.dp, Color(0xFF3A465B)), modifier = Modifier.fillMaxWidth()) {
                    Text("+ Create New Player", color = Color(0xFFE5EAF2))
                }
            }

            StageCard(modifier = Modifier.weight(1f), step = "2", title = "Review Results") {
                if (players.isEmpty()) {
                    Text("No existing players match this search yet.", color = Color(0xFF9BA8BA), fontSize = 13.sp)
                } else {
                    players.forEach { player ->
                        val active = player.id == selectedPlayerId
                        Card(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                            colors = CardDefaults.cardColors(containerColor = if (active) Color(0xFF1A1F29) else Color(0xFF101821)),
                            border = BorderStroke(1.dp, if (active) Color(0xFFDF1E2D) else Color(0xFF2D3847))
                        ) {
                            Row(modifier = Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                Column {
                                    Text(player.displayName, color = Color.White, fontWeight = FontWeight.Bold)
                                    Text(player.location ?: "Unknown location", color = Color(0xFF9BA8BA), fontSize = 12.sp)
                                }
                                Button(onClick = { onSelect(player) }, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1B242F)), shape = RoundedCornerShape(10.dp)) {
                                    Text(if (active) "Selected" else "Select")
                                }
                            }
                        }
                    }
                }
                Spacer(modifier = Modifier.height(10.dp))
                OutlinedButton(onClick = onAddSelected, border = BorderStroke(1.dp, Color(0xFF3A465B)), modifier = Modifier.fillMaxWidth()) {
                    Text("Add Selected to Roster", color = Color(0xFFE5EAF2))
                }
            }
        }

        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            StageCard(modifier = Modifier.weight(1f), step = "3", title = "Create New Player") {
                if (showWarning) {
                    Box(modifier = Modifier.fillMaxWidth().background(Color(0xFF3E2A10), RoundedCornerShape(10.dp)).padding(12.dp)) {
                        Text("Possible existing players found. Confirm before creating a new universal player.", color = Color(0xFFFFE79C), fontSize = 12.sp)
                    }
                    Spacer(modifier = Modifier.height(12.dp))
                }
                Text("Full Name", color = Color(0xFFB2BDD0), fontSize = 12.sp)
                OutlinedTextField(value = query, onValueChange = {}, enabled = false, modifier = Modifier.fillMaxWidth(), colors = fieldColors())
                Spacer(modifier = Modifier.height(12.dp))
                Text("Location", color = Color(0xFFB2BDD0), fontSize = 12.sp)
                OutlinedTextField(value = locationInput, onValueChange = onLocationChange, modifier = Modifier.fillMaxWidth(), colors = fieldColors())
                Spacer(modifier = Modifier.height(12.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(
                        checked = confirmed,
                        onCheckedChange = onConfirmedChange,
                        colors = CheckboxDefaults.colors(checkedColor = Color(0xFFDF1E2D), uncheckedColor = Color(0xFF65748B))
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("I confirm this is a new player.", color = Color(0xFFE7EDF5), fontSize = 12.sp)
                }
                Spacer(modifier = Modifier.height(18.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(onClick = onCancelCreate, border = BorderStroke(1.dp, Color(0xFF2B3440)), modifier = Modifier.weight(1f)) { Text("Cancel") }
                    Button(onClick = onCreatePlayer, enabled = confirmed && query.isNotBlank(), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDF1E2D)), modifier = Modifier.weight(1f)) {
                        Text("Create + Add")
                    }
                }
            }

            StageCard(modifier = Modifier.weight(1f), step = "4", title = "Roster Added") {
                if (lastAddedPlayer != null) {
                    Box(modifier = Modifier.fillMaxWidth().background(Color(0xFF17372A), RoundedCornerShape(12.dp)).padding(16.dp)) {
                        Column {
                            Text("${lastAddedPlayer.displayName} has been added!", color = Color(0xFFBFF2CC), fontWeight = FontWeight.Bold)
                            Text("The roster stores the universal Player ID plus a display-name snapshot.", color = Color(0xFFD7FBE0), fontSize = 12.sp)
                        }
                    }
                    Spacer(modifier = Modifier.height(16.dp))
                }
                if (!errorMessage.isNullOrBlank()) {
                    Text(errorMessage, color = Color(0xFFFFB4B8), fontSize = 12.sp)
                    Spacer(modifier = Modifier.height(10.dp))
                }
                entries.forEach { entry ->
                    val player = rosterPlayers.firstOrNull { it.id == entry.playerId }
                    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Text(entry.displayName, color = Color.White)
                        Text(player?.location ?: "Unknown", color = Color.White)
                        Text(entry.playerId.takeLast(8), color = Color(0xFF9AA7B9))
                    }
                }
            }
        }
    }
}

@Composable
private fun BracketScreen(
    tournament: Tournament,
    feedbackMessage: String?,
    onGenerateBracket: () -> Unit,
    onStartTournament: () -> Unit
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
        StageCard(modifier = Modifier.weight(1f), step = "A", title = "Bracket Status") {
            MetricRow("Players", tournament.players.size.toString())
            MetricRow("Matches", tournament.matches.size.toString())
            MetricRow("Status", tournament.status.name)
            MetricRow("Phase", tournament.tournamentPhase.name)
            if (!feedbackMessage.isNullOrBlank()) {
                Spacer(modifier = Modifier.height(12.dp))
                Text(feedbackMessage, color = Color(0xFFB5C2D3), fontSize = 12.sp)
            }
            Spacer(modifier = Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(onClick = onGenerateBracket, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1F6ECF)), modifier = Modifier.weight(1f)) { Text("Generate Bracket") }
                Button(onClick = onStartTournament, enabled = tournament.bracketGenerated && tournament.status == TournamentStatus.READY, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDF1E2D)), modifier = Modifier.weight(1f)) { Text("Start Tournament") }
            }
        }

        StageCard(modifier = Modifier.weight(1f), step = "B", title = "Match Graph") {
            if (tournament.matches.isEmpty()) {
                Text("No bracket generated yet.", color = Color(0xFF9BA8BA), fontSize = 13.sp)
            } else {
                tournament.matches.forEach { match ->
                    Card(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                        colors = CardDefaults.cardColors(containerColor = Color(0xFF101821)),
                        border = BorderStroke(1.dp, Color(0xFF2D3847))
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                                Text(match.id, color = Color.White, fontWeight = FontWeight.Bold)
                                Text(match.state.name, color = Color(0xFF9AA7B9))
                            }
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(match.entrants.joinToString(" vs ").ifBlank { "Awaiting entrants" }, color = Color(0xFFBFC8D6), fontSize = 12.sp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MatchScreen(
    tournament: Tournament,
    selectedMatchId: String?,
    onSelectMatch: (String) -> Unit,
    onAssignTable: (String, String) -> Unit,
    onStartMatch: () -> Unit,
    onCompleteMatch: (String, String) -> Unit,
    onCorrectMatch: (String, String) -> Unit,
    feedbackMessage: String?,
    featuredScoringState: FeaturedTableScoringState,
    featuredTarget: String,
    onFeaturedTargetChange: (String) -> Unit,
    onEnableFeaturedScoring: () -> Unit,
    onTapRackWinner: (String) -> Unit,
    onResetFeaturedScoring: () -> Unit
) {
    val selectedMatch = tournament.matches.firstOrNull { it.id == selectedMatchId } ?: tournament.matches.firstOrNull()
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
        StageCard(modifier = Modifier.weight(1f), step = "A", title = "Matches") {
            tournament.matches.forEach { match ->
                val active = match.id == selectedMatch?.id
                Card(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                    colors = CardDefaults.cardColors(containerColor = if (active) Color(0xFF1A1F29) else Color(0xFF101821)),
                    border = BorderStroke(1.dp, if (active) Color(0xFFDF1E2D) else Color(0xFF2D3847))
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text(match.id, color = Color.White, fontWeight = FontWeight.Bold)
                            Text(match.entrants.joinToString(" vs ").ifBlank { "Awaiting entrants" }, color = Color(0xFF9BA8BA), fontSize = 12.sp)
                        }
                        Button(onClick = { onSelectMatch(match.id) }, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1B242F)), shape = RoundedCornerShape(10.dp)) {
                            Text(if (active) "Selected" else "Select")
                        }
                    }
                }
            }
        }

        StageCard(modifier = Modifier.weight(1f), step = "B", title = "Match Control") {
            if (selectedMatch == null) {
                Text("No match selected.", color = Color(0xFF9BA8BA), fontSize = 13.sp)
            } else {
                MetricRow("State", selectedMatch.state.name)
                MetricRow("Table", selectedMatch.tableId ?: "Unassigned")
                MetricRow("Round", selectedMatch.round.toString())
                Spacer(modifier = Modifier.height(10.dp))
                Text("Entrants", color = Color(0xFF9BA7B9), fontSize = 12.sp)
                selectedMatch.entrants.forEach { entrant ->
                    Text(entrant, color = Color.White, fontSize = 13.sp)
                }
                Spacer(modifier = Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    tournament.tables.forEach { table ->
                        OutlinedButton(onClick = { onAssignTable(selectedMatch.id, table.id) }, modifier = Modifier.weight(1f)) {
                            Text(table.label)
                        }
                    }
                }
                Spacer(modifier = Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = onStartMatch, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1F6ECF)), modifier = Modifier.weight(1f)) {
                        Text("Start Match")
                    }
                }
                Spacer(modifier = Modifier.height(14.dp))
                if (selectedMatch.entrants.size >= 2) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { onCompleteMatch(selectedMatch.id, selectedMatch.entrants[0]) }, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDF1E2D)), modifier = Modifier.weight(1f)) {
                            Text("Winner: 1")
                        }
                        Button(onClick = { onCompleteMatch(selectedMatch.id, selectedMatch.entrants[1]) }, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDF1E2D)), modifier = Modifier.weight(1f)) {
                            Text("Winner: 2")
                        }
                    }
                    Spacer(modifier = Modifier.height(10.dp))
                    OutlinedButton(onClick = { onCorrectMatch(selectedMatch.id, selectedMatch.entrants[0]) }, modifier = Modifier.fillMaxWidth()) {
                        Text("Correct Result")
                    }
                }
            }

            if (!feedbackMessage.isNullOrBlank()) {
                Spacer(modifier = Modifier.height(12.dp))
                Text(feedbackMessage, color = Color(0xFFB5C2D3), fontSize = 12.sp)
            }
        }

        StageCard(modifier = Modifier.weight(1f), step = "C", title = "Featured Table Scoring") {
            Text(
                "Pro+ / Venue only. This scoring is independent from core tournament scoring and follows only the featured match.",
                color = Color(0xFF9BA8BA),
                fontSize = 12.sp
            )
            Spacer(modifier = Modifier.height(12.dp))
            Text("Target / race length (optional)", color = Color(0xFFB2BDD0), fontSize = 12.sp)
            OutlinedTextField(
                value = featuredTarget,
                onValueChange = onFeaturedTargetChange,
                modifier = Modifier.fillMaxWidth(),
                colors = fieldColors()
            )
            Spacer(modifier = Modifier.height(12.dp))
            Button(
                onClick = onEnableFeaturedScoring,
                enabled = selectedMatch != null && selectedMatch.entrants.size >= 2,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1F6ECF)),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Enable Featured Scoring")
            }
            Spacer(modifier = Modifier.height(14.dp))
            if (!featuredScoringState.enabled) {
                Text("Scoring is off until enabled for the featured match.", color = Color(0xFF9BA8BA), fontSize = 12.sp)
            } else {
                MetricRow("Players", "${featuredScoringState.playerAName} vs ${featuredScoringState.playerBName}")
                MetricRow("Score", "${featuredScoringState.playerAScore} - ${featuredScoringState.playerBScore}")
                MetricRow("Rack", featuredScoringState.currentRack.toString())
                MetricRow("Target", featuredScoringState.targetScore?.toString() ?: "None")
                MetricRow("Status", featuredScoringState.matchStatus)
                Spacer(modifier = Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { featuredScoringState.playerAId?.let(onTapRackWinner) },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDF1E2D)),
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(featuredScoringState.playerAName.ifBlank { "Player A" })
                    }
                    Button(
                        onClick = { featuredScoringState.playerBId?.let(onTapRackWinner) },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDF1E2D)),
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(featuredScoringState.playerBName.ifBlank { "Player B" })
                    }
                }
                Spacer(modifier = Modifier.height(10.dp))
                OutlinedButton(onClick = onResetFeaturedScoring, modifier = Modifier.fillMaxWidth()) {
                    Text("Reset Featured Score")
                }
            }
        }
    }
}

@Composable
private fun Sidebar() {
    Column(
        modifier = Modifier
            .width(220.dp)
            .fillMaxHeight()
            .background(Color(0xFF0A0C10))
            .border(1.dp, Color(0xFF1A1E26))
            .padding(vertical = 18.dp, horizontal = 12.dp),
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        Column {
            Text("TDIAB", color = Color(0xFFF6F7F9), fontWeight = FontWeight.Black, fontSize = 32.sp, letterSpacing = 1.sp)
            Text("TOURNAMENTS. PLAYERS. BROADCASTS.", color = Color(0xFF8F97A5), fontSize = 10.sp, letterSpacing = 1.3.sp, modifier = Modifier.padding(top = 4.dp))
            Spacer(modifier = Modifier.height(24.dp))
            MenuItem("Dashboard")
            MenuItem("Tournaments")
            MenuItem("Players", selected = true)
            MenuItem("Broadcast")
            MenuItem("Sponsors")
            MenuItem("Reports")
            MenuItem("Venue")
            MenuItem("Settings")
        }

        Card(
            colors = CardDefaults.cardColors(containerColor = Color(0xFF12151D)),
            border = BorderStroke(1.dp, Color(0xFF2A303C)),
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("TD Pro+", color = Color(0xFFF6F6F6), fontWeight = FontWeight.Bold)
                Text("Universal player identity, TDTV, sponsors, and branding.", color = Color(0xFF9AA4B2), textAlign = TextAlign.Center, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
                Button(onClick = {}, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDF1E2D)), modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) {
                    Text("Upgrade Now")
                }
            }
        }
    }
}

@Composable
private fun MenuItem(label: String, selected: Boolean = false) {
    val background = if (selected) Color(0xFF241214) else Color.Transparent
    val foreground = if (selected) Color(0xFFF6F7F9) else Color(0xFFB7C0CD)
    val outline = if (selected) Color(0xFFDF1E2D) else Color.Transparent

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .background(background, RoundedCornerShape(10.dp))
            .border(1.dp, outline, RoundedCornerShape(10.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        contentAlignment = Alignment.CenterStart
    ) {
        Text(label, color = foreground, fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium, fontSize = 15.sp)
    }
}

@Composable
private fun TopBar(tournament: Tournament) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            ContentBadge("Tournament Progress", selected = true)
            Spacer(modifier = Modifier.width(10.dp))
            Text(tournament.name, color = Color(0xFFC2CAD6), fontSize = 13.sp)
            Text("• ${tournament.status.name} • ${tournament.entries.size} rostered • ${tournament.matches.size} matches", color = Color(0xFF7C8799), fontSize = 12.sp, modifier = Modifier.padding(start = 8.dp))
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(modifier = Modifier.clip(RoundedCornerShape(18.dp)).background(Color(0xFF1B1F27)).padding(horizontal = 12.dp, vertical = 8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(modifier = Modifier.size(10.dp).background(Color(0xFF31D17B), CircleShape))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("TDTV", color = Color(0xFFFDFDFD), fontWeight = FontWeight.Bold)
                    Text(" LIVE", color = Color(0xFFFF4B53), fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 4.dp))
                }
            }
            Spacer(modifier = Modifier.width(12.dp))
            Text("AA", color = Color(0xFFF5F5F5), fontWeight = FontWeight.Bold)
            Text("Alan A.", color = Color(0xFFAAB1C0), modifier = Modifier.padding(start = 10.dp))
        }
    }
}

@Composable
private fun ContentBadge(label: String, selected: Boolean = false) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (selected) Color(0xFF1B2029) else Color.Transparent)
            .border(1.dp, if (selected) Color(0xFF2B3440) else Color.Transparent, RoundedCornerShape(8.dp))
            .padding(horizontal = 8.dp, vertical = 4.dp)
    ) {
        Text(label, color = Color(0xFF9FA9BA), fontSize = 10.sp, letterSpacing = 1.sp)
    }
}

@Composable
private fun MetricRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = Color(0xFF9AA7B9), fontSize = 12.sp)
        Text(value, color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun StageCard(
    modifier: Modifier = Modifier,
    step: String,
    title: String,
    content: @Composable ColumnScope.() -> Unit
) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = Color(0xFF121922)),
        border = BorderStroke(1.dp, Color(0xFF2C3645)),
        shape = RoundedCornerShape(18.dp)
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                StepPill(step)
                Spacer(modifier = Modifier.width(10.dp))
                Text(title, color = Color(0xFFF3F6FB), fontWeight = FontWeight.Bold, fontSize = 18.sp)
            }
            Spacer(modifier = Modifier.height(12.dp))
            content()
        }
    }
}

@Composable
private fun StepPill(value: String) {
    Box(modifier = Modifier.size(28.dp).background(Color(0xFFDF1E2D), CircleShape), contentAlignment = Alignment.Center) {
        Text(value, color = Color.White, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun fieldColors() = TextFieldDefaults.colors(
    focusedContainerColor = Color(0xFF0F151B),
    unfocusedContainerColor = Color(0xFF0F151B),
    disabledContainerColor = Color(0xFF0F151B),
    focusedIndicatorColor = Color(0xFFDF1E2D),
    unfocusedIndicatorColor = Color(0xFF394860),
    disabledIndicatorColor = Color(0xFF394860),
    focusedTextColor = Color.White,
    unfocusedTextColor = Color.White,
    disabledTextColor = Color(0xFFDDE4EE)
)

@Composable
private fun darkColorScheme() = MaterialTheme.colorScheme.copy(
    background = Color(0xFF0B0D12),
    surface = Color(0xFF101821),
    onSurface = Color(0xFFF2F4F7),
    primary = Color(0xFFDF1E2D),
    secondary = Color(0xFF1F6ECF),
    tertiary = Color(0xFF31D17B)
)
