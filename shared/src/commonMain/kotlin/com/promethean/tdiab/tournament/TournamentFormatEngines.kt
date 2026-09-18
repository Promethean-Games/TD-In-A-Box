package com.promethean.tdiab.tournament

import com.promethean.tdiab.domain.DomainError
import com.promethean.tdiab.domain.DomainResult
import com.promethean.tdiab.domain.Match
import com.promethean.tdiab.domain.MatchResult
import com.promethean.tdiab.domain.MatchStage
import com.promethean.tdiab.domain.MatchState
import com.promethean.tdiab.domain.Player
import com.promethean.tdiab.domain.PlayerStatus
import com.promethean.tdiab.domain.RegistrationState
import com.promethean.tdiab.domain.CheckInState
import com.promethean.tdiab.domain.Tournament
import com.promethean.tdiab.domain.TournamentFormat
import com.promethean.tdiab.domain.TournamentPhase
import com.promethean.tdiab.domain.TournamentResult
import com.promethean.tdiab.domain.TournamentStatus

interface TournamentFormatEngine {
    fun generateBracket(tournament: Tournament): DomainResult<Tournament>
    fun completeMatch(tournament: Tournament, matchId: String, winnerId: String, score: String = ""): DomainResult<Tournament>
    fun correctMatchResult(tournament: Tournament, matchId: String, winnerId: String, score: String = ""): DomainResult<Tournament>
}

object TournamentFormatEngineRegistry {
    fun forFormat(format: TournamentFormat): TournamentFormatEngine? {
        return when (format) {
            TournamentFormat.SINGLE_ELIMINATION -> SingleEliminationFormatEngine
            TournamentFormat.DOUBLE_ELIMINATION -> DoubleEliminationFormatEngine
            TournamentFormat.RESET_FINAL -> null
            TournamentFormat.MODIFIED_ELIMINATION -> ModifiedEliminationFormatEngine
            TournamentFormat.CHIP_TOURNAMENT -> ChipTournamentFormatEngine
        }
    }
}

object SingleEliminationFormatEngine : TournamentFormatEngine {
    override fun generateBracket(tournament: Tournament): DomainResult<Tournament> {
        if (tournament.players.size < 2) {
            return DomainResult.Failure(DomainError.InvalidTournamentConfiguration("At least two players are required to generate a bracket."))
        }

        val players = tournament.players.sortedWith(compareBy<Player> { it.seed }.thenBy { it.id })
        var matches = buildWinnersBracket(players)
        matches.filter { it.winnerId != null }.forEach { matches = routeWinner(matches, it) }

        return DomainResult.Success(
            tournament.copy(
                players = players,
                seedOrder = players.map { it.id },
                matches = matches,
                bracketGenerated = true,
                currentRound = 1,
                status = TournamentStatus.READY,
                tournamentPhase = TournamentPhase.BRACKET,
                result = TournamentResult()
            )
        )
    }

    override fun completeMatch(tournament: Tournament, matchId: String, winnerId: String, score: String): DomainResult<Tournament> {
        val match = tournament.matches.firstOrNull { it.id == matchId }
            ?: return DomainResult.Failure(DomainError.InvalidMatch())

        val validEntrants = match.entrants.filter { it.isNotBlank() }
        if (winnerId !in validEntrants) {
            return DomainResult.Failure(DomainError.InvalidResult())
        }
        if (match.winnerId != null && match.winnerId != winnerId) {
            return DomainResult.Failure(DomainError.InvalidResult())
        }
        if (match.winnerId == winnerId && match.state == MatchState.COMPLETE) {
            return DomainResult.Success(tournament)
        }

        val loserId = validEntrants.firstOrNull { it != winnerId }
        val completedMatch = match.copy(
            winnerId = winnerId,
            loserId = loserId,
            state = MatchState.COMPLETE,
            result = MatchResult(winnerId = winnerId, loserId = loserId, score = score)
        )

        var updatedMatches = tournament.matches.map { if (it.id == matchId) completedMatch else it }
        updatedMatches = routeWinner(updatedMatches, completedMatch)

        val updatedPlayers = tournament.players.map { player ->
            when (player.id) {
                winnerId -> player.copy(
                    wins = player.wins + 1,
                    eliminated = false,
                    status = PlayerStatus.ACTIVE,
                    registrationState = RegistrationState.ACTIVE,
                    checkInState = if (player.checkInState == CheckInState.NOT_CHECKED_IN) CheckInState.CHECKED_IN else player.checkInState,
                    state = player.state
                )
                loserId -> player.copy(
                    losses = player.losses + 1,
                    eliminated = true,
                    status = PlayerStatus.ELIMINATED,
                    registrationState = RegistrationState.ELIMINATED
                )
                else -> player
            }
        }

        val finalMatch = updatedMatches.lastOrNull { it.winnerDestination == null }
        val tournamentCompleted = finalMatch != null && finalMatch.id == matchId && completedMatch.winnerId != null
        val result = if (tournamentCompleted) {
            TournamentResult(
                winnerId = winnerId,
                standings = buildStandings(updatedPlayers, winnerId)
            )
        } else {
            tournament.result
        }

        val status = if (tournamentCompleted) TournamentStatus.COMPLETED else tournament.status
        val phase = if (tournamentCompleted) TournamentPhase.RESULTS else TournamentPhase.MATCHES

        return DomainResult.Success(
            tournament.copy(
                matches = updatedMatches,
                players = updatedPlayers,
                result = result,
                status = status,
                tournamentPhase = phase,
                currentRound = maxOf(tournament.currentRound, match.round)
            )
        )
    }

    override fun correctMatchResult(tournament: Tournament, matchId: String, winnerId: String, score: String): DomainResult<Tournament> {
        return completeMatch(tournament, matchId, winnerId, score)
    }

    private fun buildWinnersBracket(players: List<Player>): List<Match> {
        val bracketSize = nextPowerOfTwo(players.size)
        val slots = players.map { it.id } + List(bracketSize - players.size) { null }
        val roundCount = roundCount(bracketSize)
        val matches = mutableListOf<Match>()

        for (round in 1..roundCount) {
            val matchCount = bracketSize / pow2(round)
            for (position in 1..matchCount) {
                val entrants = if (round == 1) {
                    val left = slots[position - 1]
                    val right = slots[bracketSize - position]
                    listOfNotNull(left, right)
                } else {
                    emptyList()
                }

                val byeWinner = if (round == 1 && entrants.size == 1) entrants.firstOrNull() else null
                val match = Match(
                    id = matchId(round, position),
                    round = round,
                    entrants = entrants,
                    winnerId = byeWinner,
                    loserId = null,
                    state = when {
                        byeWinner != null -> MatchState.COMPLETE
                        entrants.size >= 2 -> MatchState.PENDING
                        else -> MatchState.PENDING
                    },
                    stage = MatchStage.WINNERS,
                    result = if (byeWinner != null) MatchResult(winnerId = byeWinner, score = "BYE") else null,
                    winnerDestination = if (round < roundCount) matchId(round + 1, (position + 1) / 2) else null,
                    loserDestination = null
                )
                matches += match
            }
        }

        return matches
    }

    private fun routeWinner(matches: List<Match>, sourceMatch: Match): List<Match> {
        val winnerId = sourceMatch.winnerId ?: return matches
        val destinationId = sourceMatch.winnerDestination ?: return matches

        return matches.map { match ->
            if (match.id != destinationId) {
                match
            } else {
                val entrants = (match.entrants + winnerId).distinct()
                match.copy(
                    entrants = entrants,
                    state = if (match.state == MatchState.COMPLETE) {
                        match.state
                    } else if (entrants.size >= 2) {
                        MatchState.READY
                    } else {
                        match.state
                    }
                )
            }
        }
    }

    private fun buildStandings(players: List<Player>, winnerId: String): List<String> {
        val winnerFirst = listOf(winnerId)
        val rest = players.filter { it.id != winnerId }
            .sortedWith(
                compareByDescending<Player> { it.wins }
                    .thenByDescending { it.losses }
                    .thenBy { it.seed }
                    .thenBy { it.id }
            )
            .map { it.id }
        return winnerFirst + rest
    }

    private fun nextPowerOfTwo(value: Int): Int {
        var size = 1
        while (size < value) {
            size *= 2
        }
        return size
    }

    private fun roundCount(bracketSize: Int): Int {
        var rounds = 0
        var currentSize = 1
        while (currentSize < bracketSize) {
            currentSize *= 2
            rounds += 1
        }
        return rounds
    }

    private fun pow2(exponent: Int): Int {
        var value = 1
        repeat(exponent) {
            value *= 2
        }
        return value
    }

    private fun matchId(round: Int, position: Int): String = "match-r${round}-${position}"
}

object DoubleEliminationFormatEngine : TournamentFormatEngine {
    override fun generateBracket(tournament: Tournament): DomainResult<Tournament> {
        if (tournament.players.size < 2) {
            return DomainResult.Failure(DomainError.InvalidTournamentConfiguration("At least two players are required to generate a bracket."))
        }

        val players = tournament.players.sortedWith(compareBy<Player> { it.seed }.thenBy { it.id })
        val bracketSize = nextPowerOfTwo(players.size)
        val roundCount = roundCount(bracketSize)
        val grandFinalId = grandFinalId()

        if (roundCount == 1) {
            return DomainResult.Success(
                tournament.copy(
                    players = players,
                    seedOrder = players.map { it.id },
                    matches = listOf(
                        Match(
                            id = grandFinalId,
                            round = 1,
                            entrants = players.map { it.id },
                            stage = MatchStage.FINAL,
                            state = MatchState.PENDING,
                            winnerDestination = null,
                            loserDestination = null
                        )
                    ),
                    bracketGenerated = true,
                    currentRound = 1,
                    status = TournamentStatus.READY,
                    tournamentPhase = TournamentPhase.BRACKET,
                    result = TournamentResult()
                )
            )
        }

        val winners = buildWinnersBracket(players, bracketSize, roundCount, grandFinalId)
        val losers = buildLosersBracket(bracketSize, roundCount, grandFinalId)
        val finals = listOf(
            Match(
                id = grandFinalId,
                round = roundCount + 1,
                entrants = emptyList(),
                stage = MatchStage.FINAL,
                state = MatchState.PENDING,
                winnerDestination = null,
                loserDestination = null
            )
        )

        return DomainResult.Success(
            tournament.copy(
                players = players,
                seedOrder = players.map { it.id },
                matches = winners + losers + finals,
                bracketGenerated = true,
                currentRound = 1,
                status = TournamentStatus.READY,
                tournamentPhase = TournamentPhase.BRACKET,
                result = TournamentResult()
            )
        )
    }

    override fun completeMatch(tournament: Tournament, matchId: String, winnerId: String, score: String): DomainResult<Tournament> {
        val match = tournament.matches.firstOrNull { it.id == matchId }
            ?: return DomainResult.Failure(DomainError.InvalidMatch())

        val validEntrants = match.entrants.filter { it.isNotBlank() }
        if (winnerId !in validEntrants) {
            return DomainResult.Failure(DomainError.InvalidResult())
        }
        if (match.winnerId != null && match.winnerId != winnerId) {
            return DomainResult.Failure(DomainError.InvalidResult())
        }
        if (match.winnerId == winnerId && match.state == MatchState.COMPLETE) {
            return DomainResult.Success(tournament)
        }

        val loserId = validEntrants.firstOrNull { it != winnerId }
        val completedMatch = match.copy(
            winnerId = winnerId,
            loserId = loserId,
            state = MatchState.COMPLETE,
            result = MatchResult(winnerId = winnerId, loserId = loserId, score = score)
        )

        var updatedMatches = tournament.matches.map { if (it.id == matchId) completedMatch else it }
        updatedMatches = routeWinner(updatedMatches, completedMatch)
        updatedMatches = routeLoser(updatedMatches, match, loserId)

        val updatedPlayers = tournament.players.map { player ->
            when (player.id) {
                winnerId -> player.copy(
                    wins = player.wins + 1,
                    eliminated = false,
                    status = PlayerStatus.ACTIVE,
                    registrationState = RegistrationState.ACTIVE,
                    checkInState = if (player.checkInState == CheckInState.NOT_CHECKED_IN) CheckInState.CHECKED_IN else player.checkInState
                )
                loserId -> {
                    val nextLosses = player.losses + 1
                    player.copy(
                        losses = nextLosses,
                        eliminated = nextLosses >= 2,
                        status = if (nextLosses >= 2) PlayerStatus.ELIMINATED else PlayerStatus.ACTIVE,
                        registrationState = if (nextLosses >= 2) RegistrationState.ELIMINATED else RegistrationState.ACTIVE
                    )
                }
                else -> player
            }
        }

        return when (match.stage) {
            MatchStage.FINAL -> {
                val winnerLosses = updatedPlayers.first { it.id == winnerId }.losses
                val loserLosses = loserId?.let { updatedPlayers.first { player -> player.id == it }.losses } ?: 0
                if (winnerLosses == 1 && loserLosses == 1) {
                    val resetMatch = Match(
                        id = resetFinalId(),
                        round = match.round + 1,
                        entrants = listOfNotNull(winnerId, loserId),
                        stage = MatchStage.RESET_FINAL,
                        state = MatchState.READY,
                        winnerDestination = null,
                        loserDestination = null
                    )
                    DomainResult.Success(
                        tournament.copy(
                            matches = updatedMatches.filterNot { it.id == resetMatch.id } + resetMatch,
                            players = updatedPlayers,
                            status = TournamentStatus.ACTIVE,
                            tournamentPhase = TournamentPhase.MATCHES,
                            result = tournament.result,
                            currentRound = maxOf(tournament.currentRound, match.round)
                        )
                    )
                } else {
                    DomainResult.Success(
                        tournament.copy(
                            matches = updatedMatches,
                            players = updatedPlayers,
                            result = TournamentResult(
                                winnerId = winnerId,
                                standings = buildStandings(updatedPlayers, winnerId)
                            ),
                            status = TournamentStatus.COMPLETED,
                            tournamentPhase = TournamentPhase.RESULTS,
                            currentRound = maxOf(tournament.currentRound, match.round)
                        )
                    )
                }
            }

            MatchStage.RESET_FINAL -> {
                DomainResult.Success(
                    tournament.copy(
                        matches = updatedMatches,
                        players = updatedPlayers,
                        result = TournamentResult(
                            winnerId = winnerId,
                            standings = buildStandings(updatedPlayers, winnerId)
                        ),
                        status = TournamentStatus.COMPLETED,
                        tournamentPhase = TournamentPhase.RESULTS,
                        currentRound = maxOf(tournament.currentRound, match.round)
                    )
                )
            }

            else -> {
                DomainResult.Success(
                    tournament.copy(
                        matches = updatedMatches,
                        players = updatedPlayers,
                        status = tournament.status,
                        tournamentPhase = TournamentPhase.MATCHES,
                        currentRound = maxOf(tournament.currentRound, match.round)
                    )
                )
            }
        }
    }

    override fun correctMatchResult(tournament: Tournament, matchId: String, winnerId: String, score: String): DomainResult<Tournament> {
        return completeMatch(tournament, matchId, winnerId, score)
    }

    private fun buildWinnersBracket(
        players: List<Player>,
        bracketSize: Int,
        roundCount: Int,
        grandFinalId: String
    ): List<Match> {
        val slots = players.map { it.id } + List(bracketSize - players.size) { null }
        val matches = mutableListOf<Match>()

        for (round in 1..roundCount) {
            val matchCount = bracketSize / pow2(round)
            for (position in 1..matchCount) {
                val entrants = if (round == 1) {
                    val left = slots[position - 1]
                    val right = slots[bracketSize - position]
                    listOfNotNull(left, right)
                } else {
                    emptyList()
                }

                val byeWinner = if (round == 1 && entrants.size == 1) entrants.firstOrNull() else null
                matches += Match(
                    id = winnersMatchId(round, position),
                    round = round,
                    entrants = entrants,
                    winnerId = byeWinner,
                    loserId = null,
                    state = if (byeWinner != null) MatchState.COMPLETE else MatchState.PENDING,
                    stage = MatchStage.WINNERS,
                    result = if (byeWinner != null) MatchResult(winnerId = byeWinner, score = "BYE") else null,
                    winnerDestination = if (round < roundCount) winnersMatchId(round + 1, (position + 1) / 2) else grandFinalId,
                    loserDestination = losersDestinationForWinnerRound(round, position, roundCount)
                )
            }
        }

        return matches
    }

    private fun buildLosersBracket(bracketSize: Int, roundCount: Int, grandFinalId: String): List<Match> {
        if (roundCount < 2) {
            return emptyList()
        }

        val totalStages = (roundCount - 1) * 2
        val matches = mutableListOf<Match>()

        for (stage in 1..totalStages) {
            val count = losersStageCount(bracketSize, stage)
            for (position in 1..count) {
                val destination = when {
                    stage == totalStages -> grandFinalId
                    stage % 2 == 1 -> losersMatchId(stage + 1, position)
                    else -> losersMatchId(stage + 1, (position + 1) / 2)
                }
                matches += Match(
                    id = losersMatchId(stage, position),
                    round = stage,
                    entrants = emptyList(),
                    stage = MatchStage.LOSERS,
                    state = MatchState.PENDING,
                    winnerDestination = destination,
                    loserDestination = null
                )
            }
        }

        return matches
    }

    private fun losersDestinationForWinnerRound(round: Int, position: Int, roundCount: Int): String? {
        return when {
            roundCount < 2 -> null
            round == 1 -> losersMatchId(1, (position + 1) / 2)
            round < roundCount -> losersMatchId(2 * round - 2, position)
            else -> losersMatchId((roundCount - 1) * 2, 1)
        }
    }

    private fun routeWinner(matches: List<Match>, sourceMatch: Match): List<Match> {
        val winnerId = sourceMatch.winnerId ?: return matches
        return addEntrant(matches, sourceMatch.winnerDestination, winnerId)
    }

    private fun routeLoser(matches: List<Match>, sourceMatch: Match, loserId: String?): List<Match> {
        if (loserId == null) {
            return matches
        }
        return addEntrant(matches, sourceMatch.loserDestination, loserId)
    }

    private fun addEntrant(matches: List<Match>, destinationId: String?, entrantId: String): List<Match> {
        if (destinationId == null) {
            return matches
        }

        return matches.map { match ->
            if (match.id != destinationId) {
                match
            } else {
                val entrants = (match.entrants + entrantId).distinct()
                match.copy(
                    entrants = entrants,
                    state = if (match.state == MatchState.COMPLETE) {
                        match.state
                    } else if (entrants.size >= 2) {
                        MatchState.READY
                    } else {
                        match.state
                    }
                )
            }
        }
    }

    private fun buildStandings(players: List<Player>, winnerId: String): List<String> {
        val winnerFirst = listOf(winnerId)
        val rest = players.filter { it.id != winnerId }
            .sortedWith(
                compareByDescending<Player> { it.wins }
                    .thenByDescending { it.losses }
                    .thenBy { it.seed }
                    .thenBy { it.id }
            )
            .map { it.id }
        return winnerFirst + rest
    }

    private fun winnersMatchId(round: Int, position: Int): String = "wb-r${round}-${position}"
    private fun losersMatchId(stage: Int, position: Int): String = "lb-s${stage}-${position}"
    private fun grandFinalId(): String = "final-grand"
    private fun resetFinalId(): String = "final-reset"
}

object ModifiedEliminationFormatEngine : TournamentFormatEngine {
    override fun generateBracket(tournament: Tournament): DomainResult<Tournament> {
        return SingleEliminationFormatEngine.generateBracket(tournament).mapTournament { updated ->
            updated.copy(
                matches = updated.matches.map { it.copy(stage = MatchStage.MODIFIED) },
                tournamentPhase = TournamentPhase.BRACKET
            )
        }
    }

    override fun completeMatch(tournament: Tournament, matchId: String, winnerId: String, score: String): DomainResult<Tournament> {
        return SingleEliminationFormatEngine.completeMatch(tournament, matchId, winnerId, score).mapTournament { updated ->
            val modificationPoint = tournament.formatSettings["modificationPoint"]?.toIntOrNull()
            if (modificationPoint != null && modificationPoint > 0) {
                val completedMatches = updated.matches.count { it.state == MatchState.COMPLETE }
                if (completedMatches >= modificationPoint && updated.status != TournamentStatus.COMPLETED) {
                    val reseeded = updated.players.sortedWith(compareByDescending<Player> { it.wins }.thenBy { it.seed }.thenBy { it.id })
                    updated.copy(
                        players = reseeded,
                        seedOrder = reseeded.map { it.id }
                    )
                } else {
                    updated
                }
            } else {
                updated
            }
        }
    }

    override fun correctMatchResult(tournament: Tournament, matchId: String, winnerId: String, score: String): DomainResult<Tournament> {
        return completeMatch(tournament, matchId, winnerId, score)
    }
}

object ChipTournamentFormatEngine : TournamentFormatEngine {
    override fun generateBracket(tournament: Tournament): DomainResult<Tournament> {
        return SingleEliminationFormatEngine.generateBracket(tournament).mapTournament { updated ->
            updated.copy(
                matches = updated.matches.map { it.copy(stage = MatchStage.CHIP) },
                players = updated.players.map { if (it.chips <= 0) it.copy(chips = 100) else it },
                tournamentPhase = TournamentPhase.BRACKET
            )
        }
    }

    override fun completeMatch(tournament: Tournament, matchId: String, winnerId: String, score: String): DomainResult<Tournament> {
        return SingleEliminationFormatEngine.completeMatch(tournament, matchId, winnerId, score).mapTournament { updated ->
            val match = updated.matches.firstOrNull { it.id == matchId } ?: return@mapTournament updated
            val loserId = match.loserId
            updated.copy(
                players = updated.players.map { player ->
                    when (player.id) {
                        winnerId -> player.copy(chips = player.chips + 10, status = PlayerStatus.ACTIVE)
                        loserId -> {
                            val nextChips = maxOf(0, player.chips - 10)
                            player.copy(
                                chips = nextChips,
                                eliminated = nextChips == 0,
                                status = if (nextChips == 0) PlayerStatus.ELIMINATED else PlayerStatus.ACTIVE
                            )
                        }
                        else -> player
                    }
                },
                matches = updated.matches.map { if (it.id == matchId) it.copy(stage = MatchStage.CHIP) else it },
                tournamentPhase = if (updated.status == TournamentStatus.COMPLETED) TournamentPhase.RESULTS else TournamentPhase.MATCHES
            )
        }
    }

    override fun correctMatchResult(tournament: Tournament, matchId: String, winnerId: String, score: String): DomainResult<Tournament> {
        return completeMatch(tournament, matchId, winnerId, score)
    }
}

private inline fun DomainResult<Tournament>.mapTournament(transform: (Tournament) -> Tournament): DomainResult<Tournament> {
    return when (this) {
        is DomainResult.Success -> DomainResult.Success(transform(value))
        is DomainResult.Failure -> this
    }
}

private fun nextPowerOfTwo(value: Int): Int {
    var size = 1
    while (size < value) {
        size *= 2
    }
    return size
}

private fun roundCount(bracketSize: Int): Int {
    var rounds = 0
    var currentSize = 1
    while (currentSize < bracketSize) {
        currentSize *= 2
        rounds += 1
    }
    return rounds
}

private fun losersStageCount(bracketSize: Int, stage: Int): Int {
    val exponent = ((stage + 1) / 2) + 1
    return bracketSize / pow2(exponent)
}

private fun pow2(exponent: Int): Int {
    var value = 1
    repeat(exponent) {
        value *= 2
    }
    return value
}
