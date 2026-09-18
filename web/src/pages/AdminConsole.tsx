import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCurrentUser, hasPermission, listEffectivePermissions } from '@/lib/auth';
import {
  getSystemBroadcastSponsorDefaults,
  saveSystemBroadcastSponsorDefaults,
  type BroadcastSponsorCard
} from '@/lib/broadcast';
import {
  getChannelRegistry,
  getVenueChannelChangeRequests,
  resolveVenueChannelChangeRequest
} from '@/lib/channel';
import { useTournamentStore } from '@/store/tournamentStore';
import './AdminConsole.css';

type AdminSectionId = 'overview' | 'people' | 'venues' | 'tdtv' | 'sponsorships' | 'events' | 'billing' | 'system';

const overviewMetrics = [
  {
    id: 'live-broadcasts',
    label: 'Live Broadcasts',
    value: '3',
    tone: 'red',
    delta: '+50%',
    detail: 'vs last week',
    sparkline: '0,32 24,27 56,18 80,22 118,12 170,16 220,9'
  },
  {
    id: 'live-viewers',
    label: 'Live Viewers',
    value: '412',
    tone: 'blue',
    delta: '+28%',
    detail: 'vs last week',
    sparkline: '0,34 20,30 45,25 68,19 92,23 120,20 150,18 180,15'
  },
  {
    id: 'total-broadcasts',
    label: 'Total Broadcasts',
    value: '28',
    tone: 'purple',
    delta: '+33%',
    detail: 'vs last week',
    sparkline: '0,28 20,26 40,20 68,17 96,15 124,18 160,12'
  },
  {
    id: 'active-venues',
    label: 'Active Venues',
    value: '27',
    tone: 'green',
    delta: '+8%',
    detail: 'vs last week',
    sparkline: '0,30 20,28 44,24 68,20 96,22 124,18 150,14'
  },
  {
    id: 'active-tds',
    label: 'Active TDs',
    value: '61',
    tone: 'amber',
    delta: '+12%',
    detail: 'vs last week',
    sparkline: '0,35 24,29 52,26 84,22 110,20 140,18 180,10'
  },
  {
    id: 'total-players',
    label: 'Total Players',
    value: '2,841',
    tone: 'violet',
    delta: '+18%',
    detail: 'vs last week',
    sparkline: '0,38 26,34 52,27 85,24 115,21 146,18 180,15'
  },
  {
    id: 'venue-channels',
    label: 'Venue Channels',
    value: '27 / 200',
    tone: 'cyan',
    delta: '+4%',
    detail: 'capacity used',
    sparkline: '0,35 28,33 58,29 88,23 120,20 150,16 180,12'
  }
] as const;

const adminSections = [
  { id: 'overview', label: 'Overview' },
  { id: 'people', label: 'People' },
  { id: 'venues', label: 'Venues' },
  { id: 'tdtv', label: 'TDTV' },
  { id: 'sponsorships', label: 'Sponsorships' },
  { id: 'events', label: 'Events' },
  { id: 'billing', label: 'Billing' },
  { id: 'system', label: 'System' }
] as const;

const defaultOverviewMetrics = overviewMetrics.map((metric) => metric.id);

function formatAdminTournamentStage(
  status: 'DRAFT' | 'READY' | 'ACTIVE' | 'COMPLETED',
  bracketGenerated: boolean,
  matches: { round: number; state: string }[]
): string {
  if (!bracketGenerated) return status === 'DRAFT' ? 'Setup' : 'Bracket Pending';
  if (status === 'COMPLETED') return 'Final Results';
  const nextRound =
    matches
      .filter((match) => match.state !== 'COMPLETE')
      .sort((a, b) => a.round - b.round)[0]?.round ?? matches[matches.length - 1]?.round ?? 0;
  const roundMatchCount = matches.filter((match) => match.round === nextRound).length;
  if (roundMatchCount <= 1) return 'Final';
  if (roundMatchCount === 2) return 'Semifinal';
  if (roundMatchCount === 4) return 'Quarterfinal';
  return roundMatchCount > 0 ? `Round of ${roundMatchCount * 2}` : 'Opening Round';
}

function getAdminEventTone(status: 'DRAFT' | 'READY' | 'ACTIVE' | 'COMPLETED'): 'red' | 'amber' | 'blue' | 'green' {
  if (status === 'ACTIVE') return 'red';
  if (status === 'READY') return 'amber';
  if (status === 'COMPLETED') return 'green';
  return 'blue';
}

export default function AdminConsole() {
  const currentUser = getCurrentUser();
  const { tournaments } = useTournamentStore();
  const [activeSection, setActiveSection] = useState<AdminSectionId>('overview');
  const [showMetricMenu, setShowMetricMenu] = useState(false);
  const [visibleOverviewMetrics, setVisibleOverviewMetrics] = useState<string[]>(defaultOverviewMetrics);
  const [allChannels, setAllChannels] = useState(() => getChannelRegistry());
  const [venueChannelRequests, setVenueChannelRequests] = useState(() => getVenueChannelChangeRequests());
  const [systemSponsorDefaults, setSystemSponsorDefaults] = useState<BroadcastSponsorCard[]>(() => getSystemBroadcastSponsorDefaults());
  const [sponsorshipStatus, setSponsorshipStatus] = useState<string>('');

  const permissions = useMemo(() => listEffectivePermissions(currentUser), [currentUser]);
  const overviewCardSet = overviewMetrics.filter((metric) => visibleOverviewMetrics.includes(metric.id));
  const pendingVenueChannelRequests = venueChannelRequests.filter((request) => request.status === 'PENDING');
  const eventGuideItems = useMemo(
    () =>
      tournaments.map((tournament) => ({
        id: tournament.id,
        name: tournament.name,
        format: tournament.format.replaceAll('_', ' '),
        players: tournament.players.length,
        tables: tournament.tableCount,
        status: tournament.status,
        tone: getAdminEventTone(tournament.status),
        stage: formatAdminTournamentStage(tournament.status, tournament.bracketGenerated, tournament.matches),
        activeMatches: tournament.matches.filter((match) => match.state === 'READY' || match.state === 'IN_PROGRESS').length
      })),
    [tournaments]
  );

  const sectionData = useMemo(() => {
    const baseCards = [
      { title: 'Verified account', value: currentUser.email || 'No email on file', detail: currentUser.role },
      { title: 'Tier', value: currentUser.tier, detail: 'Subscription access' },
      { title: 'Status', value: currentUser.status, detail: currentUser.verified ? 'Verified' : 'Unverified' },
      { title: 'Permissions', value: String(permissions.length), detail: 'Effective permissions' }
    ];

    switch (activeSection) {
      case 'overview':
        return [
          ...baseCards,
          { title: 'Channels', value: String(allChannels.length), detail: 'Channel registry entries' },
          { title: 'Tournaments', value: String(tournaments.length), detail: tournaments.length ? 'Stored records' : 'No tournaments yet' }
        ];
      case 'people':
        return [
          { title: 'User identity', value: currentUser.name, detail: currentUser.email },
          { title: 'Role', value: currentUser.role, detail: 'Administrative responsibility' },
          { title: 'Venue access', value: String(currentUser.venueIds.length), detail: 'Associated venue records' },
          { title: 'TD profile', value: currentUser.tdProfileId ?? 'Not assigned', detail: currentUser.tdProfileId ? 'Linked TD record' : 'No TD profile attached' }
        ];
      case 'venues': {
        const venueChannels = allChannels.filter((channel) => channel.type === 'VENUE');
        return venueChannels.length > 0
          ? venueChannels.map((channel) => ({
              title: channel.entityName,
              value: `Channel ${channel.number}`,
              detail: channel.status
            }))
          : [{ title: 'No venue records', value: 'Awaiting setup', detail: 'Create a venue to populate this pane.' }];
      }
      case 'tdtv': {
        const tdChannels = allChannels.filter((channel) => channel.type === 'TD');
        return tdChannels.length > 0
          ? tdChannels.map((channel) => ({
              title: channel.entityName,
              value: `Channel ${channel.number}`,
              detail: channel.status
            }))
          : [{ title: 'No TD channel records', value: 'Awaiting assignment', detail: 'TD channel data appears here when available.' }];
      }
      case 'sponsorships':
        return [
          { title: 'Permanent slots', value: String(systemSponsorDefaults.length), detail: 'System-wide broadcast defaults' },
          { title: 'Default duration', value: `${systemSponsorDefaults[0]?.durationSeconds ?? 15}s`, detail: 'Applied to new tournament sponsor configs' }
        ];
      case 'billing':
        return [
          { title: 'Subscription tier', value: currentUser.tier, detail: 'Current plan' },
          { title: 'Billing state', value: 'Not configured', detail: 'Source of truth remains external billing' },
          { title: 'Account status', value: currentUser.status, detail: currentUser.verified ? 'Verified admin' : 'Needs verification' }
        ];
      case 'system':
        return [
          { title: 'Permission model', value: String(permissions.length), detail: 'Effective access checks' },
          { title: 'Channel registry', value: String(allChannels.length), detail: 'Stored channel allocations' },
          { title: 'Audit trail', value: 'Ready', detail: 'Administrative actions can be recorded here' }
        ];
      default:
        return [];
    }
  }, [activeSection, allChannels, currentUser, permissions, systemSponsorDefaults, tournaments]);

  if (!hasPermission(currentUser, 'platform.manage_users')) {
    return (
      <div className="admin-console admin-console--denied">
        <div className="denied-card">
          <span className="denied-lock">🔒</span>
          <h1>Verification required</h1>
          <p>This platform admin account has not been verified. Access is restricted to the authorized administrator.</p>
          <Link className="primary-btn" to="/">Return to dashboard</Link>
        </div>
      </div>
    );
  }

  const toggleOverviewMetric = (metricId: string) => {
    setVisibleOverviewMetrics((current) => {
      if (current.includes(metricId)) {
        return current.filter((id) => id !== metricId);
      }
      return [...current, metricId];
    });
  };

  const refreshAdminData = () => {
    setAllChannels(getChannelRegistry());
    setVenueChannelRequests(getVenueChannelChangeRequests());
    setSystemSponsorDefaults(getSystemBroadcastSponsorDefaults());
  };

  const handleSystemSponsorFieldChange = (
    sponsorId: string,
    field: 'name' | 'durationSeconds' | 'marketingBlip',
    value: string
  ) => {
    setSystemSponsorDefaults((current) =>
      current.map((sponsor) => {
        if (sponsor.id !== sponsorId) return sponsor;
        if (field === 'durationSeconds') {
          return { ...sponsor, durationSeconds: Math.max(5, Math.floor(Number(value) || sponsor.durationSeconds || 15)) };
        }
        if (field === 'marketingBlip') {
          return { ...sponsor, marketingBlip: value };
        }
        return { ...sponsor, name: value };
      })
    );
    setSponsorshipStatus('');
  };

  const handleSystemSponsorLogoUpload = (sponsorId: string, file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      setSystemSponsorDefaults((current) =>
        current.map((sponsor) => (sponsor.id === sponsorId ? { ...sponsor, logoDataUrl: result } : sponsor))
      );
      setSponsorshipStatus('');
    };
    reader.readAsDataURL(file);
  };

  const handleSaveSystemSponsorDefaults = () => {
    setSystemSponsorDefaults(saveSystemBroadcastSponsorDefaults(systemSponsorDefaults));
    setSponsorshipStatus('System-wide sponsorship defaults updated.');
  };

  const handleVenueChannelDecision = (requestId: string, decision: 'APPROVED' | 'DENIED') => {
    try {
      resolveVenueChannelChangeRequest(requestId, decision, currentUser.name || currentUser.email || 'Platform Admin');
      refreshAdminData();
    } catch (decisionError) {
      window.alert(decisionError instanceof Error ? decisionError.message : 'Unable to process venue channel request.');
    }
  };

  return (
    <div className="admin-console">
      <aside className="admin-console__sidebar">
        <div className="brand-block">
          <div className="brand-mark">TD<span>IAB</span></div>
          <span className="mini-label">ADMIN CONSOLE</span>
        </div>

        <div className="admin-console__sidebar-meta">
          <span className="sidebar-security-pill">Verified access only</span>
          <p>Platform controls are isolated from customer workflows and gated behind the verified admin account.</p>
        </div>

        <nav className="admin-console__nav" aria-label="Admin navigation">
          {adminSections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`admin-nav-item ${activeSection === section.id ? 'is-active' : ''}`}
              onClick={() => setActiveSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-stats">
          <div>
            <span>Channels</span>
            <strong>{allChannels.length}</strong>
          </div>
          <div>
            <span>Events</span>
            <strong>{tournaments.length}</strong>
          </div>
          <div>
            <span>Role</span>
            <strong>{currentUser.role}</strong>
          </div>
        </div>
      </aside>

      <main className="admin-console__content">
        <header className="admin-console__topbar">
          <div className="admin-console__topbar-meta">
            <span className="eyebrow">Operational overview</span>
            <h1>Platform Admin</h1>
          </div>
          <div className="admin-console__topbar-actions">
            <span className="topbar-date">{new Date().toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            <button type="button" className="topbar-icon" aria-label="notifications">{pendingVenueChannelRequests.length}</button>
            <div className="topbar-user">
              <span className="topbar-user__avatar">{currentUser.name.slice(0, 2).toUpperCase() || 'AA'}</span>
              <span>{currentUser.name || 'Admin'}</span>
            </div>
          </div>
        </header>

        <div className="admin-console__workspace">
          <div className="admin-console__pane-header">
            <div>
              <span className="eyebrow">{activeSection}</span>
              <h2>{adminSections.find((section) => section.id === activeSection)?.label}</h2>
            </div>
            <div className="admin-console__pane-actions">
              {activeSection === 'overview' && (
                <div className="metric-menu-wrap">
                  <button
                    type="button"
                    className="ghost-btn ghost-btn--compact metric-menu-trigger"
                    aria-label="Toggle overview metric visibility"
                    onClick={() => setShowMetricMenu((current) => !current)}
                  >
                    ⚙
                  </button>

                  {showMetricMenu && (
                    <div className="metric-menu-dropdown" role="menu" aria-label="Overview metric visibility controls">
                      {overviewMetrics.map((metric) => (
                        <label key={metric.id} className="metric-menu-item" role="menuitemcheckbox" aria-checked={visibleOverviewMetrics.includes(metric.id)}>
                          <input
                            type="checkbox"
                            checked={visibleOverviewMetrics.includes(metric.id)}
                            onChange={() => toggleOverviewMetric(metric.id)}
                          />
                          <span>{metric.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button type="button" className="ghost-btn ghost-btn--compact" onClick={refreshAdminData}>Refresh</button>
            </div>
          </div>

          {activeSection === 'overview' ? (
            <>
              <section className="metric-grid">
                {overviewCardSet.map((metric) => (
                  <div key={metric.id} className={`metric-card metric-card--${metric.tone}`}>
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

                    <svg className="sparkline" viewBox="0 0 180 40" preserveAspectRatio="none" aria-hidden="true">
                      <polyline points={metric.sparkline} />
                    </svg>
                  </div>
                ))}
              </section>

              {overviewCardSet.length === 0 && (
                <div className="admin-empty-state">
                  <h3>No overview tiles selected</h3>
                  <p>Choose metrics above to restore the platform admin overview.</p>
                </div>
              )}
            </>
          ) : activeSection === 'sponsorships' ? (
            <div className="admin-sponsorship-layout">
              <div className="admin-panel-grid">
                {sectionData.map((item) => (
                  <article key={`${activeSection}-${item.title}`} className="admin-panel-card">
                    <span className="admin-panel-card__label">{item.title}</span>
                    <strong>{item.value}</strong>
                    <small>{item.detail}</small>
                  </article>
                ))}
              </div>

              <section className="admin-sponsorship-panel">
                <div className="admin-sponsorship-head">
                  <div>
                    <h3>System Broadcast Sponsorship Defaults</h3>
                    <p>These permanent cards flow into every tournament broadcast setup across the platform.</p>
                  </div>
                  <button type="button" className="primary-btn" onClick={handleSaveSystemSponsorDefaults}>
                    Save sponsorship defaults
                  </button>
                </div>

                {sponsorshipStatus ? <p className="admin-sponsorship-status">{sponsorshipStatus}</p> : null}

                <div className="admin-sponsorship-list">
                  {systemSponsorDefaults.map((sponsor) => (
                    <article key={sponsor.id} className="admin-sponsorship-card">
                      <div className="admin-sponsorship-preview">
                        {sponsor.logoDataUrl ? <img src={sponsor.logoDataUrl} alt={`${sponsor.name} logo`} /> : <span>LOGO</span>}
                      </div>
                      <div className="admin-sponsorship-fields">
                        <label className="admin-field">
                          <span>Title</span>
                          <input
                            type="text"
                            value={sponsor.name}
                            onChange={(event) => handleSystemSponsorFieldChange(sponsor.id, 'name', event.target.value)}
                          />
                        </label>
                        <label className="admin-field">
                          <span title="Minimum permanent slot duration is 5 seconds.">Default duration (seconds)</span>
                          <input
                            type="number"
                            min={5}
                            value={sponsor.durationSeconds}
                            onChange={(event) => handleSystemSponsorFieldChange(sponsor.id, 'durationSeconds', event.target.value)}
                          />
                        </label>
                        <label className="admin-field admin-field--wide">
                          <span>Marketing blurb</span>
                          <textarea
                            value={sponsor.marketingBlip ?? ''}
                            rows={3}
                            onChange={(event) => handleSystemSponsorFieldChange(sponsor.id, 'marketingBlip', event.target.value)}
                          />
                        </label>
                        <label className="admin-field admin-field--wide">
                          <span>Logo</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(event) => handleSystemSponsorLogoUpload(sponsor.id, event.target.files?.[0] ?? null)}
                          />
                        </label>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          ) : activeSection === 'events' ? (
            eventGuideItems.length === 0 ? (
              <div className="admin-empty-state">
                <h3>No events yet</h3>
                <p>New tournament records will appear here as a compact guide once they are created.</p>
              </div>
            ) : (
              <section className="event-guide-panel">
                <div className="event-guide-head">
                  <span className="eyebrow">Movie Guide View</span>
                  <p>Track what is setting up, queued, live, and completed at a glance.</p>
                </div>
                <div className="event-guide-list">
                  {eventGuideItems.map((event) => (
                    <article key={event.id} className={`event-guide-row event-guide-row--${event.tone}`}>
                      <div className="event-guide-channel">
                        <span className={`event-status-pill event-status-pill--${event.tone}`}>{event.status}</span>
                        <strong>{event.stage}</strong>
                      </div>
                      <div className="event-guide-copy">
                        <h3>{event.name}</h3>
                        <p>{event.format}</p>
                      </div>
                      <div className="event-guide-meta">
                        <span>{event.players} players</span>
                        <span>{event.tables} tables</span>
                        <span>{event.activeMatches} live match{event.activeMatches === 1 ? '' : 'es'}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )
          ) : sectionData.length === 0 ? (
            <div className="admin-empty-state">
              <h3>No data available</h3>
              <p>Content will appear here when this area has live records or assigned entities.</p>
            </div>
          ) : (
            <>
              <div className="admin-panel-grid">
                {sectionData.map((item) => (
                  <article key={`${activeSection}-${item.title}`} className="admin-panel-card">
                    <span className="admin-panel-card__label">{item.title}</span>
                    <strong>{item.value}</strong>
                    <small>{item.detail}</small>
                  </article>
                ))}
              </div>
              {activeSection === 'venues' && (
                <section className="venue-request-admin-panel">
                  <h3>Venue channel change requests</h3>
                  {venueChannelRequests.length === 0 ? (
                    <p>No venue channel requests submitted yet.</p>
                  ) : (
                    <div className="venue-request-admin-list">
                      {venueChannelRequests.map((request) => (
                        <article key={request.id} className="venue-request-admin-row">
                          <div>
                            <strong>{request.venueName}</strong>
                            <small>
                              Requested VENUE-{String(request.requestedChannelNumber).padStart(3, '0')} - {request.requestedChannelName}
                            </small>
                          </div>
                          <div className="venue-request-admin-status">{request.status}</div>
                          {request.status === 'PENDING' ? (
                            <div className="venue-request-admin-actions">
                              <button
                                type="button"
                                className="ghost-btn ghost-btn--small"
                                onClick={() => handleVenueChannelDecision(request.id, 'APPROVED')}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                className="ghost-btn ghost-btn--small"
                                onClick={() => handleVenueChannelDecision(request.id, 'DENIED')}
                              >
                                Deny
                              </button>
                            </div>
                          ) : (
                            <small className="venue-request-admin-reviewed">
                              {request.reviewedBy ? `Reviewed by ${request.reviewedBy}` : 'Resolved'}
                            </small>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
