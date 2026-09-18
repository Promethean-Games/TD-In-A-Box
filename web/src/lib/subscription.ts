export type SubscriptionTier = 'BASIC' | 'PRO' | 'PRO_PLUS' | 'VENUE';
export type AccessTier = SubscriptionTier | 'INTERNAL';
export type TierLimitKey = 'activeTournaments' | 'savedTournamentRecords' | 'accounts' | 'templates' | 'cameraFeeds';

const STORAGE_KEY = 'tdiab_subscription_tier';
const USER_STORAGE_KEY = 'tdiab_current_user';
const CUSTOMER_TIER_ORDER: SubscriptionTier[] = ['BASIC', 'PRO', 'PRO_PLUS', 'VENUE'];
const ACCESS_TIER_ORDER: AccessTier[] = ['BASIC', 'PRO', 'PRO_PLUS', 'VENUE', 'INTERNAL'];

export interface TierLimits {
  activeTournaments: number | null;
  savedTournamentRecords: number | null;
  accounts: number | null;
  templates: number | null;
  cameraFeeds: number | null;
}

type EntitlementConfig = {
  name: string;
  minTier: AccessTier;
  usageLimit?: Partial<Record<AccessTier, number | string | null>>;
  roleRestriction?: string[];
  networkRestriction?: string;
};

const ENTITLEMENT_CATALOG = {
  'tournament.single_elimination': { name: 'Single Elimination', minTier: 'BASIC' },
  'tournament.double_elimination': { name: 'Double Elimination', minTier: 'BASIC' },
  'tournament.modified': { name: 'Modified Elimination', minTier: 'PRO' },
  'tournament.chip': { name: 'Chip Tournament', minTier: 'PRO' },
  'tournament.race_tracking': { name: 'Race Tracking', minTier: 'PRO' },
  'tournament.custom_race': { name: 'Custom Race Formats', minTier: 'PRO' },
  'tournament.multi_table': { name: 'Multi-table Management', minTier: 'BASIC' },
  'tournament.live_roster': { name: 'Live roster / player management', minTier: 'BASIC' },
  'tournament.live_match_control': { name: 'Live match control', minTier: 'BASIC' },
  'tournament.payouts': { name: 'Payout management', minTier: 'BASIC' },
  'tournament.history.basic': {
    name: 'Basic tournament history',
    minTier: 'BASIC',
    usageLimit: { BASIC: 5, PRO: 25, PRO_PLUS: 100 }
  },
  'tournament.history.expanded': {
    name: 'Expanded tournament history and stats',
    minTier: 'PRO',
    usageLimit: { PRO: 25, PRO_PLUS: 100 }
  },
  'tournament.templates': {
    name: 'Tournament templates',
    minTier: 'PRO',
    usageLimit: { PRO: 5, PRO_PLUS: 25 }
  },
  'tournament.active_records': {
    name: 'Active tournament allowance',
    minTier: 'BASIC',
    usageLimit: { BASIC: 1, PRO: 3, PRO_PLUS: 10 }
  },
  'players.basic_management': { name: 'Basic player management', minTier: 'BASIC' },
  'players.database': { name: 'Player Database access', minTier: 'PRO' },
  'players.universal_id': { name: 'Universal Player ID access', minTier: 'PRO' },
  'players.history': { name: 'Player history and statistics', minTier: 'PRO' },
  'identity.td_profile': { name: 'TD Profile', minTier: 'PRO' },
  'identity.tdtv_presence': {
    name: 'TD network broadcasting identity',
    minTier: 'PRO_PLUS',
    networkRestriction: 'Publishing to TDTV requires Pro+ or Venue.'
  },
  'identity.venue_presence': { name: 'Venue identity and advertising presence', minTier: 'VENUE' },
  'broadcast.local': {
    name: 'Local broadcasting',
    minTier: 'PRO',
    usageLimit: { PRO: 1 }
  },
  'broadcast.overlays': { name: 'Broadcast overlays', minTier: 'PRO' },
  'broadcast.tdtv': {
    name: 'Network broadcasting (TDTV publishing)',
    minTier: 'PRO_PLUS',
    networkRestriction: 'TDTV viewing is free, but publishing requires Pro+ or Venue.'
  },
  'broadcast.overlays_advanced': { name: 'Advanced overlays', minTier: 'PRO_PLUS' },
  'broadcast.branding': { name: 'Tournament branding', minTier: 'PRO_PLUS' },
  'broadcast.sponsors': { name: 'Sponsor management and rotation', minTier: 'PRO_PLUS' },
  'broadcast.multi_camera': { name: 'Multi-camera support', minTier: 'PRO_PLUS' },
  'broadcast.camera_table_assignment': { name: 'Camera-to-table assignment', minTier: 'PRO_PLUS' },
  'broadcast.featured_table_switching': { name: 'Featured Table program switching', minTier: 'PRO_PLUS' },
  'broadcast.venue_network': { name: 'Venue-level broadcast and network capability', minTier: 'VENUE' },
  'venue.advertising': { name: 'Venue advertising', minTier: 'VENUE' },
  'account.standard': {
    name: 'Standard customer account',
    minTier: 'BASIC',
    usageLimit: { BASIC: 1, PRO: 1, PRO_PLUS: 2, VENUE: 3 }
  },
  'account.multi_user': {
    name: 'Multiple TD / staff accounts',
    minTier: 'VENUE',
    usageLimit: { VENUE: 3 }
  },
  'venue.administration': {
    name: 'Venue administration',
    minTier: 'VENUE',
    roleRestriction: ['VENUE_ADMIN']
  },
  'internal.full_access': { name: 'Internal administrative access', minTier: 'INTERNAL' }
} as const satisfies Record<string, EntitlementConfig>;

export type EntitlementId = keyof typeof ENTITLEMENT_CATALOG;

const TIER_LIMITS: Record<AccessTier, TierLimits> = {
  BASIC: {
    activeTournaments: 1,
    savedTournamentRecords: 5,
    accounts: 1,
    templates: 0,
    cameraFeeds: 0
  },
  PRO: {
    activeTournaments: 3,
    savedTournamentRecords: 25,
    accounts: 1,
    templates: 5,
    cameraFeeds: 1
  },
  PRO_PLUS: {
    activeTournaments: 10,
    savedTournamentRecords: 100,
    accounts: 2,
    templates: 25,
    cameraFeeds: null
  },
  VENUE: {
    activeTournaments: null,
    savedTournamentRecords: null,
    accounts: 3,
    templates: null,
    cameraFeeds: null
  },
  INTERNAL: {
    activeTournaments: null,
    savedTournamentRecords: null,
    accounts: null,
    templates: null,
    cameraFeeds: null
  }
};

const TIER_PRICE_LABELS: Record<AccessTier, string> = {
  BASIC: '$0',
  PRO: '$4.99/month',
  PRO_PLUS: '$9.99/month',
  VENUE: '$24.99/month',
  INTERNAL: 'Internal only'
};

const TIER_PRICE_SHORT_LABELS: Record<SubscriptionTier, string> = {
  BASIC: 'Free',
  PRO: '$4.99/mo',
  PRO_PLUS: '$9.99/mo',
  VENUE: '$24.99/mo'
};

const LEGACY_ENTITLEMENT_ALIAS: Record<string, EntitlementId> = {
  'basic.tournament_limit': 'tournament.history.basic',
  'pro.templates': 'tournament.templates',
  'pro.history': 'tournament.history.expanded',
  'pro.profile': 'identity.td_profile',
  'pro.local_broadcast': 'broadcast.local',
  'proplus.td_channel': 'broadcast.tdtv',
  'proplus.advanced_broadcast': 'broadcast.overlays_advanced',
  'proplus.obs': 'broadcast.overlays_advanced',
  'proplus.wifi_camera': 'broadcast.tdtv',
  'proplus.branding': 'broadcast.branding'
};

export function isSubscriptionTier(value: unknown): value is SubscriptionTier {
  return CUSTOMER_TIER_ORDER.includes(value as SubscriptionTier);
}

export function isAccessTier(value: unknown): value is AccessTier {
  return ACCESS_TIER_ORDER.includes(value as AccessTier);
}

function normalizeEntitlementId(value: EntitlementId | string): EntitlementId | null {
  if (value in ENTITLEMENT_CATALOG) {
    return value as EntitlementId;
  }
  return LEGACY_ENTITLEMENT_ALIAS[value] ?? null;
}

export function resolveAccessTier(role: string | null | undefined, tier: SubscriptionTier | null | undefined): AccessTier {
  if (role === 'PLATFORM_ADMIN') return 'INTERNAL';
  return isSubscriptionTier(tier) ? tier : 'BASIC';
}

function tierRank(tier: AccessTier): number {
  return ACCESS_TIER_ORDER.indexOf(tier);
}

export function meetsTierRequirement(currentTier: AccessTier, minimumTier: AccessTier): boolean {
  if (currentTier === 'INTERNAL') return true;
  if (minimumTier === 'INTERNAL') return currentTier === 'INTERNAL';
  return tierRank(currentTier) >= tierRank(minimumTier);
}

export function getEntitlementDefinition(entitlementId: EntitlementId | string) {
  const normalizedId = normalizeEntitlementId(entitlementId);
  if (!normalizedId) return null;
  return {
    id: normalizedId,
    ...ENTITLEMENT_CATALOG[normalizedId]
  };
}

export function listEntitlementDefinitions() {
  return (Object.keys(ENTITLEMENT_CATALOG) as EntitlementId[]).map((id) => ({
    id,
    ...ENTITLEMENT_CATALOG[id]
  }));
}

export function hasEntitlement(tier: AccessTier, entitlementId: EntitlementId | string): boolean {
  const definition = getEntitlementDefinition(entitlementId);
  if (!definition) return false;
  return meetsTierRequirement(tier, definition.minTier);
}

export function getTierLimits(tier: AccessTier): TierLimits {
  return TIER_LIMITS[tier];
}

export function getTierLimit(tier: AccessTier, key: TierLimitKey): number | null {
  return TIER_LIMITS[tier][key];
}

export function getTierPriceLabel(tier: AccessTier): string {
  return TIER_PRICE_LABELS[tier];
}

export function getTierPriceShortLabel(tier: SubscriptionTier): string {
  return TIER_PRICE_SHORT_LABELS[tier];
}

export function getNextCustomerTier(tier: SubscriptionTier): SubscriptionTier | null {
  const currentIndex = CUSTOMER_TIER_ORDER.indexOf(tier);
  if (currentIndex < 0 || currentIndex === CUSTOMER_TIER_ORDER.length - 1) return null;
  return CUSTOMER_TIER_ORDER[currentIndex + 1];
}

export function getUpgradeUnlocks(tier: AccessTier) {
  if (tier === 'INTERNAL') return [];
  const nextTier = getNextCustomerTier(tier);
  if (!nextTier) return [];
  return listEntitlementDefinitions().filter(
    (definition) => hasEntitlement(nextTier, definition.id) && !hasEntitlement(tier, definition.id)
  );
}

export function getEntitlementUsageLimit(tier: AccessTier, entitlementId: EntitlementId | string): number | string | null {
  const definition = getEntitlementDefinition(entitlementId);
  if (!definition?.usageLimit) return null;
  if (tier === 'INTERNAL') return null;
  if (definition.usageLimit[tier] !== undefined) {
    return definition.usageLimit[tier] ?? null;
  }

  const fallbackTiers = CUSTOMER_TIER_ORDER.filter((candidate) => meetsTierRequirement(tier, candidate)).reverse();
  for (const candidate of fallbackTiers) {
    if (definition.usageLimit[candidate] !== undefined) {
      return definition.usageLimit[candidate] ?? null;
    }
  }

  return null;
}

export function getSubscriptionTier(): SubscriptionTier {
  if (typeof window === 'undefined') return 'BASIC';
  try {
    const rawUser = localStorage.getItem(USER_STORAGE_KEY);
    if (rawUser) {
      const parsed = JSON.parse(rawUser) as { tier?: unknown };
      if (isSubscriptionTier(parsed.tier)) {
        return parsed.tier;
      }
    }
  } catch {
    // fall through to direct tier storage
  }
  const value = localStorage.getItem(STORAGE_KEY);
  if (isSubscriptionTier(value)) {
    return value;
  }
  return 'BASIC';
}

export function setSubscriptionTier(tier: SubscriptionTier): SubscriptionTier {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, tier);
  }
  return tier;
}

export function canCreateTemplates(tier: AccessTier): boolean {
  return hasEntitlement(tier, 'tournament.templates');
}

export function canConfigureTables(_tier: AccessTier): boolean {
  return true;
}

export function canUseTdChannel(tier: AccessTier): boolean {
  return hasEntitlement(tier, 'broadcast.tdtv');
}

export function canUseModifiedElimination(tier: AccessTier): boolean {
  return hasEntitlement(tier, 'tournament.modified');
}

export function canUseChipTournament(tier: AccessTier): boolean {
  return hasEntitlement(tier, 'tournament.chip');
}

export function canUsePlayerDatabase(tier: AccessTier): boolean {
  return hasEntitlement(tier, 'players.database');
}

export function canUseUniversalPlayerId(tier: AccessTier): boolean {
  return hasEntitlement(tier, 'players.universal_id');
}

export function getModifiedEliminationRaceCap(tier: AccessTier): number {
  return hasEntitlement(tier, 'tournament.custom_race') ? 10 : 1;
}

