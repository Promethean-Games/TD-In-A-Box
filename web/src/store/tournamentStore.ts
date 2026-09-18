import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import {
  Tournament,
  TournamentEngine,
  TournamentFormat,
  TournamentSeedMode,
  db,
  normalizeTournament,
  normalizePayoutPercentages
} from '@/lib/tournament';

export interface TournamentStore {
  tournaments: Tournament[];
  currentTournament: Tournament | null;
  loading: boolean;
  error: string | null;

  // Actions
  setCurrentTournament: (tournament: Tournament | null) => void;
  createTournament: (
    name: string,
    format: TournamentFormat,
    config?: {
      entryFee?: number;
      greenFee?: number;
      payoutPositions?: number;
      isTemplate?: boolean;
      tableCount?: number;
      seedingMethod?: TournamentSeedMode;
      winnersRaceTo?: number;
      losersRaceTo?: number;
      raceShiftStartRound?: number | null;
      winnersRaceToAfterShift?: number;
      losersRaceToAfterShift?: number;
    }
  ) => Tournament;
  fetchTournaments: () => void;
  fetchTournament: (id: string) => void;
  addPlayer: (tournamentId: string, playerName: string) => void;
  removePlayer: (tournamentId: string, playerId: string) => void;
  updateTournament: (tournamentId: string, updates: Partial<Tournament>) => void;
  deleteTournament: (tournamentId: string) => void;
  reorderPlayers: (tournamentId: string, orderedPlayerIds: string[], seedingMethod: TournamentSeedMode) => void;
  generateBracket: (tournamentId: string) => void;
  startTournament: (tournamentId: string) => void;
  completeMatch: (tournamentId: string, matchId: string, winnerId: string, score?: string) => void;
  hydrate: () => void;
  reset: () => void;
  clearError: () => void;
}

function normalizePersistedTournaments(value: unknown): Tournament[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeTournament(entry as Partial<Tournament>))
    .filter((entry): entry is Tournament => Boolean(entry));
}

export const useTournamentStore = create<TournamentStore>()(
  devtools(
    persist(
      (set, get) => ({
        tournaments: db.getAll(),
        currentTournament: null,
        loading: false,
        error: null,

        setCurrentTournament: (tournament) => set({ currentTournament: tournament }),

        createTournament: (name, format, config = {}) => {
          set({ loading: true, error: null });
          try {
            const tournament = db.create(name, format, config);
            set((state) => ({
              tournaments: [tournament, ...state.tournaments],
              currentTournament: tournament,
              loading: false
            }));
            return tournament;
          } catch (error) {
            set({ error: `Failed to create tournament: ${error}`, loading: false });
            throw error;
          }
        },

        fetchTournaments: () => {
          set({ loading: true, error: null });
          try {
            const tournaments = db.getAll();
            set({ tournaments, loading: false });
          } catch (error) {
            set({ error: `Failed to fetch tournaments: ${error}`, loading: false });
          }
        },

        fetchTournament: (id) => {
          set({ loading: true, error: null });
          try {
            const tournament = db.getById(id);
            if (tournament) {
              set({ currentTournament: tournament, loading: false });
            } else {
              set({ error: 'Tournament not found', loading: false });
            }
          } catch (error) {
            set({ error: `Failed to fetch tournament: ${error}`, loading: false });
          }
        },

        addPlayer: (tournamentId, playerName) => {
          set({ loading: true, error: null });
          try {
            const tournament = db.getById(tournamentId);
            if (!tournament) throw new Error('Tournament not found');

            const updated = TournamentEngine.addPlayer(tournament, playerName);
            set((state) => ({
              currentTournament: updated,
              tournaments: state.tournaments.map((t) => (t.id === updated.id ? updated : t)),
              loading: false
            }));
          } catch (error) {
            set({ error: `Failed to add player: ${error}`, loading: false });
          }
        },

        removePlayer: (tournamentId, playerId) => {
          set({ loading: true, error: null });
          try {
            const tournament = db.getById(tournamentId);
            if (!tournament) throw new Error('Tournament not found');

            const updated = TournamentEngine.removePlayer(tournament, playerId);
            set((state) => ({
              currentTournament: updated,
              tournaments: state.tournaments.map((t) => (t.id === updated.id ? updated : t)),
              loading: false
            }));
          } catch (error) {
            set({ error: `Failed to remove player: ${error}`, loading: false });
          }
        },

        updateTournament: (tournamentId, updates) => {
          set({ loading: true, error: null });
          try {
            const tournament = db.getById(tournamentId);
            if (!tournament) throw new Error('Tournament not found');

            const merged = { ...tournament, ...updates, id: tournament.id };
            const nextPayoutPositions = Math.max(1, Number(merged.payoutPositions || 1));
            const recalculated = TournamentEngine.calculatePayouts(merged);
            const updated = db.update({
              ...merged,
              payoutPositions: nextPayoutPositions,
              payoutPercentages: normalizePayoutPercentages(merged.payoutPercentages, nextPayoutPositions),
              payouts: recalculated.payouts
            });
            set((state) => ({
              currentTournament: state.currentTournament?.id === updated.id ? updated : state.currentTournament,
              tournaments: state.tournaments.map((t) => (t.id === updated.id ? updated : t)),
              loading: false
            }));
          } catch (error) {
            set({ error: `Failed to update tournament: ${error}`, loading: false });
          }
        },

        deleteTournament: (tournamentId) => {
          set({ loading: true, error: null });
          try {
            db.delete(tournamentId);
            set((state) => ({
              currentTournament: state.currentTournament?.id === tournamentId ? null : state.currentTournament,
              tournaments: state.tournaments.filter((t) => t.id !== tournamentId),
              loading: false
            }));
          } catch (error) {
            set({ error: `Failed to delete tournament: ${error}`, loading: false });
          }
        },

        reorderPlayers: (tournamentId, orderedPlayerIds, seedingMethod) => {
          set({ loading: true, error: null });
          try {
            const tournament = db.getById(tournamentId);
            if (!tournament) throw new Error('Tournament not found');

            const updated = TournamentEngine.reorderPlayers(tournament, orderedPlayerIds, seedingMethod);
            set((state) => ({
              currentTournament: updated,
              tournaments: state.tournaments.map((t) => (t.id === updated.id ? updated : t)),
              loading: false
            }));
          } catch (error) {
            set({ error: `Failed to reorder players: ${error}`, loading: false });
          }
        },

        generateBracket: (tournamentId) => {
          set({ loading: true, error: null });
          try {
            const tournament = db.getById(tournamentId);
            if (!tournament) throw new Error('Tournament not found');

            const updated = TournamentEngine.generateBracket(tournament);
            set((state) => ({
              currentTournament: updated,
              tournaments: state.tournaments.map((t) => (t.id === updated.id ? updated : t)),
              loading: false
            }));
          } catch (error) {
            set({ error: `Failed to generate bracket: ${error}`, loading: false });
          }
        },

        startTournament: (tournamentId) => {
          set({ loading: true, error: null });
          try {
            const tournament = db.getById(tournamentId);
            if (!tournament) throw new Error('Tournament not found');

            const updated = TournamentEngine.startTournament(tournament);
            set((state) => ({
              currentTournament: updated,
              tournaments: state.tournaments.map((t) => (t.id === updated.id ? updated : t)),
              loading: false
            }));
          } catch (error) {
            set({ error: `Failed to start tournament: ${error}`, loading: false });
          }
        },

        completeMatch: (tournamentId, matchId, winnerId, score) => {
          set({ loading: true, error: null });
          try {
            const tournament = db.getById(tournamentId);
            if (!tournament) throw new Error('Tournament not found');

            const updated = TournamentEngine.completeMatch(tournament, matchId, winnerId, score || '');
            set((state) => ({
              currentTournament: updated,
              tournaments: state.tournaments.map((t) => (t.id === updated.id ? updated : t)),
              loading: false
            }));
          } catch (error) {
            set({ error: `Failed to complete match: ${error}`, loading: false });
          }
        },

        hydrate: () => {
          const tournaments = db.getAll();
          set({ tournaments, currentTournament: get().currentTournament ? db.getById(get().currentTournament.id) ?? null : null });
        },

        reset: () => {
          set({
            tournaments: [],
            currentTournament: null,
            loading: false,
            error: null
          });
        },

        clearError: () => {
          set({ error: null });
        }
      }),
      {
        name: 'tournament-store',
        merge: (persistedState, currentState) => {
          const persisted = persistedState as Partial<TournamentStore> | undefined;
          const tournaments = normalizePersistedTournaments(persisted?.tournaments);
          const currentTournamentId =
            persisted?.currentTournament && typeof persisted.currentTournament.id === 'string'
              ? persisted.currentTournament.id
              : null;
          const normalizedCurrentTournament =
            (currentTournamentId ? tournaments.find((tournament) => tournament.id === currentTournamentId) : null) ??
            normalizeTournament(persisted?.currentTournament as Partial<Tournament> | null | undefined) ??
            null;

          return {
            ...currentState,
            ...persisted,
            tournaments,
            currentTournament: normalizedCurrentTournament,
            loading: false,
            error: null
          };
        }
      }
    )
  )
);
