import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  getCurrentUser,
  getEffectiveTier,
  getUserRoleLabel,
  getUserTierLabel,
  signOutCurrentUser,
  updateCurrentUserProfile,
  updateCurrentUserSubscription
} from '@/lib/auth';
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
import type { SubscriptionTier } from '@/lib/subscription';
import './AccountPage.css';

const SUBSCRIPTION_OPTIONS: { tier: SubscriptionTier; name: string; price: string; detail: string }[] = [
  { tier: 'BASIC', name: 'Basic', price: 'Free', detail: 'Core tournament workflow for individual testing.' },
  { tier: 'PRO', name: 'Pro', price: '$4.99/mo', detail: 'Broadcast basics, templates, and expanded tournament tools.' },
  { tier: 'PRO_PLUS', name: 'Pro+', price: '$9.99/mo', detail: 'TDTV channel access, advanced broadcast tools, and branding.' },
  { tier: 'VENUE', name: 'Venue', price: 'Custom', detail: 'Venue-level channel, device, and broadcast controls.' }
];

const BROADCAST_BILLING_OPTIONS = [
  {
    tier: 'PRO' as const,
    name: 'Pro',
    price: '$4.99/mo',
    kicker: 'In-room production',
    detail: 'Built for local stream control inside the venue.',
    emphasis: 'Good for operators who want overlays, camera pairing, and broadcast tools without TDTV distribution.',
    features: ['Broadcast overlays', 'USB + QR camera workflows', 'Tournament templates', 'Tournament history', 'TD profile tools'],
    footnote: 'TDTV / TV Guide placement is not included on Pro.'
  },
  {
    tier: 'PRO_PLUS' as const,
    name: 'Pro+',
    price: '$9.99/mo',
    kicker: 'TDTV-ready coverage',
    detail: 'Built for public-facing streams and the stronger upsell path.',
    emphasis: 'Use this tier when you want the tournament on TV, on the guide, and packaged with stronger broadcast controls.',
    features: ['Everything in Pro', 'TDTV / TV Guide placement', 'TD channel access', 'Network / Wi-Fi camera support', 'Advanced branding + sponsor tools'],
    footnote: 'Recommended when players expect a public-facing broadcast presence.'
  }
] as const;

export default function AccountPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = getCurrentUser();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [updatingSubscription, setUpdatingSubscription] = useState<SubscriptionTier | null>(null);
  const [, setRefreshKey] = useState(0);
  const [profileNameDraft, setProfileNameDraft] = useState(user.name);
  const [profileEmailDraft, setProfileEmailDraft] = useState(user.email);
  const isVenueAccount = user.role === 'VENUE_ADMIN' || user.tier === 'VENUE';
  const isPlatformAdmin = user.role === 'PLATFORM_ADMIN';
  const currentSection = searchParams.get('section') === 'billing' ? 'billing' : 'profile';
  const billingOffer = searchParams.get('offer');
  const showBroadcastOffer = currentSection === 'billing' && billingOffer === 'broadcast' && !isPlatformAdmin;
  const effectiveTier = getEffectiveTier(user);
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

  useEffect(() => {
    setProfileNameDraft(user.name);
    setProfileEmailDraft(user.email);
  }, [user.name, user.email]);

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

  const handleSaveProfile = async () => {
    setError(null);
    setNotice(null);
    setSavingProfile(true);
    try {
      const updated = await updateCurrentUserProfile(profileNameDraft, profileEmailDraft);
      setProfileNameDraft(updated.name);
      setProfileEmailDraft(updated.email);
      setNotice(
        profileEmailDraft.trim() !== user.email.trim()
          ? 'Account profile saved. If your email changed, watch for a confirmation message from your auth provider.'
          : 'Account profile saved.'
      );
      setRefreshKey((value) => value + 1);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSelectSubscription = async (tier: SubscriptionTier) => {
    setError(null);
    setNotice(null);
    setUpdatingSubscription(tier);
    try {
      await updateCurrentUserSubscription(tier);
      setNotice(`Plan updated to ${tier.replace('_', '+')}.`);
      setRefreshKey((value) => value + 1);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update subscription.');
    } finally {
      setUpdatingSubscription(null);
    }
  };

  return (
    <div className="account-page">
      <div className={`account-card ${showBroadcastOffer ? 'account-card--offer' : ''}`}>
        <header className="account-header">
          <h1>Account</h1>
          <span className={`account-badge ${isPlatformAdmin ? 'account-badge--admin' : ''}`}>{getUserTierLabel(user)}</span>
        </header>

        <div className="account-section-toggle" role="tablist" aria-label="Account sections">
          <button
            type="button"
            className={`account-section-tab ${currentSection === 'profile' ? 'active' : ''}`}
            onClick={() => setSearchParams({ section: 'profile' })}
          >
            Profile
          </button>
          <button
            type="button"
            className={`account-section-tab ${currentSection === 'billing' ? 'active' : ''}`}
            onClick={() => setSearchParams({ section: 'billing' })}
          >
            Plan & Billing
          </button>
        </div>

        {!showBroadcastOffer && (
          <div className="account-section">
            <div className="account-row">
              <div className="account-field">
                <label>Name</label>
                {currentSection === 'profile' ? (
                  <input
                    className="account-input"
                    type="text"
                    value={profileNameDraft}
                    onChange={(event) => setProfileNameDraft(event.target.value)}
                  />
                ) : (
                  <div className="value">{user.name}</div>
                )}
              </div>
              <div className="account-field">
                <label>Email</label>
                {currentSection === 'profile' ? (
                  <input
                    className="account-input"
                    type="email"
                    value={profileEmailDraft}
                    onChange={(event) => setProfileEmailDraft(event.target.value)}
                  />
                ) : (
                  <div className="value">{user.email}</div>
                )}
              </div>
            </div>

            <div className="account-row">
              <div className="account-field">
                <label>Role</label>
                <div className="value">{getUserRoleLabel(user)}</div>
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
        )}

        {currentSection === 'profile' && (
          <div className="account-actions account-actions--inline account-actions--profile">
            <button type="button" className="primary-btn" onClick={handleSaveProfile} disabled={savingProfile}>
              {savingProfile ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        )}

        {currentSection === 'billing' && (
          <div className="billing-section">
            {isPlatformAdmin ? (
              <div className="account-admin-entitlement">
                <h2>Platform Admin Access</h2>
                <p>
                  Platform Admin accounts carry universal entitlements across tournament, venue, channel, and broadcast workflows.
                </p>
                <div className="value">Effective feature tier: {effectiveTier.replace('_', '+')}</div>
              </div>
            ) : (
              <>
                {showBroadcastOffer ? (
                  <>
                    <div className="billing-offer-hero">
                      <span className="billing-offer-kicker">Broadcast Upgrade</span>
                      <h2>Choose the broadcast lane that matches the audience you want.</h2>
                      <p>
                        Pro is for in-room production. Pro+ is the tier for TDTV / TV Guide placement, wider exposure, and the fuller
                        broadcast toolset.
                      </p>
                      <div className="billing-offer-current">
                        Current plan: <strong>{SUBSCRIPTION_OPTIONS.find((option) => option.tier === effectiveTier)?.name ?? effectiveTier}</strong>
                      </div>
                    </div>

                    <div className="billing-compare-grid">
                      {BROADCAST_BILLING_OPTIONS.map((option) => {
                        const isCurrent = effectiveTier === option.tier;
                        return (
                          <article
                            key={option.tier}
                            className={`billing-compare-card ${option.tier === 'PRO_PLUS' ? 'featured' : ''} ${isCurrent ? 'active' : ''}`}
                          >
                            <div className="billing-compare-head">
                              <span className="billing-compare-kicker">{option.kicker}</span>
                              <div className="billing-compare-title-row">
                                <strong>{option.name}</strong>
                                <span className="billing-compare-price">{option.price}</span>
                              </div>
                              <p>{option.detail}</p>
                            </div>

                            <div className="billing-compare-emphasis">{option.emphasis}</div>

                            <div className="billing-compare-feature-list">
                              {option.features.map((feature) => (
                                <div key={`${option.tier}-${feature}`} className="billing-compare-feature">
                                  <span className="billing-compare-bullet" aria-hidden="true" />
                                  <span>{feature}</span>
                                </div>
                              ))}
                            </div>

                            <div className="billing-compare-footnote">{option.footnote}</div>

                            <button
                              type="button"
                              className={isCurrent ? 'secondary-btn' : 'primary-btn'}
                              onClick={() => void handleSelectSubscription(option.tier)}
                              disabled={isCurrent || updatingSubscription === option.tier}
                            >
                              {isCurrent ? 'Current Plan' : updatingSubscription === option.tier ? 'Processing...' : `Purchase ${option.name}`}
                            </button>
                          </article>
                        );
                      })}
                    </div>

                    <p className="billing-offer-caption">
                      Purchase buttons activate plan access for testing now. Stripe checkout can replace this exact purchase step later.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="billing-section-head">
                      <h2>Plan Management</h2>
                      <p>Select the plan you want active for product testing. Stripe checkout wiring can replace this flow later.</p>
                    </div>
                    <div className="billing-plan-grid">
                      {SUBSCRIPTION_OPTIONS.map((option) => {
                        const isCurrent = effectiveTier === option.tier;
                        return (
                          <article key={option.tier} className={`billing-plan-card ${isCurrent ? 'active' : ''}`}>
                            <div className="billing-plan-copy">
                              <div className="billing-plan-title-row">
                                <strong>{option.name}</strong>
                                <span className="billing-plan-price">{option.price}</span>
                              </div>
                              <span>{option.detail}</span>
                            </div>
                            <button
                              type="button"
                              className={isCurrent ? 'secondary-btn' : 'primary-btn'}
                              onClick={() => void handleSelectSubscription(option.tier)}
                              disabled={isCurrent || updatingSubscription === option.tier}
                            >
                              {isCurrent ? 'Current Plan' : updatingSubscription === option.tier ? 'Updating...' : `Switch to ${option.name}`}
                            </button>
                          </article>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

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
          {isPlatformAdmin ? (
            <Link to="/admin" className="primary-btn account-link-button">
              Open Admin Console
            </Link>
          ) : (
            <button
              type="button"
              className="primary-btn"
              onClick={() => setSearchParams({ section: 'billing' })}
            >
              Manage Subscription
            </button>
          )}
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
