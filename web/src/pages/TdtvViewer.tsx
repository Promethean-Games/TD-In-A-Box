import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  deriveBroadcastChannelsFromTournaments,
  getBroadcastPublicationByChannelId,
  getBroadcastChannelById,
  getPublishedBroadcastLiveStream,
  subscribeToBroadcastPublications,
  getTdtvLobbySlides,
  TDTV_LOOP_CHANNEL_ID
} from '@/lib/broadcast';
import { useTournamentStore } from '@/store/tournamentStore';
import './TdtvViewer.css';

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

export default function TdtvViewer() {
  const { channelId } = useParams<{ channelId?: string }>();
  const navigate = useNavigate();
  const { tournaments } = useTournamentStore();
  const [, setPublicationVersion] = useState(0);
  const channels = deriveBroadcastChannelsFromTournaments(tournaments);
  const lobbySlides = useMemo(() => getTdtvLobbySlides(tournaments), [tournaments]);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [lobbySlideIndex, setLobbySlideIndex] = useState(0);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);

  const filteredChannels = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter((channel) => {
      return `${channel.name} ${channel.venue} ${channel.location} ${channel.now} ${channel.next}`.toLowerCase().includes(q);
    });
  }, [channels, query]);

  const activeChannel = useMemo(() => {
    const byRoute = getBroadcastChannelById(channelId);
    const fallback = byRoute ?? filteredChannels[0] ?? getBroadcastChannelById(channels[0]?.id);

    return {
      id: fallback?.id ?? 'empty',
      name: fallback?.name ?? 'Featured table',
      venue: fallback?.venue ?? 'Venue pending',
      location: fallback?.location ?? 'Location pending',
      now: fallback?.now ?? 'No live stream selected',
      next: fallback?.next ?? 'Awaiting match assignment',
      watching: fallback?.watching ?? 0,
      route: fallback?.route ?? '/tournaments'
    };
  }, [channelId, filteredChannels, channels]);
  const isLobbyChannel = activeChannel.id === TDTV_LOOP_CHANNEL_ID;
  const activeLobbySlide = lobbySlides[lobbySlideIndex % Math.max(1, lobbySlides.length)] ?? null;
  const activePublication = getBroadcastPublicationByChannelId(activeChannel.id);
  const publishedStream = getPublishedBroadcastLiveStream(activeChannel.id);
  const liveStreamUrl = isLobbyChannel ? '' : (activePublication?.streamUrl ?? '');
  const streamHasLiveVideoTrack = useMemo(
    () => Boolean(publishedStream?.getVideoTracks().some((track) => track.readyState === 'live')),
    [publishedStream]
  );
  const shouldAttemptLiveVideo = !isLobbyChannel && (streamHasLiveVideoTrack || liveStreamUrl.trim().length > 0);

  useEffect(() => {
    return subscribeToBroadcastPublications(() => {
      setPublicationVersion((value) => value + 1);
    });
  }, []);

  useEffect(() => {
    const index = filteredChannels.findIndex((channel) => channel.id === activeChannel.id);
    if (index >= 0) setSelectedIndex(index);
  }, [activeChannel.id, filteredChannels]);

  useEffect(() => {
    if (!isLobbyChannel || lobbySlides.length === 0) return;
    const timer = window.setInterval(() => {
      setLobbySlideIndex((current) => (current + 1) % lobbySlides.length);
    }, 15000);
    return () => {
      window.clearInterval(timer);
    };
  }, [isLobbyChannel, lobbySlides.length]);

  useEffect(() => {
    setIsVideoReady(false);
  }, [activeChannel.id, liveStreamUrl, streamHasLiveVideoTrack]);

  useEffect(() => {
    const video = liveVideoRef.current;
    if (!video || !shouldAttemptLiveVideo || isLobbyChannel) {
      if (video) {
        video.pause();
        video.srcObject = null;
        video.removeAttribute('src');
      }
      return;
    }
    video.muted = true;
    video.playsInline = true;
    if (publishedStream) {
      if (video.srcObject !== publishedStream) {
        video.removeAttribute('src');
        video.srcObject = publishedStream;
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
  }, [isLobbyChannel, liveStreamUrl, publishedStream, shouldAttemptLiveVideo]);

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

  const handleRemoteKeys: React.KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (filteredChannels.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = Math.min(selectedIndex + 1, filteredChannels.length - 1);
      setSelectedIndex(next);
      navigate(`/tdtv/channel/${filteredChannels[next].id}`);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = Math.max(selectedIndex - 1, 0);
      setSelectedIndex(next);
      navigate(`/tdtv/channel/${filteredChannels[next].id}`);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = filteredChannels[selectedIndex];
      if (target) navigate(`/tdtv/channel/${target.id}`);
    }
  };

  return (
    <div className="tdtv-viewer-page" tabIndex={0} onKeyDown={handleRemoteKeys}>
      <header className="viewer-header">
        <div className="viewer-brand">
          <strong>TDTV</strong>
          <span>Live pool streams across the states</span>
        </div>
        <input
          className="viewer-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search states, venues, channels..."
          aria-label="Search TDTV channels"
        />
      </header>

      <div className="viewer-layout">
        {filteredChannels.length === 0 ? (
          <main className="viewer-main viewer-main--empty">
            <section className="viewer-player viewer-player--empty" ref={playerRef}>
              <div className="player-head">
                <span className="live-pill live-pill--standby">STANDBY</span>
              </div>
              <div className="player-overlay">
                <h1>No live channel available</h1>
                <p>Assign a tournament to a live table to publish stream data.</p>
              </div>
            </section>
            <section className="viewer-info">
              <div>
                <h2>Broadcast queue empty</h2>
                <p>Once a featured table becomes active, it will appear here automatically.</p>
              </div>
            </section>
          </main>
        ) : (
          <main className="viewer-main">
            <section className="viewer-player" ref={playerRef}>
              {shouldAttemptLiveVideo ? (
                <video
                  ref={liveVideoRef}
                  className={`viewer-live-video ${isVideoReady ? 'is-ready' : ''}`}
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
              <div className="player-head">
                <span className="live-pill">{isLobbyChannel ? 'TDTV LOOP' : 'LIVE NOW'}</span>
                <button type="button" className="fullscreen-btn" onClick={toggleFullscreen}>
                  {isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
                </button>
              </div>
              <div className="player-overlay">
                {isLobbyChannel && activeLobbySlide?.logoDataUrl ? (
                  <div className="loop-sponsor-lockup">
                    <img src={activeLobbySlide.logoDataUrl} alt={`${activeLobbySlide.title} logo`} />
                  </div>
                ) : null}
                <h1>{isLobbyChannel ? activeLobbySlide?.title ?? activeChannel.now : activeChannel.now}</h1>
                <p>
                  {isLobbyChannel
                    ? activeLobbySlide?.body ?? 'TDTV network programming loop.'
                    : `${activeChannel.venue} • ${activeChannel.location}`}
                </p>
              </div>
            </section>

            <section className="viewer-info">
              <div>
                <h2>{activeChannel.name}</h2>
                <p>{isLobbyChannel ? '24/7 auto-generated one-minute loop.' : `Up next: ${activeChannel.next}`}</p>
              </div>
              <div className="watching">{activeChannel.watching} watching</div>
            </section>
          </main>
        )}

        <aside className="viewer-rail">
          <div className="rail-title">
            <h3>Channels</h3>
            <span>Use remote ↑ ↓</span>
          </div>
          <div className="channel-list">
            {filteredChannels.map((channel, index) => (
              <Link
                key={channel.id}
                className={`channel-item ${activeChannel.id === channel.id ? 'active' : ''} ${selectedIndex === index ? 'selected' : ''}`}
                to={`/tdtv/channel/${channel.id}`}
                onFocus={() => setSelectedIndex(index)}
              >
                <strong>{channel.number} • {channel.name}</strong>
                <span>{channel.location}</span>
              </Link>
            ))}
            {filteredChannels.length === 0 && <div className="empty-channels">No channels found.</div>}
          </div>
        </aside>

        <aside className="viewer-ad">
          <div className="ad-label">Brought to you by</div>
          <h3>Promethean Games</h3>
          <p>Play. Learn. Connect.</p>
        </aside>
      </div>
    </div>
  );
}
