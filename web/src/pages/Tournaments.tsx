import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TournamentFormat } from '@/lib/tournament';
import { useTournamentStore } from '@/store/tournamentStore';
import './Tournaments.css';

const FORMATS: TournamentFormat[] = [
  'SINGLE_ELIMINATION',
  'DOUBLE_ELIMINATION',
  'MODIFIED_ELIMINATION',
  'CHIP_TOURNAMENT'
];

const formatLabel = (value: string) => value.replace(/_/g, ' ');

type StatusFilter = 'All' | 'Active' | 'Completed' | 'Templates';
type SortMode = 'Newest' | 'Oldest' | 'Name';
type TournamentRow = {
  id?: string;
  name?: string;
  format?: string;
  status?: string;
  players?: unknown[];
  createdAt?: string | number;
  date?: string;
  location?: string;
  game?: string;
  isTemplate?: boolean;
};

export default function Tournaments() {
  const { tournaments, fetchTournaments, updateTournament, deleteTournament, loading } = useTournamentStore();
  const navigate = useNavigate();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editFormat, setEditFormat] = useState<TournamentFormat>('SINGLE_ELIMINATION');
  const [filter, setFilter] = useState<StatusFilter>('All');
  const [sortMode, setSortMode] = useState<SortMode>('Newest');
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [activeTab, setActiveTab] = useState<'overview' | 'broadcast' | 'templates'>('overview');
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  const [broadcastConfig, setBroadcastConfig] = useState({
    featuredTable: '',
    cameraPreset: '',
    overlayDuration: 8,
    sponsorRotation: true,
    streamMode: 'standby'
  });

  useEffect(() => {
    fetchTournaments();
  }, [fetchTournaments]);

  const tournamentList = Array.isArray(tournaments) ? tournaments : [];

  const filteredTournaments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const source = (tournamentList as TournamentRow[]).filter((tournament) => {
      const status = String(tournament.status || 'DRAFT').toUpperCase();
      const name = String(tournament.name || 'Untitled Tournament').toLowerCase();
      const format = String(tournament.format || 'SINGLE_ELIMINATION').toLowerCase();
      const location = String(tournament.location || '').toLowerCase();

      const matchesFilter =
        filter === 'All' ||
        (filter === 'Active' && status === 'ACTIVE') ||
        (filter === 'Completed' && status === 'COMPLETED') ||
        (filter === 'Templates' && Boolean(tournament.isTemplate));

      const matchesQuery =
        normalizedQuery.length === 0 ||
        [name, format, status, location].some((value) => value.includes(normalizedQuery));

      return matchesFilter && matchesQuery;
    });

    return [...source].sort((a, b) => {
      if (sortMode === 'Oldest') return Number(a.createdAt || 0) - Number(b.createdAt || 0);
      if (sortMode === 'Name') return String(a.name || '').localeCompare(String(b.name || ''));
      return Number(b.createdAt || 0) - Number(a.createdAt || 0);
    });
  }, [filter, query, sortMode, tournamentList]);

  useEffect(() => {
    if (filteredTournaments.length === 0) {
      setSelectedTournamentId(null);
      return;
    }

    if (!selectedTournamentId || !filteredTournaments.some((tournament) => tournament.id === selectedTournamentId)) {
      setSelectedTournamentId(filteredTournaments[0].id ?? null);
    }
  }, [filteredTournaments, selectedTournamentId]);

  const selectedTournament = filteredTournaments.find((tournament) => tournament.id === selectedTournamentId) ?? filteredTournaments[0] ?? null;
  const selectedPlayerCount = Array.isArray(selectedTournament?.players) ? selectedTournament.players.length : 0;

  const safeText = (value: unknown, fallback: string) => {
    if (typeof value === 'string' && value.trim().length > 0) return value;
    return fallback;
  };

  const startEdit = (id: string, name: string, format: string, date?: string) => {
    setEditingId(id);
    setEditName(name);
    setEditDate(date || '');
    setEditFormat((FORMATS.includes(format as TournamentFormat) ? format : 'SINGLE_ELIMINATION') as TournamentFormat);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditDate('');
    setEditFormat('SINGLE_ELIMINATION');
  };

  const saveEdit = (id: string) => {
    const trimmedName = editName.trim();
    if (!trimmedName) {
      alert('Tournament name required');
      return;
    }
    const parsedDate = editDate ? new Date(editDate).toISOString() : undefined;
    updateTournament(id, {
      name: trimmedName,
      format: editFormat,
      ...(parsedDate ? { date: parsedDate } : {})
    });
    cancelEdit();
  };

  const openSettings = (id: string) => {
    navigate(`/tournament/${id}`);
  };

  const downloadBackup = (tournamentData: unknown, name: string) => {
    const blob = new Blob([JSON.stringify(tournamentData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-backup.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const confirmDelete = (id: string, name: string) => {
    const confirmed = window.confirm(
      `Delete "${name}"?\n\nBefore deleting, please create a backup copy. Use the Backup button if needed.\n\nThis action cannot be undone.`
    );
    if (!confirmed) return;
    deleteTournament(id);
    if (editingId === id) cancelEdit();
  };

  const getStatusMeta = (status: string, isTemplate = false) => {
    if (isTemplate) return { label: 'TEMPLATE', className: 'status template' };
    const normalized = String(status || 'DRAFT').toUpperCase();
    if (normalized === 'COMPLETED') return { label: 'Completed', className: 'status completed' };
    if (normalized === 'ACTIVE') return { label: 'Active', className: 'status active' };
    if (normalized === 'DRAFT') return { label: 'Draft', className: 'status draft' };
    return { label: normalized, className: 'status default' };
  };

  const iconMap = {
    list: '☰',
    grid: '▦'
  } as const;

  const formatIcon = (value: string) => {
    const normalized = String(value || 'SINGLE_ELIMINATION').toUpperCase();
    if (normalized.includes('DOUBLE')) return '🏆';
    if (normalized.includes('MODIFIED')) return '🎯';
    if (normalized.includes('CHIP')) return '🪙';
    return '🏆';
  };

  const rowPlayers = (count: number) => count > 0 ? `${count}` : '0';

  const getEditableDate = (tournament: { date?: string; createdAt?: string }) => {
    if (typeof tournament.date === 'string' && tournament.date) {
      return new Date(tournament.date).toISOString().slice(0, 10);
    }
    const ts = Number(tournament.createdAt ?? 0);
    if (Number.isFinite(ts) && ts > 0) {
      return new Date(ts).toISOString().slice(0, 10);
    }
    return new Date().toISOString().slice(0, 10);
  };

  return (
    <div className="tournaments-page">
      <header className="tournaments-header">
        <div className="header-copy">
          <div className="eyebrow">TOURNAMENTS</div>
          <h1>Tournament Management</h1>
          <p>Create. Run. Repeat.</p>
        </div>

        <div className="header-slogan" aria-hidden="true">
          <span className="ball">8</span>
          <span className="slogan">More Than a Game.</span>
        </div>

        <Link className="new-event-btn" to="/tournament/new">+ Create Tournament</Link>
      </header>

      <section className="management-summary" aria-label="Tournament summary">
        <article className="summary-card summary-card--red">
          <span>Live events</span>
          <strong>{filteredTournaments.filter((t) => String(t.status || 'DRAFT').toUpperCase() === 'ACTIVE').length}</strong>
          <small>Built for match flow</small>
        </article>
        <article className="summary-card summary-card--blue">
          <span>Players</span>
          <strong>{tournamentList.reduce((sum, tournament) => sum + (Array.isArray(tournament.players) ? tournament.players.length : 0), 0)}</strong>
          <small>Across all events</small>
        </article>
        <article className="summary-card summary-card--purple">
          <span>Broadcasts</span>
          <strong>{Math.max(0, Math.min(6, filteredTournaments.length))}</strong>
          <small>Live and scheduled</small>
        </article>
        <article className="summary-card summary-card--green">
          <span>Templates</span>
          <strong>{filteredTournaments.filter((t) => Boolean((t as TournamentRow).isTemplate)).length}</strong>
          <small>Ready to reuse</small>
        </article>
      </section>

      <div className="toolbar-panel">
        <div className="search-wrap">
          <span className="search-icon" aria-hidden="true">⌕</span>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tournaments..."
            aria-label="Search tournaments"
          />
        </div>

        <div className="filter-group" role="tablist" aria-label="Tournament filters">
          {(['All', 'Active', 'Completed', 'Templates'] as StatusFilter[]).map((currentFilter) => (
            <button
              key={currentFilter}
              type="button"
              className={`filter-chip ${filter === currentFilter ? 'active' : ''}`}
              onClick={() => setFilter(currentFilter)}
            >
              {currentFilter === 'Templates' ? 'Templates' : currentFilter}
            </button>
          ))}
        </div>

        <div className="sort-group">
          <button type="button" className="sort-icon-button" aria-label="Sort order">⇅</button>
          <div className="sort-control">
            <span className="sort-label">Sort</span>
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
              <option value="Newest">Newest</option>
              <option value="Oldest">Oldest</option>
              <option value="Name">Name</option>
            </select>
          </div>

          <div className="view-toggle" aria-label="View mode toggle">
            {(['list', 'grid'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`toggle-btn ${viewMode === mode ? 'active' : ''}`}
                onClick={() => setViewMode(mode)}
                aria-label={`Switch to ${mode} view`}
              >
                {iconMap[mode]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="management-tabs" role="tablist" aria-label="Tournament management tabs">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'broadcast', label: 'Broadcast' },
          { id: 'templates', label: 'Templates' }
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`management-tab ${activeTab === tab.id ? 'is-active' : ''}`}
            onClick={() => setActiveTab(tab.id as 'overview' | 'broadcast' | 'templates')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading-state">Loading tournaments...</div>
      ) : filteredTournaments.length === 0 ? (
        <div className="empty-state">
          <h3>No tournaments found</h3>
          <p>Try another search or create your first event.</p>
        </div>
      ) : (
        <>
          {activeTab === 'overview' && (
            <section className="tournament-spotlight">
              <div className="spotlight-card spotlight-card--primary">
                <div className="spotlight-card__header">
                  <span className="eyebrow">Current focus</span>
                  <span className="status-pill status-pill--large">{selectedTournament ? String(selectedTournament.status || 'DRAFT').toUpperCase() : 'READY'}</span>
                </div>
                <h2>{selectedTournament?.name ?? 'Untitled Tournament'}</h2>
                <div className="spotlight-meta">
                  <span>{selectedTournament ? String(selectedTournament.format || 'SINGLE_ELIMINATION').replace(/_/g, ' ') : 'Single Elimination'}</span>
                  <span>{selectedPlayerCount} players</span>
                  <span>{selectedTournament ? String((selectedTournament as TournamentRow).game || '9-Ball') : '9-Ball'}</span>
                </div>
                <div className="spotlight-actions">
                  <button type="button" className="primary-btn" onClick={() => selectedTournament && navigate(`/tournament/${selectedTournament.id}`)}>Open tournament</button>
                  <button type="button" className="secondary-btn" onClick={() => selectedTournament && navigate(`/broadcast/${selectedTournament.id}`)}>View broadcast</button>
                </div>
              </div>

              <div className="spotlight-card">
                <span className="eyebrow">Quick look</span>
                <ul className="mini-list">
                  <li><span>Venue</span><strong>{selectedTournament ? String((selectedTournament as TournamentRow).location || 'Venue pending') : 'Venue pending'}</strong></li>
                  <li><span>Tables</span><strong>{selectedTournament ? String(selectedTournament.tableCount || 0) : '0'}</strong></li>
                  <li><span>Seed mode</span><strong>{selectedTournament ? String(selectedTournament.seedingMethod || 'ENTERED') : 'ENTERED'}</strong></li>
                  <li><span>Last update</span><strong>{selectedTournament ? new Date(selectedTournament.updatedAt || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Awaiting data'}</strong></li>
                </ul>
              </div>
            </section>
          )}

          {activeTab === 'broadcast' && (
            <section className="broadcast-manager">
              <div className="broadcast-panel">
                <div className="broadcast-panel__header">
                  <div>
                    <span className="eyebrow">Broadcast studio</span>
                    <h3>Live production controls</h3>
                  </div>
                  <span className={`stream-status ${broadcastConfig.streamMode === 'live' ? 'stream-status--live' : ''}`}>
                    {broadcastConfig.streamMode === 'live' ? 'Live' : 'Standby'}
                  </span>
                </div>

                <div className="broadcast-grid">
                  <label className="field-group">
                    <span>Featured table</span>
                    <select value={broadcastConfig.featuredTable} onChange={(event) => setBroadcastConfig((current) => ({ ...current, featuredTable: event.target.value }))}>
                      <option value="featured">Featured Table</option>
                      <option value="arena-2">Arena 2</option>
                      <option value="arena-3">Arena 3</option>
                      <option value="arena-4">Arena 4</option>
                    </select>
                  </label>

                  <label className="field-group">
                    <span>Camera preset</span>
                    <select value={broadcastConfig.cameraPreset} onChange={(event) => setBroadcastConfig((current) => ({ ...current, cameraPreset: event.target.value }))}>
                      <option value="wifi+obs">Wireless + OBS</option>
                      <option value="wifi-only">Wireless Only</option>
                      <option value="usb">USB Cameras</option>
                    </select>
                  </label>

                  <label className="field-group">
                    <span>Overlay duration</span>
                    <input
                      type="range"
                      min={4}
                      max={20}
                      value={broadcastConfig.overlayDuration}
                      onChange={(event) => setBroadcastConfig((current) => ({ ...current, overlayDuration: Number(event.target.value) }))}
                    />
                    <small>{broadcastConfig.overlayDuration}s</small>
                  </label>

                  <label className="field-toggle">
                    <input
                      type="checkbox"
                      checked={broadcastConfig.sponsorRotation}
                      onChange={(event) => setBroadcastConfig((current) => ({ ...current, sponsorRotation: event.target.checked }))}
                    />
                    <span>Auto-rotate sponsor cards</span>
                  </label>
                </div>
              </div>

              <div className="broadcast-panel">
                <div className="broadcast-panel__header">
                  <div>
                    <span className="eyebrow">Camera setup</span>
                    <h3>Connected sources</h3>
                  </div>
                </div>

                <div className="camera-list">
                  {broadcastConfig.cameraPreset.length > 0 ? (
                    ['Camera 01', 'Camera 02', 'OBS Main', 'Wireless PTZ'].map((item, index) => (
                      <div key={item} className={`camera-item ${index === 0 ? 'is-active' : ''}`}>
                        <div>
                          <strong>{item}</strong>
                          <small>{index === 3 ? 'PTZ wireless' : 'Ready for stream'}</small>
                        </div>
                        <span>{index === 0 ? 'Strong' : 'Connected'}</span>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state-inline">No camera sources configured yet.</div>
                  )}
                </div>
              </div>

              <div className="broadcast-panel">
                <div className="broadcast-panel__header">
                  <div>
                    <span className="eyebrow">Overlay</span>
                    <h3>Brand and sponsorship</h3>
                  </div>
                </div>

                <div className="overlay-list">
                  {broadcastConfig.sponsorRotation && broadcastConfig.featuredTable ? (
                    ['Promethean Games', 'Parlor Room', 'TDTV Network'].map((brand, index) => (
                      <div key={brand} className="overlay-item">
                        <div>
                          <strong>{brand}</strong>
                          <small>{index === 0 ? 'Primary sponsor' : `${Math.max(6, 10 - index)}s rotation`}</small>
                        </div>
                        <span>{index === 0 ? 'On' : 'Queued'}</span>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state-inline">No sponsor overlays are configured for this broadcast.</div>
                  )}
                </div>
              </div>
            </section>
          )}

          {activeTab === 'templates' && (
            <section className="template-panel">
              <div className="template-card">
                <div className="broadcast-panel__header">
                  <div>
                    <span className="eyebrow">Saved templates</span>
                    <h3>Reusable event setups</h3>
                  </div>
                  <button type="button" className="secondary-btn">New template</button>
                </div>

                <div className="template-list">
                  {['Texas Open', 'Local League', 'Venue Night', 'Championship Finals'].map((template, index) => (
                    <button key={template} type="button" className="template-item">
                      <div>
                        <strong>{template}</strong>
                        <small>{index % 2 === 0 ? 'Double elimination' : 'Single elimination'}</small>
                      </div>
                      <span>Use</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

          <div className="tournament-table-shell">
            <div className="table-header-row">
              <span className="col-name">Name</span>
              <span className="col-status">Status</span>
              <span className="col-format">Format</span>
              <span className="col-game">Game</span>
              <span className="col-players">Players</span>
              <span className="col-date">Date</span>
              <span className="col-location">Location</span>
              <span className="col-actions">Actions</span>
            </div>

            <div className={`tournament-table ${viewMode}`}>
              {filteredTournaments.map((tournament, index) => {
                const id = safeText(tournament.id, `invalid-${index}`);
                const name = safeText(tournament.name, 'Untitled Tournament');
                const format = safeText(tournament.format, 'SINGLE_ELIMINATION');
                const location = String((tournament as TournamentRow).location || 'Austin, TX');
                const status = safeText(tournament.status, 'DRAFT');
                const playerCount = Array.isArray(tournament.players) ? tournament.players.length : 0;
                const gameName = String((tournament as TournamentRow).game || '9-Ball');
                const dateValue = getEditableDate(tournament);
                const createdDate = new Date(dateValue).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                const createdTime = new Date(dateValue).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                const isTemplate = Boolean((tournament as TournamentRow).isTemplate);
                const isEditing = editingId === id;
                const isSelected = selectedTournamentId === id;
                const statusMeta = getStatusMeta(status, isTemplate);

                return (
                  <article key={id} className={`tournament-row ${isSelected ? 'is-selected' : ''}`} onClick={() => setSelectedTournamentId(id)}>
                    <div className="name-cell">
                      <div className="table-avatar" aria-hidden="true" />
                      <div className="name-stack">
                        <div className="name-line">
                          <strong>{isEditing ? (
                            <input
                              className="name-input"
                              value={editName}
                              onChange={(event) => setEditName(event.target.value)}
                              aria-label="Edit tournament name"
                            />
                          ) : (
                            name
                          )}</strong>
                          {isTemplate && <span className="template-flag">TEMPLATE</span>}
                        </div>
                        {!isTemplate && <small>No Template</small>}
                      </div>
                    </div>

                    <div className="status-cell">
                      {isEditing ? (
                        <select className="inline-select" value={status} onChange={() => undefined}>
                          <option value="DRAFT">Draft</option>
                          <option value="ACTIVE">Active</option>
                          <option value="COMPLETED">Completed</option>
                        </select>
                      ) : (
                        <span className={statusMeta.className}>{statusMeta.label}</span>
                      )}
                    </div>

                    <div className="format-cell">
                      {isEditing ? (
                        <select
                          className="inline-select"
                          value={editFormat}
                          onChange={(event) => setEditFormat(event.target.value as TournamentFormat)}
                        >
                          {FORMATS.map((option) => (
                            <option key={option} value={option}>{formatLabel(option)}</option>
                          ))}
                        </select>
                      ) : (
                        <>
                          <span className="meta-icon">{formatIcon(format)}</span>
                          <span>{formatLabel(format)}</span>
                        </>
                      )}
                    </div>

                    <div className="game-cell">
                      <span className="meta-icon">🎱</span>
                      <span>{gameName}</span>
                    </div>

                    <div className="players-cell">
                      <span className="meta-icon">👥</span>
                      <span>{rowPlayers(playerCount)}</span>
                    </div>

                    <div className="date-cell">
                      {isEditing ? (
                        <input
                          className="inline-date"
                          type="date"
                          value={editDate || dateValue}
                          onChange={(event) => setEditDate(event.target.value)}
                          aria-label="Edit tournament date"
                        />
                      ) : (
                        <>
                          <span className="meta-icon">📅</span>
                          <div className="date-stack">
                            <strong>{createdDate}</strong>
                            <small>{createdTime}</small>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="location-cell">
                      <span className="meta-icon">📍</span>
                      <span>{location}</span>
                    </div>

                    <div className="actions-cell" onClick={(event) => event.stopPropagation()}>
                      {id && !id.startsWith('invalid-') && (
                        <button type="button" className="mini-btn play-btn" onClick={() => navigate(`/tournament/${id}`)} aria-label="Open tournament">▶</button>
                      )}

                      {!isEditing ? (
                        <button
                          type="button"
                          className="mini-btn"
                          onClick={() => startEdit(id, name, format, dateValue)}
                          aria-label="Quick edit tournament name, date, and format"
                        >
                          ✎
                        </button>
                      ) : (
                        <>
                          <button type="button" className="mini-btn success" onClick={() => saveEdit(id)} aria-label="Save tournament">✓</button>
                          <button type="button" className="mini-btn" onClick={cancelEdit} aria-label="Cancel editing">✕</button>
                        </>
                      )}

                      <button type="button" className="mini-btn" onClick={() => openSettings(id)} aria-label="Open full tournament settings">⚙</button>
                      <button type="button" className="mini-btn" onClick={() => downloadBackup(tournament, name)} aria-label="Backup tournament">⤓</button>
                      <button type="button" className="mini-btn danger" onClick={() => confirmDelete(id, name)} aria-label="Delete tournament">🗑</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </>
      )}

      <div className="table-footer">
        <span>Showing {filteredTournaments.length} of {tournamentList.length} tournaments</span>
        <div className="page-nav" aria-label="Pagination">
          <button type="button" className="page-btn">‹</button>
          <button type="button" className="page-btn active">1</button>
          <button type="button" className="page-btn">›</button>
        </div>
      </div>
    </div>
  );
}
