import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCurrentUser, getUserTierLabel } from '@/lib/auth';
import { useTournamentStore } from '@/store/tournamentStore';
import './Dashboard.css';

const DASHBOARD_METRICS_KEY = 'tdiab_dashboard_metrics';
const DEFAULT_VISIBLE_METRICS = ['live-broadcasts', 'live-viewers', 'active-venues', 'active-tds', 'total-players'];

const dashboardMetricCatalog = [
  { id: 'live-broadcasts', label: 'Live Broadcasts', value: '3', delta: '+50%', detail: 'vs last week', tone: 'red' },
  { id: 'live-viewers', label: 'Live Viewers', value: '412', delta: '+28%', detail: 'vs last week', tone: 'blue' },
  { id: 'total-broadcasts', label: 'Total Broadcasts', value: '28', delta: '+33%', detail: 'vs last week', tone: 'purple' },
  { id: 'active-venues', label: 'Active Venues', value: '27', delta: '+8%', detail: 'vs last week', tone: 'green' },
  { id: 'active-tds', label: 'Active TDs', value: '61', delta: '+12%', detail: 'vs last week', tone: 'amber' },
  { id: 'total-players', label: 'Total Players', value: '2,841', delta: '+18%', detail: 'vs last week', tone: 'violet' },
  { id: 'upcoming-events', label: 'Upcoming Events', value: '14', delta: '+6%', detail: 'this week', tone: 'cyan' },
  { id: 'new-players', label: 'New Players', value: '126', delta: '+22%', detail: 'this month', tone: 'pink' },
  { id: 'avg-entry-fee', label: 'Avg. Entry Fee', value: '$42', delta: '+9%', detail: 'this month', tone: 'gold' },
  { id: 'retention', label: 'Retention', value: '74%', delta: '+5%', detail: 'monthly', tone: 'mint' }
];

export default function Dashboard() {
  const { tournaments, fetchTournaments, loading } = useTournamentStore();
  const currentUser = getCurrentUser();
  const [showMetricMenu, setShowMetricMenu] = useState(false);
  const metricMenuRef = useRef<HTMLDivElement | null>(null);
  const [visibleMetrics, setVisibleMetrics] = useState<string[]>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_VISIBLE_METRICS;
    }

    try {
      const saved = window.localStorage.getItem(DASHBOARD_METRICS_KEY);
      if (!saved) {
        return DEFAULT_VISIBLE_METRICS;
      }

      const parsed = JSON.parse(saved) as string[];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return DEFAULT_VISIBLE_METRICS;
      }

      return parsed.filter((metricId) => dashboardMetricCatalog.some((metric) => metric.id === metricId));
    } catch {
      return DEFAULT_VISIBLE_METRICS;
    }
  });

  useEffect(() => {
    fetchTournaments();
  }, [fetchTournaments]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const nextVisible = visibleMetrics.length > 0 ? visibleMetrics : DEFAULT_VISIBLE_METRICS;
    window.localStorage.setItem(DASHBOARD_METRICS_KEY, JSON.stringify(nextVisible));
  }, [visibleMetrics]);

  useEffect(() => {
    if (!showMetricMenu) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!metricMenuRef.current?.contains(event.target as Node)) {
        setShowMetricMenu(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowMetricMenu(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showMetricMenu]);

  const quickActions = [
    { title: 'Create Tournament', subtitle: 'Start a new event', icon: '🏆', href: '/tournament/new' },
    { title: 'Manage Tournaments', subtitle: 'Open drafts and live events', icon: '📋', href: '/tournaments' },
    { title: 'Manage Series', subtitle: 'Leagues & ToC', icon: '📅', href: '/tournament/new' },
    { title: 'Go Live', subtitle: 'Broadcast setup', icon: '📺', href: '/tv-guide' }
  ];

  const safePlayerCount = (players: unknown) => {
    if (Array.isArray(players)) return players.length;
    if (typeof players === 'number') return players;
    return 0;
  };

  const tournamentList = Array.isArray(tournaments) ? tournaments : [];

  const showingRealTournaments = tournamentList.length > 0;
  const featuredTournaments = tournamentList.slice(0, 2).map((tournament) => ({
    ...tournament,
    href: `/tournament/${tournament.id}`,
    players: safePlayerCount(tournament.players),
    status: String(tournament.status || 'DRAFT')
  }));

  const selectedMetrics = showingRealTournaments
    ? dashboardMetricCatalog.filter((metric) => visibleMetrics.includes(metric.id) || visibleMetrics.length === 0)
    : [];

  const toggleMetric = (metricId: string) => {
    setVisibleMetrics((current) => {
      if (current.includes(metricId)) {
        return current.filter((id) => id !== metricId);
      }

      return [...current, metricId];
    });
  };

  const resetVisibleMetrics = () => setVisibleMetrics(DEFAULT_VISIBLE_METRICS);

  if (loading) return <div className="dashboard-loading">Loading tournaments...</div>;

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">TD<span className="accent">IAB</span></div>
        </div>

        <nav className="sidebar-nav" aria-label="Sidebar navigation">
          <Link className="sidebar-link active" to="/">
            <span className="icon">🏠</span> Dashboard
          </Link>
          <Link className="sidebar-link" to="/tournaments">
            <span className="icon">🏆</span> Tournaments
          </Link>
          <Link className="sidebar-link" to="/tournaments">
            <span className="icon">🧭</span> Manage Events
          </Link>
          <Link className="sidebar-link" to="/tournament/new">
            <span className="icon">📚</span> Series &amp; ToC
          </Link>
          <Link className="sidebar-link" to="/tv-guide">
            <span className="icon">📡</span> Broadcast
          </Link>
        </nav>

        <div className="sidebar-card">
          <span className="title">Your plan</span>
          <div className="plan-row">
            <div className="plan"><span>{getUserTierLabel(currentUser)}</span></div>
            <Link className="account-settings-link" to="/account" aria-label="Account settings">
              ⚙ Account
            </Link>
          </div>
          {currentUser.role === 'PLATFORM_ADMIN' ? (
            <Link className="upgrade-btn upgrade-btn--link" to="/admin">
              Open Admin Console
            </Link>
          ) : (
            <Link className="upgrade-btn upgrade-btn--link" to="/account?section=billing">
              Manage Plan
            </Link>
          )}
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="topbar">
          <div className="search-box">
            <span aria-hidden="true">⌕</span>
            <input type="text" placeholder="Search players, tournaments, venues..." />
          </div>

          <div className="topbar-meta">
            <div className="dashboard-metric-menu-wrap" ref={metricMenuRef}>
              <button
                type="button"
                className="settings-button"
                aria-label="Customize dashboard metrics"
                aria-expanded={showMetricMenu}
                aria-haspopup="dialog"
                onClick={() => setShowMetricMenu((current) => !current)}
                title="Customize dashboard"
              >
                ⚙
              </button>

              {showMetricMenu && (
                <div className="dashboard-metric-menu" role="dialog" aria-label="Dashboard metric visibility controls">
                  <div className="dashboard-metric-menu-head">
                    <strong>Dashboard Metrics</strong>
                    <span>Choose what appears on your command view.</span>
                  </div>
                  <div className="dashboard-metric-menu-list">
                  {dashboardMetricCatalog.map((metric) => (
                    <label key={metric.id} className="dashboard-metric-item">
                      <input
                        type="checkbox"
                        checked={visibleMetrics.includes(metric.id)}
                        onChange={() => toggleMetric(metric.id)}
                      />
                      <span className="dashboard-metric-checkbox" aria-hidden="true" />
                      <span className="dashboard-metric-item-copy">
                        <strong>{metric.label}</strong>
                        <small>{metric.detail}</small>
                      </span>
                    </label>
                  ))}
                  </div>

                  <button type="button" className="dashboard-metric-reset" onClick={() => {
                    resetVisibleMetrics();
                    setShowMetricMenu(false);
                  }}>
                    Reset visible metrics
                  </button>
                </div>
              )}
            </div>
            <div className="prometheus-pill">
              <span className="dot" />
              Promethean +
            </div>
          </div>
        </header>

        <section className="hero-row">
          <div>
            <div className="eyebrow">OPERATIONS</div>
            <h1 className="hero-title">Welcome back, Alan.</h1>
            <p className="hero-subtitle">Run tournaments. Build players. Grow the game.</p>
          </div>

          <div className="clock-box">
            <div className="small">Tue, Sep 16, 2026</div>
            <div className="time">4:27 PM</div>
          </div>
        </section>

        <section className="quick-actions">
          {quickActions.map(({ title, subtitle, icon, href }) => (
            <Link key={title} className="action-card" to={href}>
              <div className="icon-box" aria-hidden="true">{icon}</div>
              <div>
                <strong>{title}</strong>
                <span>{subtitle}</span>
              </div>
            </Link>
          ))}
        </section>

        <section className="metric-grid" data-empty={selectedMetrics.length === 0 ? 'true' : 'false'}>
          {selectedMetrics.map((metric) => (
            <article key={metric.id} className={`metric-card metric-card--${metric.tone}`}>
              <div className="metric-card__header">
                <span className="metric-card__icon">◉</span>
                <span>{metric.label}</span>
              </div>
              <div className="metric-card__body">
                <strong>{metric.value}</strong>
                <small>
                  <span className="trend trend--up">▲ {metric.delta}</span>
                  <span>{metric.detail}</span>
                </small>
              </div>
            </article>
          ))}
        </section>

        <section className="content-grid">
          <div className="panel">
            <div className="panel-header">
                <h3>Active Tournaments</h3>
                <Link className="link-inline" to="/tournaments">View All</Link>
              </div>

              {featuredTournaments.length === 0 ? (
                <div className="empty-state-panel">
                  <h4>No live events yet</h4>
                  <p>Create a tournament or connect your live data source to populate the dashboard.</p>
                </div>
              ) : (
                <div className="tournament-list">
                  {featuredTournaments.map((tournament) => (
                    <Link key={tournament.id} className="tournament-item" to={tournament.href}>
                      <div className="thumb" aria-hidden="true" />
                      <div className="item-copy">
                        <div className="meta">
                          <span className="status-pill">{String(tournament.status)}</span>
                          <span>{tournament.format}</span>
                        </div>
                        <h4>{tournament.name}</h4>
                        <div className="item-stats">
                          <span>{tournament.players} players</span>
                          <span>{tournament.status === 'LIVE' ? 'Round 16' : 'Finished'}</span>
                        </div>
                      </div>
                      <div className="badge-arrow" aria-hidden="true">›</div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

          <div className="panel panel--full-width">
            <div className="panel-header">
              <h3>Quick Access</h3>
              <Link className="link-inline" to="/tournaments">Manage</Link>
            </div>

            <div className="quick-access-grid">
              <Link className="quick-access-item" to="/tournament/new">
                <span className="icon">🏆</span>
                <div>
                  <strong>Players</strong>
                  <small>Roster &amp; entry management</small>
                </div>
              </Link>
              <Link className="quick-access-item" to="/tv-guide">
                <span className="icon">📡</span>
                <div>
                  <strong>Broadcast</strong>
                  <small>Stream control and guide</small>
                </div>
              </Link>
              <Link className="quick-access-item" to="/tournament/new">
                <span className="icon">⚙️</span>
                <div>
                  <strong>Settings</strong>
                  <small>Tournament configuration</small>
                </div>
              </Link>
            </div>
          </div>
        </section>

        <footer className="dashboard-footer">
          <Link to="/privacy-policy">Privacy Policy</Link>
          <span>·</span>
          <Link to="/terms-of-service">Terms of Service</Link>
        </footer>
      </main>

    </div>
  );
}
