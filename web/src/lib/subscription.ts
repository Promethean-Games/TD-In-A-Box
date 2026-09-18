export type SubscriptionTier = 'BASIC' | 'PRO' | 'PRO_PLUS' | 'VENUE';

const STORAGE_KEY = 'tdiab_subscription_tier';
const VALID_TIERS: SubscriptionTier[] = ['BASIC', 'PRO', 'PRO_PLUS', 'VENUE'];

export function getSubscriptionTier(): SubscriptionTier {
  if (typeof window === 'undefined') return 'PRO_PLUS';
  const value = localStorage.getItem(STORAGE_KEY);
  if (value && VALID_TIERS.includes(value as SubscriptionTier)) {
    return value as SubscriptionTier;
  }
  return 'PRO_PLUS';
}

export function setSubscriptionTier(tier: SubscriptionTier): SubscriptionTier {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, tier);
  }
  return tier;
}

export function hasEntitlement(tier: SubscriptionTier, entitlement: string): boolean {
  const basic = ['basic.tournament_limit'];
  const pro = ['pro.templates', 'pro.history', 'pro.profile', 'pro.local_broadcast'];
  const proPlus = ['proplus.td_channel', 'proplus.advanced_broadcast', 'proplus.obs', 'proplus.wifi_camera', 'proplus.branding'];
  const venue = ['venue.view', 'venue.edit', 'venue.manage_devices', 'venue.view_events', 'venue.view_broadcasts'];

  if (tier === 'BASIC') return basic.includes(entitlement);
  if (tier === 'PRO') return [...basic, ...pro].includes(entitlement);
  if (tier === 'PRO_PLUS') return [...basic, ...pro, ...proPlus].includes(entitlement);
  if (tier === 'VENUE') return [...basic, ...pro, ...proPlus, ...venue].includes(entitlement);

  return false;
}

export function canCreateTemplates(tier: SubscriptionTier): boolean {
  return hasEntitlement(tier, 'pro.templates');
}

export function canConfigureTables(tier: SubscriptionTier): boolean {
  return tier === 'PRO' || tier === 'PRO_PLUS' || tier === 'VENUE';
}

export function canUseTdChannel(tier: SubscriptionTier): boolean {
  return hasEntitlement(tier, 'proplus.td_channel');
}

export function canUseModifiedElimination(tier: SubscriptionTier): boolean {
  return tier === 'PRO' || tier === 'PRO_PLUS' || tier === 'VENUE';
}

export function getModifiedEliminationRaceCap(tier: SubscriptionTier): number {
  if (tier === 'VENUE') return 10;
  if (tier === 'PRO_PLUS') return 5;
  if (tier === 'PRO') return 3;
  return 1;
}
