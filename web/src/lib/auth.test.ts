import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BROADCAST_SPONSOR_CARDS,
  PROMETHEAN_SPONSOR_ID,
  TDTV_NETWORK_SPONSOR_ID,
  getSystemBroadcastSponsorDefaults,
  getBroadcastRuntimeConfig
} from './broadcast';
import { getEffectiveTier, getUserTierLabel, hasPermission, listEffectivePermissions, type AppUser } from './auth';

const platformAdmin: AppUser = {
  id: 'platform-admin',
  name: 'Platform Admin',
  email: 'info@promethean-games.com',
  role: 'PLATFORM_ADMIN',
  tier: 'PRO_PLUS',
  status: 'ACTIVE',
  verified: true,
  venueIds: ['venue-austin'],
  permissions: ['platform.manage_users', 'platform.manage_channels', 'platform.manage_venues', 'tournament.create']
};

const basicUser: AppUser = {
  id: 'basic-user',
  name: 'Basic User',
  email: 'member@example.com',
  role: 'USER',
  tier: 'BASIC',
  status: 'ACTIVE',
  verified: false,
  venueIds: [],
  permissions: ['basic.tournament_limit']
};

const proPlusTd: AppUser = {
  id: 'pro-plus-td',
  name: 'TD Pro+',
  email: 'td@example.com',
  role: 'TD',
  tier: 'PRO_PLUS',
  status: 'ACTIVE',
  verified: true,
  venueIds: ['venue-austin'],
  tdProfileId: 'td-001',
  tdChannelId: 199,
  permissions: ['tournament.create', 'proplus.td_channel', 'proplus.advanced_broadcast', 'proplus.wifi_camera']
};

const venueAdmin: AppUser = {
  id: 'venue-admin',
  name: 'Venue Admin',
  email: 'venue@example.com',
  role: 'VENUE_ADMIN',
  tier: 'VENUE',
  status: 'ACTIVE',
  verified: true,
  venueIds: ['venue-austin'],
  permissions: ['venue.view', 'venue.edit']
};

describe('authorization model', () => {
  it('grants platform admin all platform powers', () => {
    expect(hasPermission(platformAdmin, 'platform.manage_users')).toBe(true);
    expect(hasPermission(platformAdmin, 'platform.manage_channels')).toBe(true);
    expect(getEffectiveTier(platformAdmin)).toBe('VENUE');
    expect(getUserTierLabel(platformAdmin)).toBe('Platform Admin');
  });

  it('blocks bare users from pro+ permissions', () => {
    expect(hasPermission(basicUser, 'pro.templates')).toBe(false);
    expect(hasPermission(basicUser, 'proplus.td_channel')).toBe(false);
  });

  it('allows pro+ TDs to access TD channel entitlement', () => {
    expect(proPlusTd.tier).toBe('PRO_PLUS');
    expect(hasPermission(proPlusTd, 'proplus.td_channel')).toBe(true);
    expect(listEffectivePermissions(proPlusTd)).toContain('proplus.td_channel');
  });

  it('restricts venue admin to the correct venue only', () => {
    expect(hasPermission(venueAdmin, 'venue.view')).toBe(true);
    expect(hasPermission(venueAdmin, 'platform.manage_users')).toBe(false);
  });

  it('allows pro+ broadcast control for authorized TD accounts', () => {
    expect(hasPermission(proPlusTd, 'proplus.advanced_broadcast')).toBe(true);
    expect(hasPermission(proPlusTd, 'proplus.wifi_camera')).toBe(true);
  });

  it('provides default sponsor overlay config for the broadcast studio', () => {
    const config = getBroadcastRuntimeConfig();
    expect(config.cameraList.length).toBeGreaterThanOrEqual(0);
    expect(config.sponsorCards.length).toBeGreaterThanOrEqual(2);
    expect(config.sponsorCards[0]?.id).toBe(TDTV_NETWORK_SPONSOR_ID);
    expect(config.sponsorCards[0]?.permanent).toBe(true);
    expect(config.sponsorCards[0]?.durationSeconds).toBe(15);
    expect(config.sponsorCards[1]?.id).toBe(PROMETHEAN_SPONSOR_ID);
    expect(config.sponsorCards[1]?.durationSeconds).toBe(15);
    expect(getSystemBroadcastSponsorDefaults().map((card) => card.durationSeconds)).toEqual([15, 15]);
    expect(DEFAULT_BROADCAST_SPONSOR_CARDS.map((card) => card.id)).toEqual([
      TDTV_NETWORK_SPONSOR_ID,
      PROMETHEAN_SPONSOR_ID
    ]);
  });
});
