# TDIAB Entitlements Source of Truth

This document is the authoritative source for TDIAB subscription tiers, feature entitlements, usage limits, roles, and access rules.

Future developers must **not** scan the entire application architecture to determine whether a feature is available to a tier. When a gated feature is added, changed, or removed:

1. Update this document first.
2. Update the centralized entitlement catalog/checks.
3. Update upgrade/pricing UI when applicable.
4. Add or update entitlement tests.

If application behavior disagrees with this document, treat the code as drift and fix the implementation. Do **not** silently rewrite this specification to match current code.

## Core Rules

1. Subscription tier controls paid feature access.
2. Roles and tiers are separate concepts.
3. A user role must not automatically grant paid customer subscription features.
4. Higher customer tiers inherit lower-tier customer entitlements unless explicitly stated otherwise.
5. Basic is always free.
6. TDTV viewing is free.
7. Pro may broadcast locally but cannot publish to TDTV.
8. Pro+ can publish to TDTV.
9. Venue inherits Pro+ customer capabilities.
10. Internal / Platform Admin access is for administration, testing, and support regardless of customer subscription.

## Subscription Tiers

| Tier | Price | Purpose |
| --- | --- | --- |
| BASIC | $0 | Free tier for core tournament operation and evaluation |
| PRO | $4.99/month | Paid TD tier for advanced tournament control and local broadcasting |
| PRO_PLUS | $9.99/month | Paid TD tier for TDTV publishing and advanced broadcast tooling |
| VENUE | $24.99/month | Venue-level tier for staff accounts, venue presence, and venue broadcasting |
| INTERNAL | Not customer-facing | Platform/internal entitlement level for admin, testing, and support |

## Roles

Roles describe who the user is in the system. Tiers describe what paid product access they have.

| Role | Meaning | Notes |
| --- | --- | --- |
| USER | Standard customer account | No implicit paid feature unlocks |
| TD | Tournament director account identity | No implicit paid feature unlocks |
| VENUE_ADMIN | Venue administrative identity | Must still rely on VENUE-tier customer entitlements for paid product features |
| PLATFORM_ADMIN | Internal administrative identity | Internal-only access for support, testing, and administration |

## Tournament Features by Tier

### BASIC

- Single Elimination
- Double Elimination
- Live roster/player management
- Multi-table management
- Live match control
- Payout management
- Basic tournament history

### PRO

- Everything in Basic
- Modified Elimination
- Chip Tournament
- Race Tracking
- Custom Race Formats
- Tournament Templates
- Expanded Tournament History & Stats
- Player Database access
- Universal Player ID access
- TD Profile
- Local Broadcasting
- Broadcast Overlays

### PRO_PLUS

- Everything in Pro
- Network Broadcasting (TDTV)
- Advanced Overlays
- Tournament Branding
- Sponsor Management / Sponsor Rotation
- Multi-Camera Support

### VENUE

- Everything in Pro+
- Venue Administration
- Multiple TD/staff accounts
- Venue advertising
- Venue TDTV presence / network capabilities

## Tournament Limits

| Tier | Active tournaments | Saved tournament records | Accounts | Templates |
| --- | --- | --- | --- | --- |
| BASIC | 1 | 5 | 1 | 0 |
| PRO | 3 | 25 | 1 | 5 |
| PRO_PLUS | 10 | 100 | 2 | 25 |
| VENUE | Venue-level account | Venue-defined venue records | 3 TD/staff accounts | Venue-level template policy |

**Important:** active tournaments, saved tournament records, and templates are separate limits and must be enforced separately.

## Broadcast Entitlements

### BASIC

- No broadcasting

### PRO

- Local broadcasting
- Broadcast overlays
- 1 camera
- Cannot publish to TDTV
- Cannot use network broadcasting
- Cannot use tournament branding
- Cannot use sponsor management / rotation

### PRO_PLUS

- Local broadcasting
- Network Broadcasting (TDTV)
- Advanced overlays
- Tournament branding
- Sponsor logos / placements / rotation / acknowledgments
- Multi-camera support
- Camera feeds can be assigned to tables
- Featured Table can drive program switching

### VENUE

- All Pro+ broadcasting capabilities
- Venue-level broadcast / network capabilities
- Venue advertising
- Persistent venue presence within the TDTV ecosystem

**Viewing rule:** TDTV viewing is free. Publishing to the TDTV network requires **PRO_PLUS** or **VENUE**.

## Player Data

### BASIC

- Basic player management

### PRO

- Player Database access
- Universal Player ID access
- Player history / statistical data through those systems

### PRO_PLUS

- Everything in Pro

### VENUE

- Everything in Pro+

## TD / Venue Identity

### BASIC

- Standard account identity

### PRO

- TD Profile
- Persistent TD identity

### PRO_PLUS

- TD identity and network broadcasting identity

### VENUE

- Venue identity
- Venue administration
- Venue advertising presence
- Venue / network identity on TDTV

## Canonical Entitlement Catalog

Every gated feature must have:

- A unique entitlement identifier
- A human-readable feature name
- A minimum required tier
- Optional usage limit
- Optional role restriction
- Optional network / broadcast restriction

### Tournament

| Entitlement ID | Feature | Minimum tier | Limit / rule |
| --- | --- | --- | --- |
| tournament.single_elimination | Single Elimination | BASIC | None |
| tournament.double_elimination | Double Elimination | BASIC | None |
| tournament.modified | Modified Elimination | PRO | None |
| tournament.chip | Chip Tournament | PRO | None |
| tournament.race_tracking | Race Tracking | PRO | None |
| tournament.custom_race | Custom Race Formats | PRO | None |
| tournament.multi_table | Multi-table management | BASIC | None |
| tournament.live_roster | Live roster / player management | BASIC | None |
| tournament.live_match_control | Live match control | BASIC | None |
| tournament.payouts | Payout management | BASIC | None |
| tournament.history.basic | Basic tournament history | BASIC | 5 saved tournament records |
| tournament.history.expanded | Expanded tournament history & stats | PRO | 25 saved records on PRO, 100 on PRO_PLUS |
| tournament.templates | Tournament templates | PRO | 5 on PRO, 25 on PRO_PLUS, venue policy on VENUE |
| tournament.active_records | Active tournament allowance | BASIC | 1 on BASIC, 3 on PRO, 10 on PRO_PLUS |

### Players / Identity

| Entitlement ID | Feature | Minimum tier | Limit / rule |
| --- | --- | --- | --- |
| players.basic_management | Basic player management | BASIC | None |
| players.database | Player Database access | PRO | None |
| players.universal_id | Universal Player ID access | PRO | None |
| players.history | Player history / stats from identity systems | PRO | Depends on linked data source |
| identity.td_profile | TD Profile | PRO | 1 account on BASIC/PRO, 2 accounts on PRO_PLUS |
| identity.tdtv_presence | TD network identity | PRO_PLUS | Requires TDTV-capable publishing tier |
| identity.venue_presence | Venue identity / advertising presence | VENUE | Venue-only |

### Broadcast

| Entitlement ID | Feature | Minimum tier | Limit / rule |
| --- | --- | --- | --- |
| broadcast.local | Local broadcasting | PRO | 1 camera on PRO |
| broadcast.overlays | Broadcast overlays | PRO | Local-only on PRO |
| broadcast.tdtv | Network Broadcasting (TDTV publishing) | PRO_PLUS | Publishing only; viewing remains free |
| broadcast.overlays_advanced | Advanced overlays | PRO_PLUS | None |
| broadcast.branding | Tournament branding | PRO_PLUS | None |
| broadcast.sponsors | Sponsor logos / placements / rotation / acknowledgments | PRO_PLUS | None |
| broadcast.multi_camera | Multi-camera support | PRO_PLUS | More than 1 camera |
| broadcast.camera_table_assignment | Camera-to-table assignment | PRO_PLUS | Broadcast context only |
| broadcast.featured_table_switching | Featured Table drives switching | PRO_PLUS | Broadcast context only |
| broadcast.venue_network | Venue broadcast / network capability | VENUE | Venue-only |
| venue.advertising | Venue advertising | VENUE | Venue-only |

### Venue / Accounts / Internal

| Entitlement ID | Feature | Minimum tier | Limit / rule |
| --- | --- | --- | --- |
| account.standard | Standard customer account | BASIC | 1 account |
| account.multi_user | Multiple TD / staff accounts | VENUE | 3 TD/staff accounts |
| venue.administration | Venue administration | VENUE | Venue-only |
| internal.full_access | Internal support / admin access | INTERNAL | Not customer-facing |

## Upgrade Messaging Rules

The application should always be able to answer:

1. Can this user access this feature?
2. What tier is required?
3. What usage limit applies?
4. What does the user get by upgrading?
5. What does the next tier unlock?

At minimum:

- BASIC -> PRO should explain advanced tournament controls, templates, player identity/data access, and local broadcasting.
- PRO -> PRO_PLUS should explicitly explain that **TDTV / TV Guide publishing requires PRO_PLUS**.
- PRO_PLUS -> VENUE should explain venue identity, venue administration, venue advertising, and staff-account expansion.

## Centralized Gating Requirement

Do not hard-code tier checks throughout the application such as `if (tier === "PRO")` unless there is a compelling architectural reason.

Implement centralized entitlement checks so that changing a feature's minimum tier requires editing the entitlement definition, not searching the whole codebase.

The implementation should expose a central model capable of returning:

- whether access is allowed
- which tier is required
- which limit applies
- what the next tier unlocks
- what the current upgrade path should say

## Maintenance Requirements

Whenever a new paid feature is added, the developer must:

1. Add it to this document.
2. Assign its minimum tier.
3. Define any usage limits.
4. Add its entitlement identifier.
5. Implement the centralized entitlement check.
6. Update upgrade / pricing UI if appropriate.
7. Add or update entitlement tests.

Do not add a paid or gated feature without updating this document.

## Current Implementation Status

The current web entitlement implementation is expected to align to this document on the main paid-feature surfaces:

- centralized entitlement definitions
- INTERNAL access modeled separately from customer tiers
- role and tier checks separated for gated product access
- centralized tournament, template, history, and camera-limit policy
- pricing UI aligned to the tier catalog

If a future audit finds drift, add a new discrepancy list here until the implementation is brought back into alignment.
