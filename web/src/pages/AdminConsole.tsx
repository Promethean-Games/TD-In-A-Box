import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

interface AdminEntityRecord {
  id: string;
  name: string;
  type: 'USER' | 'TD' | 'VENUE' | 'PLAYER' | 'CHANNEL' | 'TOURNAMENT' | 'BROADCAST';
  group: 'people' | 'tdtv' | 'events';
  status: string;
  identifier: string;
  detail: string;
  actions: string[];
}
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
import { getAuditLogEntries, recordAuditAction } from '@/lib/audit';
import {
  formatApplicationReportTimestamp,
  getApplicationReportInstanceKey,
  getApplicationReportInstanceLabel,
  readCachedApplicationReports,
  listApplicationReports,
  type ApplicationReport
} from '@/lib/applicationReports';
import './AdminConsole.css';

type AdminSectionId = 'overview' | 'people' | 'venues' | 'tdtv' | 'events' | 'application' | 'billing' | 'system';
type ApplicationReportCategory = 'crash' | 'connection';

const overviewMetrics = [
  {
    id: 'active-tds',
    label: 'Active TDs',
    value: '47',
    tone: 'amber',
    delta: '+12%',
    detail: 'network-wide',
    sparkline: '0,35 24,29 52,26 84,22 110,20 140,18 180,10',
    href: '/admin?filter=tds'
  },
  {
    id: 'active-venues',
    label: 'Active Venues',
    value: '23',
    tone: 'green',
    delta: '+8%',
    detail: 'approved venues',
    sparkline: '0,30 20,28 44,24 68,20 96,22 124,18 150,14',
    href: '/admin?filter=venues'
  },
  {
    id: 'total-players',
    label: 'Total Players',
    value: '2,841',
    tone: 'violet',
    delta: '+18%',
    detail: 'network IDs',
    sparkline: '0,38 26,34 52,27 85,24 115,21 146,18 180,15',
    href: '/admin?filter=players'
  },
  {
    id: 'live-broadcasts',
    label: 'Live Broadcasts',
    value: '8',
    tone: 'red',
    delta: '+50%',
    detail: 'active streams',
    sparkline: '0,32 24,27 56,18 80,22 118,12 170,16 220,9',
    href: '/admin?filter=broadcasts'
  },
  {
    id: 'live-viewers',
    label: 'Current Viewers',
    value: '412',
    tone: 'blue',
    delta: '+28%',
    detail: 'networkwide',
    sparkline: '0,34 20,30 45,25 68,19 92,23 120,20 150,18 180,15',
    href: '/admin?filter=tdtv'
  },
  {
    id: 'active-channels',
    label: 'Active Channels',
    value: '19',
    tone: 'cyan',
    delta: '+4%',
    detail: 'network channels',
    sparkline: '0,35 28,33 58,29 88,23 120,20 150,16 180,12',
    href: '/admin?filter=channels'
  },
  {
    id: 'pending-approvals',
    label: 'Pending Approvals',
    value: '3',
    tone: 'amber',
    delta: 'Action needed',
    detail: 'TDs / venues',
    sparkline: '0,20 40,12 80,24 120,18 160,10 180,14',
    href: '/admin?filter=approvals'
  },
  {
    id: 'subscription-issues',
    label: 'Subscription Issues',
    value: '2',
    tone: 'purple',
    delta: 'Needs review',
    detail: 'billing exceptions',
    sparkline: '0,18 40,20 80,32 120,26 160,16 180,20',
    href: '/admin?filter=billing-issues'
  }
] as const;

const adminSections = [
  { id: 'overview', label: 'Overview' },
  { id: 'people', label: 'People' },
  { id: 'tdtv', label: 'TDTV' },
  { id: 'events', label: 'Tournaments' },
  { id: 'application', label: 'Application' },
  { id: 'billing', label: 'Billing' },
  { id: 'system', label: 'System' }
] as const;

const nestedAdminNavigation: Partial<Record<AdminSectionId, readonly string[]>> = {
  people: ['Users', 'TDs', 'Venues', 'Players'],
  events: ['All Tournaments', 'My Tournaments', 'Live Now', 'Recent'],
  application: ['Reports'],
  tdtv: ['Network', 'Channels', 'Live Broadcasts'],
  billing: ['Subscriptions', 'Entitlements'],
  system: ['Activity / Audit Log', 'System Health', 'Settings']
} as const;

const submenuRouteMap: Partial<Record<AdminSectionId, Partial<Record<string, string>>>> = {
  events: {
    'All Tournaments': '/tournaments',
    'My Tournaments': '/tournaments',
    'Live Now': '/tournaments',
    'Recent': '/tournaments'
  },
  tdtv: {
    Channels: '/tv-guide',
    'Live Broadcasts': '/tv-guide'
  },
  billing: {
    Subscriptions: '/account?section=billing',
    Entitlements: '/account?section=billing'
  }
} as const;

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
  const navigate = useNavigate();
  const { tournaments } = useTournamentStore();
  const [activeSection, setActiveSection] = useState<AdminSectionId>('overview');
  const [expandedNavSection, setExpandedNavSection] = useState<AdminSectionId | null>(null);
  const [activeSubnavItem, setActiveSubnavItem] = useState<string | null>(null);
  const [showMetricMenu, setShowMetricMenu] = useState(false);
  const [visibleOverviewMetrics, setVisibleOverviewMetrics] = useState<string[]>(defaultOverviewMetrics);
  const [allChannels, setAllChannels] = useState(() => getChannelRegistry());
  const [venueChannelRequests, setVenueChannelRequests] = useState(() => getVenueChannelChangeRequests());
  const [systemSponsorDefaults, setSystemSponsorDefaults] = useState<BroadcastSponsorCard[]>(() => getSystemBroadcastSponsorDefaults());
  const [sponsorshipStatus, setSponsorshipStatus] = useState<string>('');
  const [applicationReports, setApplicationReports] = useState<ApplicationReport[]>([]);
  const [applicationReportsStatus, setApplicationReportsStatus] = useState<string>('');
  const [applicationReportFilter, setApplicationReportFilter] = useState<'all' | ApplicationReportCategory>('all');
  const [applicationReportRunFilter, setApplicationReportRunFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedEntity, setSelectedEntity] = useState<AdminEntityRecord | null>(null);
  const [selectedEntityTab, setSelectedEntityTab] = useState<'overview' | 'activity' | 'history' | 'related'>('overview');
  const [auditEntries, setAuditEntries] = useState(() => getAuditLogEntries());

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

  const refreshApplicationReports = async () => {
    setApplicationReportsStatus('Loading crash reports…');
    try {
      const reports = await listApplicationReports();
      setApplicationReports(reports);
      setApplicationReportsStatus(reports.length > 0 ? `Loaded ${reports.length} report${reports.length === 1 ? '' : 's'}.` : 'No crash reports yet.');
    } catch (error) {
      const cachedReports = readCachedApplicationReports();
      if (cachedReports.length > 0) {
        setApplicationReports(cachedReports);
        setApplicationReportsStatus(
          `${error instanceof Error ? error.message : 'Unable to load crash reports.'} Showing ${cachedReports.length} cached report${cachedReports.length === 1 ? '' : 's'} instead.`
        );
        return;
      }

      setApplicationReports([]);
      setApplicationReportsStatus(error instanceof Error ? error.message : 'Unable to load crash reports.');
    }
  };

  useEffect(() => {
    void refreshApplicationReports();
  }, []);

  const categorizeApplicationReport = (report: ApplicationReport): ApplicationReportCategory => {
    const source = report.source.toLowerCase();
    if (source.includes('connection') || report.exception_class === 'ConnectionEvent') {
      return 'connection';
    }
    return 'crash';
  };

  const crashReports = useMemo(
    () => applicationReports.filter((report) => categorizeApplicationReport(report) === 'crash'),
    [applicationReports]
  );
  const connectionReports = useMemo(
    () => applicationReports.filter((report) => categorizeApplicationReport(report) === 'connection'),
    [applicationReports]
  );
  const applicationReportRunOptions = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    applicationReports.forEach((report) => {
      const key = getApplicationReportInstanceKey(report);
      const label = getApplicationReportInstanceLabel(report);
      const current = counts.get(key);
      counts.set(key, { label: current?.label ?? label, count: (current?.count ?? 0) + 1 });
    });
    return Array.from(counts.entries())
      .map(([key, value]) => ({ key, label: value.label, count: value.count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [applicationReports]);
  const filteredApplicationReports = useMemo(() => {
    let reports = applicationReports;
    if (applicationReportFilter !== 'all') {
      reports = reports.filter((report) => categorizeApplicationReport(report) === applicationReportFilter);
    }
    if (applicationReportRunFilter !== 'all') {
      reports = reports.filter((report) => getApplicationReportInstanceKey(report) === applicationReportRunFilter);
    }
    return reports;
  }, [applicationReportFilter, applicationReportRunFilter, applicationReports]);

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
      case 'application': {
        const latestReport = applicationReports[0];
        return [
          { title: 'Crash reports', value: String(crashReports.length), detail: 'Unhandled exception reports' },
          { title: 'Connection reports', value: String(connectionReports.length), detail: 'Linking and signal diagnostics' },
          { title: 'Latest report', value: latestReport ? latestReport.app_name : 'None', detail: latestReport ? latestReport.summary : 'Waiting for the first crash report' }
        ];
      }
      default:
        return [];
    }
  }, [activeSection, allChannels, applicationReports, crashReports.length, connectionReports.length, currentUser, permissions, systemSponsorDefaults, tournaments]);

  const networkEntityDirectory = useMemo(() => {
    const people = [
      { name: 'Platform Admin', type: 'USER', status: 'ACTIVE', identifier: 'PA-0001', detail: 'Verified network admin identity', actions: ['Edit profile', 'Audit log', 'View activity'] },
      ...allChannels.filter((channel) => channel.type === 'VENUE').slice(0, 3).map((channel) => ({
        name: channel.entityName,
        type: 'VENUE',
        status: channel.status,
        identifier: `Venue ${channel.number}`,
        detail: 'Venue profile • channel assignment',
        actions: ['Approve', 'Edit venue', 'Manage admins']
      })),
      ...allChannels.filter((channel) => channel.type === 'TD').slice(0, 3).map((channel) => ({
        name: channel.entityName,
        type: 'TD',
        status: channel.status,
        identifier: `TD ${channel.number}`,
        detail: 'TD profile • broadcast access',
        actions: ['Approve', 'Assign channel', 'View broadcasts']
      }))
    ];

    const tdtv = allChannels.map((channel) => ({
      name: channel.entityName,
      type: channel.type,
      status: channel.status,
      identifier: `Channel ${channel.number}`,
      detail: channel.entityType === 'TDTV' ? 'Network feed' : `${channel.entityType} ownership`,
      actions: ['Manage assignment', 'Edit metadata', 'View activity']
    }));

    const billing = [
      { name: 'All Subscriptions', type: 'SUBSCRIPTION', status: 'MONITORING', identifier: 'Overview', detail: 'Customer billing summary', actions: ['Review issues', 'View entitlements', 'Manage plans'] },
      { name: 'Pro+ Subscribers', type: 'ENTITLEMENT', status: 'ACTIVE', identifier: '8 Accounts', detail: 'Broadcast + TDTV', actions: ['Adjust tier', 'Grant promo', 'Revoke grants'] },
      { name: 'Venue Billing', type: 'SUBSCRIPTION', status: 'ACTIVE', identifier: '5 Accounts', detail: 'Venue / network operations', actions: ['Review plans', 'Check invoices', 'Approve renewals'] }
    ];

    return { people, tdtv, billing };
  }, [allChannels]);

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
    const logEntry = recordAuditAction({
      administrator: currentUser.name || currentUser.email || 'Platform Admin',
      action: 'System-wide sponsorship defaults updated',
      entity: 'Broadcast Sponsorship Defaults',
      previousValue: 'Existing defaults',
      newValue: 'Updated system sponsor defaults'
    });
    setAuditEntries((current) => [logEntry, ...current].slice(0, 12));
    setSponsorshipStatus('System-wide sponsorship defaults updated.');
  };

  const handleVenueChannelDecision = (requestId: string, decision: 'APPROVED' | 'DENIED') => {
    try {
      const matchingRequest = venueChannelRequests.find((request) => request.id === requestId);
      const previousValue = matchingRequest?.status ?? 'PENDING';
      resolveVenueChannelChangeRequest(requestId, decision, currentUser.name || currentUser.email || 'Platform Admin');
      const logEntry = recordAuditAction({
        administrator: currentUser.name || currentUser.email || 'Platform Admin',
        action: `Venue channel request ${decision.toLowerCase()}`,
        entity: matchingRequest?.venueName ?? 'Venue Request',
        previousValue,
        newValue: decision
      });
      setAuditEntries((current) => [logEntry, ...current].slice(0, 12));
      refreshAdminData();
    } catch (decisionError) {
      window.alert(decisionError instanceof Error ? decisionError.message : 'Unable to process venue channel request.');
    }
  };

  const adminEntityCatalog = useMemo<AdminEntityRecord[]>(() => {
    const channelEntities: AdminEntityRecord[] = allChannels.map((channel) => ({
      id: channel.id,
      name: channel.entityName,
      type: 'CHANNEL',
      group: 'tdtv',
      status: channel.status,
      identifier: `Channel ${channel.number}`,
      detail: `${channel.type} • ${channel.entityType}`,
      actions: ['Manage Assignment', 'Edit Metadata', 'View Activity']
    }));

    const tournamentEntities: AdminEntityRecord[] = tournaments.map((tournament) => ({
      id: tournament.id,
      name: tournament.name,
      type: 'TOURNAMENT',
      group: 'events',
      status: tournament.status,
      identifier: tournament.format,
      detail: `${tournament.players.length} players • ${tournament.tableCount} tables`,
      actions: ['Open Tournament', 'View Bracket', 'Broadcasts']
    }));

    return [
      ...channelEntities,
      ...tournamentEntities,
      {
        id: 'entity-network-overview',
        name: 'TDIAB Network',
        type: 'CHANNEL',
        group: 'tdtv',
        status: 'ACTIVE',
        identifier: 'Network 0',
        detail: 'Network operations and system overview',
        actions: ['Overview', 'Activity', 'Health']
      },
      {
        id: 'entity-td-ops',
        name: "Ace's Tournaments",
        type: 'TD',
        group: 'people',
        status: 'ACTIVE',
        identifier: 'TD-1247',
        detail: 'TD profile • Pro+ • Channel 1247',
        actions: ['Approve', 'Assign Channel', 'View Broadcasts']
      },
      {
        id: 'entity-venue-parlor',
        name: 'Parlor Room',
        type: 'VENUE',
        group: 'people',
        status: 'ACTIVE',
        identifier: 'Venue 17',
        detail: 'Venue profile • Active • Channel 17',
        actions: ['Approve', 'Manage Admins', 'View Tournaments']
      },
      {
        id: 'entity-player-18427',
        name: 'John Smith',
        type: 'PLAYER',
        group: 'people',
        status: 'ACTIVE',
        identifier: 'Universal ID #18427',
        detail: 'Player profile • Tournament history',
        actions: ['View Profile', 'History', 'Merge Records']
      }
    ];
  }, [allChannels, tournaments]);

  const filteredSearchResults = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];

    return adminEntityCatalog.filter((entity) => {
      const haystack = [entity.name, entity.identifier, entity.detail, entity.type, entity.status].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [adminEntityCatalog, search]);

  const handleEntitySelect = (entity: AdminEntityRecord) => {
    setSelectedEntity(entity);
    setSearch("");
    if (entity.group === 'tdtv') setActiveSection('tdtv');
    else if (entity.group === 'events') setActiveSection('events');
    else setActiveSection('people');
    setExpandedNavSection(entity.group === 'tdtv' ? 'tdtv' : entity.group === 'events' ? 'events' : 'people');
    setActiveSubnavItem(null);
  };

  const handleSectionSelect = (sectionId: AdminSectionId) => {
    const hasSubnav = (nestedAdminNavigation[sectionId]?.length ?? 0) > 0;
    setActiveSection(sectionId);
    setActiveSubnavItem(null);
    if (!hasSubnav) {
      setExpandedNavSection(null);
      return;
    }
    setExpandedNavSection((current) => (current === sectionId ? null : sectionId));
  };

  const handleSubnavSelect = (sectionId: AdminSectionId, item: string) => {
    const routeTarget = submenuRouteMap[sectionId]?.[item];
    const targetSection: AdminSectionId = sectionId === 'people' && item === 'Venues' ? 'venues' : sectionId;

    setActiveSection(targetSection);
    setExpandedNavSection(sectionId);
    setActiveSubnavItem(`${sectionId}:${item}`);

    if (routeTarget) {
      navigate(routeTarget);
    }
  };

  return (
    <div className="admin-console">
      <aside className="admin-console__sidebar">
        <div className="brand-block">
          <div className="brand-mark">TD<span>IAB</span></div>
          <span className="mini-label">NETWORK COMMAND</span>
        </div>

        <div className="admin-console__sidebar-meta">
          <span className="sidebar-security-pill">Platform Admin</span>
          <p>Verified administrative authority across the TDIAB network, venue operations, and channel system.</p>
        </div>

        <nav className="admin-console__nav" aria-label="Admin navigation">
          {adminSections.map((section) => {
            const sectionSubnavItems = nestedAdminNavigation[section.id] ?? [];
            const isSubnavOpen = expandedNavSection === section.id;

            return (
              <div key={section.id} className="admin-nav-group">
                <button
                  type="button"
                  className={`admin-nav-item ${activeSection === section.id ? 'is-active' : ''}`}
                  onClick={() => handleSectionSelect(section.id)}
                  aria-expanded={sectionSubnavItems.length > 0 ? isSubnavOpen : undefined}
                >
                  <span className="admin-nav-item__label">{section.label}</span>
                  {sectionSubnavItems.length > 0 ? (
                    <span className={`admin-nav-item__chevron ${isSubnavOpen ? 'is-open' : ''}`} aria-hidden="true">▾</span>
                  ) : null}
                </button>
                {sectionSubnavItems.length > 0 && isSubnavOpen ? (
                  <div className="admin-subnav">
                    {sectionSubnavItems.map((item) => (
                      <button
                        key={`${section.id}-${item}`}
                        type="button"
                        className={`admin-subnav-item ${activeSubnavItem === `${section.id}:${item}` ? 'is-active' : ''}`}
                        onClick={() => handleSubnavSelect(section.id, item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
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
            <strong>PA</strong>
          </div>
        </div>
      </aside>

      <main className="admin-console__content">
        <header className="admin-console__topbar">
          <div className="admin-console__topbar-meta">
            <span className="eyebrow">Network operations</span>
            <h1>Platform Admin</h1>
          </div>
          <div className="admin-console__topbar-actions">
            <span className="topbar-date">{new Date().toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            <button type="button" className="topbar-icon" aria-label="notifications">{pendingVenueChannelRequests.length}</button>
            <div className="topbar-user" title="Platform Administrator — Full access to TDIAB network management.">
              <span className="topbar-user__avatar">🔒</span>
              <span>{currentUser.name || 'Admin'}</span>
            </div>
          </div>
        </header>

        <div className="admin-console__toolbar">
          <div className="admin-console__search">
            <span aria-hidden="true">⌕</span>
            <input
              type="text"
              placeholder="Search network entities..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <button type="button" className="ghost-btn ghost-btn--compact" onClick={refreshAdminData}>Refresh</button>
        </div>

        {search.trim() && filteredSearchResults.length > 0 && (
          <div className="admin-console__search-results">
            {filteredSearchResults.map((result) => (
              <button key={`${result.type}-${result.id}`} type="button" className="admin-search-result" onClick={() => handleEntitySelect(result)}>
                <div>
                  <strong>{result.name}</strong>
                  <small>{result.identifier} • {result.detail}</small>
                </div>
                <span>{result.type}</span>
              </button>
            ))}
          </div>
        )}

        {selectedEntity && (
          <div className="admin-console__entity-detail">
            <div className="admin-console__entity-header">
              <div>
                <span className="eyebrow">{selectedEntity.type}</span>
                <h3>{selectedEntity.name}</h3>
              </div>
              <span className="admin-entity-status">{selectedEntity.status}</span>
            </div>
            <div className="admin-console__entity-meta">
              <span>{selectedEntity.identifier}</span>
              <span>{selectedEntity.detail}</span>
            </div>
            <div className="admin-console__entity-actions">
              {selectedEntity.actions.map((action) => (
                <button key={`${selectedEntity.id}-${action}`} type="button" className="ghost-btn ghost-btn--small">
                  {action}
                </button>
              ))}
            </div>
            <div className="admin-console__entity-tabs" role="tablist" aria-label={`${selectedEntity.name} detail tabs`}>
              {(['overview', 'activity', 'history', 'related'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={selectedEntityTab === tab}
                  className={`admin-entity-tab ${selectedEntityTab === tab ? 'is-active' : ''}`}
                  onClick={() => setSelectedEntityTab(tab)}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {selectedEntityTab === 'overview' && (
              <div className="admin-console__entity-panels">
                <article className="admin-panel-card">
                  <span className="admin-panel-card__label">Overview</span>
                  <strong>{selectedEntity.name}</strong>
                  <small>{selectedEntity.identifier}</small>
                </article>
                <article className="admin-panel-card">
                  <span className="admin-panel-card__label">Status</span>
                  <strong>{selectedEntity.status}</strong>
                  <small>Current administrative state</small>
                </article>
                <article className="admin-panel-card">
                  <span className="admin-panel-card__label">Context</span>
                  <strong>{selectedEntity.type}</strong>
                  <small>{selectedEntity.detail}</small>
                </article>
              </div>
            )}

            {selectedEntityTab === 'activity' && (
              <div className="admin-entity-panel-body">
                <div className="admin-entity-activity-list">
                  <div><strong>Live</strong><span>{selectedEntity.status}</span></div>
                  <div><strong>Recent activity</strong><span>{selectedEntity.detail}</span></div>
                  <div><strong>Network health</strong><span>Monitoring active</span></div>
                </div>
              </div>
            )}

            {selectedEntityTab === 'history' && (
              <div className="admin-entity-panel-body">
                <div className="admin-entity-activity-list">
                  <div><strong>Lifecycle</strong><span>{selectedEntity.status}</span></div>
                  <div><strong>Last update</strong><span>{new Date().toLocaleString()}</span></div>
                  <div><strong>Related log</strong><span>Audit entries available in System</span></div>
                </div>
              </div>
            )}

            {selectedEntityTab === 'related' && (
              <div className="admin-entity-panel-body">
                <div className="admin-entity-activity-list">
                  <div><strong>Related records</strong><span>{selectedEntity.actions.join(', ')}</span></div>
                  <div><strong>Contextual actions</strong><span>{selectedEntity.identifier}</span></div>
                  <div><strong>Next step</strong><span>{selectedEntity.group === 'people' ? 'People management' : selectedEntity.group === 'tdtv' ? 'TDTV management' : 'Tournament operations'}</span></div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeSection === 'system' && (
          <section className="admin-audit-panel">
            <div className="admin-audit-panel__head">
              <div>
                <span className="eyebrow">System activity</span>
                <h3>Audit Log</h3>
              </div>
              <button type="button" className="ghost-btn ghost-btn--compact" onClick={() => setAuditEntries(getAuditLogEntries())}>Refresh</button>
            </div>
            <div className="admin-audit-list">
              {auditEntries.length === 0 ? (
                <div className="admin-empty-state">
                  <h3>No admin actions recorded yet</h3>
                  <p>Network changes will appear here with administrator, entity, and timestamp metadata.</p>
                </div>
              ) : (
                auditEntries.map((entry) => (
                  <article key={entry.id} className="admin-audit-entry">
                    <div className="admin-audit-entry__meta">
                      <strong>{entry.action}</strong>
                      <small>{new Date(entry.timestamp).toLocaleString()}</small>
                    </div>
                    <div className="admin-audit-entry__body">
                      <span>{entry.administrator}</span>
                      <span>{entry.entity}</span>
                    </div>
                    <div className="admin-audit-entry__diff">
                      <span>Previous: {entry.previousValue ?? '—'}</span>
                      <span>New: {entry.newValue ?? '—'}</span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        )}

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
            </div>
          </div>

          {activeSection === 'overview' ? (
            <>
              <section className="metric-grid">
                {overviewCardSet.map((metric) => (
                  <button key={metric.id} type="button" className={`metric-card metric-card--${metric.tone}`} onClick={() => setSearch(metric.label)}>
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
                  </button>
                ))}
              </section>

              {overviewCardSet.length === 0 && (
                <div className="admin-empty-state">
                  <h3>No overview tiles selected</h3>
                  <p>Choose metrics above to restore the platform admin overview.</p>
                </div>
              )}
            </>
          ) : activeSection === 'system' ? (
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
          ) : activeSection === 'application' ? (
            <section className="admin-application-panel">
              <div className="admin-application-panel__head">
                <div>
                  <span className="eyebrow">Application</span>
                  <h3>Reports</h3>
                  <p>Crash reports captured by the Android app are synchronized here as files are generated and uploaded.</p>
                </div>
                <button type="button" className="ghost-btn ghost-btn--compact" onClick={() => void refreshApplicationReports()}>
                  Refresh
                </button>
              </div>

              {applicationReportsStatus ? <p className="admin-application-status">{applicationReportsStatus}</p> : null}

              <div className="admin-application-filters" role="tablist" aria-label="Application report type">
                <button
                  type="button"
                  className={`filter-pill ${applicationReportFilter === 'all' ? 'is-selected' : ''}`}
                  onClick={() => setApplicationReportFilter('all')}
                >
                  All reports
                </button>
                <button
                  type="button"
                  className={`filter-pill ${applicationReportFilter === 'crash' ? 'is-selected' : ''}`}
                  onClick={() => setApplicationReportFilter('crash')}
                >
                  Crash reports
                </button>
                <button
                  type="button"
                  className={`filter-pill ${applicationReportFilter === 'connection' ? 'is-selected' : ''}`}
                  onClick={() => setApplicationReportFilter('connection')}
                >
                  Connection reports
                </button>
              </div>

              <div className="admin-application-filters" role="tablist" aria-label="Application report run">
                <button
                  type="button"
                  className={`filter-pill ${applicationReportRunFilter === 'all' ? 'is-selected' : ''}`}
                  onClick={() => setApplicationReportRunFilter('all')}
                >
                  All runs
                </button>
                {applicationReportRunOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`filter-pill ${applicationReportRunFilter === option.key ? 'is-selected' : ''}`}
                    onClick={() => setApplicationReportRunFilter(option.key)}
                  >
                    {option.label} ({option.count})
                  </button>
                ))}
              </div>

              <div className="admin-panel-grid">
                {sectionData.map((item) => (
                  <article key={`${activeSection}-${item.title}`} className="admin-panel-card">
                    <span className="admin-panel-card__label">{item.title}</span>
                    <strong>{item.value}</strong>
                    <small>{item.detail}</small>
                  </article>
                ))}
              </div>

              {filteredApplicationReports.length === 0 ? (
                <div className="admin-empty-state">
                  <h3>No {applicationReportFilter === 'all' ? '' : `${applicationReportFilter} `}reports yet</h3>
                  <p>When the Android app captures an uncaught exception or a connection lifecycle event, reports will appear here after sync.</p>
                </div>
              ) : (
                <div className="admin-application-list">
                  {filteredApplicationReports.map((report) => (
                    <article key={report.id} className="admin-application-report">
                      <div className="admin-application-report__head">
                        <div>
                          <span className={`admin-application-severity admin-application-severity--${report.severity.toLowerCase()}`}>{report.severity}</span>
                          <strong>{report.title}</strong>
                          <span className="admin-application-report__instance">
                            {getApplicationReportInstanceLabel(report)}
                          </span>
                        </div>
                        <small>{formatApplicationReportTimestamp(report.occurred_at)}</small>
                      </div>
                      <div className="admin-application-report__body">
                        <span>{categorizeApplicationReport(report) === 'connection' ? 'Connection report' : 'Crash report'}</span>
                        <span>{report.app_name} • {report.version_name} ({report.build_type})</span>
                        <span>{report.device_manufacturer} {report.device_model}</span>
                        <span>{report.android_version} • API {report.sdk_int}</span>
                        <span>{report.file_path}</span>
                      </div>
                      <p>{report.summary}</p>
                      {report.stack_trace ? <pre>{report.stack_trace}</pre> : null}
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : activeSection === 'people' ? (
            <div className="admin-panel-grid">
              {networkEntityDirectory.people.map((item) => (
                <article key={`${activeSection}-${item.name}`} className="admin-panel-card">
                  <span className="admin-panel-card__label">{item.type}</span>
                  <strong>{item.name}</strong>
                  <small>{item.identifier}</small>
                  <div className="admin-panel-card__footer">
                    <span className="admin-entity-status admin-entity-status--small">{item.status}</span>
                    <p>{item.detail}</p>
                  </div>
                  <div className="admin-panel-card__actions">
                    {item.actions.map((action) => (
                      <button key={`${item.name}-${action}`} type="button" className="ghost-btn ghost-btn--small">
                        {action}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : activeSection === 'tdtv' ? (
            <div className="admin-panel-grid">
              {networkEntityDirectory.tdtv.map((item) => (
                <article key={`${activeSection}-${item.name}-${item.identifier}`} className="admin-panel-card">
                  <span className="admin-panel-card__label">{item.type}</span>
                  <strong>{item.name}</strong>
                  <small>{item.identifier}</small>
                  <div className="admin-panel-card__footer">
                    <span className="admin-entity-status admin-entity-status--small">{item.status}</span>
                    <p>{item.detail}</p>
                  </div>
                  <div className="admin-panel-card__actions">
                    {item.actions.map((action) => (
                      <button key={`${item.name}-${action}`} type="button" className="ghost-btn ghost-btn--small">
                        {action}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : activeSection === 'billing' ? (
            <div className="admin-panel-grid">
              {networkEntityDirectory.billing.map((item) => (
                <article key={`${activeSection}-${item.name}`} className="admin-panel-card">
                  <span className="admin-panel-card__label">{item.type}</span>
                  <strong>{item.name}</strong>
                  <small>{item.identifier}</small>
                  <div className="admin-panel-card__footer">
                    <span className="admin-entity-status admin-entity-status--small">{item.status}</span>
                    <p>{item.detail}</p>
                  </div>
                  <div className="admin-panel-card__actions">
                    {item.actions.map((action) => (
                      <button key={`${item.name}-${action}`} type="button" className="ghost-btn ghost-btn--small">
                        {action}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
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
                  <span className="eyebrow">Network event guide</span>
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
          ) : activeSection === 'venues' ? (
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
            </>
          )}
        </div>
      </main>
    </div>
  );
}
