import { describe, expect, it } from 'vitest';
import {
  getModifiedEliminationRaceCap,
  getTierLimit,
  getTierPriceShortLabel,
  hasEntitlement,
  resolveAccessTier
} from './subscription';

describe('subscription entitlement catalog', () => {
  it('models internal access separately from customer tiers', () => {
    expect(resolveAccessTier('PLATFORM_ADMIN', 'PRO_PLUS')).toBe('INTERNAL');
  });

  it('gates paid tournament formats and broadcast tiers centrally', () => {
    expect(hasEntitlement('BASIC', 'tournament.modified')).toBe(false);
    expect(hasEntitlement('PRO', 'tournament.modified')).toBe(true);
    expect(hasEntitlement('PRO', 'broadcast.tdtv')).toBe(false);
    expect(hasEntitlement('PRO_PLUS', 'broadcast.tdtv')).toBe(true);
  });

  it('exposes source-of-truth limits and pricing', () => {
    expect(getTierLimit('BASIC', 'savedTournamentRecords')).toBe(5);
    expect(getTierLimit('PRO', 'templates')).toBe(5);
    expect(getTierLimit('PRO_PLUS', 'accounts')).toBe(2);
    expect(getTierLimit('VENUE', 'accounts')).toBe(3);
    expect(getTierPriceShortLabel('VENUE')).toBe('$24.99/mo');
  });

  it('uses a single race cap policy for paid custom race tiers', () => {
    expect(getModifiedEliminationRaceCap('BASIC')).toBe(1);
    expect(getModifiedEliminationRaceCap('PRO')).toBe(10);
    expect(getModifiedEliminationRaceCap('PRO_PLUS')).toBe(10);
  });
});

