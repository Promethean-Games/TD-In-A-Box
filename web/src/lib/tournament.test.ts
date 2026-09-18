import { describe, expect, it } from 'vitest';
import {
  TournamentEngine,
  buildDefaultPayoutPercentages,
  calculatePrizeContributionPerPlayer,
  normalizeTournament,
  normalizePayoutPercentages,
  type Tournament
} from './tournament';

function createTournamentFixture(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: 'fixture',
    name: 'Fixture',
    format: 'SINGLE_ELIMINATION',
    status: 'DRAFT',
    seedingMethod: 'ENTERED',
    tableCount: 2,
    isTemplate: false,
    players: [
      { id: 'p1', displayName: 'Player 1', entryOrder: 1, seed: 1, status: 'REGISTERED', wins: 0, losses: 0, eliminated: false, identityMode: 'UNRESOLVED', universalProfileId: null },
      { id: 'p2', displayName: 'Player 2', entryOrder: 2, seed: 2, status: 'REGISTERED', wins: 0, losses: 0, eliminated: false, identityMode: 'UNRESOLVED', universalProfileId: null },
      { id: 'p3', displayName: 'Player 3', entryOrder: 3, seed: 3, status: 'REGISTERED', wins: 0, losses: 0, eliminated: false, identityMode: 'UNRESOLVED', universalProfileId: null },
      { id: 'p4', displayName: 'Player 4', entryOrder: 4, seed: 4, status: 'REGISTERED', wins: 0, losses: 0, eliminated: false, identityMode: 'UNRESOLVED', universalProfileId: null },
      { id: 'p5', displayName: 'Player 5', entryOrder: 5, seed: 5, status: 'REGISTERED', wins: 0, losses: 0, eliminated: false, identityMode: 'UNRESOLVED', universalProfileId: null },
      { id: 'p6', displayName: 'Player 6', entryOrder: 6, seed: 6, status: 'REGISTERED', wins: 0, losses: 0, eliminated: false, identityMode: 'UNRESOLVED', universalProfileId: null },
      { id: 'p7', displayName: 'Player 7', entryOrder: 7, seed: 7, status: 'REGISTERED', wins: 0, losses: 0, eliminated: false, identityMode: 'UNRESOLVED', universalProfileId: null }
    ],
    matches: [],
    bracketGenerated: false,
    entryFee: 10,
    greenFee: 0,
    payoutPositions: 3,
    payoutPercentages: buildDefaultPayoutPercentages(3),
    winnersRaceTo: 1,
    losersRaceTo: 1,
    payouts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe('tournament payout calculations', () => {
  it('uses total entry minus green fee for each player contribution', () => {
    expect(calculatePrizeContributionPerPlayer(10, 3)).toBe(7);
    expect(calculatePrizeContributionPerPlayer(10, 11)).toBe(0);
  });

  it('computes a 70 dollar pool for 7 players at 10 entry and 0 green fee', () => {
    const tournament = createTournamentFixture({ entryFee: 10, greenFee: 0 });
    const result = TournamentEngine.calculatePayouts(tournament);
    expect(result.totalPool).toBe(70);
    expect(result.payouts.reduce((sum, row) => sum + row.amount, 0)).toBe(70);
  });

  it('normalizes payout percentages to 5 percent increments totaling 100', () => {
    const normalized = normalizePayoutPercentages([33, 33, 34], 3);
    expect(normalized.reduce((sum, value) => sum + value, 0)).toBe(100);
    normalized.forEach((value) => {
      expect(value % 5).toBe(0);
    });
  });

  it('limits ready matches to configured table count when tournament starts', () => {
    const entrants = Array.from({ length: 21 }, (_, index) => ({
      id: `player-${index + 1}`,
      displayName: `Player ${index + 1}`,
      entryOrder: index + 1,
      seed: index + 1,
      status: 'REGISTERED' as const,
      wins: 0,
      losses: 0,
      eliminated: false,
      identityMode: 'UNRESOLVED' as const,
      universalProfileId: null
    }));

    const baseTournament = createTournamentFixture({
      players: entrants,
      tableCount: 2,
      payoutPositions: 3,
      payoutPercentages: buildDefaultPayoutPercentages(3)
    });

    const withBracket = TournamentEngine.generateBracket(baseTournament);
    const activeTournament = TournamentEngine.startTournament(withBracket);
    const readyMatchCount = activeTournament.matches.filter((match) => match.state === 'READY').length;

    expect(readyMatchCount).toBe(2);
  });

  it('normalizes modified elimination race settings with sane defaults and cap', () => {
    const normalized = normalizeTournament({
      ...createTournamentFixture(),
      format: 'MODIFIED_ELIMINATION',
      winnersRaceTo: 99,
      losersRaceTo: 0
    });
    expect(normalized?.winnersRaceTo).toBe(10);
    expect(normalized?.losersRaceTo).toBe(1);
  });

  it('defaults modified elimination to a real race profile instead of a basic 1/1 fallback', () => {
    const normalized = normalizeTournament({
      ...createTournamentFixture(),
      format: 'MODIFIED_ELIMINATION',
      winnersRaceTo: undefined,
      losersRaceTo: undefined,
      raceShiftStartRound: undefined,
      winnersRaceToAfterShift: undefined,
      losersRaceToAfterShift: undefined
    });

    expect(normalized?.format).toBe('MODIFIED_ELIMINATION');
    expect(normalized?.winnersRaceTo).toBe(2);
    expect(normalized?.losersRaceTo).toBe(1);
    expect(normalized?.raceShiftStartRound).toBe(3);
  });

  it('propagates completed results to later bracket rounds without stale references', () => {
    let tournament = createTournamentFixture({
      players: Array.from({ length: 8 }, (_, index) => ({
        id: `player-${index + 1}`,
        displayName: `Player ${index + 1}`,
        entryOrder: index + 1,
        seed: index + 1,
        status: 'REGISTERED' as const,
        wins: 0,
        losses: 0,
        eliminated: false,
        identityMode: 'UNRESOLVED' as const,
        universalProfileId: null
      }))
    });

    tournament = TournamentEngine.generateBracket(tournament);
    tournament = TournamentEngine.startTournament(tournament);

    const roundOneMatch = tournament.matches.find((match) => match.round === 1 && match.slot === 0)!;
    const next = TournamentEngine.completeMatch(tournament, roundOneMatch.id, roundOneMatch.entrants[0]);

    const roundTwoMatch = next.matches.find((match) => match.round === 2 && match.slot === 0)!;
    expect(roundTwoMatch.entrants).toEqual([roundOneMatch.entrants[0]]);
    expect(roundTwoMatch.state).toBe('PENDING');
    expect(next.matches).not.toBe(tournament.matches);
  });

  it('backfills legacy players without identity mode data', () => {
    const normalized = normalizeTournament({
      ...createTournamentFixture(),
      players: [
        {
          id: 'legacy-player',
          displayName: 'Legacy Player',
          entryOrder: 1,
          seed: 1,
          status: 'REGISTERED',
          wins: 0,
          losses: 0,
          eliminated: false
        }
      ]
    });

    expect(normalized?.players[0]?.identityMode).toBe('UNRESOLVED');
    expect(normalized?.players[0]?.universalProfileId).toBeNull();
  });
});
