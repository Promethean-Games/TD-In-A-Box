import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getCurrentUser, signOutCurrentUser } from '@/lib/auth';
import {
  formatChannelOptionLabel,
  getAllowedBroadcastChannelsForUser,
  getAvailableVenueChannelNumbers,
  getVenueChannelAnalytics,
  getVenueChannelChangeRequests,
  getVenueChannelSettingsForUser,
  submitVenueChannelChangeRequest,
  updateVenueChannelSettings
} from '@/lib/channel';
import './AccountPage.css';

export default function AccountPage() {
  const navigate = useNavigate();
  const user = getCurrentUser();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, setRefreshKey] = useState(0);
  const isVenueAccount = user.role === 'VENUE_ADMIN' || user.tier === 'VENUE';
  const primaryVenueId = user.venueIds[0] ?? null;
  const venueChannelOptions = getAllowedBroadcastChannelsForUser(user).filter((channel) => channel.type === 'VENUE');
  const venueChannelSettings = isVenueAccount ? getVenueChannelSettingsForUser(user) : null;
  const [selectedVenueChannelId, setSelectedVenueChannelId] = useState(venueChannelSettings?.channelId ?? '');
  const [channelNameDraft, setChannelNameDraft] = useState(venueChannelSettings?.channelName ?? '');
  const currentSelectedVenueChannel =
    venueChannelOptions.find((channel) => channel.id === selectedVenueChannelId) ?? venueChannelOptions[0] ?? null;
  const availableVenueNumbers = getAvailableVenueChannelNumbers(currentSelectedVenueChannel?.number ?? null);
  const [requestedVenueChannelNumber, setRequestedVenueChannelNumber] = useState<number>(
    currentSelectedVenueChannel?.number ?? availableVenueNumbers[0] ?? 1
  );
  const [requestedVenueChannelName, setRequestedVenueChannelName] = useState(venueChannelSettings?.channelName ?? '');
  const venueAnalytics = (() => {
    if (!primaryVenueId || !currentSelectedVenueChannel) return null;
    return getVenueChannelAnalytics(primaryVenueId, currentSelectedVenueChannel.number);
  })();
  const venueRequests = (() => {
    if (!primaryVenueId) return [];
    return getVenueChannelChangeRequests().filter((request) => request.venueId === primaryVenueId);
  })();

  useEffect(() => {
    setSelectedVenueChannelId(venueChannelSettings?.channelId ?? venueChannelOptions[0]?.id ?? '');
    setChannelNameDraft(venueChannelSettings?.channelName ?? venueChannelOptions[0]?.entityName ?? '');
    setRequestedVenueChannelName(venueChannelSettings?.channelName ?? venueChannelOptions[0]?.entityName ?? '');
  }, [venueChannelSettings?.channelId, venueChannelSettings?.channelName, venueChannelOptions]);

  useEffect(() => {
    setRequestedVenueChannelNumber(currentSelectedVenueChannel?.number ?? availableVenueNumbers[0] ?? 1);
  }, [currentSelectedVenueChannel?.number, availableVenueNumbers]);

  const handleSignOut = async () => {
    setError(null);
    setNotice(null);

    try {
      await signOutCurrentUser();
      navigate('/login');
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : 'Unable to sign out.');
    }
  };

  const handleSaveVenueChannel = () => {
    if (!isVenueAccount) return;
    setError(null);
    setNotice(null);
    const updated = updateVenueChannelSettings(user, {
      channelId: selectedVenueChannelId,
      channelName: channelNameDraft
    });
    if (!updated) {
      setError('Unable to save venue channel settings.');
      return;
    }
    setNotice('Venue channel settings saved.');
    setRefreshKey((value) => value + 1);
  };

  const handleSubmitVenueChannelRequest = () => {
    if (!isVenueAccount) return;
    setError(null);
    setNotice(null);
    try {
      submitVenueChannelChangeRequest(user, requestedVenueChannelNumber, requestedVenueChannelName);
      setNotice('Channel change request sent to platform admin.');
      setRefreshKey((value) => value + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to submit request.');
    }
  };

  return (
    <div className="account-page">
      <div className="account-card">
        <header className="account-header">
          <h1>Account</h1>
          <span className="account-badge">{user.tier}</span>
        </header>

        <div className="account-section">
          <div className="account-row">
            <div className="account-field">
              <label>Name</label>
              <div className="value">{user.name}</div>
            </div>
            <div className="account-field">
              <label>Email</label>
              <div className="value">{user.email}</div>
            </div>
          </div>

          <div className="account-row">
            <div className="account-field">
              <label>Role</label>
              <div className="value">{user.role.replace('_', ' ')}</div>
            </div>
            <div className="account-field">
              <label>Status</label>
              <div className="value">{user.status}</div>
            </div>
          </div>

          <div className="account-row">
            <div className="account-field">
              <label>Account ID</label>
              <div className="value">{user.id}</div>
            </div>
            <div className="account-field">
              <label>TDTV Channel</label>
              <div className="value">{user.tdChannelId ?? 'Not assigned'}</div>
            </div>
          </div>
        </div>

        {isVenueAccount && (
          <div className="venue-channel-section">
            <h2>Venue channel settings</h2>
            {venueChannelOptions.length === 0 ? (
              <p className="account-muted">No dedicated venue channels are assigned yet.</p>
            ) : (
              <>
                <div className="account-row">
                  <div className="account-field">
                    <label>Dedicated channel</label>
                    <select
                      className="account-select"
                      value={selectedVenueChannelId}
                      onChange={(event) => setSelectedVenueChannelId(event.target.value)}
                    >
                      {venueChannelOptions.map((channel) => (
                        <option key={channel.id} value={channel.id}>
                          {formatChannelOptionLabel(channel)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="account-field">
                    <label>Channel display name</label>
                    <input
                      className="account-input"
                      type="text"
                      value={channelNameDraft}
                      onChange={(event) => setChannelNameDraft(event.target.value)}
                    />
                  </div>
                </div>
                <div className="account-actions account-actions--inline">
                  <button type="button" className="primary-btn" onClick={handleSaveVenueChannel}>
                    Save channel settings
                  </button>
                </div>
              </>
            )}

            {venueAnalytics && (
              <div className="venue-metrics-grid">
                <article className="metric-chip">
                  <span>Current viewers</span>
                  <strong>{venueAnalytics.currentViewers}</strong>
                </article>
                <article className="metric-chip">
                  <span>Avg concurrent</span>
                  <strong>{venueAnalytics.avgConcurrentViewers}</strong>
                </article>
                <article className="metric-chip">
                  <span>Peak viewers</span>
                  <strong>{venueAnalytics.peakViewers}</strong>
                </article>
                <article className="metric-chip">
                  <span>30-day growth</span>
                  <strong>{venueAnalytics.growthLast30Days >= 0 ? '+' : ''}{venueAnalytics.growthLast30Days}%</strong>
                </article>
              </div>
            )}

            <div className="venue-request-panel">
              <h3>Request dedicated channel change</h3>
              <p className="account-muted">Requests are sent to platform admin for approval before routing changes are applied.</p>
              <div className="account-row">
                <div className="account-field">
                  <label>Requested venue channel (001-100)</label>
                  <select
                    className="account-select"
                    value={requestedVenueChannelNumber}
                    onChange={(event) => setRequestedVenueChannelNumber(Number(event.target.value))}
                  >
                    {availableVenueNumbers.map((number) => (
                      <option key={number} value={number}>
                        VENUE-{String(number).padStart(3, '0')}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="account-field">
                  <label>Requested channel name</label>
                  <input
                    className="account-input"
                    type="text"
                    value={requestedVenueChannelName}
                    onChange={(event) => setRequestedVenueChannelName(event.target.value)}
                  />
                </div>
              </div>
              <div className="account-actions account-actions--inline">
                <button type="button" className="secondary-btn" onClick={handleSubmitVenueChannelRequest}>
                  Submit request
                </button>
              </div>
              {venueRequests.length > 0 && (
                <div className="request-list">
                  {venueRequests.slice(0, 4).map((request) => (
                    <div className="request-row" key={request.id}>
                      <strong>VENUE-{String(request.requestedChannelNumber).padStart(3, '0')}</strong>
                      <span>{request.requestedChannelName}</span>
                      <em>{request.status}</em>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {notice && <p className="account-notice">{notice}</p>}
        {error && <p className="account-error">{error}</p>}

        <div className="account-actions">
          <button type="button" className="primary-btn">
            Manage Subscription
          </button>
          <button type="button" className="secondary-btn" onClick={handleSignOut}>
            Sign Out
          </button>
          <Link to="/" className="secondary-btn account-link-button">
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
