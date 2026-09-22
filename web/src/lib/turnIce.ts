import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { DEFAULT_ICE_SERVERS } from '@/lib/webrtcPairing';

const TURN_ICE_CACHE_MS = 60_000;
const TURN_ICE_TTL_SECONDS = 86_400;

export type TurnIceSource = 'cloudflare-turn' | 'legacy-fallback';

export interface TurnIceConfiguration {
  iceServers: RTCIceServer[];
  source: TurnIceSource;
  error?: string;
}

let cachedTurnIce: TurnIceConfiguration | null = null;
let cachedTurnIceAt = 0;
let inFlightTurnIceRequest: Promise<TurnIceConfiguration> | null = null;

function cloneIceServers(iceServers: RTCIceServer[]): RTCIceServer[] {
  return iceServers.map((iceServer) => ({
    ...iceServer,
    urls: Array.isArray(iceServer.urls) ? [...iceServer.urls] : iceServer.urls
  }));
}

function buildFallbackResult(error?: string): TurnIceConfiguration {
  return {
    iceServers: cloneIceServers(DEFAULT_ICE_SERVERS),
    source: 'legacy-fallback',
    error
  };
}

function normalizeIceServer(value: unknown): RTCIceServer | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const urls = candidate.urls;
  const hasUrls =
    typeof urls === 'string' ||
    (Array.isArray(urls) && urls.length > 0 && urls.every((entry) => typeof entry === 'string'));

  if (!hasUrls) {
    return null;
  }

  return {
    urls: urls as string | string[],
    username: typeof candidate.username === 'string' ? candidate.username : undefined,
    credential: typeof candidate.credential === 'string' ? candidate.credential : undefined
  };
}

export async function getTemporaryIceConfiguration(options?: {
  forceRefresh?: boolean;
  onDiagnostic?: (message: string) => void;
}): Promise<TurnIceConfiguration> {
  const onDiagnostic = options?.onDiagnostic;

  if (!isSupabaseConfigured || !supabase) {
    return buildFallbackResult('Supabase is not configured for TURN credential fetch.');
  }

  const canReuseCache =
    !options?.forceRefresh &&
    cachedTurnIce &&
    Date.now() - cachedTurnIceAt < TURN_ICE_CACHE_MS;
  if (canReuseCache) {
    return {
      ...cachedTurnIce,
      iceServers: cloneIceServers(cachedTurnIce.iceServers)
    };
  }

  if (inFlightTurnIceRequest) {
    return inFlightTurnIceRequest;
  }

  inFlightTurnIceRequest = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke('turn-ice', {
        body: { ttl: TURN_ICE_TTL_SECONDS }
      });

      if (error) {
        throw error;
      }

      const normalizedIceServers = Array.isArray((data as { iceServers?: unknown[] } | null)?.iceServers)
        ? ((data as { iceServers: unknown[] }).iceServers
            .map(normalizeIceServer)
            .filter((entry): entry is RTCIceServer => entry !== null))
        : [];

      if (normalizedIceServers.length === 0) {
        throw new Error('TURN endpoint returned no usable ICE servers.');
      }

      cachedTurnIce = {
        iceServers: cloneIceServers(normalizedIceServers),
        source: 'cloudflare-turn'
      };
      cachedTurnIceAt = Date.now();
      return {
        ...cachedTurnIce,
        iceServers: cloneIceServers(cachedTurnIce.iceServers)
      };
    } catch (error) {
      const detail = error instanceof Error && error.message.trim().length > 0
        ? error.message
        : 'TURN credential fetch failed.';
      onDiagnostic?.(`TURN credential fetch failed; using fallback ICE servers. ${detail}`);
      return buildFallbackResult(detail);
    } finally {
      inFlightTurnIceRequest = null;
    }
  })();

  return inFlightTurnIceRequest;
}
