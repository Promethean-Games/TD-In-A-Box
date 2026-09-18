package com.promethean.tdiab.domain

import com.promethean.tdiab.tournament.TournamentStateEngine

class WorkspaceWorkflow(
    private val stateEngine: TournamentStateEngine = TournamentStateEngine()
) {
    fun createTournament(
        name: String,
        playerCapacity: Int,
        numberOfTables: Int,
        format: TournamentFormat = TournamentFormat.SINGLE_ELIMINATION
    ): WorkspaceSnapshot {
        val state = stateEngine.createTournament(
            TournamentConfiguration(
                name = name,
                format = format,
                playerCapacity = playerCapacity,
                numberOfTables = numberOfTables
            )
        )
        return WorkspaceSnapshot(tournament = state.tournament, players = emptyList())
    }

    fun addPlayer(snapshot: WorkspaceSnapshot, player: Player): DomainResult<WorkspaceSnapshot> {
        val rosterResult = TournamentRosterService.addPlayerToTournament(snapshot.tournament, player)
        return when (rosterResult) {
            is DomainResult.Success -> DomainResult.Success(
                snapshot.copy(
                    tournament = rosterResult.value,
                    players = snapshot.players + player
                )
            )
            is DomainResult.Failure -> DomainResult.Failure(rosterResult.error)
        }
    }

    fun generateBracket(snapshot: WorkspaceSnapshot): DomainResult<WorkspaceSnapshot> {
        return when (val result = stateEngine.generateBracket(TournamentState(snapshot.tournament))) {
            is DomainResult.Success -> DomainResult.Success(snapshot.copy(tournament = result.value.tournament))
            is DomainResult.Failure -> DomainResult.Failure(result.error)
        }
    }

    fun startTournament(snapshot: WorkspaceSnapshot): DomainResult<WorkspaceSnapshot> {
        return when (val result = stateEngine.startTournament(TournamentState(snapshot.tournament))) {
            is DomainResult.Success -> DomainResult.Success(snapshot.copy(tournament = result.value.tournament))
            is DomainResult.Failure -> DomainResult.Failure(result.error)
        }
    }

    fun assignTable(snapshot: WorkspaceSnapshot, matchId: String, tableId: String): DomainResult<WorkspaceSnapshot> {
        return when (val result = stateEngine.assignTable(TournamentState(snapshot.tournament), matchId, tableId)) {
            is DomainResult.Success -> DomainResult.Success(snapshot.copy(tournament = result.value.tournament))
            is DomainResult.Failure -> DomainResult.Failure(result.error)
        }
    }

    fun startMatch(snapshot: WorkspaceSnapshot, matchId: String): DomainResult<WorkspaceSnapshot> {
        return when (val result = stateEngine.startMatch(TournamentState(snapshot.tournament), matchId)) {
            is DomainResult.Success -> DomainResult.Success(snapshot.copy(tournament = result.value.tournament))
            is DomainResult.Failure -> DomainResult.Failure(result.error)
        }
    }

    fun completeMatch(snapshot: WorkspaceSnapshot, matchId: String, winnerId: String, score: String = ""): DomainResult<WorkspaceSnapshot> {
        return when (val result = stateEngine.completeMatch(TournamentState(snapshot.tournament), matchId, winnerId, score)) {
            is DomainResult.Success -> DomainResult.Success(snapshot.copy(tournament = result.value.tournament))
            is DomainResult.Failure -> DomainResult.Failure(result.error)
        }
    }

    fun correctMatch(snapshot: WorkspaceSnapshot, matchId: String, winnerId: String, score: String = ""): DomainResult<WorkspaceSnapshot> {
        return when (val result = stateEngine.correctMatchResult(TournamentState(snapshot.tournament), matchId, winnerId, score)) {
            is DomainResult.Success -> DomainResult.Success(snapshot.copy(tournament = result.value.tournament))
            is DomainResult.Failure -> DomainResult.Failure(result.error)
        }
    }
}

class InMemoryWorkspaceStore(
    initialSnapshot: WorkspaceSnapshot = WorkspaceSnapshot()
) : WorkspaceStore {
    private var snapshot: WorkspaceSnapshot = initialSnapshot

    override suspend fun load(): DomainResult<WorkspaceSnapshot> = DomainResult.Success(snapshot)

    override suspend fun save(snapshot: WorkspaceSnapshot): DomainResult<Unit> {
        this.snapshot = snapshot
        return DomainResult.Success(Unit)
    }
}
