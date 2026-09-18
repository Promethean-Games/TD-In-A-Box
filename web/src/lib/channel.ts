import type { AppUser } from '@/lib/auth';

export type ChannelType = 'NETWORK' | 'VENUE' | 'TD';
export type ChannelStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'RETIRED';

export interface ChannelRecord {
  id: string;
  number: number;
  type: ChannelType;
  status: ChannelStatus;
  entityType: 'TDTV' | 'VENUE' | 'TD';
  entityId: string;
  entityName: string;
  createdAt: string;
  tier?: 'BASIC' | 'PRO' | 'PRO_PLUS' | 'VENUE';
}

export interface EventChannelLink {
  eventId: string;
  channelId: string;
  role: 'VENUE' | 'TD' | 'NETWORK';
  visible: boolean;
}

export interface VenueChannelSettings {
  venueId: string;
  channelId: string;
  channelName: string;
  updatedAt: string;
}

export type VenueChannelRequestStatus = 'PENDING' | 'APPROVED' | 'DENIED';

export interface VenueChannelChangeRequest {
  id: string;
  venueId: string;
  venueName: string;
  currentChannelId: string | null;
  requestedChannelNumber: number;
  requestedChannelName: string;
  status: VenueChannelRequestStatus;
  requestedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
}

export const CHANNEL_RANGES = {
  NETWORK: { min: 0, max: 0 },
  VENUE: { min: 1, max: 100 },
  RESERVED: { min: 101, max: 999 },
  TD: { min: 1000, max: 5000 }
} as const;

const NON_BROADCASTABLE_CHANNELS = new Set<number>([0]);

export const DEFAULT_CHANNELS: ChannelRecord[] = [
  {
    id: 'channel-tdtv',
    number: 0,
    type: 'NETWORK',
    status: 'ACTIVE',
    entityType: 'TDTV',
    entityId: 'network-tdtv',
    entityName: 'TDTV Network',
    createdAt: '2024-01-01T00:00:00.000Z'
  },
  {
    id: 'channel-venue-parlor',
    number: 17,
    type: 'VENUE',
    status: 'ACTIVE',
    entityType: 'VENUE',
    entityId: 'venue-parlor-room',
    entityName: 'Parlor Room',
    createdAt: '2024-01-05T00:00:00.000Z'
  },
  {
    id: 'channel-td-ace',
    number: 1247,
    type: 'TD',
    status: 'ACTIVE',
    entityType: 'TD',
    entityId: 'user-td-ace',
    entityName: "Ace's Tournaments",
    createdAt: '2024-02-01T00:00:00.000Z',
    tier: 'PRO_PLUS'
  }
];

const CHANNEL_REGISTRY_KEY = 'tdiab_channel_registry';
const VENUE_REQUESTS_KEY = 'tdiab_venue_channel_requests';

function padChannelNumber(value: number): string {
  if (value >= 1000) return String(value).padStart(4, '0');
  return String(value).padStart(3, '0');
}

function channelCode(channel: ChannelRecord): string {
  if (channel.type === 'NETWORK') return 'TDTV-000';
  if (channel.type === 'VENUE') return `VENUE-${padChannelNumber(channel.number)}`;
  return `TD-${padChannelNumber(channel.number)}`;
}

function randomSuffix(length = 6): string {
  return Math.random().toString(36).slice(2, 2 + length);
}

function normalizeChannel(channel: Partial<ChannelRecord> | null | undefined): ChannelRecord | null {
  if (!channel || typeof channel.number !== 'number') return null;
  if (!isValidChannelAssignment(channel.number, (channel.type as ChannelType) ?? 'TD')) return null;

  const type = (channel.type as ChannelType) ?? 'TD';
  const entityType = type === 'VENUE' ? 'VENUE' : type === 'TD' ? 'TD' : 'TDTV';
  return {
    id: String(channel.id ?? `channel-${entityType.toLowerCase()}-${channel.number}`),
    number: Number(channel.number),
    type,
    status:
      channel.status === 'ACTIVE' ||
      channel.status === 'INACTIVE' ||
      channel.status === 'SUSPENDED' ||
      channel.status === 'RETIRED'
        ? channel.status
        : 'ACTIVE',
    entityType,
    entityId: String(channel.entityId ?? `${entityType.toLowerCase()}-${channel.number}`),
    entityName: String(channel.entityName ?? `${entityType} Channel ${channel.number}`),
    createdAt: String(channel.createdAt ?? new Date().toISOString()),
    tier: channel.tier === 'BASIC' || channel.tier === 'PRO' || channel.tier === 'PRO_PLUS' || channel.tier === 'VENUE' ? channel.tier : undefined
  };
}

function normalizeRequest(request: Partial<VenueChannelChangeRequest> | null | undefined): VenueChannelChangeRequest | null {
  if (!request) return null;
  const status =
    request.status === 'APPROVED' || request.status === 'DENIED' || request.status === 'PENDING'
      ? request.status
      : 'PENDING';
  const requestedChannelNumber = Number(request.requestedChannelNumber);
  if (!isValidChannelAssignment(requestedChannelNumber, 'VENUE')) return null;
  return {
    id: String(request.id ?? `venue-channel-request-${randomSuffix(10)}`),
    venueId: String(request.venueId ?? ''),
    venueName: String(request.venueName ?? 'Venue'),
    currentChannelId: typeof request.currentChannelId === 'string' ? request.currentChannelId : null,
    requestedChannelNumber,
    requestedChannelName: String(request.requestedChannelName ?? 'Venue Channel'),
    status,
    requestedAt: String(request.requestedAt ?? new Date().toISOString()),
    reviewedAt: typeof request.reviewedAt === 'string' ? request.reviewedAt : undefined,
    reviewedBy: typeof request.reviewedBy === 'string' ? request.reviewedBy : undefined,
    reviewNote: typeof request.reviewNote === 'string' ? request.reviewNote : undefined
  };
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function saveVenueChannelSettings(settings: VenueChannelSettings): VenueChannelSettings {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(`tdiab_venue_channel_settings_${settings.venueId}`, JSON.stringify(settings));
  }
  return settings;
}

function getVenueChannelSettings(venueId: string): VenueChannelSettings | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(`tdiab_venue_channel_settings_${venueId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<VenueChannelSettings>;
    if (!parsed || typeof parsed.venueId !== 'string' || typeof parsed.channelId !== 'string') return null;
    return {
      venueId: parsed.venueId,
      channelId: parsed.channelId,
      channelName: typeof parsed.channelName === 'string' ? parsed.channelName : 'Venue Channel',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString()
    };
  } catch {
    return null;
  }
}

function getVenueScopedChannels(user: AppUser, channels: ChannelRecord[]): ChannelRecord[] {
  const venueIds = Array.isArray(user.venueIds) ? user.venueIds.filter(Boolean) : [];
  if (venueIds.length === 0) return [];
  let scoped = channels.filter((channel) => channel.type === 'VENUE' && venueIds.includes(channel.entityId));
  if (scoped.length > 0) return scoped;

  const primaryVenueId = venueIds[0];
  const occupied = channels.map((channel) => channel.number);
  const created = createChannelAssignment('VENUE', `Venue ${primaryVenueId}`, primaryVenueId, occupied);
  const nextChannels = persistChannelRegistry(uniqueById([...channels, created]));
  scoped = nextChannels.filter((channel) => channel.type === 'VENUE' && channel.entityId === primaryVenueId);
  return scoped;
}

function getTdScopedChannels(user: AppUser, channels: ChannelRecord[]): ChannelRecord[] {
  const tdIds = [user.id, user.tdProfileId].filter((value): value is string => typeof value === 'string' && value.length > 0);
  if (tdIds.length === 0) return [];
  let scoped = channels.filter((channel) => channel.type === 'TD' && tdIds.includes(channel.entityId));
  if (scoped.length > 0) return scoped;

  const tierAllowsTdChannel = user.tier === 'PRO_PLUS' || user.tier === 'VENUE' || user.role === 'PLATFORM_ADMIN';
  if (!tierAllowsTdChannel) return [];
  const occupied = channels.map((channel) => channel.number);
  const created = createChannelAssignment('TD', `${user.name || 'TD'} Channel`, tdIds[0], occupied);
  const nextChannels = persistChannelRegistry(uniqueById([...channels, created]));
  scoped = nextChannels.filter((channel) => channel.type === 'TD' && tdIds.includes(channel.entityId));
  return scoped;
}

function hashString(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function isReservedRange(channelNumber: number): boolean {
  return channelNumber >= CHANNEL_RANGES.RESERVED.min && channelNumber <= CHANNEL_RANGES.RESERVED.max;
}

export function isValidChannelAssignment(channelNumber: number, type: ChannelType): boolean {
  if (channelNumber === 0 && type !== 'NETWORK') return false;
  if (type === 'NETWORK') return channelNumber === 0;
  if (type === 'VENUE') return channelNumber >= CHANNEL_RANGES.VENUE.min && channelNumber <= CHANNEL_RANGES.VENUE.max;
  if (type === 'TD') return channelNumber >= CHANNEL_RANGES.TD.min && channelNumber <= CHANNEL_RANGES.TD.max;
  return false;
}

export function allocateNextChannel(type: ChannelType, occupied: number[] = []): number {
  const range =
    type === 'NETWORK'
      ? [0]
      : type === 'VENUE'
        ? Array.from({ length: CHANNEL_RANGES.VENUE.max - CHANNEL_RANGES.VENUE.min + 1 }, (_, i) => i + CHANNEL_RANGES.VENUE.min)
        : Array.from({ length: CHANNEL_RANGES.TD.max - CHANNEL_RANGES.TD.min + 1 }, (_, i) => i + CHANNEL_RANGES.TD.min);
  const used = new Set(occupied);
  const available = range.find((channelNumber) => !used.has(channelNumber));
  if (available === undefined) {
    throw new Error(`No available ${type.toLowerCase()} channel in the permitted range.`);
  }
  return available;
}

export function getChannelRegistry(): ChannelRecord[] {
  if (typeof window === 'undefined') return DEFAULT_CHANNELS;

  const raw = window.localStorage.getItem(CHANNEL_REGISTRY_KEY);
  if (!raw) {
    window.localStorage.setItem(CHANNEL_REGISTRY_KEY, JSON.stringify(DEFAULT_CHANNELS));
    return DEFAULT_CHANNELS;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ChannelRecord>[];
    const normalized = Array.isArray(parsed) ? parsed.map((channel) => normalizeChannel(channel)).filter((channel): channel is ChannelRecord => Boolean(channel)) : [];
    return normalized.length > 0 ? normalized : DEFAULT_CHANNELS;
  } catch {
    return DEFAULT_CHANNELS;
  }
}

export function persistChannelRegistry(channels: ChannelRecord[]): ChannelRecord[] {
  const normalized = channels.map((channel) => normalizeChannel(channel)).filter((channel): channel is ChannelRecord => Boolean(channel));
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(CHANNEL_REGISTRY_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export function createChannelAssignment(type: ChannelType, entityName: string, entityId: string, occupied: number[] = []): ChannelRecord {
  const nextNumber = allocateNextChannel(type, occupied);
  return {
    id: `channel-${entityId}`,
    number: nextNumber,
    type,
    status: 'ACTIVE',
    entityType: type === 'VENUE' ? 'VENUE' : type === 'TD' ? 'TD' : 'TDTV',
    entityId,
    entityName,
    createdAt: new Date().toISOString(),
    tier: type === 'TD' ? 'PRO_PLUS' : type === 'VENUE' ? 'VENUE' : undefined
  };
}

export function getChannelByNumber(number: number): ChannelRecord | undefined {
  return getChannelRegistry().find((channel) => channel.number === number);
}

export function getEventChannelLinks(eventId: string): EventChannelLink[] {
  const defaultLinks: EventChannelLink[] = [
    { eventId, channelId: 'channel-tdtv', role: 'NETWORK', visible: true },
    { eventId, channelId: 'channel-venue-parlor', role: 'VENUE', visible: true },
    { eventId, channelId: 'channel-td-ace', role: 'TD', visible: true }
  ];

  if (typeof window === 'undefined') return defaultLinks;

  const raw = window.localStorage.getItem(`tdiab_event_channels_${eventId}`);
  if (!raw) return defaultLinks;

  try {
    const parsed = JSON.parse(raw) as EventChannelLink[];
    return Array.isArray(parsed) ? parsed : defaultLinks;
  } catch {
    return defaultLinks;
  }
}

export function persistEventChannelLinks(eventId: string, links: EventChannelLink[]): EventChannelLink[] {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(`tdiab_event_channels_${eventId}`, JSON.stringify(links));
  }
  return links;
}

export function getAllowedBroadcastChannelsForUser(user: AppUser): ChannelRecord[] {
  const channels = getChannelRegistry().filter((channel) => channel.status === 'ACTIVE');
  const scoped =
    user.role === 'PLATFORM_ADMIN'
      ? channels
      : user.role === 'VENUE_ADMIN' || user.tier === 'VENUE'
        ? getVenueScopedChannels(user, channels)
        : getTdScopedChannels(user, channels);
  return scoped.filter((channel) => !NON_BROADCASTABLE_CHANNELS.has(channel.number));
}

export function getChannelNamingConventionHelp(): string[] {
  return [
    'TDTV-000: always-on TDTV lobby loop (not broadcastable by users).',
    'VENUE-001 to VENUE-100: dedicated venue channel range.',
    'TD-1000+: individual TD channels for eligible Pro+ creators.'
  ];
}

export function formatChannelOptionLabel(channel: ChannelRecord): string {
  return `${channelCode(channel)} - ${channel.entityName}`;
}

export function getVenueChannelAnalytics(venueId: string, channelNumber: number): {
  currentViewers: number;
  avgConcurrentViewers: number;
  growthLast30Days: number;
  peakViewers: number;
} {
  const seed = hashString(`${venueId}:${channelNumber}`);
  const currentViewers = 25 + (seed % 220);
  const avgConcurrentViewers = Math.max(12, Math.round(currentViewers * 0.72));
  const peakViewers = currentViewers + 40 + (seed % 110);
  const growthLast30Days = Math.round(((seed % 31) - 8) * 10) / 10;
  return {
    currentViewers,
    avgConcurrentViewers,
    growthLast30Days,
    peakViewers
  };
}

export function getVenueChannelSettingsForUser(user: AppUser): VenueChannelSettings | null {
  if (user.venueIds.length === 0) return null;
  const primaryVenueId = user.venueIds[0];
  const existing = getVenueChannelSettings(primaryVenueId);
  if (existing) return existing;

  const channels = getChannelRegistry();
  const venueChannel =
    channels.find((channel) => channel.type === 'VENUE' && channel.entityId === primaryVenueId) ??
    channels.find((channel) => channel.type === 'VENUE');
  if (!venueChannel) return null;

  return saveVenueChannelSettings({
    venueId: primaryVenueId,
    channelId: venueChannel.id,
    channelName: venueChannel.entityName,
    updatedAt: new Date().toISOString()
  });
}

export function updateVenueChannelSettings(
  user: AppUser,
  updates: { channelId?: string; channelName?: string }
): VenueChannelSettings | null {
  if (user.venueIds.length === 0) return null;
  const primaryVenueId = user.venueIds[0];
  const current = getVenueChannelSettingsForUser(user);
  if (!current) return null;

  const nextChannelId = typeof updates.channelId === 'string' && updates.channelId.length > 0 ? updates.channelId : current.channelId;
  const nextChannelName =
    typeof updates.channelName === 'string' && updates.channelName.trim().length > 0
      ? updates.channelName.trim()
      : current.channelName;

  const channels = getChannelRegistry();
  const nextChannel = channels.find((channel) => channel.id === nextChannelId && channel.type === 'VENUE');
  if (!nextChannel) return current;
  if (!user.venueIds.includes(nextChannel.entityId)) return current;

  const updatedChannels = channels.map((channel) => {
    if (channel.id !== nextChannel.id) return channel;
    return {
      ...channel,
      entityName: nextChannelName
    };
  });
  persistChannelRegistry(updatedChannels);

  return saveVenueChannelSettings({
    venueId: primaryVenueId,
    channelId: nextChannel.id,
    channelName: nextChannelName,
    updatedAt: new Date().toISOString()
  });
}

export function getVenueChannelChangeRequests(): VenueChannelChangeRequest[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(VENUE_REQUESTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<VenueChannelChangeRequest>[];
    return Array.isArray(parsed)
      ? parsed
          .map((request) => normalizeRequest(request))
          .filter((request): request is VenueChannelChangeRequest => Boolean(request))
          .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())
      : [];
  } catch {
    return [];
  }
}

function persistVenueChannelChangeRequests(requests: VenueChannelChangeRequest[]): VenueChannelChangeRequest[] {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(VENUE_REQUESTS_KEY, JSON.stringify(requests));
  }
  return requests;
}

export function getAvailableVenueChannelNumbers(currentChannelNumber?: number | null): number[] {
  const channels = getChannelRegistry();
  const occupied = new Set(
    channels
      .filter((channel) => channel.type === 'VENUE')
      .map((channel) => channel.number)
      .filter((number) => number !== currentChannelNumber)
  );
  return Array.from(
    { length: CHANNEL_RANGES.VENUE.max - CHANNEL_RANGES.VENUE.min + 1 },
    (_, index) => CHANNEL_RANGES.VENUE.min + index
  ).filter((number) => !occupied.has(number));
}

export function submitVenueChannelChangeRequest(
  user: AppUser,
  requestedChannelNumber: number,
  requestedChannelName: string
): VenueChannelChangeRequest {
  if (user.venueIds.length === 0) {
    throw new Error('No venue is associated with this account.');
  }
  if (!isValidChannelAssignment(requestedChannelNumber, 'VENUE')) {
    throw new Error('Venue channel requests must be between 1 and 100.');
  }
  const primaryVenueId = user.venueIds[0];
  const channels = getChannelRegistry();
  const currentChannel = channels.find((channel) => channel.type === 'VENUE' && channel.entityId === primaryVenueId) ?? null;
  const occupiedByOtherVenue = channels.some(
    (channel) =>
      channel.type === 'VENUE' &&
      channel.number === requestedChannelNumber &&
      channel.entityId !== primaryVenueId &&
      channel.status === 'ACTIVE'
  );
  if (occupiedByOtherVenue) {
    throw new Error(`Channel ${requestedChannelNumber} is already assigned to another venue.`);
  }

  const request: VenueChannelChangeRequest = {
    id: `venue-channel-request-${Date.now()}-${randomSuffix(6)}`,
    venueId: primaryVenueId,
    venueName: currentChannel?.entityName || user.name || primaryVenueId,
    currentChannelId: currentChannel?.id ?? null,
    requestedChannelNumber,
    requestedChannelName: requestedChannelName.trim() || currentChannel?.entityName || 'Venue Channel',
    status: 'PENDING',
    requestedAt: new Date().toISOString()
  };
  const existing = getVenueChannelChangeRequests();
  persistVenueChannelChangeRequests([request, ...existing]);
  return request;
}

export function resolveVenueChannelChangeRequest(
  requestId: string,
  decision: 'APPROVED' | 'DENIED',
  reviewedBy: string,
  note?: string
): VenueChannelChangeRequest {
  const requests = getVenueChannelChangeRequests();
  const target = requests.find((request) => request.id === requestId);
  if (!target) {
    throw new Error('Request not found.');
  }
  if (target.status !== 'PENDING') return target;

  const resolvedRequest: VenueChannelChangeRequest = {
    ...target,
    status: decision,
    reviewedBy,
    reviewedAt: new Date().toISOString(),
    reviewNote: note
  };

  if (decision === 'APPROVED') {
    const channels = getChannelRegistry();
    const conflict = channels.some(
      (channel) =>
        channel.type === 'VENUE' &&
        channel.number === target.requestedChannelNumber &&
        channel.entityId !== target.venueId &&
        channel.status === 'ACTIVE'
    );
    if (conflict) {
      throw new Error(`Channel ${target.requestedChannelNumber} is no longer available.`);
    }

    const existing = channels.find((channel) => channel.type === 'VENUE' && channel.entityId === target.venueId);
    const channelId = existing?.id ?? `channel-venue-${target.venueId}`;
    const updated: ChannelRecord = {
      id: channelId,
      number: target.requestedChannelNumber,
      type: 'VENUE',
      status: 'ACTIVE',
      entityType: 'VENUE',
      entityId: target.venueId,
      entityName: target.requestedChannelName,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      tier: 'VENUE'
    };
    const nextChannels = channels
      .filter((channel) => !(channel.type === 'VENUE' && channel.entityId === target.venueId))
      .concat(updated);
    persistChannelRegistry(nextChannels);
    saveVenueChannelSettings({
      venueId: target.venueId,
      channelId: updated.id,
      channelName: updated.entityName,
      updatedAt: new Date().toISOString()
    });
  }

  const nextRequests = requests.map((request) => (request.id === requestId ? resolvedRequest : request));
  persistVenueChannelChangeRequests(nextRequests);
  return resolvedRequest;
}
