import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { deriveBroadcastChannelsFromTournaments, subscribeToBroadcastPublications } from '@/lib/broadcast';
import { useTournamentStore } from '@/store/tournamentStore';
import './TvGuide.css';

const filters = ['All', 'Live', 'Standby', 'Featured'];

export default function TvGuide() {
  const navigate = useNavigate();
  const { tournaments } = useTournamentStore();
  const [, setPublicationVersion] = useState(0);
  const channels = deriveBroadcastChannelsFromTournaments(tournaments);
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>('All');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [jumpChannel, setJumpChannel] = useState(0);

  useEffect(() => {
    return subscribeToBroadcastPublications(() => {
      setPublicationVersion((value) => value + 1);
    });
  }, []);

  const filteredChannels = useMemo(() => {
    return channels.filter((channel) => {
      const filterPass =
        activeFilter === 'All' ||
        (activeFilter === 'Live' && channel.status === 'LIVE') ||
        (activeFilter === 'Standby' && channel.status !== 'LIVE') ||
        (activeFilter === 'Featured' && channel.id === 'featured');

      const q = query.trim().toLowerCase();
      if (!q) return filterPass;
      return (
        filterPass &&
        (`${channel.number} ${channel.name} ${channel.now} ${channel.next}`.toLowerCase().includes(q))
      );
    });
  }, [activeFilter, channels, query]);

  useEffect(() => {
    if (filteredChannels.length === 0) {
      setSelectedIndex(0);
      return;
    }
    if (selectedIndex > filteredChannels.length - 1) {
      setSelectedIndex(filteredChannels.length - 1);
    }
  }, [filteredChannels, selectedIndex]);

  const tuneToSelected = () => {
    if (filteredChannels.length === 0) return;
    const target = filteredChannels[selectedIndex];
    if (target) navigate(target.route);
  };

  const tuneToChannel = () => {
    const found = channels.find((channel) => Number(channel.number) === jumpChannel);
    if (found) {
      navigate(found.route);
    }
  };

  const handleRemoteKeys: React.KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (filteredChannels.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filteredChannels.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        tuneToSelected();
      }
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setJumpChannel((prev) => Math.min(prev + 1, channels.length));
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setJumpChannel((prev) => Math.max(prev - 1, 0));
    }
  };

  return (
    <div className="tdtv-page" tabIndex={0} onKeyDown={handleRemoteKeys}>
      <aside className="tdtv-rail">
        <div className="tdtv-logo">TDTV</div>
        <nav className="tdtv-rail-nav" aria-label="TDTV sections">
          <a className="active" href="#live">Live TV</a>
          <a href="#guide">Guide</a>
          <a href="#featured">Featured</a>
          <Link to="/tournaments">Tournaments</Link>
        </nav>
      </aside>

      <main className="tdtv-main">
        <header className="tdtv-topbar">
          <h1>Live TV</h1>
          <div className="tdtv-topbar-actions">
            <Link className="viewer-portal-link" to="/tdtv">Open Viewer Portal</Link>
            <input
              className="tdtv-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search channel name or match..."
              aria-label="Search channels"
            />
          </div>
        </header>

        <section className="remote-toolbar">
          <div className="filter-chips" role="tablist" aria-label="Channel filters">
            {filters.map((filter) => (
              <button
                key={filter}
                type="button"
                className={`chip ${activeFilter === filter ? 'active' : ''}`}
                onClick={() => setActiveFilter(filter)}
              >
                {filter}
              </button>
            ))}
          </div>

          <div className="jump-panel">
            <span>Jump to channel</span>
            <div className="jump-controls">
              <button type="button" onClick={() => setJumpChannel((prev) => Math.max(prev - 1, 0))}>◀</button>
              <strong>{String(jumpChannel).padStart(2, '0')}</strong>
              <button type="button" onClick={() => setJumpChannel((prev) => Math.min(prev + 1, channels.length))}>▶</button>
              <button type="button" className="tune-btn" onClick={tuneToChannel}>Tune</button>
            </div>
          </div>
        </section>

        {channels.length === 0 ? (
          <section id="live" className="tdtv-hero empty-hero">
            <div className="hero-video hero-video--empty">
              <span className="live-pill">STANDBY</span>
              <div className="hero-overlay">
                <strong>No live broadcast yet</strong>
                <span>Set up a tournament and assign a featured table to publish live content.</span>
              </div>
            </div>
            <div className="hero-info">
              <h2>Broadcast queue is empty</h2>
              <p>Your live view will appear as soon as a tournament is assigned to the network.</p>
            </div>
          </section>
        ) : (
          <section id="live" className="tdtv-hero">
            <div className="hero-video">
              <span className="live-pill">LIVE NOW</span>
              <div className="hero-overlay">
                <strong>{channels[0]?.now ?? 'Live event'}</strong>
                <span>{channels[0]?.name ?? 'Featured table'} • {channels[0]?.next ?? 'Awaiting match'}</span>
              </div>
            </div>
            <div className="hero-info">
              <h2>{channels[0]?.name ?? 'Featured Table'}</h2>
              <p>{channels[0]?.venue ?? 'Venue'} • {channels[0]?.location ?? 'Location pending'}</p>
              <div className="hero-tags">
                <span>{channels[0]?.format ?? 'Tournament'}</span>
                <span>{channels[0]?.round ?? 'Ready'}</span>
                <span>{channels[0]?.status === 'LIVE' ? 'Live' : 'Standby'}</span>
              </div>
              <Link className="watch-btn" to={channels[0]?.route ?? '/tournaments'}>Watch Live</Link>
            </div>
          </section>
        )}

        <section id="guide" className="tdtv-guide">
          <div className="section-head">
            <h3>Channel Guide</h3>
            <span>Use remote ↑ ↓ and press OK</span>
          </div>

          <div className="guide-rows">
            {filteredChannels.map((channel, index) => (
              <button
                key={channel.id}
                type="button"
                className={`guide-row ${selectedIndex === index ? 'selected' : ''}`}
                onClick={() => navigate(channel.route)}
                onFocus={() => setSelectedIndex(index)}
              >
                <div className="guide-channel">
                  <span className="guide-number">{channel.number}</span>
                  <strong>{channel.name}</strong>
                </div>
                <div className="guide-now">
                  <span className={`status ${channel.status === 'LIVE' ? 'live' : ''}`}>{channel.status}</span>
                  <p>{channel.now}</p>
                </div>
                <div className="guide-next">{channel.next}</div>
              </button>
            ))}
            {filteredChannels.length === 0 && <div className="no-results">No channels match your search.</div>}
          </div>
        </section>
      </main>

      <aside className="tdtv-ad">
        <div className="ad-label">Brought to you by</div>
        <h3>Promethean Games</h3>
        <p>Play. Learn. Connect.</p>
      </aside>
    </div>
  );
}
