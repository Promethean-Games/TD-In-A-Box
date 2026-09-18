package com.promethean.tdiab.account

import com.promethean.tdiab.domain.Capability
import com.promethean.tdiab.domain.SubscriptionTier
import kotlinx.serialization.Serializable

@Serializable
data class User(
    val id: String,
    val displayName: String,
    val email: String,
    val role: AccountRole = AccountRole.TD,
    val subscriptionTier: SubscriptionTier = SubscriptionTier.FREE,
    val profileName: String = displayName
)

@Serializable
data class AccountProfile(
    val id: String,
    val userId: String,
    val displayName: String,
    val organizationName: String? = null,
    val avatarUrl: String? = null
)

@Serializable
data class Entitlement(
    val tier: SubscriptionTier = SubscriptionTier.FREE,
    val capabilities: Set<Capability> = emptySet(),
    val maxTournamentHistory: Int = 25,
    val maxVenueUsers: Int = 5
)

enum class AccountRole {
    TD,
    ADMIN,
    VIEWER,
    VENUE_MANAGER
}
