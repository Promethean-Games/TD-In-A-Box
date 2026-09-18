package com.promethean.tdiab.venue

import kotlinx.serialization.Serializable

@Serializable
data class Venue(
    val id: String,
    val name: String,
    val adminUserId: String,
    val tdUserIds: List<String> = emptyList(),
    val brandColor: String = "#000000",
    val location: String? = null,
    val active: Boolean = true
)

@Serializable
data class VenueMembership(
    val userId: String,
    val venueId: String,
    val role: VenueRole = VenueRole.TD
)

enum class VenueRole {
    ADMIN,
    TD,
    VIEWER
}
