// Tournament engine that runs entirely in the browser
// No backend needed - perfect for testing and GitHub Pages

import { v4 as uuidv4 } from 'uuid';

export type TournamentFormat = 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION' | 'CHIP_TOURNAMENT' | 'MODIFIED_ELIMINATION';
export type TournamentSeedMode = 'ENTERED' | 'ALPHABETICAL' | 'RANDOM' | 'MANUAL';
export type TournamentStatus = 'DRAFT' | 'READY' | 'ACTIVE' | 'COMPLETED';
export type MatchState = 'PENDING' | 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BYE';
export type PlayerStatus = 'REGISTERED' | 'ACTIVE' | 'ELIMINATED' | 'COMPLETE';
export type PlayerIdentityMode = 'UNRESOLVED' | 'LINKED' | 'LOCAL_ONLY';

export interface Player {
  id: string;
  displayName: string;
  entryOrder: number;
  seed: number;
  status: PlayerStatus;
  wins: number;
  losses: number;
  eliminated: boolean;
  identityMode: PlayerIdentityMode;
  universalProfileId: string | null;
}

export interface Match {
  id: string;
  round: number;
  slot: number;
  entrants: string[];
  winnerId: string | null;
  loserId: string | null;
  state: MatchState;
  result: { winnerId: string | null; loserId: string | null; score: string } | null;
}

export interface PayoutBreakdown {
  position: number;
  percentage: number;
  amount: number;
}

export interface Tournament {
  id: string;
  name: string;
  format: TournamentFormat;
  status: TournamentStatus;
  seedingMethod: TournamentSeedMode;
  tableCount: number;
  isTemplate: boolean;
  players: Player[];
  matches: Match[];
  bracketGenerated: boolean;
  entryFee: number;
  greenFee: number;
  payoutPositions: number;
  payoutPercentages: number[];
  winnersRaceTo: number;
  losersRaceTo: number;
  raceShiftStartRound: number | null;
  winnersRaceToAfterShift: number;
  losersRaceToAfterShift: number;
  payouts: PayoutBreakdown[];
  location?: string;
  venueId?: string | null;
  venueName?: string;
  date?: string;
  createdAt: string;
  updatedAt: string;
}

export function calculatePrizeContributionPerPlayer(entryFee: number, greenFee: number): number {
  return Math.max(0, Number(entryFee || 0) - Number(greenFee || 0));
}

export const PAYOUT_PERCENT_STEP = 5;
const PAYOUT_PERCENT_TOTAL = 100;
const PAYOUT_PERCENT_TOTAL_UNITS = PAYOUT_PERCENT_TOTAL / PAYOUT_PERCENT_STEP;
const UNIVERSAL_PLAYER_PROFILE_STORAGE_KEY = 'tdiab_universal_player_profiles';

export interface UniversalPlayerProfile {
  id: string;
  displayName: string;
  createdAt: string;
}

export function getUniversalPlayerProfiles(): UniversalPlayerProfile[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(UNIVERSAL_PLAYER_PROFILE_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as UniversalPlayerProfile[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => typeof entry?.id === 'string' && typeof entry?.displayName === 'string')
      .map((entry) => ({
        id: entry.id,
        displayName: entry.displayName,
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString()
      }));
  } catch {
    return [];
  }
}

function saveUniversalPlayerProfiles(profiles: UniversalPlayerProfile[]): UniversalPlayerProfile[] {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(UNIVERSAL_PLAYER_PROFILE_STORAGE_KEY, JSON.stringify(profiles));
  }
  return profiles;
}

export function findUniversalPlayerProfileByName(name: string): UniversalPlayerProfile | null {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  return (
    getUniversalPlayerProfiles().find((entry) => entry.displayName.trim().toLowerCase() === normalized) ?? null
  );
}

export function createUniversalPlayerProfile(displayName: string): UniversalPlayerProfile {
  const safeName = displayName.trim() || 'Player';
  const existing = findUniversalPlayerProfileByName(safeName);
  if (existing) return existing;

  const profile: UniversalPlayerProfile = {
    id: `up-${uuidv4().slice(0, 8)}`,
    displayName: safeName,
    createdAt: new Date().toISOString()
  };
  const current = getUniversalPlayerProfiles();
  saveUniversalPlayerProfiles([profile, ...current]);
  return profile;
}

function defaultPayoutWeights(positionCount: number): number[] {
  return Array.from({ length: positionCount }, (_, index) => {
    const position = index + 1;
    if (position === 1) return 0.4;
    if (position === 2) return 0.25;
    if (position === 3) return 0.15;
    if (position === 4) return 0.1;
    if (position === 5) return 0.07;
    if (position === 6) return 0.03;
    if (position === 7) return 0.02;
    if (position === 8) return 0.015;
    if (position === 9) return 0.01;
    if (position === 10) return 0.008;
    return 0.004 / Math.max(position - 10, 1);
  });
}

function unitsToPercentages(units: number[]): number[] {
  return units.map((unit) => unit * PAYOUT_PERCENT_STEP);
}

function percentagesToUnits(percentages: number[], positionCount: number): number[] {
  const normalized = Array.from({ length: positionCount }, (_, index) => {
    const raw = Number(percentages[index] ?? 0);
    const snapped = Math.round(raw / PAYOUT_PERCENT_STEP);
    return Math.max(0, Math.min(PAYOUT_PERCENT_TOTAL_UNITS, snapped));
  });

  let totalUnits = normalized.reduce((sum, unit) => sum + unit, 0);
  if (totalUnits === 0) return [];

  if (totalUnits > PAYOUT_PERCENT_TOTAL_UNITS) {
    let overflow = totalUnits - PAYOUT_PERCENT_TOTAL_UNITS;
    for (let index = normalized.length - 1; index >= 0 && overflow > 0; index -= 1) {
      const reduction = Math.min(normalized[index], overflow);
      normalized[index] -= reduction;
      overflow -= reduction;
    }
  } else if (totalUnits < PAYOUT_PERCENT_TOTAL_UNITS) {
    let deficit = PAYOUT_PERCENT_TOTAL_UNITS - totalUnits;
    for (let index = 0; index < normalized.length && deficit > 0; index += 1) {
      const room = PAYOUT_PERCENT_TOTAL_UNITS - normalized[index];
      if (room <= 0) continue;
      const increase = Math.min(room, deficit);
      normalized[index] += increase;
      deficit -= increase;
      if (index === normalized.length - 1 && deficit > 0) {
        index = -1;
      }
    }
  }

  totalUnits = normalized.reduce((sum, unit) => sum + unit, 0);
  if (totalUnits !== PAYOUT_PERCENT_TOTAL_UNITS) return [];
  return normalized;
}

export function buildDefaultPayoutPercentages(positionCount: number): number[] {
  if (!Number.isFinite(positionCount) || positionCount <= 0) return [];
  const weights = defaultPayoutWeights(positionCount);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const rawUnits = weights.map((weight) => (weight / totalWeight) * PAYOUT_PERCENT_TOTAL_UNITS);
  const units = rawUnits.map((value) => Math.floor(value));
  let usedUnits = units.reduce((sum, value) => sum + value, 0);
  const orderByFraction = rawUnits
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  let cursor = 0;
  while (usedUnits < PAYOUT_PERCENT_TOTAL_UNITS && orderByFraction.length > 0) {
    const target = orderByFraction[cursor % orderByFraction.length];
    units[target.index] += 1;
    usedUnits += 1;
    cursor += 1;
  }

  return unitsToPercentages(units);
}

export function normalizePayoutPercentages(percentages: number[] | null | undefined, positionCount: number): number[] {
  if (!Array.isArray(percentages)) {
    return buildDefaultPayoutPercentages(positionCount);
  }

  const units = percentagesToUnits(percentages, positionCount);
  if (units.length !== positionCount) {
    return buildDefaultPayoutPercentages(positionCount);
  }

  return unitsToPercentages(units);
}

function clampRaceValue(value: unknown, fallback = 1): number {
  return Math.max(1, Math.min(10, Number(value ?? fallback) || fallback));
}

export function getDefaultRaceSettingsForFormat(format: TournamentFormat): {
  winnersRaceTo: number;
  losersRaceTo: number;
  winnersRaceToAfterShift: number;
  losersRaceToAfterShift: number;
  raceShiftStartRound: number | null;
} {
  if (format === 'MODIFIED_ELIMINATION') {
    return {
      winnersRaceTo: 2,
      losersRaceTo: 1,
      winnersRaceToAfterShift: 1,
      losersRaceToAfterShift: 1,
      raceShiftStartRound: 3
    };
  }

  return {
    winnersRaceTo: 1,
    losersRaceTo: 1,
    winnersRaceToAfterShift: 1,
    losersRaceToAfterShift: 1,
    raceShiftStartRound: null
  };
}

function normalizeRaceShiftStartRound(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || Number(value) <= 0) return null;
  return Math.max(1, Math.floor(Number(value)));
}

export function getModifiedEliminationRacePlan(
  tournament: Pick<
    Tournament,
    | 'format'
    | 'winnersRaceTo'
    | 'losersRaceTo'
    | 'raceShiftStartRound'
    | 'winnersRaceToAfterShift'
    | 'losersRaceToAfterShift'
  >,
  round: number
): {
  winnersRaceTo: number;
  losersRaceTo: number;
  shifted: boolean;
  shiftStartRound: number | null;
} {
  const shiftStartRound = normalizeRaceShiftStartRound(tournament.raceShiftStartRound);
  const shifted =
    tournament.format === 'MODIFIED_ELIMINATION' &&
    shiftStartRound !== null &&
    Math.max(1, Math.floor(Number(round) || 1)) >= shiftStartRound;

  return {
    winnersRaceTo: shifted ? clampRaceValue(tournament.winnersRaceToAfterShift) : clampRaceValue(tournament.winnersRaceTo),
    losersRaceTo: shifted ? clampRaceValue(tournament.losersRaceToAfterShift) : clampRaceValue(tournament.losersRaceTo),
    shifted,
    shiftStartRound
  };
}

export function normalizePlayer(player: Partial<Player> | null | undefined, fallbackSeed = 1): Player {
  const identityMode =
    player?.identityMode === 'LINKED' || player?.identityMode === 'LOCAL_ONLY' || player?.identityMode === 'UNRESOLVED'
      ? player.identityMode
      : 'UNRESOLVED';
  return {
    id: String(player?.id ?? `player-${fallbackSeed}-${Math.random().toString(36).slice(2, 8)}`),
    displayName: String(player?.displayName ?? `Player ${fallbackSeed}`),
    entryOrder: Number.isFinite(player?.entryOrder) ? Number(player?.entryOrder) : fallbackSeed,
    seed: Number.isFinite(player?.seed) ? Number(player?.seed) : fallbackSeed,
    status: (player?.status as PlayerStatus) ?? 'REGISTERED',
    wins: Number.isFinite(player?.wins) ? Number(player?.wins) : 0,
    losses: Number.isFinite(player?.losses) ? Number(player?.losses) : 0,
    eliminated: Boolean(player?.eliminated),
    identityMode,
    universalProfileId:
      typeof player?.universalProfileId === 'string' && player.universalProfileId.length > 0
        ? player.universalProfileId
        : null
  };
}

export function normalizeMatch(match: Partial<Match> | null | undefined, fallbackRound = 1, fallbackSlot = 0): Match {
  const entrants = Array.isArray(match?.entrants) ? match.entrants.filter(Boolean) : [];
  return {
    id: String(match?.id ?? `match-${fallbackRound}-${Math.random().toString(36).slice(2, 8)}`),
    round: Number.isFinite(match?.round) ? Number(match?.round) : fallbackRound,
    slot: Number.isFinite(match?.slot) ? Number(match?.slot) : fallbackSlot,
    entrants,
    winnerId: match?.winnerId ?? null,
    loserId: match?.loserId ?? null,
    state: (match?.state as MatchState) ?? (entrants.length <= 1 ? 'BYE' : 'PENDING'),
    result: match?.result ?? null
  };
}

export function normalizeTournament(tournament: Partial<Tournament> | null | undefined): Tournament | null {
  if (!tournament) return null;

  const rawPlayers = Array.isArray(tournament.players) ? tournament.players : [];
  const rawMatches = Array.isArray(tournament.matches) ? tournament.matches : [];

  const normalizedMatches = rawMatches.map((m, index) => normalizeMatch(m, index + 1, index));
  const roundSlots = new Map<number, number>();
  const matchesWithSlots = normalizedMatches.map((match) => {
    if (Number.isFinite(match.slot)) return match;
    const current = roundSlots.get(match.round) ?? 0;
    roundSlots.set(match.round, current + 1);
    return { ...match, slot: current };
  });

  const format = (tournament.format as TournamentFormat) ?? 'SINGLE_ELIMINATION';
  const defaultRaceSettings = getDefaultRaceSettingsForFormat(format);

  return {
    id: String(tournament.id ?? `tournament-${Math.random().toString(36).slice(2, 8)}`),
    name: String(tournament.name ?? 'Untitled Tournament'),
    format,
    status: (tournament.status as TournamentStatus) ?? 'DRAFT',
    seedingMethod: (tournament.seedingMethod as TournamentSeedMode) ?? 'ENTERED',
    tableCount: Number.isFinite(tournament.tableCount) ? Number(tournament.tableCount) : 0,
    isTemplate: Boolean(tournament.isTemplate),
    players: rawPlayers.map((p, index) => normalizePlayer(p, index + 1)),
    matches: matchesWithSlots,
    bracketGenerated: Boolean(tournament.bracketGenerated),
    entryFee: Number(tournament.entryFee ?? 0),
    greenFee: Number(tournament.greenFee ?? 0),
    payoutPositions: Number.isFinite(tournament.payoutPositions) ? Number(tournament.payoutPositions) : 3,
    payoutPercentages: normalizePayoutPercentages(
      Array.isArray(tournament.payoutPercentages) ? tournament.payoutPercentages : [],
      Number.isFinite(tournament.payoutPositions) ? Number(tournament.payoutPositions) : 3
    ),
    winnersRaceTo: clampRaceValue(
      tournament.winnersRaceTo ?? (format === 'MODIFIED_ELIMINATION' ? defaultRaceSettings.winnersRaceTo : 1),
      format === 'MODIFIED_ELIMINATION' ? defaultRaceSettings.winnersRaceTo : 1
    ),
    losersRaceTo: clampRaceValue(
      tournament.losersRaceTo ?? (format === 'MODIFIED_ELIMINATION' ? defaultRaceSettings.losersRaceTo : 1),
      format === 'MODIFIED_ELIMINATION' ? defaultRaceSettings.losersRaceTo : 1
    ),
    raceShiftStartRound: normalizeRaceShiftStartRound(
      tournament.raceShiftStartRound ?? defaultRaceSettings.raceShiftStartRound
    ),
    winnersRaceToAfterShift: clampRaceValue(
      tournament.winnersRaceToAfterShift ??
        (format === 'MODIFIED_ELIMINATION' ? defaultRaceSettings.winnersRaceToAfterShift : 1),
      format === 'MODIFIED_ELIMINATION' ? defaultRaceSettings.winnersRaceToAfterShift : 1
    ),
    losersRaceToAfterShift: clampRaceValue(
      tournament.losersRaceToAfterShift ??
        (format === 'MODIFIED_ELIMINATION' ? defaultRaceSettings.losersRaceToAfterShift : 1),
      format === 'MODIFIED_ELIMINATION' ? defaultRaceSettings.losersRaceToAfterShift : 1
    ),
    payouts: Array.isArray(tournament.payouts) ? tournament.payouts : [],
    location: typeof tournament.location === 'string' && tournament.location.trim().length > 0 ? tournament.location.trim() : undefined,
    venueId: typeof tournament.venueId === 'string' && tournament.venueId.trim().length > 0 ? tournament.venueId : null,
    venueName: typeof tournament.venueName === 'string' && tournament.venueName.trim().length > 0 ? tournament.venueName.trim() : undefined,
    date: typeof tournament.date === 'string' && tournament.date ? tournament.date : undefined,
    createdAt: String(tournament.createdAt ?? new Date().toISOString()),
    updatedAt: String(tournament.updatedAt ?? new Date().toISOString())
  };
}

// In-memory database
class TournamentDatabase {
  private tournaments = new Map<string, Tournament>();
  private storageKey = 'tdiab_tournaments';

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    if (typeof window === 'undefined') return;
    try {
      const data = localStorage.getItem(this.storageKey);
      if (data) {
        const tournaments = JSON.parse(data);
        if (Array.isArray(tournaments)) {
          tournaments.forEach((t) => {
            const normalized = normalizeTournament(t);
            if (normalized) this.tournaments.set(normalized.id, normalized);
          });
        }
      }
    } catch (error) {
      console.error('Failed to load tournaments from storage:', error);
    }
  }

  private saveToStorage() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(Array.from(this.tournaments.values())));
    } catch (error) {
      console.error('Failed to save tournaments to storage:', error);
    }
  }

  create(
    name: string,
    format: TournamentFormat,
    config: {
      entryFee?: number;
      greenFee?: number;
      payoutPositions?: number;
      isTemplate?: boolean;
      tableCount?: number;
      seedingMethod?: TournamentSeedMode;
      winnersRaceTo?: number;
      losersRaceTo?: number;
      raceShiftStartRound?: number | null;
      winnersRaceToAfterShift?: number;
      losersRaceToAfterShift?: number;
      location?: string;
      venueId?: string | null;
      venueName?: string;
      date?: string;
    } = {}
  ): Tournament {
    const defaultRaceSettings = getDefaultRaceSettingsForFormat(format);
    const tournament: Tournament = {
      id: uuidv4(),
      name,
      format,
      status: 'DRAFT',
      seedingMethod: config.seedingMethod ?? 'ENTERED',
      tableCount: Number(config.tableCount ?? 0),
      isTemplate: Boolean(config.isTemplate),
      players: [],
      matches: [],
      bracketGenerated: false,
      entryFee: config.entryFee ?? 0,
      greenFee: config.greenFee ?? 0,
      payoutPositions: config.payoutPositions ?? 3,
      payoutPercentages: buildDefaultPayoutPercentages(config.payoutPositions ?? 3),
      winnersRaceTo:
        format === 'MODIFIED_ELIMINATION'
          ? clampRaceValue(config.winnersRaceTo ?? defaultRaceSettings.winnersRaceTo, defaultRaceSettings.winnersRaceTo)
          : 1,
      losersRaceTo:
        format === 'MODIFIED_ELIMINATION'
          ? clampRaceValue(config.losersRaceTo ?? defaultRaceSettings.losersRaceTo, defaultRaceSettings.losersRaceTo)
          : 1,
      raceShiftStartRound:
        format === 'MODIFIED_ELIMINATION'
          ? normalizeRaceShiftStartRound(config.raceShiftStartRound ?? defaultRaceSettings.raceShiftStartRound)
          : null,
      winnersRaceToAfterShift:
        format === 'MODIFIED_ELIMINATION'
          ? clampRaceValue(
              config.winnersRaceToAfterShift ?? defaultRaceSettings.winnersRaceToAfterShift,
              defaultRaceSettings.winnersRaceToAfterShift
            )
          : 1,
      losersRaceToAfterShift:
        format === 'MODIFIED_ELIMINATION'
          ? clampRaceValue(
              config.losersRaceToAfterShift ?? defaultRaceSettings.losersRaceToAfterShift,
              defaultRaceSettings.losersRaceToAfterShift
            )
          : 1,
      payouts: [],
      location: typeof config.location === 'string' && config.location.trim().length > 0 ? config.location.trim() : undefined,
      venueId: typeof config.venueId === 'string' && config.venueId.trim().length > 0 ? config.venueId : null,
      venueName: typeof config.venueName === 'string' && config.venueName.trim().length > 0 ? config.venueName.trim() : undefined,
      date: typeof config.date === 'string' && config.date ? config.date : new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const calculated = TournamentEngine.calculatePayouts(tournament);
    tournament.payouts = calculated.payouts;
    this.tournaments.set(tournament.id, tournament);
    this.saveToStorage();
    return tournament;
  }

  getAll(): Tournament[] {
    return Array.from(this.tournaments.values())
      .map((t) => normalizeTournament(t))
      .filter((t): t is Tournament => Boolean(t))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  getById(id: string): Tournament | undefined {
    const tournament = this.tournaments.get(id);
    return tournament ? normalizeTournament(tournament) ?? undefined : undefined;
  }

  update(tournament: Tournament): Tournament {
    const normalized = normalizeTournament(tournament) ?? tournament;
    normalized.updatedAt = new Date().toISOString();
    this.tournaments.set(normalized.id, normalized);
    this.saveToStorage();
    return normalized;
  }

  delete(id: string): void {
    this.tournaments.delete(id);
    this.saveToStorage();
  }
}

export const db = new TournamentDatabase();

// Tournament Engine
export class TournamentEngine {
  static addPlayer(tournament: Tournament, playerName: string): Tournament {
    if (tournament.bracketGenerated) {
      throw new Error('Cannot add players after bracket is generated');
    }

    const player: Player = {
      id: uuidv4(),
      displayName: playerName,
      entryOrder: tournament.players.length + 1,
      seed: tournament.players.length + 1,
      status: 'REGISTERED',
      wins: 0,
      losses: 0,
      eliminated: false,
      identityMode: 'UNRESOLVED',
      universalProfileId: null
    };

    const updated = {
      ...tournament,
      players: [...tournament.players, player]
    };
    const calculated = this.calculatePayouts(updated);
    return db.update({
      ...updated,
      payouts: calculated.payouts
    });
  }

  static removePlayer(tournament: Tournament, playerId: string): Tournament {
    if (tournament.bracketGenerated) {
      throw new Error('Cannot remove players after bracket is generated');
    }

    const remainingPlayers = tournament.players
      .filter((p) => p.id !== playerId)
      .sort((a, b) => a.entryOrder - b.entryOrder)
      .map((player, index) => ({ ...player, seed: index + 1 }));

    const updated = {
      ...tournament,
      players: remainingPlayers
    };
    const calculated = this.calculatePayouts(updated);
    return db.update({
      ...updated,
      payouts: calculated.payouts
    });
  }

  static reorderPlayers(
    tournament: Tournament,
    orderedPlayerIds: string[],
    seedingMethod: TournamentSeedMode = tournament.seedingMethod
  ): Tournament {
    if (tournament.bracketGenerated) {
      throw new Error('Cannot reorder players after bracket is generated');
    }

    const playerMap = new Map(tournament.players.map((player) => [player.id, player]));
    const uniqueIds = Array.from(new Set(orderedPlayerIds)).filter((id) => playerMap.has(id));
    const missingIds = tournament.players.map((p) => p.id).filter((id) => !uniqueIds.includes(id));
    const finalOrder = [...uniqueIds, ...missingIds];

    const reorderedPlayers = finalOrder
      .map((id) => playerMap.get(id))
      .filter((player): player is Player => Boolean(player))
      .map((player, index) => ({
        ...player,
        seed: index + 1
      }));

    return db.update({
      ...tournament,
      seedingMethod,
      players: reorderedPlayers
    });
  }

  static generateBracket(tournament: Tournament): Tournament {
    if (tournament.players.length < 2) {
      throw new Error('At least 2 players required');
    }

    if (tournament.bracketGenerated) {
      throw new Error('Bracket already generated');
    }

    const matches = this.buildSingleEliminationBracket(tournament.players);
    const updated = {
      ...tournament,
      matches,
      bracketGenerated: true,
      status: 'READY'
    };
    const calculated = this.calculatePayouts(updated);

    return db.update({
      ...updated,
      payouts: calculated.payouts
    });
  }

  static startTournament(tournament: Tournament): Tournament {
    if (!tournament.bracketGenerated) {
      throw new Error('Generate bracket first');
    }

    const refreshedMatches = this.refreshFutureMatches(tournament.matches.map((match) => ({
      ...match,
      entrants: Array.isArray(match.entrants) ? [...match.entrants.filter(Boolean)] : []
    })), tournament.tableCount);
    const withPayouts = TournamentEngine.calculatePayouts(tournament);
    return db.update({
      ...tournament,
      matches: refreshedMatches,
      payouts: withPayouts.payouts,
      status: 'ACTIVE'
    });
  }

  static calculatePayouts(tournament: Tournament): { totalPool: number; payouts: PayoutBreakdown[] } {
    const playerCount = Math.max(tournament.players.length, 0);
    const totalPool = calculatePrizeContributionPerPlayer(tournament.entryFee, tournament.greenFee) * playerCount;
    const totalPoolDollars = Math.max(0, Math.round(totalPool));

    if (playerCount === 0 || totalPoolDollars <= 0 || tournament.payoutPositions <= 0) {
      return { totalPool: 0, payouts: [] };
    }

    const payoutPercentages = normalizePayoutPercentages(
      tournament.payoutPercentages,
      Math.max(1, tournament.payoutPositions)
    );

    const weightedPayouts = payoutPercentages.map((percentageValue, index) => {
      const position = index + 1;
      const percentage = percentageValue / 100;
      const amount = totalPoolDollars * percentage;
      return { position, percentage, amount };
    });

    const wholeDollarPayouts = weightedPayouts.map((payout) => ({
      ...payout,
      amount: Math.floor(payout.amount)
    }));

    const distributed = wholeDollarPayouts.reduce((sum, payout) => sum + payout.amount, 0);
    const remainder = Math.max(0, totalPoolDollars - distributed);
    if (wholeDollarPayouts.length > 0) {
      wholeDollarPayouts[0] = {
        ...wholeDollarPayouts[0],
        amount: wholeDollarPayouts[0].amount + remainder
      };
    }

    const payouts = wholeDollarPayouts.map((payout) => ({
      position: payout.position,
      percentage: payout.amount / totalPoolDollars,
      amount: payout.amount
    }));

    return { totalPool: totalPoolDollars, payouts };
  }

  static completeMatch(tournament: Tournament, matchId: string, winnerId: string, score: string = ''): Tournament {
    const match = tournament.matches.find((m) => m.id === matchId);
    if (!match) throw new Error('Match not found');

    if (!winnerId || !Array.isArray(match.entrants) || !match.entrants.includes(winnerId)) {
      throw new Error('Invalid match winner');
    }

    const winner = tournament.players.find((p) => p.id === winnerId);
    if (!winner) throw new Error('Winner not found');

    if (match.state === 'COMPLETE') {
      return tournament;
    }

    const loser = match.entrants.find((id) => id !== winnerId) ?? null;

    const updatedMatches = tournament.matches.map((m) =>
      m.id === matchId
        ? {
            ...m,
            entrants: Array.isArray(m.entrants) ? [...m.entrants] : [],
            state: 'COMPLETE' as const,
            winnerId,
            loserId: loser,
            result: { winnerId, loserId: loser, score }
          }
        : {
            ...m,
            entrants: Array.isArray(m.entrants) ? [...m.entrants.filter(Boolean)] : []
          }
    );

    const updatedPlayers = tournament.players.map((p) => {
      if (p.id === winnerId) {
        return { ...p, wins: p.wins + 1, status: 'ACTIVE' as const, eliminated: false };
      }
      if (p.id === loser) {
        return { ...p, losses: p.losses + 1, eliminated: true, status: 'ELIMINATED' as const };
      }
      return p;
    });

    const nextMatches = this.refreshFutureMatches(updatedMatches, tournament.tableCount);
    let finalStatus = tournament.status === 'READY' ? 'ACTIVE' : tournament.status;

    const maxRound = Math.max(...nextMatches.map((m) => m.round));
    const finalMatch = nextMatches.find((m) => m.round === maxRound && m.slot === 0);
    const championId = finalMatch ? this.getMatchWinner(finalMatch) : null;
    if (championId && (finalMatch?.state === 'COMPLETE' || finalMatch?.state === 'BYE')) {
      finalStatus = 'COMPLETED';
    }

    const activePlayers = updatedPlayers.filter((p) => !p.eliminated);
    if (activePlayers.length <= 1 && finalStatus !== 'COMPLETED') {
      finalStatus = 'COMPLETED';
    }

    const finalTournament = {
      ...tournament,
      matches: nextMatches,
      players: updatedPlayers,
      status: finalStatus
    };
    const calculated = this.calculatePayouts(finalTournament);

    return db.update({
      ...finalTournament,
      payouts: calculated.payouts
    });
  }

  private static buildSingleEliminationBracket(players: Player[]): Match[] {
    const matches: Match[] = [];
    const playerIds = players.map((p) => p.id);

    // Build round one from seeded player order.
    for (let i = 0; i < playerIds.length; i += 2) {
      const entrants = [playerIds[i], playerIds[i + 1]].filter(Boolean);
      matches.push({
        id: uuidv4(),
        round: 1,
        slot: i / 2,
        entrants,
        winnerId: entrants.length === 1 ? entrants[0] : null,
        loserId: null,
        state: entrants.length === 1 ? 'BYE' : 'PENDING',
        result: null
      });
    }

    let previousRoundCount = matches.length;
    let round = 2;
    while (previousRoundCount > 1) {
      const roundCount = Math.ceil(previousRoundCount / 2);
      for (let slot = 0; slot < roundCount; slot += 1) {
        matches.push({
          id: uuidv4(),
          round,
          slot,
          entrants: [],
          winnerId: null,
          loserId: null,
          state: 'PENDING',
          result: null
        });
      }
      previousRoundCount = roundCount;
      round += 1;
    }

    return this.refreshFutureMatches(matches);
  }

  private static getMatchWinner(match: Match): string | null {
    if (match.state === 'COMPLETE') return match.winnerId;
    if (match.state === 'BYE') return match.winnerId ?? match.entrants[0] ?? null;
    return null;
  }

  private static refreshFutureMatches(matches: Match[], tableCount = 0): Match[] {
    const updated = matches.map((match) => ({
      ...match,
      entrants: Array.isArray(match.entrants) ? [...match.entrants.filter(Boolean)] : []
    }));
    const maxRound = Math.max(...updated.map((m) => m.round), 1);

    for (let round = 2; round <= maxRound; round += 1) {
      const roundMatches = updated.filter((m) => m.round === round).sort((a, b) => a.slot - b.slot);
      for (let index = 0; index < roundMatches.length; index += 1) {
        const match = roundMatches[index];
        if (match.state === 'COMPLETE') continue;

        const feederA = updated.find((m) => m.round === round - 1 && m.slot === match.slot * 2);
        const feederB = updated.find((m) => m.round === round - 1 && m.slot === (match.slot * 2) + 1);
        const winnerA = feederA ? this.getMatchWinner(feederA) : null;
        const winnerB = feederB ? this.getMatchWinner(feederB) : null;

        const entrants = [winnerA, winnerB].filter((id): id is string => Boolean(id));
        const nextMatch: Match = {
          ...match,
          entrants,
          state: 'PENDING',
          winnerId: null,
          loserId: null,
          result: null
        };

        if (entrants.length === 2) {
          updated[updated.indexOf(match)] = nextMatch;
          continue;
        }

        if (entrants.length === 1) {
          const missingFeeder = !feederA || !feederB;
          updated[updated.indexOf(match)] = {
            ...nextMatch,
            state: missingFeeder ? 'BYE' : 'PENDING',
            winnerId: missingFeeder ? entrants[0] : null,
            loserId: null,
            result: null
          };
          continue;
        }

        updated[updated.indexOf(match)] = nextMatch;
      }
    }

    if (tableCount > 0) {
      const tableLimit = Math.max(1, Math.floor(tableCount));
      const schedulableMatches = updated
        .filter(
          (match) =>
            match.entrants.length === 2 &&
            match.state !== 'COMPLETE' &&
            match.state !== 'BYE'
        )
        .sort((a, b) => (a.round === b.round ? a.slot - b.slot : a.round - b.round));

      const inProgressMatches = schedulableMatches.filter((match) => match.state === 'IN_PROGRESS');
      const inProgressIds = new Set(inProgressMatches.map((match) => match.id));
      const openTableSlots = Math.max(0, tableLimit - inProgressMatches.length);
      const readyIds = new Set<string>();

      for (const match of schedulableMatches) {
        if (inProgressIds.has(match.id)) continue;
        if (readyIds.size < openTableSlots) {
          readyIds.add(match.id);
        }
      }

      for (let index = 0; index < updated.length; index += 1) {
        const match = updated[index];
        if (match.state === 'COMPLETE' || match.state === 'BYE' || match.entrants.length !== 2 || inProgressIds.has(match.id)) {
          continue;
        }
        updated[index] = {
          ...match,
          state: readyIds.has(match.id) ? 'READY' : 'PENDING'
        };
      }
    }

    return updated;
  }
}
