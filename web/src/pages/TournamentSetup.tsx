import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser, getEffectiveTier } from '@/lib/auth';
import { useTournamentStore } from '@/store/tournamentStore';
import { TournamentFormat, calculatePrizeContributionPerPlayer } from '@/lib/tournament';
import {
  canCreateTemplates,
  canUseChipTournament,
  canUseModifiedElimination,
  getModifiedEliminationRaceCap,
  getTierLimit
} from '@/lib/subscription';
import { getChannelRegistry } from '@/lib/channel';
import './TournamentSetup.css';

const FORMATS: { value: TournamentFormat; label: string; description: string; accent: string }[] = [
  {
    value: 'SINGLE_ELIMINATION',
    label: 'Single Elimination',
    description: 'Best of 1 bracket progression',
    accent: 'linear-gradient(135deg, rgba(255, 91, 106, 0.22), rgba(255, 255, 255, 0.04))'
  },
  {
    value: 'DOUBLE_ELIMINATION',
    label: 'Double Elimination',
    description: 'One loss resets, two losses eliminated',
    accent: 'linear-gradient(135deg, rgba(85, 135, 255, 0.22), rgba(116, 217, 255, 0.08))'
  },
  {
    value: 'MODIFIED_ELIMINATION',
    label: 'Modified Elimination',
    description: 'Hybrid format with custom progression',
    accent: 'linear-gradient(135deg, rgba(68, 196, 158, 0.2), rgba(116, 217, 255, 0.08))'
  },
  {
    value: 'CHIP_TOURNAMENT',
    label: 'Chip Tournament',
    description: 'Score-based ranking play',
    accent: 'linear-gradient(135deg, rgba(247, 179, 67, 0.2), rgba(255, 255, 255, 0.04))'
  }
];

function FieldHint({ text }: { text: string }) {
  return (
    <span className="field-hint-wrap">
      <span className="field-hint-trigger" tabIndex={0} aria-label={text}>
        i
      </span>
      <span className="field-tooltip" role="tooltip">{text}</span>
    </span>
  );
}

function FieldLabel({ label, hint, htmlFor }: { label: string; hint: string; htmlFor?: string }) {
  const content = (
    <>
      <span>{label}</span>
      <FieldHint text={hint} />
    </>
  );

  return htmlFor ? <label htmlFor={htmlFor} className="field-label-row">{content}</label> : <span className="field-label field-label-row">{content}</span>;
}

export default function TournamentSetup() {
  const navigate = useNavigate();
  const { createTournament } = useTournamentStore();
  const [name, setName] = useState('');
  const [format, setFormat] = useState<TournamentFormat>('SINGLE_ELIMINATION');
  const [isFormatMenuOpen, setIsFormatMenuOpen] = useState(false);
  const [entryFee, setEntryFee] = useState<number>(0);
  const [greenFee, setGreenFee] = useState<number>(0);
  const [payoutPositions, setPayoutPositions] = useState<number>(3);
  const [tableCount, setTableCount] = useState<number>(1);
  const [isRaceMenuOpen, setIsRaceMenuOpen] = useState(false);
  const [winnersRaceTo, setWinnersRaceTo] = useState<number>(2);
  const [losersRaceTo, setLosersRaceTo] = useState<number>(1);
  const [hasRaceShift, setHasRaceShift] = useState(false);
  const [raceShiftStartRound, setRaceShiftStartRound] = useState<number>(3);
  const [winnersRaceToAfterShift, setWinnersRaceToAfterShift] = useState<number>(1);
  const [losersRaceToAfterShift, setLosersRaceToAfterShift] = useState<number>(1);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [location, setLocation] = useState('');
  const [venueId, setVenueId] = useState('');
  const [venueName, setVenueName] = useState('');
  const [eventDateTime, setEventDateTime] = useState('');
  const [loading, setLoading] = useState(false);
  const currentUser = getCurrentUser();
  const accessTier = getEffectiveTier(currentUser);
  const venueOptions = useMemo(() => {
    const channels = getChannelRegistry().filter((channel) => channel.type === 'VENUE' && channel.status === 'ACTIVE');
    return channels.map((channel) => ({
      id: channel.entityId,
      label: channel.entityName,
      location: channel.entityName,
      channelNumber: channel.number
    }));
  }, []);
  const canSaveTemplate = canCreateTemplates(accessTier);
  const canSelectModifiedElimination = canUseModifiedElimination(accessTier);
  const canSelectChipTournament = canUseChipTournament(accessTier);
  const modifiedRaceCap = getModifiedEliminationRaceCap(accessTier);
  const templateLimit = getTierLimit(accessTier, 'templates');
  const prizeContributionPerPlayer = calculatePrizeContributionPerPlayer(entryFee, greenFee);
  const selectedFormat = FORMATS.find((option) => option.value === format) ?? FORMATS[0];
  const raceSummary = hasRaceShift
    ? `${winnersRaceTo}/${losersRaceTo} until round ${Math.max(2, raceShiftStartRound)}, then ${winnersRaceToAfterShift}/${losersRaceToAfterShift}`
    : `${winnersRaceTo}/${losersRaceTo} all event`;
  const canSubmitTournament =
    name.trim().length > 0 &&
    location.trim().length > 0 &&
    Math.max(1, Math.min(100, Number(payoutPositions) || 1)) >= 1 &&
    Math.max(1, Number(tableCount) || 1) >= 1 &&
    (format !== 'MODIFIED_ELIMINATION' || canSelectModifiedElimination) &&
    (format !== 'CHIP_TOURNAMENT' || canSelectChipTournament);

  const clampRace = (value: number) => Math.max(1, Math.min(modifiedRaceCap, Number(value) || 1));
  const clampShiftRound = (value: number) => Math.max(2, Math.floor(Number(value) || 2));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmitTournament) {
      alert('Tournament name and venue/location are required');
      return;
    }
    if (format === 'MODIFIED_ELIMINATION' && !canSelectModifiedElimination) {
      alert('Modified Elimination is available to paid members on Pro, Pro+, and Venue tiers.');
      return;
    }
    if (format === 'CHIP_TOURNAMENT' && !canSelectChipTournament) {
      alert('Chip Tournament is available to paid members on Pro, Pro+, and Venue tiers.');
      return;
    }

    setLoading(true);
    try {
      const normalizedWinnersRace = clampRace(winnersRaceTo);
      const normalizedLosersRace = clampRace(losersRaceTo);
      const normalizedShiftRound = hasRaceShift ? clampShiftRound(raceShiftStartRound) : null;
      const normalizedWinnersRaceAfterShift = clampRace(winnersRaceToAfterShift);
      const normalizedLosersRaceAfterShift = clampRace(losersRaceToAfterShift);
      const resolvedVenue = venueOptions.find((option) => option.id === venueId) ?? null;
      const finalVenueName = resolvedVenue?.label || venueName.trim() || location.trim();
      const finalLocation = resolvedVenue?.location || location.trim();
      const newTournament = createTournament(name, format, {
        entryFee: Number(entryFee) || 0,
        greenFee: Number(greenFee) || 0,
        payoutPositions: Math.max(1, Math.min(100, Number(payoutPositions) || 3)),
        tableCount: Math.max(1, Number(tableCount) || 1),
        isTemplate: canSaveTemplate && saveAsTemplate,
        winnersRaceTo: format === 'MODIFIED_ELIMINATION' ? normalizedWinnersRace : 1,
        losersRaceTo: format === 'MODIFIED_ELIMINATION' ? normalizedLosersRace : 1,
        raceShiftStartRound: format === 'MODIFIED_ELIMINATION' ? normalizedShiftRound : null,
        winnersRaceToAfterShift: format === 'MODIFIED_ELIMINATION' ? normalizedWinnersRaceAfterShift : 1,
        losersRaceToAfterShift: format === 'MODIFIED_ELIMINATION' ? normalizedLosersRaceAfterShift : 1,
        location: finalLocation,
        venueId: resolvedVenue?.id ?? (venueId || null),
        venueName: finalVenueName,
        date: eventDateTime ? new Date(eventDateTime).toISOString() : new Date().toISOString()
      });
      setTimeout(() => {
        navigate(`/tournament/${newTournament?.id ?? ''}`);
      }, 100);
    } catch (error) {
      alert(`Error: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="tournament-setup">
      <div className="setup-container">
        <div className="setup-header">
          <h1 className="setup-title">Create New Tournament</h1>
          <p className="setup-subtitle">Set up a new tournament with your preferred format</p>
        </div>

        <form onSubmit={handleSubmit} className="setup-form-card">
          <div className="form-grid">
            <div className="form-group">
              <FieldLabel
                htmlFor="name"
                label="Tournament Name *"
                hint="This is the event name shown everywhere in the app, on the bracket, and on broadcast views."
              />
              <input
                id="name"
                className="form-input"
                type="text"
                placeholder="e.g., Weekly Pool Challenge"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <FieldLabel
                htmlFor="venue-select"
                label="Tournament Location *"
                hint="Pick the venue or create a custom location. Platform venue records are used for unified channel and historical tracking."
              />
              <select
                id="venue-select"
                className="form-input"
                value={venueId}
                onChange={(event) => {
                  const nextVenueId = event.target.value;
                  setVenueId(nextVenueId);
                  const option = venueOptions.find((entry) => entry.id === nextVenueId);
                  setVenueName(option?.label ?? '');
                  setLocation(option?.location ?? '');
                }}
              >
                <option value="">Select a venue or custom location</option>
                {venueOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
                <option value="custom">Custom location</option>
              </select>
              {(!venueId || venueId === 'custom') && (
                <input
                  className="form-input"
                  type="text"
                  placeholder="Enter a custom venue or city location"
                  value={location}
                  onChange={(e) => {
                    setLocation(e.target.value);
                    setVenueName(e.target.value);
                    setVenueId('custom');
                  }}
                  style={{ marginTop: 8 }}
                />
              )}
            </div>

            <div className="form-group">
              <FieldLabel
                label="Tournament Format *"
                hint="This determines the tournament rules and how players advance through the event."
              />
              <button
                type="button"
                className="format-accordion-trigger"
                onClick={() => setIsFormatMenuOpen((current) => !current)}
                aria-expanded={isFormatMenuOpen}
                aria-controls="format-accordion-panel"
              >
                <span className="format-accordion-copy">
                  <strong>{selectedFormat.label}</strong>
                  <small>{selectedFormat.description}</small>
                </span>
                <span className="format-accordion-chevron" aria-hidden="true">
                  {isFormatMenuOpen ? '▲' : '▼'}
                </span>
              </button>

              {isFormatMenuOpen && (
                <div id="format-accordion-panel" className="format-accordion-panel" role="listbox" aria-label="Tournament format selection">
                  {FORMATS.map((option) => {
                    const active = option.value === format;
                    const isLocked =
                      (option.value === 'MODIFIED_ELIMINATION' && !canSelectModifiedElimination) ||
                      (option.value === 'CHIP_TOURNAMENT' && !canSelectChipTournament);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`format-tile ${active ? 'active' : ''} ${isLocked ? 'locked' : ''}`}
                        style={{ background: option.accent }}
                        onClick={() => {
                          if (isLocked) return;
                          setFormat(option.value);
                          setIsFormatMenuOpen(false);
                        }}
                        role="option"
                        aria-selected={active}
                        disabled={isLocked}
                        title={
                          isLocked
                            ? option.value === 'CHIP_TOURNAMENT'
                              ? 'Chip Tournament unlocks for paid members on Pro, Pro+, and Venue tiers.'
                              : 'Modified Elimination unlocks for paid members on Pro, Pro+, and Venue tiers.'
                            : undefined
                        }
                      >
                        <span className="format-label">{option.label}</span>
                        <span className="format-description">{option.description}</span>
                        {isLocked && <span className="format-lock-note">Paid feature</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {format === 'MODIFIED_ELIMINATION' && (
              <div className="form-group">
                <FieldLabel
                  label="Modified Elimination Race Settings"
                  hint="These settings define the race length for winners-side and losers-side matches, including any later-round change."
                />
                <button
                  type="button"
                  className="format-accordion-trigger"
                  onClick={() => setIsRaceMenuOpen((current) => !current)}
                  aria-expanded={isRaceMenuOpen}
                  aria-controls="race-accordion-panel"
                >
                  <span className="format-accordion-copy">
                    <strong>{raceSummary}</strong>
                    <small>Tier cap: up to {modifiedRaceCap}/{modifiedRaceCap}</small>
                  </span>
                  <span className="format-accordion-chevron" aria-hidden="true">
                    {isRaceMenuOpen ? '▲' : '▼'}
                  </span>
                </button>
                {isRaceMenuOpen && (
                  <div id="race-accordion-panel" className="race-accordion-panel">
                    <p className="race-help-copy">
                      Set base races by bracket side, then optionally shorten them starting on a later round.
                    </p>
                    <div className="race-input-grid">
                      <label className="form-group compact" title={`Each winners-side match requires this many game wins (max ${modifiedRaceCap}).`}>
                        <span className="field-label-row">
                          <span>Winners side race</span>
                          <FieldHint text="How many games a player must win to take a winners-side match." />
                        </span>
                        <input
                          className="form-input"
                          type="number"
                          min={1}
                          max={modifiedRaceCap}
                          step={1}
                          value={winnersRaceTo}
                          onChange={(event) => setWinnersRaceTo(clampRace(Number(event.target.value)))}
                        />
                      </label>
                      <label className="form-group compact" title={`Each losers-side match requires this many game wins (max ${modifiedRaceCap}).`}>
                        <span className="field-label-row">
                          <span>Losers side race</span>
                          <FieldHint text="How many games a player must win to take a losers-side match." />
                        </span>
                        <input
                          className="form-input"
                          type="number"
                          min={1}
                          max={modifiedRaceCap}
                          step={1}
                          value={losersRaceTo}
                          onChange={(event) => setLosersRaceTo(clampRace(Number(event.target.value)))}
                        />
                      </label>
                    </div>
                    <label className="race-shift-toggle" htmlFor="race-shift-enabled">
                      <input
                        id="race-shift-enabled"
                        type="checkbox"
                        checked={hasRaceShift}
                        onChange={(event) => setHasRaceShift(event.target.checked)}
                      />
                      <span className="toggle-indicator" aria-hidden="true" />
                      <span className="toggle-copy">
                        <strong>Shorten the race later in the bracket</strong>
                        <small>Example: 3/2 until round 3, then 1/1 for the closing rounds.</small>
                      </span>
                    </label>
                    {hasRaceShift && (
                      <div className="race-shift-panel">
                        <div className="race-input-grid race-input-grid--shift">
                          <label className="form-group compact" title="These shorter races begin on this round and continue for the rest of the event.">
                            <span className="field-label-row">
                              <span>Switch starting round</span>
                              <FieldHint text="The round number where the later race settings begin for the rest of the event." />
                            </span>
                            <input
                              className="form-input"
                              type="number"
                              min={2}
                              step={1}
                              value={raceShiftStartRound}
                              onChange={(event) => setRaceShiftStartRound(clampShiftRound(Number(event.target.value)))}
                            />
                          </label>
                          <label className="form-group compact" title={`Winners-side race from round ${Math.max(2, raceShiftStartRound)} onward (max ${modifiedRaceCap}).`}>
                            <span className="field-label-row">
                              <span>Later winners race</span>
                              <FieldHint text="The winners-side race length after the switch round is reached." />
                            </span>
                            <input
                              className="form-input"
                              type="number"
                              min={1}
                              max={modifiedRaceCap}
                              step={1}
                              value={winnersRaceToAfterShift}
                              onChange={(event) => setWinnersRaceToAfterShift(clampRace(Number(event.target.value)))}
                            />
                          </label>
                          <label className="form-group compact" title={`Losers-side race from round ${Math.max(2, raceShiftStartRound)} onward (max ${modifiedRaceCap}).`}>
                            <span className="field-label-row">
                              <span>Later losers race</span>
                              <FieldHint text="The losers-side race length after the switch round is reached." />
                            </span>
                            <input
                              className="form-input"
                              type="number"
                              min={1}
                              max={modifiedRaceCap}
                              step={1}
                              value={losersRaceToAfterShift}
                              onChange={(event) => setLosersRaceToAfterShift(clampRace(Number(event.target.value)))}
                            />
                          </label>
                        </div>
                        <small className="race-cap-note">
                          Early bracket: {winnersRaceTo}/{losersRaceTo}. Late bracket from round {Math.max(2, raceShiftStartRound)}: {winnersRaceToAfterShift}/{losersRaceToAfterShift}.
                        </small>
                      </div>
                    )}
                    <small className="race-cap-note">
                      Paid tiers can set custom race values up to 10/10.
                    </small>
                  </div>
                )}
              </div>
            )}

            <div className="inline-field-grid">
              <div className="form-group compact">
                <FieldLabel
                  htmlFor="event-date-time"
                  label="Tournament Date & Time"
                  hint="Optional. Used for scheduling, coming-soon overlays, and live-event countdowns when a broadcast is live before the start time."
                />
                <input
                  id="event-date-time"
                  className="form-input"
                  type="datetime-local"
                  value={eventDateTime}
                  onChange={(e) => setEventDateTime(e.target.value)}
                />
              </div>

              <div className="form-group compact">
                <FieldLabel
                  htmlFor="entry-fee"
                  label="$ Total Entry / Player"
                  hint="The full dollar amount each player pays to enter the event before any green fee is removed."
                />
                <input
                  id="entry-fee"
                  className="form-input"
                  type="number"
                  min="0"
                  step="1"
                  value={entryFee}
                  onChange={(e) => setEntryFee(Math.max(0, Number(e.target.value || 0)))}
                />
              </div>

              <div className="form-group compact">
                <FieldLabel
                  htmlFor="green-fee"
                  label="$ Green Fee / Player"
                  hint="The dollar amount taken out of each entry for venue or administrative costs."
                />
                <input
                  id="green-fee"
                  className="form-input"
                  type="number"
                  min="0"
                  step="1"
                  value={greenFee}
                  onChange={(e) => setGreenFee(Math.max(0, Number(e.target.value || 0)))}
                />
              </div>

              <div className="form-group compact">
                <FieldLabel
                  htmlFor="payout-positions"
                  label="Payout Positions"
                  hint="How many finishing spots receive prize money when payouts are calculated."
                />
                <input
                  id="payout-positions"
                  className="form-input"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={payoutPositions}
                  onChange={(e) => setPayoutPositions(Math.max(1, Math.min(100, Number(e.target.value || 1))))}
                />
              </div>

              <div className="form-group compact">
                <FieldLabel
                  htmlFor="table-count"
                  label="Table Count"
                  hint="How many tables this tournament can actively use. The software uses this to know how many matches can be put on the floor at once."
                />
                <input
                  id="table-count"
                  className="form-input"
                  type="number"
                  min="1"
                  step="1"
                  value={tableCount}
                  onChange={(e) => setTableCount(Math.max(1, Number(e.target.value || 1)))}
                />
              </div>
            </div>

            <div className="prize-pool-preview" role="status" aria-live="polite">
              <span className="label">Prize Pool Entry / Player</span>
              <strong>${prizeContributionPerPlayer.toFixed(2)}</strong>
              <small>
                {entryFee > 0 || greenFee > 0
                  ? `$${entryFee.toFixed(2)} total entry - $${greenFee.toFixed(2)} green fee`
                  : 'Set total entry and green fee to calculate each player contribution.'}
              </small>
            </div>

            {canSaveTemplate && (
              <div className="template-toggle-row">
                <label className="template-toggle" htmlFor="save-template">
                  <input
                    id="save-template"
                    type="checkbox"
                    checked={saveAsTemplate}
                    onChange={(e) => setSaveAsTemplate(e.target.checked)}
                    disabled={templateLimit === 0}
                  />
                  <span className="toggle-indicator" aria-hidden="true" />
                  <span className="toggle-copy">
                    <strong>Save this setup as a template</strong>
                    <small>
                      {templateLimit === null
                        ? 'Available on this tier with venue or internal policy.'
                        : `Available on Pro and above. This tier allows up to ${templateLimit} templates.`}
                    </small>
                  </span>
                </label>
              </div>
            )}

          </div>

          <div className="form-actions">
          <button
            type="submit"
            className={`primary-btn create-tournament-btn ${canSubmitTournament ? 'ready' : ''}`}
            disabled={loading || !canSubmitTournament}
          >
            {loading ? 'Creating...' : 'Create Tournament'}
          </button>
          <button type="button" className="secondary-btn" onClick={() => navigate('/')}>
            Cancel
          </button>
          </div>
        </form>
      </div>
    </div>
  );
}
