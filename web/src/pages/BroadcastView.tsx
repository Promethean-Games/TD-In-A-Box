import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  type BroadcastRuntimeConfig,
  BroadcastStatus,
  deriveBroadcastChannelsFromTournaments,
  getBroadcastPublicationByChannelId,
  getBroadcastChannelById,
  getPublishedBroadcastLiveStream,
  getBroadcastChannels,
  getBroadcastRuntimeConfig,
  subscribeToBroadcastPublications
} from '@/lib/broadcast';
import { createViewerChannelRelay, type ViewerChannelRelay } from '@/lib/liveRelay';
import { useTournamentStore } from '@/store/tournamentStore';
import './BroadcastView.css';

type FullscreenDoc = Document & {
  webkitFullscreenElement?: Element;
  msFullscreenElement?: Element;
  webkitExitFullscreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};

export default function BroadcastView() {
  const { id } = useParams<{ id: string }>();
  const { tournaments } = useTournamentStore();
  const [, setPublicationVersion] = useState(0);
  const derivedChannels = deriveBroadcastChannelsFromTournaments(tournaments);
  const channel = useMemo(() => {
    if (id) {
      return derivedChannels.find((item) => item.id === id) ?? derivedChannels[0] ?? getBroadcastChannelById(id) ?? getBroadcastChannels()[0];
    }
    return derivedChannels[0] ?? getBroadcastChannels()[0];
  }, [derivedChannels, id]);

  const channelName = channel?.name ?? 'Featured Table';
  const playerRef = useRef<HTMLDivElement | null>(null);
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const relayRef = useRef<ViewerChannelRelay | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [status, setStatus] = useState<BroadcastStatus>(channel?.status ?? 'LIVE');
  const [isStreamRunning, setIsStreamRunning] = useState(channel?.status === 'LIVE');
  const [runtimeConfig] = useState<BroadcastRuntimeConfig>(() => getBroadcastRuntimeConfig());
  const activePublication = getBroadcastPublicationByChannelId(channel?.id);
  const publishedStream = getPublishedBroadcastLiveStream(channel?.id);
  const [relayStream, setRelayStream] = useState<MediaStream | null>(null);
  const effectiveStream = publishedStream ?? relayStream;
  const liveStreamUrl = activePublication?.streamUrl ?? '';
  const streamHasLiveVideoTrack = useMemo(
    () => Boolean(effectiveStream?.getVideoTracks().some((track) => track.readyState === 'live')),
    [effectiveStream]
  );
  const shouldAttemptLiveVideo = streamHasLiveVideoTrack || liveStreamUrl.trim().length > 0;

  const formatPlayerSystemId = (value: string | undefined) => {
    if (!value) return null;
    return `ID ${value.slice(0, 8)}`;
  };

  useEffect(() => {
    if (!channel) return;
    setStatus(channel.status);
    setIsStreamRunning(channel.status === 'LIVE');
  }, [channel]);

  useEffect(() => {
    return subscribeToBroadcastPublications(() => {
      setPublicationVersion((value) => value + 1);
    });
  }, []);

  useEffect(() => {
    const channelKey = channel?.id ?? '';
    if (!channelKey) {
      if (relayRef.current) {
        void relayRef.current.stop();
        relayRef.current = null;
      }
      setRelayStream(null);
      return;
    }

    let cancelled = false;
    setRelayStream(null);
    if (relayRef.current?.channelId === channelKey) {
      return;
    }

    void (async () => {
      try {
        if (relayRef.current) {
          await relayRef.current.stop();
          relayRef.current = null;
        }
        const relay = await createViewerChannelRelay(channelKey, (stream) => {
          if (!cancelled) {
            setRelayStream(stream);
          }
        });
        if (cancelled) {
          await relay.stop();
          return;
        }
        relayRef.current = relay;
      } catch {
        // relay is best effort; metadata-only fallback remains visible
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [channel?.id]);

  useEffect(() => {
    return () => {
      const relay = relayRef.current;
      relayRef.current = null;
      if (relay) {
        void relay.stop();
      }
    };
  }, []);

  useEffect(() => {
    const syncFullscreenState = () => {
      const doc = document as FullscreenDoc;
      const fullscreenElement = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.msFullscreenElement ?? null;
      setIsFullscreen(fullscreenElement === playerRef.current);
    };

    document.addEventListener('fullscreenchange', syncFullscreenState);
    document.addEventListener('webkitfullscreenchange', syncFullscreenState as EventListener);
    document.addEventListener('MSFullscreenChange', syncFullscreenState as EventListener);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
      document.removeEventListener('webkitfullscreenchange', syncFullscreenState as EventListener);
      document.removeEventListener('MSFullscreenChange', syncFullscreenState as EventListener);
    };
  }, []);

  useEffect(() => {
    setIsVideoReady(false);
  }, [channel?.id, liveStreamUrl, streamHasLiveVideoTrack]);

  useEffect(() => {
    const video = liveVideoRef.current;
    if (!video || !shouldAttemptLiveVideo) {
      if (video) {
        video.pause();
        video.srcObject = null;
        video.removeAttribute('src');
      }
      return;
    }
    video.muted = true;
    video.playsInline = true;
    if (effectiveStream) {
      if (video.srcObject !== effectiveStream) {
        video.removeAttribute('src');
        video.srcObject = effectiveStream;
      }
      void video.play().catch(() => setIsVideoReady(false));
      return;
    }
    if (video.src !== liveStreamUrl) {
      video.srcObject = null;
      video.src = liveStreamUrl;
      video.load();
    }
    void video.play().catch(() => setIsVideoReady(false));
  }, [effectiveStream, liveStreamUrl, shouldAttemptLiveVideo]);

  const toggleFullscreen = async () => {
    const doc = document as FullscreenDoc;
    const player = playerRef.current as FullscreenElement | null;
    if (!player) return;

    const fullscreenElement = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.msFullscreenElement ?? null;
    if (fullscreenElement === player) {
      if (doc.exitFullscreen) {
        await doc.exitFullscreen();
        return;
      }
      if (doc.webkitExitFullscreen) {
        await doc.webkitExitFullscreen();
        return;
      }
      if (doc.msExitFullscreen) {
        await doc.msExitFullscreen();
      }
      return;
    }

    if (player.requestFullscreen) {
      await player.requestFullscreen();
      return;
    }
    if (player.webkitRequestFullscreen) {
      await player.webkitRequestFullscreen();
      return;
    }
    if (player.msRequestFullscreen) {
      await player.msRequestFullscreen();
    }
  };

  const effectiveStatus: BroadcastStatus = isStreamRunning ? 'LIVE' : status;

  return (
    <div className="broadcast-layout">
      <main className="broadcast-main">
        <header className="broadcast-head">
          <div>
            <span className="live-chip">{effectiveStatus}</span>
            <h1>{channelName}</h1>
          </div>
          <Link className="guide-link" to="/tv-guide">Back to TV Guide</Link>
        </header>

        <section className="broadcast-player">
          <div className="player-surface" ref={playerRef}>
            {shouldAttemptLiveVideo ? (
              <video
                ref={liveVideoRef}
                className={`broadcast-live-video ${isVideoReady ? 'is-ready' : ''}`}
                autoPlay
                muted
                playsInline
                controls={false}
                onLoadedData={() => setIsVideoReady(true)}
                onCanPlay={() => setIsVideoReady(true)}
                onPlaying={() => setIsVideoReady(true)}
                onError={() => setIsVideoReady(false)}
              />
            ) : null}
            <div className="player-topbar">
              <div className="stream-meta">
                <span className="player-live">{isStreamRunning ? 'LIVE' : 'READY'}</span>
                <span className="stream-label">{channel?.now ?? 'Live tournament stream'}</span>
              </div>
              <button type="button" className="fullscreen-btn" onClick={toggleFullscreen}>
                {isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
              </button>
            </div>

            <div className="player-center">
              <div className="table-panel-mini">
                <span className="table-tag">{channel?.round ?? 'Table'}</span>
                {runtimeConfig.raceTrackingEnabled ? (
                  <div className="score-players">
                    <div className="player-summary">
                      <span className="player-name">{channel?.players?.[0]?.name ?? 'Player 1'}</span>
                      <span className="score-value">{channel?.players?.[0]?.score ?? 0}</span>
                    </div>
                    <span className="score-divider">:</span>
                    <div className="player-summary opponent">
                      <span className="score-value">{channel?.players?.[1]?.score ?? 0}</span>
                      <span className="player-name">{channel?.players?.[1]?.name ?? 'Player 2'}</span>
                    </div>
                  </div>
                ) : (
                  <div className="player-id-stack">
                    <div className="player-id-line">
                      <strong>{channel?.players?.[0]?.name ?? 'Player 1'}</strong>
                      {formatPlayerSystemId(channel?.players?.[0]?.id) && (
                        <small>{formatPlayerSystemId(channel?.players?.[0]?.id)}</small>
                      )}
                    </div>
                    <div className="player-id-line">
                      <strong>{channel?.players?.[1]?.name ?? 'Player 2'}</strong>
                      {formatPlayerSystemId(channel?.players?.[1]?.id) && (
                        <small>{formatPlayerSystemId(channel?.players?.[1]?.id)}</small>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {runtimeConfig.raceTrackingEnabled ? (
              <div className="player-scorebar">
                <strong>{channel?.players?.[0]?.name ?? 'Player 1'}</strong>
                <span className="score">{channel?.players?.[0]?.score ?? 0}</span>
                <span className="divider">-</span>
                <span className="score">{channel?.players?.[1]?.score ?? 0}</span>
                <strong>{channel?.players?.[1]?.name ?? 'Player 2'}</strong>
              </div>
            ) : (
              <div className="player-id-bar">
                Race tracking off. Overlay shows player names and linked IDs only.
              </div>
            )}
          </div>
        </section>


        <section className="broadcast-meta">
          <div className="meta-card">
            <h3>Now Playing</h3>
            <p>{channel?.now ?? 'Live tournament'} • {channel?.round ?? 'Live'} • {channel?.format ?? 'Tournament'}</p>
          </div>
          <div className="meta-card">
            <h3>Up Next</h3>
            <p>{channel?.next ?? 'Next match'}</p>
          </div>
        </section>
      </main>

      <aside className="broadcast-ad">
        <div className="ad-label">Brought to you by</div>
        <h2>Promethean Games</h2>
        <p>Play. Learn. Connect.</p>
      </aside>
    </div>
  );
}
