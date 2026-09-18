package com.promethean.tdiab.domain

object TournamentInterchange {
    fun exportJson(tournament: Tournament): String = TournamentJson.encode(tournament)

    fun exportCsv(tournament: Tournament): String = TournamentCsv.toCsv(tournament)

    fun importJson(payload: String): DomainResult<Tournament> {
        return try {
            DomainResult.Success(TournamentJson.decode(payload))
        } catch (ex: Throwable) {
            DomainResult.Failure(DomainError.InvalidImport(ex.message ?: "Unable to decode tournament JSON."))
        }
    }

    fun importCsv(payload: String): DomainResult<Tournament> {
        val lines = payload.lineSequence().filter { it.isNotBlank() }.toList()
        if (lines.isEmpty()) {
            return DomainResult.Failure(DomainError.InvalidImport())
        }

        val header = lines.first().split(",")
        val expected = listOf("id", "name", "player_id", "player_name", "seed", "status")
        if (header.map { it.trim() } != expected) {
            return DomainResult.Failure(DomainError.InvalidImport("CSV header is invalid."))
        }

        val rows = lines.drop(1).mapNotNull { row ->
            val cells = row.split(",")
            if (cells.size < 6) {
                null
            } else {
                cells
            }
        }
        if (rows.isEmpty()) {
            return DomainResult.Failure(DomainError.InvalidImport("CSV payload contains no players."))
        }

        val tournamentId = rows.first()[0]
        val name = rows.first()[1]
        val players = rows.map { row ->
            Player(
                id = row[2],
                name = row[3],
                seed = row[4].toIntOrNull() ?: 0,
                state = PlayerState.valueOf(row[5])
            )
        }

        return DomainResult.Success(
            Tournament(
                id = tournamentId,
                name = name,
                players = players
            )
        )
    }
}
