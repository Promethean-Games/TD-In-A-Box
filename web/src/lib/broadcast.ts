import type { Tournament } from '@/lib/tournament';
import { getPublicAssetPath } from '@/lib/appPaths';

export type BroadcastStatus = 'LIVE' | 'STANDBY' | 'UP_NEXT';

export interface BroadcastPlayerScore {
  id: string;
  name: string;
  score: number;
}

export interface BroadcastChannel {
  id: string;
  number: string;
  name: string;
  status: BroadcastStatus;
  now: string;
  next: string;
  route: string;
  venue: string;
  location: string;
  format: string;
  round: string;
  watching: number;
  players: [BroadcastPlayerScore, BroadcastPlayerScore];
}

export interface TdtvLoopSlide {
  id: string;
  title: string;
  body: string;
  logoDataUrl?: string;
}

export interface BroadcastCameraSource {
  id: string;
  name: string;
  type: 'WIFI' | 'USB' | 'OBS' | 'NETWORK';
  connection: 'Strong' | 'Medium' | 'Weak';
  streamUrl?: string;
}

export interface BroadcastSponsorCard {
  id: string;
  name: string;
  durationSeconds: number;
  enabled: boolean;
  marketingBlip?: string;
  logoDataUrl?: string;
  permanent?: boolean;
}

export type BroadcastTimingSlotKind = 'SPONSOR' | 'LEADERBOARD' | 'RACE' | 'CUSTOM';

export interface BroadcastTimingSlot {
  id: string;
  label: string;
  kind: BroadcastTimingSlotKind;
  durationSeconds: number;
  enabled: boolean;
  permanent?: boolean;
}

export interface BroadcastRuntimeConfig {
  cameraId: string;
  channelId: string;
  cameraList: BroadcastCameraSource[];
  connectedCameraIds: string[];
  cameraTableMap: Record<string, number>;
  sponsorCards: BroadcastSponsorCard[];
  timingSlots: BroadcastTimingSlot[];
  overlayDurationSeconds: number;
  autoRotateSponsors: boolean;
  raceTrackingEnabled: boolean;
  winnersRaceTo: number;
  losersRaceTo: number;
  streamStatus: BroadcastStatus;
}

export interface BroadcastPublication {
  channelId: string;
  channelNumber: string;
  channelName: string;
  tournamentId: string;
  tournamentName: string;
  status: BroadcastStatus;
  now: string;
  next: string;
  venue: string;
  location: string;
  format: string;
  round: string;
  players: [BroadcastPlayerScore, BroadcastPlayerScore];
  cameraId: string;
  cameraName: string;
  cameraType: BroadcastCameraSource['type'];
  streamUrl?: string;
  tableNumber?: number | null;
  updatedAt: string;
}

export const PROMETHEAN_SPONSOR_ID = 'promethean-games';
export const TDTV_NETWORK_SPONSOR_ID = 'tdtv-network';
export const TDTV_LOOP_CHANNEL_ID = 'channel-00-loop';
const TDTV_LOOP_SECONDS = 60;
const TDTV_LOOP_SLIDE_SECONDS = 15;
const PERMANENT_SPONSOR_DEFAULT_DURATION = 15;
const PERMANENT_SPONSOR_MIN_DURATION = 5;
const SYSTEM_SPONSOR_DEFAULTS_STORAGE_KEY = 'tdiab_system_sponsor_defaults';
const BROADCAST_PUBLICATIONS_STORAGE_KEY = 'tdiab_broadcast_publications';
const BROADCAST_PUBLICATIONS_EVENT = 'tdiab:broadcast-publications-changed';
const BROADCAST_STREAM_REGISTRY_KEY = '__tdiabBroadcastStreamRegistry';

export const DEFAULT_BROADCAST_CAMERA_SOURCES: BroadcastCameraSource[] = [];

export const DEFAULT_BROADCAST_SPONSOR_CARDS: BroadcastSponsorCard[] = [
  {
    id: TDTV_NETWORK_SPONSOR_ID,
    name: 'TDTV Network',
    durationSeconds: PERMANENT_SPONSOR_DEFAULT_DURATION,
    enabled: true,
    permanent: true,
    marketingBlip:
      'Thanks for watching — and thanks to the TDs & venues making live pool possible. Want your tournament on TDTV? Ask about TDIAB.',
    logoDataUrl: getPublicAssetPath('images/tdtv-network-logo.png')
  },
  {
    id: PROMETHEAN_SPONSOR_ID,
    name: 'Promethean Games',
    durationSeconds: PERMANENT_SPONSOR_DEFAULT_DURATION,
    enabled: true,
    permanent: true,
    marketingBlip: 'We build tools, games & experiences for the people who love pool. Thanks for watching.',
    logoDataUrl: getPublicAssetPath('images/promethean-games-logo.png')
  }
];

export function createDefaultBroadcastTimingSlots(): BroadcastTimingSlot[] {
  return [
    {
      id: 'leaderboard-bracket-overlay',
      label: 'Leaderboard / Bracket Overlay',
      kind: 'LEADERBOARD',
      durationSeconds: 15,
      enabled: true,
      permanent: true
    },
    {
      id: 'race-lower-third-overlay',
      label: 'Race Lower-Third',
      kind: 'RACE',
      durationSeconds: 30,
      enabled: true,
      permanent: true
    },
    ...DEFAULT_BROADCAST_SPONSOR_CARDS.map((sponsor) => ({
      id: `slot-${sponsor.id}`,
      label: `${sponsor.name} Sponsor Slot`,
      kind: 'SPONSOR' as const,
      durationSeconds: sponsor.durationSeconds,
      enabled: sponsor.enabled,
      permanent: sponsor.permanent ?? false
    }))
  ];
}

function getPermanentSponsorDefaults(id: string | undefined): BroadcastSponsorCard | null {
  if (!id) return null;
  return getSystemBroadcastSponsorDefaults().find((card) => card.id === id) ?? null;
}

function normalizeSystemPermanentSponsorCard(
  fallbackCard: BroadcastSponsorCard,
  storedCard?: Partial<BroadcastSponsorCard> | null
): BroadcastSponsorCard {
  return {
    ...fallbackCard,
    id: fallbackCard.id,
    name:
      typeof storedCard?.name === 'string' && storedCard.name.trim().length > 0
        ? storedCard.name
        : fallbackCard.name,
    durationSeconds: Math.max(
      PERMANENT_SPONSOR_MIN_DURATION,
      Number(storedCard?.durationSeconds ?? fallbackCard.durationSeconds) || fallbackCard.durationSeconds
    ),
    enabled: true,
    permanent: true,
    marketingBlip:
      typeof storedCard?.marketingBlip === 'string' && storedCard.marketingBlip.trim().length > 0
        ? storedCard.marketingBlip
        : fallbackCard.marketingBlip,
    logoDataUrl:
      typeof storedCard?.logoDataUrl === 'string' && storedCard.logoDataUrl.trim().length > 0
        ? storedCard.logoDataUrl
        : fallbackCard.logoDataUrl
  };
}

export function getSystemBroadcastSponsorDefaults(): BroadcastSponsorCard[] {
  if (typeof window === 'undefined') {
    return DEFAULT_BROADCAST_SPONSOR_CARDS.map((card) => ({ ...card }));
  }

  const raw = window.localStorage.getItem(SYSTEM_SPONSOR_DEFAULTS_STORAGE_KEY);
  if (!raw) {
    return DEFAULT_BROADCAST_SPONSOR_CARDS.map((card) => ({ ...card }));
  }

  try {
    const parsed = JSON.parse(raw) as Partial<BroadcastSponsorCard>[];
    return DEFAULT_BROADCAST_SPONSOR_CARDS.map((fallbackCard) =>
      normalizeSystemPermanentSponsorCard(
        fallbackCard,
        Array.isArray(parsed) ? parsed.find((card) => card.id === fallbackCard.id) : null
      )
    );
  } catch {
    return DEFAULT_BROADCAST_SPONSOR_CARDS.map((card) => ({ ...card }));
  }
}

export function saveSystemBroadcastSponsorDefaults(cards: BroadcastSponsorCard[]): BroadcastSponsorCard[] {
  const normalizedCards = DEFAULT_BROADCAST_SPONSOR_CARDS.map((fallbackCard) =>
    normalizeSystemPermanentSponsorCard(
      fallbackCard,
      cards.find((card) => card.id === fallbackCard.id)
    )
  );

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SYSTEM_SPONSOR_DEFAULTS_STORAGE_KEY, JSON.stringify(normalizedCards));
  }

  return normalizedCards;
}

function normalizeSponsorCard(card: Partial<BroadcastSponsorCard>): BroadcastSponsorCard {
  const permanentDefaults = getPermanentSponsorDefaults(typeof card.id === 'string' ? card.id : undefined);
  const isPermanent = Boolean(permanentDefaults) || Boolean(card.permanent);
  const fallbackName = isPermanent ? permanentDefaults?.name ?? 'Sponsor' : 'Sponsor';
  const nextMarketingBlip =
    isPermanent
      ? permanentDefaults?.marketingBlip ?? ''
      : typeof card.marketingBlip === 'string' && card.marketingBlip.trim().length > 0
        ? card.marketingBlip
        : '';
  const nextLogo =
    isPermanent
      ? permanentDefaults?.logoDataUrl ?? ''
      : typeof card.logoDataUrl === 'string' && card.logoDataUrl.trim().length > 0
        ? card.logoDataUrl
        : '';
  return {
    id: String(card.id ?? `sponsor-${Date.now()}`),
    name: isPermanent ? fallbackName : String(card.name ?? fallbackName),
    durationSeconds: Math.max(
      isPermanent ? PERMANENT_SPONSOR_MIN_DURATION : 3,
      Number(card.durationSeconds ?? (isPermanent ? PERMANENT_SPONSOR_DEFAULT_DURATION : 8))
    ),
    enabled: isPermanent ? true : Boolean(card.enabled ?? true),
    permanent: isPermanent,
    marketingBlip: nextMarketingBlip,
    logoDataUrl: nextLogo
  };
}

function ensurePermanentSponsors(cards: BroadcastSponsorCard[]): BroadcastSponsorCard[] {
  const normalized = cards.map((card) => normalizeSponsorCard(card));
  const nextCards = [...normalized];
  const permanentDefaults = getSystemBroadcastSponsorDefaults();

  for (const permanentDefault of permanentDefaults) {
    const existingIndex = nextCards.findIndex((card) => card.id === permanentDefault.id);
    if (existingIndex < 0) {
      nextCards.push(normalizeSponsorCard(permanentDefault));
      continue;
    }
    nextCards[existingIndex] = normalizeSponsorCard({
      ...nextCards[existingIndex],
      id: permanentDefault.id,
      permanent: true
    });
  }

  return nextCards.sort((a, b) => {
    const aIndex = DEFAULT_BROADCAST_SPONSOR_CARDS.findIndex((card) => card.id === a.id);
    const bIndex = DEFAULT_BROADCAST_SPONSOR_CARDS.findIndex((card) => card.id === b.id);
    return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex);
  });
}

export function createDefaultBroadcastRuntimeConfig(): BroadcastRuntimeConfig {
  return {
    cameraId: '',
    channelId: '',
    cameraList: DEFAULT_BROADCAST_CAMERA_SOURCES,
    connectedCameraIds: [],
    cameraTableMap: {},
    sponsorCards: ensurePermanentSponsors(getSystemBroadcastSponsorDefaults()),
    timingSlots: createDefaultBroadcastTimingSlots(),
    overlayDurationSeconds: 8,
    autoRotateSponsors: true,
    raceTrackingEnabled: false,
    winnersRaceTo: 1,
    losersRaceTo: 1,
    streamStatus: 'STANDBY'
  };
}

export function getBroadcastRuntimeConfig(): BroadcastRuntimeConfig {
  const fallback = createDefaultBroadcastRuntimeConfig();

  if (typeof window === 'undefined') return fallback;

  const raw = window.localStorage.getItem('tdiab_broadcast_runtime_config');
  if (!raw) {
    window.localStorage.setItem('tdiab_broadcast_runtime_config', JSON.stringify(fallback));
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<BroadcastRuntimeConfig>;
    const nextCameraList = Array.isArray(parsed.cameraList) && parsed.cameraList.length > 0 ? parsed.cameraList : fallback.cameraList;
    const nextSponsorCards = Array.isArray(parsed.sponsorCards) && parsed.sponsorCards.length > 0 ? parsed.sponsorCards : fallback.sponsorCards;
    const nextConnectedCameraIds = Array.isArray(parsed.connectedCameraIds)
      ? parsed.connectedCameraIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : fallback.connectedCameraIds;
    const nextCameraTableMap =
      parsed.cameraTableMap && typeof parsed.cameraTableMap === 'object'
        ? Object.fromEntries(
            Object.entries(parsed.cameraTableMap).map(([cameraId, tableValue]) => [
              cameraId,
              Math.max(1, Math.floor(Number(tableValue) || 1))
            ])
          )
        : fallback.cameraTableMap;

    const nextTimingSlots = Array.isArray(parsed.timingSlots) && parsed.timingSlots.length > 0
      ? parsed.timingSlots.map((slot) => ({
          id: typeof slot.id === 'string' ? slot.id : `slot-${Date.now()}-${Math.random()}`,
          label: typeof slot.label === 'string' && slot.label.trim().length > 0 ? slot.label : 'Overlay Slot',
          kind: slot.kind === 'SPONSOR' || slot.kind === 'LEADERBOARD' || slot.kind === 'RACE' || slot.kind === 'CUSTOM' ? slot.kind : 'CUSTOM',
          durationSeconds: typeof slot.durationSeconds === 'number' ? Math.max(5, slot.durationSeconds) : 15,
          enabled: Boolean(slot.enabled ?? true),
          permanent: Boolean(slot.permanent ?? (slot.kind === 'LEADERBOARD' || slot.kind === 'RACE'))
        }))
      : fallback.timingSlots;

    return {
      cameraId: typeof parsed.cameraId === 'string' ? parsed.cameraId : nextCameraList[0]?.id ?? fallback.cameraId,
      channelId: typeof parsed.channelId === 'string' ? parsed.channelId : fallback.channelId,
      cameraList: nextCameraList,
      connectedCameraIds: nextConnectedCameraIds,
      cameraTableMap: nextCameraTableMap,
      sponsorCards: ensurePermanentSponsors(nextSponsorCards.map((card) => normalizeSponsorCard(card))),
      timingSlots: nextTimingSlots,
      overlayDurationSeconds: typeof parsed.overlayDurationSeconds === 'number' ? Math.max(1, parsed.overlayDurationSeconds) : fallback.overlayDurationSeconds,
      autoRotateSponsors: Boolean(parsed.autoRotateSponsors ?? fallback.autoRotateSponsors),
      raceTrackingEnabled: Boolean(parsed.raceTrackingEnabled ?? fallback.raceTrackingEnabled),
      winnersRaceTo: typeof parsed.winnersRaceTo === 'number' ? Math.max(1, parsed.winnersRaceTo) : fallback.winnersRaceTo,
      losersRaceTo: typeof parsed.losersRaceTo === 'number' ? Math.max(1, parsed.losersRaceTo) : fallback.losersRaceTo,
      streamStatus: parsed.streamStatus === 'STANDBY' || parsed.streamStatus === 'UP_NEXT' || parsed.streamStatus === 'LIVE' ? parsed.streamStatus : fallback.streamStatus
    };
  } catch {
    return fallback;
  }
}

export function saveBroadcastRuntimeConfig(config: BroadcastRuntimeConfig): BroadcastRuntimeConfig {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('tdiab_broadcast_runtime_config', JSON.stringify(config));
  }
  return config;
}

function normalizeBroadcastPlayer(player: Partial<BroadcastPlayerScore> | null | undefined, fallbackName: string): BroadcastPlayerScore {
  return {
    id: typeof player?.id === 'string' ? player.id : '',
    name: typeof player?.name === 'string' && player.name.trim().length > 0 ? player.name : fallbackName,
    score: Math.max(0, Math.floor(Number(player?.score ?? 0) || 0))
  };
}

function normalizeBroadcastPublication(raw: Partial<BroadcastPublication> | null | undefined): BroadcastPublication | null {
  if (!raw || typeof raw.channelId !== 'string' || raw.channelId.trim().length === 0) return null;
  const fallbackNow = typeof raw.tournamentName === 'string' && raw.tournamentName.trim().length > 0
    ? raw.tournamentName
    : 'Tournament stream';
  return {
    channelId: raw.channelId,
    channelNumber: typeof raw.channelNumber === 'string' && raw.channelNumber.trim().length > 0 ? raw.channelNumber : '00',
    channelName: typeof raw.channelName === 'string' && raw.channelName.trim().length > 0 ? raw.channelName : 'TDTV Channel',
    tournamentId: typeof raw.tournamentId === 'string' ? raw.tournamentId : '',
    tournamentName: typeof raw.tournamentName === 'string' && raw.tournamentName.trim().length > 0 ? raw.tournamentName : 'Tournament',
    status: raw.status === 'LIVE' || raw.status === 'UP_NEXT' || raw.status === 'STANDBY' ? raw.status : 'STANDBY',
    now: typeof raw.now === 'string' && raw.now.trim().length > 0 ? raw.now : fallbackNow,
    next: typeof raw.next === 'string' ? raw.next : 'Awaiting next match',
    venue: typeof raw.venue === 'string' && raw.venue.trim().length > 0 ? raw.venue : 'Promethean Venue',
    location: typeof raw.location === 'string' && raw.location.trim().length > 0 ? raw.location : 'Local Event',
    format: typeof raw.format === 'string' && raw.format.trim().length > 0 ? raw.format : 'Tournament',
    round: typeof raw.round === 'string' && raw.round.trim().length > 0 ? raw.round : 'Live',
    players: [
      normalizeBroadcastPlayer(raw.players?.[0], 'Player 1'),
      normalizeBroadcastPlayer(raw.players?.[1], 'Player 2')
    ],
    cameraId: typeof raw.cameraId === 'string' ? raw.cameraId : '',
    cameraName: typeof raw.cameraName === 'string' && raw.cameraName.trim().length > 0 ? raw.cameraName : 'Camera',
    cameraType: raw.cameraType === 'WIFI' || raw.cameraType === 'USB' || raw.cameraType === 'OBS' || raw.cameraType === 'NETWORK'
      ? raw.cameraType
      : 'WIFI',
    streamUrl: typeof raw.streamUrl === 'string' && raw.streamUrl.trim().length > 0 ? raw.streamUrl : undefined,
    tableNumber: typeof raw.tableNumber === 'number' ? Math.max(1, Math.floor(raw.tableNumber)) : null,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt.trim().length > 0 ? raw.updatedAt : new Date().toISOString()
  };
}

function publicationToChannel(publication: BroadcastPublication): BroadcastChannel {
  return {
    id: publication.channelId,
    number: publication.channelNumber,
    name: publication.channelName,
    status: publication.status,
    now: publication.now,
    next: publication.next,
    route: `/tdtv/channel/${publication.channelId}`,
    venue: publication.venue,
    location: publication.location,
    format: publication.format,
    round: publication.round,
    watching: 155,
    players: publication.players
  };
}

function readBroadcastPublications(): BroadcastPublication[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(BROADCAST_PUBLICATIONS_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<BroadcastPublication>[];
    return Array.isArray(parsed)
      ? parsed.map((entry) => normalizeBroadcastPublication(entry)).filter((entry): entry is BroadcastPublication => Boolean(entry))
      : [];
  } catch {
    return [];
  }
}

function writeBroadcastPublications(entries: BroadcastPublication[]): BroadcastPublication[] {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(BROADCAST_PUBLICATIONS_STORAGE_KEY, JSON.stringify(entries));
    window.dispatchEvent(new Event(BROADCAST_PUBLICATIONS_EVENT));
  }
  return entries;
}

export function getBroadcastPublications(): BroadcastPublication[] {
  return readBroadcastPublications()
    .slice()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function getBroadcastPublicationByChannelId(channelId?: string | null): BroadcastPublication | null {
  if (!channelId) return null;
  return getBroadcastPublications().find((publication) => publication.channelId === channelId) ?? null;
}

export function getBroadcastPublicationByTournamentId(tournamentId?: string | null): BroadcastPublication | null {
  if (!tournamentId) return null;
  return getBroadcastPublications().find((publication) => publication.tournamentId === tournamentId) ?? null;
}

export function saveBroadcastPublication(publication: BroadcastPublication): BroadcastPublication {
  const normalized = normalizeBroadcastPublication(publication);
  if (!normalized) {
    throw new Error('Cannot save broadcast publication without a valid channelId.');
  }
  const existing = readBroadcastPublications().filter((entry) => entry.channelId !== normalized.channelId);
  writeBroadcastPublications([normalized, ...existing]);
  return normalized;
}

export function clearBroadcastPublication(channelId: string): void {
  if (!channelId) return;
  const next = readBroadcastPublications().filter((entry) => entry.channelId !== channelId);
  writeBroadcastPublications(next);
  clearPublishedBroadcastLiveStream(channelId);
}

export function subscribeToBroadcastPublications(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handleBroadcastUpdate = () => onChange();
  const handleStorage = (event: StorageEvent) => {
    if (!event.key || event.key === BROADCAST_PUBLICATIONS_STORAGE_KEY) {
      onChange();
    }
  };
  window.addEventListener(BROADCAST_PUBLICATIONS_EVENT, handleBroadcastUpdate);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(BROADCAST_PUBLICATIONS_EVENT, handleBroadcastUpdate);
    window.removeEventListener('storage', handleStorage);
  };
}

function getPublishedStreamRegistry(): Record<string, MediaStream> {
  const root = globalThis as typeof globalThis & { [BROADCAST_STREAM_REGISTRY_KEY]?: Record<string, MediaStream> };
  if (!root[BROADCAST_STREAM_REGISTRY_KEY]) {
    root[BROADCAST_STREAM_REGISTRY_KEY] = {};
  }
  return root[BROADCAST_STREAM_REGISTRY_KEY] as Record<string, MediaStream>;
}

export function publishBroadcastLiveStream(channelId: string, stream: MediaStream | null): void {
  if (!channelId) return;
  const registry = getPublishedStreamRegistry();
  if (stream) {
    registry[channelId] = stream;
    return;
  }
  delete registry[channelId];
}

export function getPublishedBroadcastLiveStream(channelId?: string | null): MediaStream | null {
  if (!channelId) return null;
  return getPublishedStreamRegistry()[channelId] ?? null;
}

export function clearPublishedBroadcastLiveStream(channelId: string): void {
  if (!channelId) return;
  const registry = getPublishedStreamRegistry();
  delete registry[channelId];
}

export const broadcastChannels: BroadcastChannel[] = [];

export function getBroadcastChannels(): BroadcastChannel[] {
  const publicationChannels = getBroadcastPublications().map((publication) => publicationToChannel(publication));
  const all = [...publicationChannels, ...broadcastChannels];
  const seen = new Set<string>();
  return all.filter((channel) => {
    if (seen.has(channel.id)) return false;
    seen.add(channel.id);
    return true;
  });
}

export function getBroadcastChannelById(channelId?: string | null): BroadcastChannel | undefined {
  const publication = getBroadcastPublicationByChannelId(channelId);
  if (publication) return publicationToChannel(publication);
  const channels = getBroadcastChannels();
  if (!channelId) return channels[0];
  return channels.find((channel) => channel.id === channelId) ?? channels[0];
}

export function getTdtvLobbySlides(tournaments: Tournament[]): TdtvLoopSlide[] {
  const highlights = Array.isArray(tournaments)
    ? tournaments
        .map((tournament) => tournament.name?.trim())
        .filter((value): value is string => Boolean(value))
        .slice(0, 2)
    : [];

  const highlightLine =
    highlights.length > 0
      ? `Now featuring: ${highlights.join(' • ')}`
      : 'New venues are joining TDTV weekly. Apply to get your room featured.';
  const sponsorSlides = getSystemBroadcastSponsorDefaults().map((sponsor) => ({
    id: `sponsor-${sponsor.id}`,
    title: sponsor.name,
    body: sponsor.marketingBlip ?? 'Featured TDTV network sponsor.',
    logoDataUrl: sponsor.logoDataUrl
  }));

  return [
    {
      id: 'welcome',
      title: 'Welcome to TDTV Channel 00',
      body: 'This is the always-on lobby loop for tutorials, network announcements, and partner highlights.'
    },
    {
      id: 'tutorial',
      title: 'Quick tutorial',
      body: 'Use TD in a Box broadcast hub: pair camera, arm overlay, then go live to your assigned TDTV channel.'
    },
    {
      id: 'venues',
      title: 'Venue spotlight',
      body: highlightLine
    },
    ...sponsorSlides
  ];
}

export function getTournamentScheduleState(tournament: Tournament): { startsAt: Date | null; isComingSoon: boolean } {
  if (!tournament?.date) {
    return { startsAt: null, isComingSoon: false };
  }

  const startsAt = new Date(tournament.date);
  if (Number.isNaN(startsAt.getTime())) {
    return { startsAt: null, isComingSoon: false };
  }

  return {
    startsAt,
    isComingSoon: Date.now() < startsAt.getTime()
  };
}

export function deriveBroadcastChannelsFromTournaments(tournaments: Tournament[]): BroadcastChannel[] {
  const safeTournaments = Array.isArray(tournaments) ? tournaments : [];
  const publications = getBroadcastPublications();
  const publicationByTournamentId = new Map(
    publications
      .filter((publication) => publication.tournamentId)
      .map((publication) => [publication.tournamentId, publication] as const)
  );
  const lobbySlides = getTdtvLobbySlides(safeTournaments);
  const loopChannel: BroadcastChannel = {
    id: TDTV_LOOP_CHANNEL_ID,
    number: '00',
    name: 'TDTV Lobby Loop',
    status: 'LIVE',
    now: lobbySlides[0]?.title ?? 'TDTV Lobby',
    next: lobbySlides[1]?.title ?? `${TDTV_LOOP_SECONDS}s loop`,
    route: `/tdtv/channel/${TDTV_LOOP_CHANNEL_ID}`,
    venue: 'TDTV Network',
    location: 'National Feed',
    format: `Loop ${TDTV_LOOP_SECONDS}s`,
    round: `Auto ${TDTV_LOOP_SLIDE_SECONDS}s slides`,
    watching: 80 + safeTournaments.length * 3,
    players: [
      { id: 'loop-slot-1', name: 'TDTV Programming', score: 0 },
      { id: 'loop-slot-2', name: 'Channel 00', score: 0 }
    ]
  };

  const tournamentChannels = safeTournaments.slice(0, 4).map((tournament, index) => {
    const activeMatch =
      tournament.matches.find((match) => match.state === 'IN_PROGRESS' || match.state === 'READY') ??
      tournament.matches.find((match) => match.state === 'COMPLETE') ??
      tournament.matches[0];

    const players = Array.isArray(activeMatch?.entrants)
      ? activeMatch.entrants.map((entrantId) => {
          const player = tournament.players.find((entry) => entry.id === entrantId);
          const linkedIdentity =
            player?.identityMode === 'LINKED'
              ? player.universalProfileId || player.id
              : '';
          return {
            id: linkedIdentity,
            name: player?.displayName ?? 'Open table',
            score: Number(player?.wins ?? 0)
          };
        })
      : [
          { id: 'open-table-1', name: 'Open table', score: 0 },
          { id: 'open-table-2', name: 'Open table', score: 0 }
        ];

    const safePlayers: [BroadcastPlayerScore, BroadcastPlayerScore] = [
      players[0] ?? { id: 'open-table-1', name: 'Open table', score: 0 },
      players[1] ?? { id: 'open-table-2', name: 'Open table', score: 0 }
    ];

    const scheduleState = getTournamentScheduleState(tournament);
    const status: BroadcastStatus =
      scheduleState.isComingSoon
        ? 'UP_NEXT'
        : tournament.status === 'ACTIVE'
          ? 'LIVE'
          : tournament.status === 'READY'
            ? 'UP_NEXT'
            : 'STANDBY';

    const computedChannel: BroadcastChannel = {
      id: tournament.id,
      number: String(index + 1).padStart(2, '0'),
      name: tournament.name || `Table ${index + 1}`,
      status,
      now: scheduleState.isComingSoon ? 'Coming Soon' : tournament.name || 'Tournament stream',
      next: scheduleState.isComingSoon && scheduleState.startsAt
        ? `Starts ${scheduleState.startsAt.toLocaleString()}`
        : activeMatch ? `Round ${activeMatch.round}` : 'Open table',
      route: `/broadcast/${tournament.id}`,
      venue: tournament.venueName || tournament.location || 'Promethean Venue',
      location: tournament.location || tournament.venueName || 'Local Event',
      format: tournament.format.replace(/_/g, ' '),
      round: scheduleState.isComingSoon ? 'Coming Soon' : activeMatch ? `Round ${activeMatch.round}` : 'Standby',
      watching: 128 + index * 21,
      players: safePlayers
    };

    const publication = publicationByTournamentId.get(tournament.id);
    if (!publication) {
      return computedChannel;
    }

    return {
      ...computedChannel,
      id: publication.channelId,
      number: publication.channelNumber,
      name: publication.channelName,
      status: publication.status,
      now: publication.now,
      next: publication.next,
      route: `/tdtv/channel/${publication.channelId}`,
      venue: publication.venue,
      location: publication.location,
      format: publication.format,
      round: publication.round,
      players: publication.players
    };
  });

  const knownTournamentIds = new Set(safeTournaments.map((tournament) => tournament.id));
  const orphanPublicationChannels = publications
    .filter((publication) => !publication.tournamentId || !knownTournamentIds.has(publication.tournamentId))
    .map((publication) => publicationToChannel(publication));

  return [loopChannel, ...tournamentChannels, ...orphanPublicationChannels];
}
