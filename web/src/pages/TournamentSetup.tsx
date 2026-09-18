import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTournamentStore } from '@/store/tournamentStore';
import { TournamentFormat, calculatePrizeContributionPerPlayer } from '@/lib/tournament';
import {
  canConfigureTables,
  canCreateTemplates,
  canUseModifiedElimination,
  getModifiedEliminationRaceCap,
  getSubscriptionTier
} from '@/lib/subscription';
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

export default function TournamentSetup() {
  const navigate = useNavigate();
  const { createTournament } = useTournamentStore();
  const [name, setName] = useState('');
  const [format, setFormat] = useState<TournamentFormat>('SINGLE_ELIMINATION');
  const [isFormatMenuOpen, setIsFormatMenuOpen] = useState(false);
  const [entryFee, setEntryFee] = useState<number>(0);
  const [greenFee, setGreenFee] = useState<number>(0);
  const [payoutPositions, setPayoutPositions] = useState<number>(3);
  const [tableCount, setTableCount] = useState<number>(0);
  const [isRaceMenuOpen, setIsRaceMenuOpen] = useState(false);
  const [winnersRaceTo, setWinnersRaceTo] = useState<number>(2);
  const [losersRaceTo, setLosersRaceTo] = useState<number>(1);
  const [hasRaceShift, setHasRaceShift] = useState(false);
  const [raceShiftStartRound, setRaceShiftStartRound] = useState<number>(3);
  const [winnersRaceToAfterShift, setWinnersRaceToAfterShift] = useState<number>(1);
  const [losersRaceToAfterShift, setLosersRaceToAfterShift] = useState<number>(1);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [loading, setLoading] = useState(false);
  const subscriptionTier = getSubscriptionTier();
  const canSaveTemplate = canCreateTemplates(subscriptionTier);
  const canSetTableCount = canConfigureTables(subscriptionTier);
  const canSelectModifiedElimination = canUseModifiedElimination(subscriptionTier);
  const modifiedRaceCap = getModifiedEliminationRaceCap(subscriptionTier);
  const prizeContributionPerPlayer = calculatePrizeContributionPerPlayer(entryFee, greenFee);
  const selectedFormat = FORMATS.find((option) => option.value === format) ?? FORMATS[0];
  const raceSummary = hasRaceShift
    ? `${winnersRaceTo}/${losersRaceTo} until round ${Math.max(2, raceShiftStartRound)}, then ${winnersRaceToAfterShift}/${losersRaceToAfterShift}`
    : `${winnersRaceTo}/${losersRaceTo} all event`;

  const clampRace = (value: number) => Math.max(1, Math.min(modifiedRaceCap, Number(value) || 1));
  const clampShiftRound = (value: number) => Math.max(2, Math.floor(Number(value) || 2));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert('Tournament name required');
      return;
    }
    if (format === 'MODIFIED_ELIMINATION' && !canSelectModifiedElimination) {
      alert('Modified Elimination is available to paid members on Pro, Pro+, and Venue tiers.');
      return;
    }

    setLoading(true);
    try {
      const normalizedWinnersRace = clampRace(winnersRaceTo);
      const normalizedLosersRace = clampRace(losersRaceTo);
      const normalizedShiftRound = hasRaceShift ? clampShiftRound(raceShiftStartRound) : null;
      const normalizedWinnersRaceAfterShift = clampRace(winnersRaceToAfterShift);
      const normalizedLosersRaceAfterShift = clampRace(losersRaceToAfterShift);
      const newTournament = createTournament(name, format, {
        entryFee: Number(entryFee) || 0,
        greenFee: Number(greenFee) || 0,
        payoutPositions: Math.max(1, Math.min(100, Number(payoutPositions) || 3)),
        tableCount: canSetTableCount ? Math.max(0, Number(tableCount) || 0) : 0,
        isTemplate: canSaveTemplate && saveAsTemplate,
        winnersRaceTo: format === 'MODIFIED_ELIMINATION' ? normalizedWinnersRace : 1,
        losersRaceTo: format === 'MODIFIED_ELIMINATION' ? normalizedLosersRace : 1,
        raceShiftStartRound: format === 'MODIFIED_ELIMINATION' ? normalizedShiftRound : null,
        winnersRaceToAfterShift: format === 'MODIFIED_ELIMINATION' ? normalizedWinnersRaceAfterShift : 1,
        losersRaceToAfterShift: format === 'MODIFIED_ELIMINATION' ? normalizedLosersRaceAfterShift : 1
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
              <label htmlFor="name">Tournament Name *</label>
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
              <span className="field-label">Tournament Format *</span>
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
                    const modifiedLocked = option.value === 'MODIFIED_ELIMINATION' && !canSelectModifiedElimination;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`format-tile ${active ? 'active' : ''} ${modifiedLocked ? 'locked' : ''}`}
                        style={{ background: option.accent }}
                        onClick={() => {
                          if (modifiedLocked) return;
                          setFormat(option.value);
                          setIsFormatMenuOpen(false);
                        }}
                        role="option"
                        aria-selected={active}
                        disabled={modifiedLocked}
                        title={
                          modifiedLocked
                            ? 'Modified Elimination unlocks for paid members on Pro, Pro+, and Venue tiers.'
                            : undefined
                        }
                      >
                        <span className="format-label">{option.label}</span>
                        <span className="format-description">{option.description}</span>
                        {modifiedLocked && <span className="format-lock-note">Paid feature</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {format === 'MODIFIED_ELIMINATION' && (
              <div className="form-group">
                <span className="field-label">Modified Elimination Race Settings</span>
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
                        <span>Winners side race</span>
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
                        <span>Losers side race</span>
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
                            <span>Switch starting round</span>
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
                            <span>Later winners race</span>
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
                            <span>Later losers race</span>
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
                      Caps by tier: Pro 3/3, Pro+ 5/5, Venue 10/10.
                    </small>
                  </div>
                )}
              </div>
            )}

            <div className="inline-field-grid">
              <div className="form-group compact">
                <label htmlFor="entry-fee">Total Entry / Player</label>
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
                <label htmlFor="green-fee">Green Fee / Player</label>
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
                <label htmlFor="payout-positions">Payout Positions</label>
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

              {canSetTableCount && (
                <div className="form-group compact">
                  <label htmlFor="table-count">Table Count</label>
                  <input
                    id="table-count"
                    className="form-input"
                    type="number"
                    min="0"
                    step="1"
                    value={tableCount}
                    onChange={(e) => setTableCount(Math.max(0, Number(e.target.value || 0)))}
                  />
                </div>
              )}
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
                  />
                  <span className="toggle-indicator" aria-hidden="true" />
                  <span className="toggle-copy">
                    <strong>Save this setup as a template</strong>
                    <small>Available on Pro+ and Venue tiers.</small>
                  </span>
                </label>
              </div>
            )}

          </div>

          <div className="form-actions">
            <button type="submit" className="primary-btn" disabled={loading}>
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
