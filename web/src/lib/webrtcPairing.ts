import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type PairRole = 'host' | 'sender';

export interface PairSignalMessage {
  type: 'ready' | 'offer' | 'answer' | 'ice' | 'stop' | 'error';
  from: PairRole;
  payload?: unknown;
  ts: number;
}

export interface PairSignalClient {
  send: (message: PairSignalMessage) => Promise<void>;
  close: () => void;
  transport: 'supabase' | 'broadcast-channel';
}

function randomCode(length = 6): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let output = '';
  for (let i = 0; i < length; i += 1) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return output;
}

export function generatePairCode(): string {
  return randomCode(6);
}

export function getPairSignalDiagnostics(sessionId?: string) {
  const signalSessionKey = sessionId ? `webrtc-pair-${sessionId}` : 'webrtc-pair-pending';
  const hasBroadcastChannel = typeof window !== 'undefined' && 'BroadcastChannel' in window;
  const signalReady = isSupabaseConfigured || hasBroadcastChannel;

  return {
    signalSessionKey,
    hasBroadcastChannel,
    supabaseConfigured: isSupabaseConfigured,
    signalReady,
    recommendedMode: isSupabaseConfigured ? 'supabase' : hasBroadcastChannel ? 'broadcast-channel' : 'unavailable'
  };
}

export function getPairingAvailabilityError(): string | null {
  if (isSupabaseConfigured) return null;
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    return 'Remote camera pairing is using a local-only browser fallback and cannot connect a phone on another device. Configure Supabase realtime signaling to enable cross-device pairing.';
  }
  return 'Remote camera pairing requires Supabase realtime signaling. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before trying to pair a phone camera.';
}

export async function createPairSignalClient(
  sessionId: string,
  onMessage: (message: PairSignalMessage) => void
): Promise<PairSignalClient> {
  const signalSessionKey = `webrtc-pair-${sessionId}`;

  if (isSupabaseConfigured && supabase) {
    const channel = supabase.channel(signalSessionKey, {
      config: { broadcast: { self: true } }
    });

    channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
      const message = payload as PairSignalMessage;
      if (!message || typeof message.type !== 'string') return;
      onMessage(message);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const waitForConnection = setTimeout(() => {
          reject(new Error('Timed out waiting for Supabase signaling.'));
        }, 7000);

        channel.subscribe((status, error) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(waitForConnection);
            resolve();
            return;
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || error) {
            clearTimeout(waitForConnection);
            reject(error ?? new Error('Signal channel failed to connect.'));
          }
        });
      });

      return {
        transport: 'supabase',
        send: async (message) => {
          await channel.send({
            type: 'broadcast',
            event: 'signal',
            payload: message
          });
        },
        close: () => {
          void channel.unsubscribe();
        }
      };
    } catch (error) {
      try {
        void channel.unsubscribe();
      } catch {
        // ignore cleanup errors while falling back
      }

      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const fallback = new BroadcastChannel(signalSessionKey);
        fallback.onmessage = (event: MessageEvent<PairSignalMessage>) => {
          if (!event?.data || typeof event.data.type !== 'string') return;
          onMessage(event.data);
        };

        return {
          transport: 'broadcast-channel',
          send: async (message) => {
            fallback.postMessage(message);
          },
          close: () => {
            fallback.close();
          }
        };
      }

      throw error;
    }
  }

  if (typeof window === 'undefined' || !('BroadcastChannel' in window)) {
    throw new Error('Remote camera pairing is unavailable: neither Supabase signaling nor BroadcastChannel is available in this browser/session.');
  }

  const fallback = new BroadcastChannel(signalSessionKey);
  fallback.onmessage = (event: MessageEvent<PairSignalMessage>) => {
    if (!event?.data || typeof event.data.type !== 'string') return;
    onMessage(event.data);
  };

  return {
    transport: 'broadcast-channel',
    send: async (message) => {
      fallback.postMessage(message);
    },
    close: () => {
      fallback.close();
    }
  };
}

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];
