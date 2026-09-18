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

export async function createPairSignalClient(
  sessionId: string,
  onMessage: (message: PairSignalMessage) => void
): Promise<PairSignalClient> {
  if (isSupabaseConfigured && supabase) {
    const channel = supabase.channel(`webrtc-pair-${sessionId}`, {
      config: { broadcast: { self: true } }
    });

    channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
      const message = payload as PairSignalMessage;
      if (!message || typeof message.type !== 'string') return;
      onMessage(message);
    });

    await channel.subscribe();

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
  }

  const fallback = new BroadcastChannel(`webrtc-pair-${sessionId}`);
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
