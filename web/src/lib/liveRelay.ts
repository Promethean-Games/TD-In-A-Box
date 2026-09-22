import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { getTemporaryIceConfiguration } from '@/lib/turnIce';

type RelayMessageType =
  | 'viewer-ready'
  | 'viewer-answer'
  | 'viewer-ice'
  | 'viewer-stop'
  | 'host-offer'
  | 'host-ice'
  | 'host-stop';

interface RelayMessage {
  type: RelayMessageType;
  viewerId?: string;
  payload?: unknown;
  ts: number;
}

export interface HostChannelRelay {
  channelId: string;
  updateStream: (stream: MediaStream) => void;
  stop: () => Promise<void>;
}

export interface ViewerChannelRelay {
  channelId: string;
  stop: () => Promise<void>;
}

function createRelayChannelKey(channelId: string): string {
  return `tdiab-live-relay-${channelId}`;
}

function randomRelayId(): string {
  return `viewer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function relayErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return fallback;
}

async function subscribeRelayChannel(channelName: string) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase signaling is required for cross-device TDTV live relay.');
  }
  const channel = supabase.channel(channelName, {
    config: { broadcast: { self: true } }
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('Timed out waiting for TDTV relay signaling channel.'));
    }, 7000);
    channel.subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        window.clearTimeout(timeout);
        resolve();
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || error) {
        window.clearTimeout(timeout);
        reject(error ?? new Error('Unable to subscribe to TDTV relay signaling channel.'));
      }
    });
  });
  return channel;
}

async function sendRelayMessage(
  relayChannel: Awaited<ReturnType<typeof subscribeRelayChannel>>,
  message: RelayMessage
): Promise<void> {
  await relayChannel.send({
    type: 'broadcast',
    event: 'relay',
    payload: message
  });
}

export async function createHostChannelRelay(
  channelId: string,
  initialStream: MediaStream,
  onError?: (message: string) => void
): Promise<HostChannelRelay> {
  const relayChannel = await subscribeRelayChannel(createRelayChannelKey(channelId));
  const peersByViewerId = new Map<string, RTCPeerConnection>();
  let currentStream = initialStream;
  let isClosed = false;

  const closeViewerPeer = (viewerId: string) => {
    const peer = peersByViewerId.get(viewerId);
    if (!peer) return;
    peer.close();
    peersByViewerId.delete(viewerId);
  };

  const addTracksToPeer = (peer: RTCPeerConnection, stream: MediaStream) => {
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      peer.addTrack(videoTrack, stream);
    }
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      peer.addTrack(audioTrack, stream);
    }
  };

  const createPeerForViewer = async (viewerId: string) => {
    closeViewerPeer(viewerId);
    const iceConfiguration = await getTemporaryIceConfiguration({
      onDiagnostic: (message) => onError?.(message)
    });
    const peer = new RTCPeerConnection({ iceServers: iceConfiguration.iceServers });
    peersByViewerId.set(viewerId, peer);
    addTracksToPeer(peer, currentStream);

    peer.onicecandidate = (event) => {
      if (!event.candidate || isClosed) return;
      void sendRelayMessage(relayChannel, {
        type: 'host-ice',
        viewerId,
        payload: event.candidate.toJSON(),
        ts: Date.now()
      });
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected' || peer.connectionState === 'closed') {
        closeViewerPeer(viewerId);
      }
    };

    const offer = await peer.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false
    });
    await peer.setLocalDescription(offer);
    await sendRelayMessage(relayChannel, {
      type: 'host-offer',
      viewerId,
      payload: offer,
      ts: Date.now()
    });
  };

  relayChannel.on('broadcast', { event: 'relay' }, ({ payload }) => {
    const message = payload as RelayMessage;
    if (!message || typeof message.type !== 'string') return;

    if (message.type === 'viewer-ready' && message.viewerId) {
      void createPeerForViewer(message.viewerId).catch((error) => {
        onError?.(relayErrorMessage(error, 'Failed to initialize viewer relay.'));
      });
      return;
    }

    if (message.type === 'viewer-answer' && message.viewerId && message.payload) {
      const peer = peersByViewerId.get(message.viewerId);
      if (!peer) return;
      void peer.setRemoteDescription(new RTCSessionDescription(message.payload as RTCSessionDescriptionInit)).catch((error) => {
        onError?.(relayErrorMessage(error, 'Failed to apply viewer answer.'));
      });
      return;
    }

    if (message.type === 'viewer-ice' && message.viewerId && message.payload) {
      const peer = peersByViewerId.get(message.viewerId);
      if (!peer) return;
      void peer.addIceCandidate(new RTCIceCandidate(message.payload as RTCIceCandidateInit)).catch(() => undefined);
      return;
    }

    if (message.type === 'viewer-stop' && message.viewerId) {
      closeViewerPeer(message.viewerId);
    }
  });

  return {
    channelId,
    updateStream: (stream: MediaStream) => {
      currentStream = stream;
      const nextVideoTrack = stream.getVideoTracks()[0] ?? null;
      const nextAudioTrack = stream.getAudioTracks()[0] ?? null;
      peersByViewerId.forEach((peer) => {
        peer.getSenders().forEach((sender) => {
          if (sender.track?.kind === 'video') {
            void sender.replaceTrack(nextVideoTrack);
          } else if (sender.track?.kind === 'audio') {
            void sender.replaceTrack(nextAudioTrack);
          }
        });
      });
    },
    stop: async () => {
      if (isClosed) return;
      isClosed = true;
      await sendRelayMessage(relayChannel, {
        type: 'host-stop',
        ts: Date.now()
      }).catch(() => undefined);
      peersByViewerId.forEach((peer) => peer.close());
      peersByViewerId.clear();
      await relayChannel.unsubscribe();
    }
  };
}

export async function createViewerChannelRelay(
  channelId: string,
  onStream: (stream: MediaStream) => void,
  onError?: (message: string) => void
): Promise<ViewerChannelRelay> {
  const relayChannel = await subscribeRelayChannel(createRelayChannelKey(channelId));
  const viewerId = randomRelayId();
  const iceConfiguration = await getTemporaryIceConfiguration({
    onDiagnostic: (message) => onError?.(message)
  });
  const peer = new RTCPeerConnection({ iceServers: iceConfiguration.iceServers });
  let isClosed = false;

  peer.ontrack = (event) => {
    const stream = event.streams?.[0] ?? null;
    if (stream) {
      onStream(stream);
      return;
    }
    if (event.track) {
      const fallback = new MediaStream([event.track]);
      onStream(fallback);
    }
  };

  peer.onicecandidate = (event) => {
    if (!event.candidate || isClosed) return;
    void sendRelayMessage(relayChannel, {
      type: 'viewer-ice',
      viewerId,
      payload: event.candidate.toJSON(),
      ts: Date.now()
    });
  };

  relayChannel.on('broadcast', { event: 'relay' }, ({ payload }) => {
    const message = payload as RelayMessage;
    if (!message || typeof message.type !== 'string') return;

    if (message.type === 'host-stop') {
      if (!isClosed) {
        peer.close();
      }
      return;
    }

    if (!message.viewerId || message.viewerId !== viewerId) return;

    if (message.type === 'host-offer' && message.payload) {
      void (async () => {
        try {
          const offer = message.payload as RTCSessionDescriptionInit;
          await peer.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          await sendRelayMessage(relayChannel, {
            type: 'viewer-answer',
            viewerId,
            payload: answer,
            ts: Date.now()
          });
        } catch (error) {
          onError?.(relayErrorMessage(error, 'Failed to answer host relay offer.'));
        }
      })();
      return;
    }

    if (message.type === 'host-ice' && message.payload) {
      void peer.addIceCandidate(new RTCIceCandidate(message.payload as RTCIceCandidateInit)).catch(() => undefined);
    }
  });

  await sendRelayMessage(relayChannel, {
    type: 'viewer-ready',
    viewerId,
    ts: Date.now()
  });

  return {
    channelId,
    stop: async () => {
      if (isClosed) return;
      isClosed = true;
      await sendRelayMessage(relayChannel, {
        type: 'viewer-stop',
        viewerId,
        ts: Date.now()
      }).catch(() => undefined);
      peer.close();
      await relayChannel.unsubscribe();
    }
  };
}
