import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Camera,
  ChevronLeft,
  ChevronRight,
  Coins,
  Crown,
  Expand,
  GitBranch,
  Info,
  Layers3,
  Play,
  SlidersHorizontal,
  Trophy,
  Users,
  Video
} from 'lucide-react';
import QRCode from 'qrcode';
import { Link, useParams } from 'react-router-dom';
import { canAccessEntitlement, getCurrentUser, getEffectiveTier } from '@/lib/auth';
import {
  type BroadcastCameraSource,
  type BroadcastRuntimeConfig,
  getBroadcastRuntimeConfig,
  saveBroadcastRuntimeConfig
} from '@/lib/broadcast';
import {
  formatChannelOptionLabel,
  getAllowedBroadcastChannelsForUser,
  getChannelNamingConventionHelp
} from '@/lib/channel';
import {
  getTierLimit
} from '@/lib/subscription';
import {
  PAYOUT_PERCENT_STEP,
  TournamentSeedMode,
  buildDefaultPayoutPercentages,
  calculatePrizeContributionPerPlayer,
  createUniversalPlayerProfile,
  findUniversalPlayerProfileByName,
  getModifiedEliminationRacePlan,
  normalizePayoutPercentages
} from '@/lib/tournament';
import { useTournamentStore } from '@/store/tournamentStore';
import {
  createPairSignalClient,
  DEFAULT_ICE_SERVERS,
  generatePairCode,
  type PairSignalClient,
  type PairSignalMessage
} from '@/lib/webrtcPairing';
import { getAppRouteUrl } from '@/lib/appPaths';
import './Tournament.css';

const SEEDING_OPTIONS: { value: TournamentSeedMode; label: string }[] = [
  { value: 'RANDOM', label: 'Random' },
  { value: 'ENTERED', label: 'Entry Order' },
  { value: 'ALPHABETICAL', label: 'Alphabetical' },
  { value: 'MANUAL', label: 'Manual' }
];

type WorkflowTab = 'ROSTER' | 'PAYOUTS' | 'BRACKET' | 'BROADCAST';
type CameraInputMode = 'QR' | 'USB' | 'NETWORK';

const WORKFLOW_TABS = [
  { value: 'ROSTER', label: 'Roster', detail: 'Players', icon: Users },
  { value: 'PAYOUTS', label: 'Payouts', detail: 'Money', icon: Coins },
  { value: 'BRACKET', label: 'Bracket', detail: 'Matches', icon: GitBranch },
  { value: 'BROADCAST', label: 'Broadcast', detail: 'TDTV', icon: Video }
] as const;

const BROADCAST_UPSELL_FEATURES = [
  { title: 'Broadcast & Overlays', detail: 'Live scores, match info, and in-room production tools.', icon: Video },
  { title: 'Tournament Templates', detail: 'Save your setup and run the room faster next time.', icon: Layers3 },
  { title: 'Custom Race Formats', detail: 'Dial in the ruleset your event actually needs.', icon: SlidersHorizontal },
  { title: 'Tournament History', detail: 'Keep past events, stats, and repeatable workflows.', icon: BarChart3 },
  { title: 'TD Profile', detail: 'Build a recognizable operator identity around your events.', icon: Users }
] as const;

function formatLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

function getTournamentStageLabel(matchCount: number, status: 'DRAFT' | 'READY' | 'ACTIVE' | 'COMPLETED', hasBracket: boolean): string {
  if (!hasBracket) return status === 'DRAFT' ? 'Setup' : 'Bracket Pending';
  if (status === 'COMPLETED') return 'Champion Crowned';
  if (matchCount <= 0) return status === 'READY' ? 'Opening Round' : 'In Progress';
  if (matchCount === 1) return 'Final';
  if (matchCount === 2) return 'Semifinal';
  if (matchCount === 4) return 'Quarterfinal';
  return `Round of ${matchCount * 2}`;
}

export default function Tournament() {
  const { id } = useParams<{ id: string }>();
  const {
    currentTournament,
    fetchTournament,
    addPlayer,
    removePlayer,
    reorderPlayers,
    generateBracket,
    startTournament,
    completeMatch,
    updateTournament,
    error,
    clearError
  } = useTournamentStore();

  const [newPlayerName, setNewPlayerName] = useState('');
  const [seedingMode, setSeedingMode] = useState<TournamentSeedMode>('ENTERED');
  const [manualOrder, setManualOrder] = useState<string[]>([]);
  const [manualSeedDraftOrder, setManualSeedDraftOrder] = useState<string[]>([]);
  const [draggingManualSeedId, setDraggingManualSeedId] = useState<string | null>(null);
  const [isManualSeedModalOpen, setIsManualSeedModalOpen] = useState(false);
  const [workflowTab, setWorkflowTab] = useState<WorkflowTab>('ROSTER');
  const [payoutPositionsInput, setPayoutPositionsInput] = useState<number>(3);
  const [payoutShareDraft, setPayoutShareDraft] = useState<number[]>([]);
  const [isPayoutOverrideOpen, setIsPayoutOverrideOpen] = useState(false);
  const [isBracketExpanded, setIsBracketExpanded] = useState(false);
  const [broadcastConfig, setBroadcastConfig] = useState<BroadcastRuntimeConfig>(() => getBroadcastRuntimeConfig());
  const [editingSponsorId, setEditingSponsorId] = useState<string | null>(null);
  const [cameraSourceId, setCameraSourceId] = useState('');
  const [cameraInputMode, setCameraInputMode] = useState<CameraInputMode>('QR');
  const [cameraConnectionState, setCameraConnectionState] = useState<'DISCONNECTED' | 'CONNECTED'>('DISCONNECTED');
  const [isCameraScanning, setIsCameraScanning] = useState(false);
  const [isCameraConnecting, setIsCameraConnecting] = useState(false);
  const [isRemotePairConnecting, setIsRemotePairConnecting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraStatusNote, setCameraStatusNote] = useState<string>('Idle');
  const [cameraPairCode, setCameraPairCode] = useState('');
  const [cameraPairQrDataUrl, setCameraPairQrDataUrl] = useState('');
  const [cameraPairStatus, setCameraPairStatus] = useState('Not paired');
  const [signalTransport, setSignalTransport] = useState<'supabase' | 'broadcast-channel' | null>(null);
  const [networkCameraName, setNetworkCameraName] = useState('Network Camera');
  const [networkCameraUrl, setNetworkCameraUrl] = useState('');
  const [pendingCameraTable, setPendingCameraTable] = useState(1);
  const [pendingCameraAssignmentId, setPendingCameraAssignmentId] = useState<string | null>(null);
  const [isTableAssignModalOpen, setIsTableAssignModalOpen] = useState(false);
  const [isGoLiveConfirmOpen, setIsGoLiveConfirmOpen] = useState(false);
  const [sponsorConfirmChecked, setSponsorConfirmChecked] = useState(false);
  const [tosConfirmChecked, setTosConfirmChecked] = useState(false);
  const [identityPromptOpenByPlayerId, setIdentityPromptOpenByPlayerId] = useState<Record<string, boolean>>({});
  const [activeBracketMatchId, setActiveBracketMatchId] = useState<string | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const activeCameraStreamRef = useRef<MediaStream | null>(null);
  const pairSignalClientRef = useRef<PairSignalClient | null>(null);
  const pairPeerRef = useRef<RTCPeerConnection | null>(null);
  const matchCarouselTrackRef = useRef<HTMLDivElement | null>(null);
  const matchCarouselCardRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const matchCarouselFrameRef = useRef<number | null>(null);
  const cameraPairUrl = cameraPairCode ? getAppRouteUrl(`/camera-link/${cameraPairCode}`) : '';

  useEffect(() => {
    if (id) fetchTournament(id);
  }, [id]);

  useEffect(() => {
    if (!currentTournament) return;
    setSeedingMode(currentTournament.seedingMethod ?? 'ENTERED');
    setPayoutPositionsInput(currentTournament.payoutPositions ?? 3);
    setPayoutShareDraft(
      normalizePayoutPercentages(currentTournament.payoutPercentages, Math.max(1, currentTournament.payoutPositions ?? 1))
    );
  }, [currentTournament?.id, currentTournament?.seedingMethod, currentTournament?.payoutPositions]);

  useEffect(() => {
    const nextPositions = Math.max(1, Number(payoutPositionsInput || 1));
    setPayoutShareDraft((current) => normalizePayoutPercentages(current, nextPositions));
  }, [payoutPositionsInput]);

  useEffect(() => {
    if (currentTournament?.status === 'ACTIVE') {
      setWorkflowTab('BRACKET');
    }
  }, [currentTournament?.status]);

  useEffect(() => {
    if (!isBracketExpanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsBracketExpanded(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isBracketExpanded]);

  const players = currentTournament && Array.isArray(currentTournament.players) ? currentTournament.players : [];
  const matches = currentTournament && Array.isArray(currentTournament.matches) ? currentTournament.matches : [];
  const payouts = currentTournament && Array.isArray(currentTournament.payouts) ? currentTournament.payouts : [];
  const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

  const paidOutSlots = Math.max(1, Math.min(currentTournament?.payoutPositions || 1, players.length));
  const totalEntryPerPlayer = Math.max(0, Number(currentTournament?.entryFee ?? 0));
  const greenFeePerPlayer = Math.max(0, Number(currentTournament?.greenFee ?? 0));
  const prizeContributionPerPlayer = calculatePrizeContributionPerPlayer(totalEntryPerPlayer, greenFeePerPlayer);
  const totalCollected = totalEntryPerPlayer * players.length;
  const totalGreenFees = greenFeePerPlayer * players.length;
  const projectedPrizePool = prizeContributionPerPlayer * players.length;
  const totalPrizePool = payouts.reduce((sum, payout) => sum + (Number(payout.amount) || 0), 0);
  const payoutShareTotal = payoutShareDraft.reduce((sum, value) => sum + value, 0);
  const currentUser = getCurrentUser();
  const accessTier = getEffectiveTier(currentUser);
  const isPayingMember = canAccessEntitlement(currentUser, 'broadcast.local');
  const canManageSponsorSlots = canAccessEntitlement(currentUser, 'broadcast.sponsors');
  const canUseTdChannelHub = canAccessEntitlement(currentUser, 'broadcast.tdtv');
  const canUseQrCamera = isPayingMember;
  const canUseUsbCamera = isPayingMember;
  const canUseNetworkCamera = canAccessEntitlement(currentUser, 'broadcast.tdtv');
  const canUsePlayerIdentity = canAccessEntitlement(currentUser, 'players.universal_id');
  const maxCameraFeeds = getTierLimit(accessTier, 'cameraFeeds');
  const totalTables = Math.max(1, Math.floor(Number(currentTournament?.tableCount || 1)));
  const tableOptions = Array.from({ length: totalTables }, (_, index) => index + 1);
  const connectedCameraIds = broadcastConfig.connectedCameraIds ?? [];
  const connectedFeedCount = connectedCameraIds.length;
  const usbAndCaptureSources = broadcastConfig.cameraList.filter((camera) => camera.type === 'USB' || camera.type === 'OBS');
  const canAccessBracketTab = true;
  const tableLimit = totalTables;
  const bracketRounds = useMemo(() => {
    const grouped = new Map<number, typeof matches>();
    matches.forEach((match) => {
      const roundMatches = grouped.get(match.round) ?? [];
      roundMatches.push(match);
      grouped.set(match.round, roundMatches);
    });
    return Array.from(grouped.entries())
      .sort(([a], [b]) => a - b)
      .map(([round, roundMatches]) => ({
        round,
        matches: roundMatches.slice().sort((a, b) => a.slot - b.slot)
      }));
  }, [matches]);
  const schedulableMatches = useMemo(
    () =>
      matches
        .filter(
          (match) =>
            Array.isArray(match.entrants) &&
            match.entrants.length > 1 &&
            match.state !== 'COMPLETE' &&
            match.state !== 'BYE'
        )
        .sort((a, b) => (a.round === b.round ? a.slot - b.slot : a.round - b.round)),
    [matches]
  );
  const activeReadyMatches = useMemo(
    () => schedulableMatches.filter((match) => match.state === 'READY' || match.state === 'IN_PROGRESS'),
    [schedulableMatches]
  );
  const actionableMatches = useMemo(
    () =>
      activeReadyMatches.length > 0
        ? activeReadyMatches
        : currentTournament?.status === 'ACTIVE'
          ? schedulableMatches.filter((match) => match.state === 'PENDING').slice(0, tableLimit)
          : [],
    [activeReadyMatches, currentTournament?.status, schedulableMatches, tableLimit]
  );
  const competitiveMatches = matches.filter((match) => match.state !== 'BYE');
  const completedCompetitiveMatches = competitiveMatches.filter((match) => match.state === 'COMPLETE').length;
  const bracketProgressPercent =
    competitiveMatches.length > 0 ? Math.round((completedCompetitiveMatches / competitiveMatches.length) * 100) : 0;
  const activeProgressRound =
    currentTournament?.status === 'COMPLETED'
      ? bracketRounds[bracketRounds.length - 1]?.round ?? 0
      : competitiveMatches
          .filter((match) => match.state !== 'COMPLETE')
          .sort((a, b) => a.round - b.round || a.slot - b.slot)[0]?.round ?? bracketRounds[0]?.round ?? 0;
  const remainingMatches = useMemo(
    () =>
      matches
        .filter((match) => match.state !== 'COMPLETE')
        .sort((a, b) => (a.round === b.round ? a.slot - b.slot : a.round - b.round)),
    [matches]
  );
  const carouselMatches = useMemo(
    () =>
      remainingMatches.length > 0
        ? remainingMatches
        : currentTournament?.status === 'COMPLETED'
          ? bracketRounds[bracketRounds.length - 1]?.matches ?? []
          : [],
    [bracketRounds, currentTournament?.status, remainingMatches]
  );
  const allowedBroadcastChannels = useMemo(() => getAllowedBroadcastChannelsForUser(currentUser), [currentUser]);
  const channelNamingConventionHelp = useMemo(() => getChannelNamingConventionHelp(), []);
  useEffect(() => {
    if (carouselMatches.length === 0) {
      if (activeBracketMatchId !== null) setActiveBracketMatchId(null);
      return;
    }
    if (!activeBracketMatchId || !carouselMatches.some((match) => match.id === activeBracketMatchId)) {
      setActiveBracketMatchId(carouselMatches[0].id);
    }
  }, [activeBracketMatchId, carouselMatches]);
  useEffect(() => {
    const matchId = activeBracketMatchId ?? carouselMatches[0]?.id;
    if (!matchId) return;
    centerCarouselMatch(matchId);
  }, [activeBracketMatchId, carouselMatches]);
  useEffect(() => {
    return () => {
      if (matchCarouselFrameRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(matchCarouselFrameRef.current);
      }
    };
  }, []);
  useEffect(() => {
    const latest = getBroadcastRuntimeConfig();
    const validChannel = allowedBroadcastChannels.some((channel) => channel.id === latest.channelId)
      ? latest.channelId
      : allowedBroadcastChannels[0]?.id ?? '';
    if (latest.channelId !== validChannel) {
      const normalized = { ...latest, channelId: validChannel };
      saveBroadcastRuntimeConfig(normalized);
      setBroadcastConfig(normalized);
      return;
    }
    setBroadcastConfig(latest);
  }, [allowedBroadcastChannels]);
  useEffect(() => {
    if (broadcastConfig.cameraId === 'remote-phone') {
      setCameraInputMode('QR');
      if ((broadcastConfig.connectedCameraIds ?? []).includes('remote-phone')) {
        setCameraConnectionState('CONNECTED');
      }
      return;
    }

    if (cameraInputMode === 'QR') {
      if ((broadcastConfig.connectedCameraIds ?? []).includes('remote-phone')) {
        setCameraConnectionState('CONNECTED');
      }
      return;
    }

    if (cameraInputMode === 'NETWORK') {
      if (!canUseNetworkCamera) {
        setCameraInputMode(canUseUsbCamera ? 'USB' : 'QR');
        return;
      }
      const preferredNetworkCamera =
        broadcastConfig.cameraList.find((camera) => camera.id === broadcastConfig.cameraId && camera.type === 'NETWORK') ??
        broadcastConfig.cameraList.find((camera) => camera.type === 'NETWORK') ??
        null;
      if (preferredNetworkCamera) {
        setNetworkCameraName(preferredNetworkCamera.name);
        setNetworkCameraUrl(preferredNetworkCamera.streamUrl ?? '');
      }
      if (broadcastConfig.cameraId && broadcastConfig.cameraId !== 'remote-phone') {
        setCameraSourceId(broadcastConfig.cameraId);
      }
      return;
    }

    const preferredCamera =
      broadcastConfig.cameraList.find((camera) => camera.id === broadcastConfig.cameraId) ??
      broadcastConfig.cameraList.find((camera) => camera.type === 'USB' || camera.type === 'OBS') ??
      broadcastConfig.cameraList[0];
    if (!preferredCamera) return;
    if (broadcastConfig.cameraId && broadcastConfig.cameraId === preferredCamera.id) {
      setCameraConnectionState('CONNECTED');
    }
    if (!cameraSourceId) setCameraSourceId(preferredCamera.id);
  }, [broadcastConfig.cameraId, broadcastConfig.cameraList, broadcastConfig.connectedCameraIds, cameraInputMode, cameraSourceId, canUseNetworkCamera, canUseUsbCamera]);
  useEffect(() => {
    if (workflowTab !== 'BROADCAST' || !canUseUsbCamera || usbAndCaptureSources.length > 0) return;
    void syncCameraInventory();
  }, [canUseUsbCamera, usbAndCaptureSources.length, workflowTab]);
  useEffect(() => {
    if (!canUseNetworkCamera && cameraInputMode === 'NETWORK') {
      setCameraInputMode(canUseUsbCamera ? 'USB' : 'QR');
    }
  }, [cameraInputMode, canUseNetworkCamera, canUseUsbCamera]);
  useEffect(() => {
    if (!cameraPairUrl) {
      setCameraPairQrDataUrl('');
      return;
    }

    let cancelled = false;
    void QRCode.toDataURL(cameraPairUrl, {
      width: 220,
      margin: 2,
      color: { dark: '#020617', light: '#ffffff' }
    }).then((dataUrl) => {
      if (!cancelled) setCameraPairQrDataUrl(dataUrl);
    }).catch(() => {
      if (!cancelled) setCameraPairQrDataUrl('');
    });

    return () => {
      cancelled = true;
    };
  }, [cameraPairUrl]);
  useEffect(() => {
    return () => {
      void stopPairingSession(false);
      const stream = activeCameraStreamRef.current;
      if (!stream) return;
      stream.getTracks().forEach((track) => track.stop());
      activeCameraStreamRef.current = null;
    };
  }, []);
  const editingSponsor = broadcastConfig.sponsorCards.find((sponsor) => sponsor.id === editingSponsorId) ?? null;
  const marketingWordCount = (editingSponsor?.marketingBlip || '').trim().split(/\s+/).filter(Boolean).length;
  const selectedBroadcastChannel =
    allowedBroadcastChannels.find((channel) => channel.id === broadcastConfig.channelId) ??
    allowedBroadcastChannels[0] ??
    null;
  const selectedCameraSource =
    cameraInputMode === 'QR'
      ? ({
          id: 'remote-phone',
          name: 'QR Paired Phone Camera',
          type: 'WIFI',
          connection: 'Strong'
        } as BroadcastCameraSource)
      : cameraInputMode === 'NETWORK'
        ? ({
            id: `network:${networkCameraUrl || networkCameraName}`,
            name: networkCameraName.trim() || 'Network Camera',
            type: 'NETWORK',
            connection: 'Medium',
            streamUrl: networkCameraUrl.trim()
          } as BroadcastCameraSource)
        : usbAndCaptureSources.find((camera) => camera.id === cameraSourceId) ??
          usbAndCaptureSources[0] ??
          null;
  const activeCameraTable =
    selectedCameraSource && broadcastConfig.cameraTableMap
      ? broadcastConfig.cameraTableMap[selectedCameraSource.id] ?? null
      : null;
  const hasEligibleBroadcastChannel = Boolean(
    selectedBroadcastChannel &&
      allowedBroadcastChannels.some((channel) => channel.id === selectedBroadcastChannel.id)
  );
  const hasConnectedCameraFeed = cameraConnectionState === 'CONNECTED' && Boolean(selectedCameraSource?.id);
  const hasMappedCameraTable = Boolean(selectedCameraSource?.id && (broadcastConfig.cameraTableMap?.[selectedCameraSource.id] ?? 0) > 0);
  const allSponsorCardsReady = broadcastConfig.sponsorCards.every(
    (sponsor) => sponsor.name.trim().length > 0 && sponsor.marketingBlip.trim().length > 0
  );
  const broadcastReadinessChecklist = [
    { id: 'camera', label: 'Camera feed connected', ready: hasConnectedCameraFeed },
    { id: 'table', label: 'Camera mapped to a table', ready: hasMappedCameraTable },
    { id: 'channel', label: 'Eligible TDTV channel assigned', ready: hasEligibleBroadcastChannel },
    { id: 'sponsors', label: 'All sponsor cards include title and blurb', ready: allSponsorCardsReady }
  ];
  const canGoLive = broadcastReadinessChecklist.every((item) => item.ready);
  const connectedCameraSources = connectedCameraIds
    .map((cameraId) => {
      if (cameraId === 'remote-phone') {
        return { id: 'remote-phone', name: 'QR Paired Phone Camera', type: 'WIFI' as const };
      }
      const found = broadcastConfig.cameraList.find((camera) => camera.id === cameraId);
      return found ? { id: found.id, name: found.name, type: found.type } : null;
    })
    .filter((camera): camera is { id: string; name: string; type: 'WIFI' | 'USB' | 'OBS' | 'NETWORK' } => Boolean(camera));

  const completedMatches = matches
    .filter((match) => match.state === 'COMPLETE' && typeof match.round === 'number')
    .sort((a, b) => b.round - a.round);
  const finalMatch = completedMatches[0] ?? null;
  const championId = finalMatch?.winnerId ?? null;
  const runnerUpId = finalMatch?.loserId ?? null;

  const rankedPlayers = players.slice().sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return a.seed - b.seed;
  });

  const orderedLeaderboard = [
    ...(championId ? [championId] : []),
    ...(runnerUpId && runnerUpId !== championId ? [runnerUpId] : []),
    ...rankedPlayers
      .map((player) => player.id)
      .filter((playerId) => playerId !== championId && playerId !== runnerUpId)
  ];

  const payoutLeaderboard = orderedLeaderboard
    .slice(0, paidOutSlots)
    .map((playerId, index) => {
      const player = players.find((p) => p.id === playerId);
      const payout = payouts.find((row) => row.position === index + 1);
      return {
        position: index + 1,
        displayName: player?.displayName ?? 'Unknown player',
        wins: player?.wins ?? 0,
        losses: player?.losses ?? 0,
        payout: payout?.amount ?? 0
      };
    });

  const sortedByEntry = useMemo(
    () => players.slice().sort((a, b) => (a.entryOrder ?? a.seed) - (b.entryOrder ?? b.seed)),
    [players]
  );
  const entryOrderIds = useMemo(() => sortedByEntry.map((player) => player.id), [sortedByEntry]);
  const savedSeedIds = useMemo(() => players.slice().sort((a, b) => a.seed - b.seed).map((player) => player.id), [players]);

  const normalizeManualSeedIds = useCallback((candidateIds: string[]) => {
    const validIds = candidateIds.filter((playerId) => entryOrderIds.includes(playerId));
    const missingIds = entryOrderIds.filter((playerId) => !validIds.includes(playerId));
    return [...validIds, ...missingIds];
  }, [entryOrderIds]);

  useEffect(() => {
    setManualOrder((prev) => normalizeManualSeedIds(prev));
    setManualSeedDraftOrder((prev) => normalizeManualSeedIds(prev));
  }, [normalizeManualSeedIds]);

  useEffect(() => {
    if (currentTournament?.seedingMethod !== 'MANUAL') return;
    const normalizedSeedIds = normalizeManualSeedIds(savedSeedIds);
    setManualOrder(normalizedSeedIds);
    setManualSeedDraftOrder(normalizedSeedIds);
  }, [currentTournament?.id, currentTournament?.seedingMethod, normalizeManualSeedIds, savedSeedIds]);

  useEffect(() => {
    const unresolvedIds = players
      .filter((player) => player.identityMode === 'UNRESOLVED')
      .map((player) => player.id);
    setIdentityPromptOpenByPlayerId((current) => {
      const next = { ...current };
      unresolvedIds.forEach((playerId) => {
        if (typeof next[playerId] !== 'boolean') {
          next[playerId] = true;
        }
      });
      return next;
    });
  }, [players]);

  const rosterDisplayIds = entryOrderIds;
  const seedingPreviewIds = useMemo(() => {
    if (currentTournament?.bracketGenerated) return savedSeedIds;

    if (seedingMode === 'ALPHABETICAL') {
      return players
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .map((player) => player.id);
    }

    if (seedingMode === 'RANDOM') {
      const ids = [...entryOrderIds];
      for (let i = ids.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      return ids;
    }

    if (seedingMode === 'MANUAL') {
      return normalizeManualSeedIds(manualOrder);
    }

    return entryOrderIds;
  }, [currentTournament?.bracketGenerated, entryOrderIds, manualOrder, normalizeManualSeedIds, players, savedSeedIds, seedingMode]);
  if (!currentTournament) {
    return <div className="tournament-page"><p>Loading tournament...</p></div>;
  }

  const movePlayerWithinOrder = (order: string[], playerId: string, direction: -1 | 1) => {
    const index = order.indexOf(playerId);
    if (index < 0) return order;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= order.length) return order;
    const copy = [...order];
    [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]];
    return copy;
  };

  const moveManualSeedDraftPlayer = (playerId: string, direction: -1 | 1) => {
    setManualSeedDraftOrder((prev) => movePlayerWithinOrder(prev, playerId, direction));
  };

  const insertManualSeedBefore = (movingPlayerId: string, targetPlayerId: string) => {
    if (!movingPlayerId || movingPlayerId === targetPlayerId) return;
    setManualSeedDraftOrder((prev) => {
      const withoutMoving = prev.filter((playerId) => playerId !== movingPlayerId);
      const targetIndex = withoutMoving.indexOf(targetPlayerId);
      if (targetIndex < 0) return prev;
      withoutMoving.splice(targetIndex, 0, movingPlayerId);
      return withoutMoving;
    });
  };

  const openManualSeedModal = () => {
    setManualSeedDraftOrder(normalizeManualSeedIds(manualOrder));
    setDraggingManualSeedId(null);
    setIsManualSeedModalOpen(true);
  };

  const handleSeedingModeChange = (nextMode: TournamentSeedMode) => {
    if (currentTournament.bracketGenerated) return;

    setSeedingMode(nextMode);
    updateTournament(currentTournament.id, { seedingMethod: nextMode });

    if (nextMode === 'MANUAL') {
      setManualSeedDraftOrder(normalizeManualSeedIds(manualOrder));
      setDraggingManualSeedId(null);
      setIsManualSeedModalOpen(true);
    }
  };

  const handleSaveManualSeedOrder = () => {
    const nextOrder = normalizeManualSeedIds(manualSeedDraftOrder);
    setManualOrder(nextOrder);
    setSeedingMode('MANUAL');
    updateTournament(currentTournament.id, { seedingMethod: 'MANUAL' });
    setDraggingManualSeedId(null);
    setIsManualSeedModalOpen(false);
  };

  const handleAddPlayer = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newPlayerName.trim();
    if (!trimmed) return;
    addPlayer(currentTournament.id, trimmed);
    setNewPlayerName('');
  };

  const handleCreateBracket = () => {
    if (players.length < 2) {
      alert('Need at least 2 players');
      return;
    }
    reorderPlayers(currentTournament.id, seedingPreviewIds, seedingMode);
    generateBracket(currentTournament.id);
    setWorkflowTab('BRACKET');
  };

  const handleCompleteMatch = (matchId: string, winnerId: string) => {
    if (!matchId || !winnerId) return;
    const match = matches.find((entry) => entry.id === matchId);
    const winner = players.find((player) => player.id === winnerId);
    const confirmed = window.confirm(
      `Confirm winner${winner?.displayName ? `: ${winner.displayName}` : ''} for Round ${match?.round ?? '-'} Match ${(match?.slot ?? 0) + 1}?\n\n` +
        'This updates the bracket and cannot be undone automatically.'
    );
    if (!confirmed) return;
    completeMatch(currentTournament.id, matchId, winnerId);
  };

  const handleApplyPayoutOverride = () => {
    const maxPayoutSlots = Math.max(1, players.length || 1);
    const nextPositions = Math.max(1, Math.min(maxPayoutSlots, Number(payoutPositionsInput) || 1));
    if (nextPositions === currentTournament.payoutPositions) return;

    if (currentTournament.status === 'ACTIVE') {
      const confirmed = window.confirm(
        `Override payout structure from top ${currentTournament.payoutPositions} to top ${nextPositions} while tournament is active?\n\n` +
          'This is strongly discouraged unless discussed with players beforehand. Bracket results stay unchanged.'
      );
      if (!confirmed) return;
    }

    const defaultShares = buildDefaultPayoutPercentages(nextPositions);
    setPayoutShareDraft(defaultShares);
    updateTournament(currentTournament.id, {
      payoutPositions: nextPositions,
      payoutPercentages: defaultShares
    });
  };

  const updateShareAtIndex = (index: number, requestedPercent: number) => {
    setPayoutShareDraft((current) => {
      if (!Array.isArray(current) || current.length === 0) return current;
      if (current.length === 1) return [100];

      const stepUnits = 100 / PAYOUT_PERCENT_STEP;
      const nextUnits = current.map((value) => Math.max(0, Math.round(value / PAYOUT_PERCENT_STEP)));
      const currentUnits = nextUnits[index] ?? 0;
      const targetUnits = Math.max(0, Math.min(stepUnits, Math.round(requestedPercent / PAYOUT_PERCENT_STEP)));
      const delta = targetUnits - currentUnits;
      if (delta === 0) return current;

      const otherIndexes = nextUnits.map((_, rowIndex) => rowIndex).filter((rowIndex) => rowIndex !== index);
      if (delta > 0) {
        let reducible = 0;
        for (const rowIndex of otherIndexes) reducible += nextUnits[rowIndex];
        const applied = Math.min(delta, reducible);
        if (applied <= 0) return current;

        nextUnits[index] = currentUnits + applied;
        let remaining = applied;
        for (let cursor = otherIndexes.length - 1; cursor >= 0 && remaining > 0; cursor -= 1) {
          const rowIndex = otherIndexes[cursor];
          const cut = Math.min(nextUnits[rowIndex], remaining);
          nextUnits[rowIndex] -= cut;
          remaining -= cut;
        }
      } else {
        const release = Math.abs(delta);
        nextUnits[index] = Math.max(0, currentUnits - release);
        let remaining = release;
        let cursor = 0;
        while (remaining > 0 && otherIndexes.length > 0) {
          const rowIndex = otherIndexes[cursor % otherIndexes.length];
          if (nextUnits[rowIndex] < stepUnits) {
            nextUnits[rowIndex] += 1;
            remaining -= 1;
          }
          cursor += 1;
        }
      }

      return nextUnits.map((unit) => unit * PAYOUT_PERCENT_STEP);
    });
  };

  const handleApplyShareOverride = () => {
    const maxPayoutSlots = Math.max(1, players.length || 1);
    const nextPositions = Math.max(1, Math.min(maxPayoutSlots, Number(payoutPositionsInput) || 1));
    const normalizedShares = normalizePayoutPercentages(payoutShareDraft, nextPositions);

    if (currentTournament.status === 'ACTIVE') {
      const confirmed = window.confirm(
        'Override winner payout percentages during an active tournament?\n\n' +
          'This is strongly discouraged unless discussed with players beforehand. Bracket results stay unchanged.'
      );
      if (!confirmed) return;
    }

    setPayoutShareDraft(normalizedShares);
    updateTournament(currentTournament.id, {
      payoutPositions: nextPositions,
      payoutPercentages: normalizedShares
    });
  };

  const updateBroadcastConfig = (updater: (current: BroadcastRuntimeConfig) => BroadcastRuntimeConfig) => {
    setBroadcastConfig((current) => {
      const next = updater(current);
      saveBroadcastRuntimeConfig(next);
      return next;
    });
  };

  const assignCameraToTable = (cameraId: string, tableNumber: number) => {
    const normalizedTable = Math.max(1, Math.min(totalTables, Math.floor(Number(tableNumber) || 1)));
    updateBroadcastConfig((current) => ({
      ...current,
      cameraTableMap: {
        ...(current.cameraTableMap ?? {}),
        [cameraId]: normalizedTable
      }
    }));
  };

  const markCameraConnected = (cameraId: string) => {
    updateBroadcastConfig((current) => {
      const connected = new Set(current.connectedCameraIds ?? []);
      connected.add(cameraId);
      return {
        ...current,
        connectedCameraIds: maxCameraFeeds === null ? Array.from(connected) : Array.from(connected).slice(0, maxCameraFeeds),
        cameraId
      };
    });
  };

  const openTableAssignmentPrompt = (cameraId: string) => {
    const existingTable = broadcastConfig.cameraTableMap?.[cameraId] ?? 1;
    setPendingCameraAssignmentId(cameraId);
    setPendingCameraTable(Math.max(1, Math.min(totalTables, existingTable)));
    setIsTableAssignModalOpen(true);
  };

  const setPlayerIdentity = (
    playerId: string,
    mode: 'LINKED' | 'LOCAL_ONLY',
    universalProfileId: string | null
  ) => {
    const updatedPlayers = players.map((player) => {
      if (player.id !== playerId) return player;
      return {
        ...player,
        identityMode: mode,
        universalProfileId
      };
    });
    updateTournament(currentTournament.id, { players: updatedPlayers });
  };

  const handleUseExistingPlayerProfile = (playerId: string) => {
    if (!canUsePlayerIdentity) {
      alert('Player Database and Universal Player ID tools require Pro, Pro+, Venue, or Internal access.');
      return;
    }
    const player = players.find((entry) => entry.id === playerId);
    if (!player) return;
    const match = findUniversalPlayerProfileByName(player.displayName);
    if (!match) {
      alert(`No existing profile found for "${player.displayName}". Use "Create New Player Profile" or mark local-only.`);
      return;
    }
    setPlayerIdentity(playerId, 'LINKED', match.id);
    setIdentityPromptOpenByPlayerId((current) => ({ ...current, [playerId]: false }));
  };

  const handleCreatePlayerProfile = (playerId: string) => {
    if (!canUsePlayerIdentity) {
      alert('Player Database and Universal Player ID tools require Pro, Pro+, Venue, or Internal access.');
      return;
    }
    const player = players.find((entry) => entry.id === playerId);
    if (!player) return;
    const profile = createUniversalPlayerProfile(player.displayName);
    setPlayerIdentity(playerId, 'LINKED', profile.id);
    setIdentityPromptOpenByPlayerId((current) => ({ ...current, [playerId]: false }));
  };

  const handleSetPlayerLocalOnly = (playerId: string) => {
    setPlayerIdentity(playerId, 'LOCAL_ONLY', null);
    setIdentityPromptOpenByPlayerId((current) => ({ ...current, [playerId]: false }));
  };

  const handleSelectChannel = (channelId: string) => {
    const nextChannel = allowedBroadcastChannels.find((channel) => channel.id === channelId);
    if (!nextChannel) return;
    updateBroadcastConfig((current) => ({
      ...current,
      channelId: channelId
    }));
  };

  const handleCopyPairLink = async () => {
    if (!cameraPairUrl || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(cameraPairUrl);
      setCameraPairStatus('Phone link copied. Send it to the camera device.');
    } catch {
      setCameraPairStatus('Copy failed. Share the pair code and scan the QR instead.');
    }
  };

  const handleConfirmTableAssignment = () => {
    if (!pendingCameraAssignmentId) return;
    assignCameraToTable(pendingCameraAssignmentId, pendingCameraTable);
    setPendingCameraAssignmentId(null);
    setIsTableAssignModalOpen(false);
    setCameraStatusNote(`Camera mapped to Table ${pendingCameraTable}.`);
  };

  const stopActiveCameraStream = () => {
    const activeStream = activeCameraStreamRef.current;
    if (activeStream) {
      activeStream.getTracks().forEach((track) => track.stop());
      activeCameraStreamRef.current = null;
    }
    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = null;
      previewVideoRef.current.removeAttribute('src');
      previewVideoRef.current.load();
    }
  };

  const stopPairingSession = async (notifySender = true) => {
    const signalClient = pairSignalClientRef.current;
    if (notifySender && signalClient) {
      try {
        await signalClient.send({ type: 'stop', from: 'host', ts: Date.now() });
      } catch {
        // ignore final signal errors while tearing down local state
      }
    }
    signalClient?.close();
    pairSignalClientRef.current = null;

    const pairPeer = pairPeerRef.current;
    if (pairPeer) {
      pairPeer.close();
      pairPeerRef.current = null;
    }

    setCameraPairCode('');
    setCameraPairStatus('Not paired');
    setSignalTransport(null);
  };

  const handleIncomingPairSignal = async (message: PairSignalMessage) => {
    if (message.from !== 'sender') return;
    const peer = pairPeerRef.current;
    const signalClient = pairSignalClientRef.current;
    if (!peer || !signalClient) return;

    try {
      if (message.type === 'ready') {
        setCameraPairStatus('Phone ready. Building secure connection...');
        const offer = await peer.createOffer({
          offerToReceiveAudio: false,
          offerToReceiveVideo: true
        });
        await peer.setLocalDescription(offer);
        await signalClient.send({ type: 'offer', from: 'host', payload: offer, ts: Date.now() });
        return;
      }
      if (message.type === 'answer' && message.payload) {
        const answer = message.payload as RTCSessionDescriptionInit;
        if (peer.signalingState === 'stable' && peer.remoteDescription) {
          setCameraPairStatus('Remote camera linked.');
          return;
        }
        await peer.setRemoteDescription(new RTCSessionDescription(answer));
        setCameraConnectionState('CONNECTED');
        setCameraPairStatus('Remote camera linked.');
        return;
      }
      if (message.type === 'ice' && message.payload) {
        await peer.addIceCandidate(message.payload as RTCIceCandidateInit);
        return;
      }
      if (message.type === 'stop') {
        await stopPairingSession(false);
        stopActiveCameraStream();
        setCameraConnectionState('DISCONNECTED');
        setCameraStatusNote('Remote camera disconnected.');
      }
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : 'Failed to process remote camera signal.');
    }
  };

  const handleStartRemotePairing = async () => {
    if (!canUseQrCamera) {
      setCameraError('Broadcast camera pairing unlocks with Pro or higher.');
      return;
    }
    if (typeof window === 'undefined' || typeof RTCPeerConnection === 'undefined') {
      setCameraError('WebRTC is not supported in this browser.');
      return;
    }
    if (maxCameraFeeds !== null && !connectedCameraIds.includes('remote-phone') && connectedFeedCount >= maxCameraFeeds) {
      setCameraError(`Feed limit reached for your tier (${maxCameraFeeds}). Disconnect another feed first.`);
      return;
    }

    setIsRemotePairConnecting(true);
    setCameraError(null);

    try {
      stopActiveCameraStream();
      await stopPairingSession(false);

      const nextPairCode = generatePairCode();
      const signalClient = await createPairSignalClient(nextPairCode, handleIncomingPairSignal);
      pairSignalClientRef.current = signalClient;
      setSignalTransport(signalClient.transport);

      const peer = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });
      pairPeerRef.current = peer;
      peer.ontrack = (event) => {
        const incomingStream = event.streams?.[0];
        if (!incomingStream) return;
        stopActiveCameraStream();
        activeCameraStreamRef.current = incomingStream;
        if (previewVideoRef.current) {
          previewVideoRef.current.srcObject = incomingStream;
          void previewVideoRef.current.play().catch(() => undefined);
        }
        setCameraConnectionState('CONNECTED');
        markCameraConnected('remote-phone');
        openTableAssignmentPrompt('remote-phone');
        setCameraStatusNote('QR-paired phone camera connected.');
      };
      peer.onicecandidate = (event) => {
        if (!event.candidate || !pairSignalClientRef.current) return;
        void pairSignalClientRef.current.send({
          type: 'ice',
          from: 'host',
          payload: event.candidate.toJSON(),
          ts: Date.now()
        });
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') {
          setCameraPairStatus('Paired and streaming.');
        } else if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
          setCameraPairStatus(`Pairing ${peer.connectionState}.`);
        }
      };

      setCameraPairCode(nextPairCode);
      setCameraPairStatus('Waiting for phone to scan the QR code...');
      setCameraStatusNote('QR code ready for phone camera pairing.');
      setCameraSourceId('remote-phone');
      updateBroadcastConfig((current) => ({
        ...current,
        cameraId: 'remote-phone'
      }));
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : 'Unable to start remote pairing session.');
    } finally {
      setIsRemotePairConnecting(false);
    }
  };

  const syncCameraInventory = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      setCameraError('Camera APIs are not available in this browser.');
      return;
    }

    setIsCameraScanning(true);
    setCameraError(null);
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((device) => device.kind === 'videoinput');
      const mappedDevices: BroadcastCameraSource[] = videoDevices.map((device, index) => {
        const label = device.label || `Camera ${index + 1}`;
        const lower = label.toLowerCase();
        const type: BroadcastCameraSource['type'] = lower.includes('obs')
          ? 'OBS'
          : lower.includes('phone') || lower.includes('android') || lower.includes('iphone') || lower.includes('mobile')
            ? 'WIFI'
            : 'USB';
        return {
          id: device.deviceId || `camera-${index + 1}`,
          name: label,
          type,
          connection: type === 'WIFI' ? 'Strong' : 'Medium'
        };
      });

      if (mappedDevices.length === 0) {
        setCameraError('No camera devices detected. Connect a camera source and rescan.');
        return;
      }

      updateBroadcastConfig((current) => ({
        ...current,
        cameraList: [
          ...current.cameraList.filter((camera) => camera.type === 'NETWORK'),
          ...mappedDevices
        ]
      }));
      if (!cameraSourceId || !mappedDevices.some((device) => device.id === cameraSourceId)) {
        setCameraSourceId(mappedDevices[0].id);
      }
      setCameraStatusNote(`Detected ${mappedDevices.length} camera source${mappedDevices.length > 1 ? 's' : ''}.`);
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : 'Unable to scan camera devices.');
    } finally {
      setIsCameraScanning(false);
    }
  };

  const handleConnectSelectedCamera = async () => {
    if (cameraInputMode === 'QR') {
      setCameraError('Use the QR pairing controls below to connect a phone camera.');
      return;
    }
    if (cameraInputMode === 'NETWORK' && !canUseNetworkCamera) {
      setCameraError('Network camera sources require Pro+, Venue, or Platform Admin access.');
      return;
    }
    if (!selectedCameraSource) {
      setCameraError('Select a camera source first.');
      return;
    }
    if (cameraInputMode === 'NETWORK' && !selectedCameraSource.streamUrl) {
      setCameraError('Enter a browser-accessible network camera URL first.');
      return;
    }
    if (maxCameraFeeds !== null && !connectedCameraIds.includes(selectedCameraSource.id) && connectedFeedCount >= maxCameraFeeds) {
      setCameraError(`Feed limit reached for your tier (${maxCameraFeeds}). Disconnect another feed first.`);
      return;
    }
    if (cameraInputMode === 'USB' && (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia)) {
      setCameraError('Camera APIs are not available in this browser.');
      return;
    }

    setIsCameraConnecting(true);
    setCameraError(null);
    try {
      await stopPairingSession();
      setCameraPairCode('');
      stopActiveCameraStream();
      if (cameraInputMode === 'NETWORK') {
        const networkSource: BroadcastCameraSource = {
          id: selectedCameraSource.id,
          name: selectedCameraSource.name,
          type: 'NETWORK',
          connection: 'Medium',
          streamUrl: selectedCameraSource.streamUrl
        };
        updateBroadcastConfig((current) => ({
          ...current,
          cameraList: [
            ...current.cameraList.filter((camera) => camera.type !== 'NETWORK' || camera.id !== networkSource.id),
            networkSource
          ]
        }));
        if (previewVideoRef.current) {
          previewVideoRef.current.src = selectedCameraSource.streamUrl ?? '';
          try {
            await previewVideoRef.current.play();
          } catch {
            // browser playback depends on codec/container support from the network source
          }
        }
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: selectedCameraSource.id ? { exact: selectedCameraSource.id } : undefined,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 60 }
          },
          audio: false
        });

        activeCameraStreamRef.current = stream;
        if (previewVideoRef.current) {
          previewVideoRef.current.srcObject = stream;
          try {
            await previewVideoRef.current.play();
          } catch {
            // autoplay can be blocked; browser controls remain available for manual playback
          }
        }
      }

      updateBroadcastConfig((current) => ({
        ...current,
        cameraId: selectedCameraSource.id
      }));
      markCameraConnected(selectedCameraSource.id);
      openTableAssignmentPrompt(selectedCameraSource.id);
      setCameraConnectionState('CONNECTED');
      setCameraStatusNote(`Connected to ${selectedCameraSource.name}.`);
      if (cameraInputMode === 'USB') {
        await syncCameraInventory();
      }
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Camera access denied. Allow camera permissions in your browser.'
          : error instanceof DOMException && error.name === 'NotFoundError'
            ? 'Selected camera source is unavailable.'
            : error instanceof DOMException && error.name === 'NotReadableError'
              ? 'Camera is busy in another app.'
              : error instanceof Error
                ? error.message
                : 'Unable to connect camera.';
      setCameraError(message);
      setCameraConnectionState('DISCONNECTED');
      setCameraStatusNote('Connection failed.');
    } finally {
      setIsCameraConnecting(false);
    }
  };

  const handleDisconnectWirelessCamera = () => {
    const disconnectCameraId = selectedCameraSource?.id ?? '';
    stopActiveCameraStream();
    void stopPairingSession();
    setCameraPairCode('');
    updateBroadcastConfig((current) => ({
      ...current,
      cameraId: '',
      connectedCameraIds: (current.connectedCameraIds ?? []).filter((cameraId) => cameraId !== disconnectCameraId),
      cameraTableMap: Object.fromEntries(
        Object.entries(current.cameraTableMap ?? {}).filter(([cameraId]) => cameraId !== disconnectCameraId)
      ),
      streamStatus: 'STANDBY'
    }));
    setCameraConnectionState('DISCONNECTED');
    setCameraError(null);
    setCameraStatusNote('Camera disconnected.');
  };

  const handleGoLiveToChannel = () => {
    if (!hasConnectedCameraFeed) {
      setCameraError('Connect a camera feed before going live.');
      return;
    }
    if (!hasEligibleBroadcastChannel || !selectedBroadcastChannel) {
      setCameraError('No eligible TDTV channel selected for this tournament.');
      return;
    }
    if (!hasMappedCameraTable) {
      setCameraError('Assign this camera to a table before going live.');
      return;
    }
    if (!allSponsorCardsReady) {
      setCameraError('Each sponsor card must include a title and marketing blurb before going live.');
      return;
    }
    setSponsorConfirmChecked(false);
    setTosConfirmChecked(false);
    setIsGoLiveConfirmOpen(true);
  };

  const handleConfirmGoLive = () => {
    if (!tosConfirmChecked) {
      setCameraError('You must agree to the broadcast ToS to go live.');
      return;
    }
    if (canManageSponsorSlots && !sponsorConfirmChecked) {
      setCameraError('Confirm sponsorship settings before going live.');
      return;
    }
    if (!selectedBroadcastChannel) return;

    updateBroadcastConfig((current) => ({
      ...current,
      streamStatus: 'LIVE',
      cameraId: selectedCameraSource?.id ?? current.cameraId
    }));
    setCameraError(null);
    setIsGoLiveConfirmOpen(false);
    setCameraStatusNote(`Live on ${formatChannelOptionLabel(selectedBroadcastChannel)}.`);
  };

  const handleStandbyBroadcast = () => {
    updateBroadcastConfig((current) => ({
      ...current,
      streamStatus: 'STANDBY'
    }));
    setCameraStatusNote('Broadcast returned to standby.');
  };

  const handleAddSponsorSlot = () => {
    if (!canManageSponsorSlots) return;
    updateBroadcastConfig((current) => ({
      ...current,
      sponsorCards: [
        ...current.sponsorCards,
        {
          id: `sponsor-${Date.now()}`,
          name: 'New sponsor',
          durationSeconds: 10,
          marketingBlip: '',
          logoDataUrl: '',
          permanent: false,
          enabled: true
        }
      ]
    }));
  };

  const handleRemoveSponsorSlot = (sponsorId: string) => {
    updateBroadcastConfig((current) => {
      const sponsor = current.sponsorCards.find((entry) => entry.id === sponsorId);
      if (!sponsor || sponsor.permanent) return current;
      return {
        ...current,
        sponsorCards: current.sponsorCards.filter((entry) => entry.id !== sponsorId)
      };
    });
    if (editingSponsorId === sponsorId) setEditingSponsorId(null);
  };

  const handleSponsorFieldChange = (
    sponsorId: string,
    field: 'name' | 'durationSeconds' | 'marketingBlip',
    value: string
  ) => {
    updateBroadcastConfig((current) => ({
      ...current,
      sponsorCards: current.sponsorCards.map((sponsor) => {
        if (sponsor.id !== sponsorId) return sponsor;
        if (sponsor.permanent && field !== 'durationSeconds') return sponsor;
        if (field === 'durationSeconds') {
          const minimumDuration = sponsor.permanent ? 5 : 10;
          const fallbackDuration = sponsor.permanent ? 15 : 10;
          const nextDuration = Math.max(minimumDuration, Math.floor(Number(value) || fallbackDuration));
          return { ...sponsor, durationSeconds: nextDuration };
        }
        if (field === 'marketingBlip') {
          const words = value.trim().split(/\s+/).filter(Boolean);
          const nextBlip = words.slice(0, 25).join(' ');
          return { ...sponsor, marketingBlip: nextBlip };
        }
        return { ...sponsor, name: value };
      })
    }));
  };

  const handleSponsorLogoUpload = (sponsorId: string, file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : null;
      updateBroadcastConfig((current) => ({
        ...current,
        sponsorCards: current.sponsorCards.map((sponsor) =>
          sponsor.id === sponsorId && !sponsor.permanent ? { ...sponsor, logoDataUrl: result } : sponsor
        )
      }));
    };
    reader.readAsDataURL(file);
  };

  const canCreateBracket = !currentTournament.bracketGenerated;
  const isTournamentReadOnly = currentTournament.status === 'COMPLETED';
  const showStartAction = !isTournamentReadOnly && currentTournament.bracketGenerated && currentTournament.status === 'READY';
  const handleStartTournament = () => {
    startTournament(currentTournament.id);
    setWorkflowTab('BRACKET');
  };
  const workflowHint = showStartAction
    ? 'Next step: start the tournament when players are ready.'
    : isTournamentReadOnly
      ? 'Tournament complete. Setup, bracket, and broadcasting remain available in read-only mode.'
      : canCreateBracket
        ? 'Next step: lock the bracket seeding, then generate the bracket.'
        : currentTournament.status === 'ACTIVE'
          ? 'Tournament is active. Use the Bracket tab to control match winners.'
          : null;
  const workflowTitle =
    workflowTab === 'ROSTER'
      ? 'Draft Roster'
      : workflowTab === 'PAYOUTS'
        ? 'Payout Structure'
        : workflowTab === 'BRACKET'
          ? 'Bracket'
          : 'Broadcast Hub';
  const activeWorkflowTab = WORKFLOW_TABS.find((tab) => tab.value === workflowTab) ?? WORKFLOW_TABS[0];
  const getPlayerName = (playerId: string) => players.find((player) => player.id === playerId)?.displayName ?? 'TBD';
  const getDisplayEntrants = (match: typeof matches[number]) => {
    const baseEntrants = (match.entrants || []).slice(0, 2).map((entrantId, index) => ({
      key: `${match.id}-${entrantId}-${index}`,
      playerId: entrantId,
      label: getPlayerName(entrantId),
      isBye: false
    }));
    if (match.state === 'BYE' && baseEntrants.length === 1) {
      return [
        baseEntrants[0],
        {
          key: `${match.id}-bye`,
          playerId: null,
          label: 'BYE',
          isBye: true
        }
      ];
    }
    while (baseEntrants.length < 2) {
      baseEntrants.push({
        key: `${match.id}-tbd-${baseEntrants.length}`,
        playerId: null,
        label: 'TBD',
        isBye: false
      });
    }
    return baseEntrants;
  };
  const focusMatch = carouselMatches.find((match) => match.id === activeBracketMatchId) ?? carouselMatches[0] ?? null;
  const actionableMatchIds = new Set(actionableMatches.map((match) => match.id));
  const focusMatchIndex = focusMatch ? carouselMatches.findIndex((match) => match.id === focusMatch.id) : -1;
  const focusEntrants = focusMatch ? getDisplayEntrants(focusMatch) : [];
  const focusMatchIsActionable = Boolean(
    focusMatch &&
    (
      actionableMatchIds.has(focusMatch.id) ||
      (focusMatch.state === 'BYE' && currentTournament.status === 'ACTIVE')
    )
  );
  const focusByeEntrant = focusMatch && focusMatch.state === 'BYE'
    ? focusEntrants.find((entrant) => !entrant.isBye && entrant.playerId) ?? null
    : null;
  const activeProgressRoundMatchCount = activeProgressRound
    ? matches.filter((match) => match.round === activeProgressRound).length
    : 0;
  const tournamentMetaLine = `${formatLabel(currentTournament.format)} • ${players.length} players • ${tableLimit} table${tableLimit === 1 ? '' : 's'}`;
  const tournamentStatusLabel =
    currentTournament.status === 'ACTIVE'
      ? 'Active'
      : currentTournament.status === 'READY'
        ? 'Ready'
        : currentTournament.status === 'COMPLETED'
          ? 'Complete'
          : 'Draft';
  const tournamentStageLabel = getTournamentStageLabel(
    activeProgressRoundMatchCount,
    currentTournament.status,
    bracketRounds.length > 0
  );
  const entrantHasBye = (matchId: string, entrantId: string) => {
    const match = matches.find((entry) => entry.id === matchId);
    if (!match || match.state !== 'BYE') return false;
    return match.winnerId === entrantId || (match.entrants?.length === 1 && match.entrants[0] === entrantId);
  };
  const getDisplayTableForMatch = (matchId: string) => {
    const matchIndex = actionableMatches.findIndex((match) => match.id === matchId);
    return matchIndex >= 0 ? matchIndex + 1 : null;
  };
  const broadcastLiveTable =
    broadcastConfig.streamStatus === 'LIVE' && broadcastConfig.cameraId
      ? broadcastConfig.cameraTableMap?.[broadcastConfig.cameraId] ?? null
      : null;
  const isBroadcastLiveTable = (matchId: string) => {
    const tableNumber = getDisplayTableForMatch(matchId);
    return Boolean(tableNumber && broadcastLiveTable && tableNumber === broadcastLiveTable);
  };
  const getCarouselMatchStatusLabel = (matchId: string, state: typeof matches[number]['state']) => {
    if (state === 'BYE') return 'BYE';
    if (state === 'IN_PROGRESS' || actionableMatchIds.has(matchId)) return 'ON TABLE';
    if (state === 'PENDING') return 'WAITING';
    return state.replaceAll('_', ' ');
  };
  const getCarouselMatchStatusTone = (statusLabel: string) => {
    if (statusLabel === 'ON TABLE') return 'live';
    if (statusLabel === 'BYE') return 'next';
    return 'waiting';
  };
  const focusedRacePlan = focusMatch
    ? getModifiedEliminationRacePlan(currentTournament, focusMatch.round)
    : getModifiedEliminationRacePlan(currentTournament, 1);
  const getFocusedRaceLabel = () => {
    if (currentTournament.format !== 'MODIFIED_ELIMINATION') return 'Race to 1';
    return `W ${focusedRacePlan.winnersRaceTo} • L ${focusedRacePlan.losersRaceTo}`;
  };
  const centerCarouselMatch = (matchId: string) => {
    const track = matchCarouselTrackRef.current;
    const target = matchCarouselCardRefs.current[matchId];
    if (!track || !target) return;
    const targetLeft = target.offsetLeft - Math.max(0, (track.clientWidth - target.clientWidth) / 2);
    track.scrollTo({
      left: Math.max(0, targetLeft),
      behavior: 'smooth'
    });
  };
  const setFocusedMatch = (matchId: string) => {
    setActiveBracketMatchId(matchId);
    centerCarouselMatch(matchId);
  };
  const handleCarouselScroll = () => {
    if (typeof window === 'undefined' || matchCarouselFrameRef.current !== null) return;
    matchCarouselFrameRef.current = window.requestAnimationFrame(() => {
      matchCarouselFrameRef.current = null;
      const track = matchCarouselTrackRef.current;
      if (!track || carouselMatches.length === 0) return;
      const trackBounds = track.getBoundingClientRect();
      const trackCenter = trackBounds.left + (trackBounds.width / 2);
      let nearestId: string | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;

      carouselMatches.forEach((match) => {
        const card = matchCarouselCardRefs.current[match.id];
        if (!card) return;
        const bounds = card.getBoundingClientRect();
        const cardCenter = bounds.left + (bounds.width / 2);
        const distance = Math.abs(trackCenter - cardCenter);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestId = match.id;
        }
      });

      if (nearestId && nearestId !== activeBracketMatchId) {
        setActiveBracketMatchId(nearestId);
      }
    });
  };
  return (
    <div className="tournament-page">
      <section className="tournament-header-shell">
        <div className="tournament-brand-bar">
          <div className="tournament-brand-lockup">
            <strong className="tournament-brand-wordmark">TDIAB</strong>
            <span>Tournament Director in a Box</span>
          </div>
          <div className="tournament-brand-status">
            <span className={`tournament-live-chip tournament-live-chip--${currentTournament.status.toLowerCase()}`}>
              <Play size={14} strokeWidth={2.4} />
              {tournamentStatusLabel}
            </span>
          </div>
        </div>

        <div className="tournament-progress-shell" aria-label="Tournament progress">
          <div className="tournament-progress-copy">
            <span className="tournament-progress-kicker">Tournament Progress</span>
            <div className="tournament-progress-inline">
              <strong>{tournamentStageLabel}</strong>
              <span>{completedCompetitiveMatches} of {competitiveMatches.length} matches complete</span>
            </div>
          </div>
          <div className="tournament-progress-track-shell">
            <div className="tournament-progress-track" aria-hidden="true">
              <span className="tournament-progress-fill" style={{ width: `${bracketProgressPercent}%` }} />
            </div>
            <div className="tournament-progress-meta">
              <span>{tournamentStatusLabel}</span>
              <strong>{bracketProgressPercent}%</strong>
            </div>
          </div>
        </div>

        <div className="tournament-header">
          <div className="tournament-title-block">
            <div className="tournament-title-row">
              <div>
                <span className="tournament-kicker">{activeWorkflowTab.label}</span>
                <h1 className="tournament-title">{currentTournament.name}</h1>
                <p className="tournament-subtitle">{tournamentMetaLine}</p>
              </div>
              <div className="tournament-prize-panel">
                <span className="tournament-prize-label">Prize Pool</span>
                <strong>{currencyFormatter.format(projectedPrizePool)}</strong>
                <small>Based on entry less green fee</small>
              </div>
            </div>
            <div className="tournament-summary-meta">
              <span>{formatLabel(currentTournament.format)}</span>
              <span>{players.length} players</span>
              <span>{tableLimit} tables</span>
              {currentTournament.isTemplate ? <span>Template</span> : null}
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="error-message">
          {error}
          <button className="secondary-action" onClick={clearError}>Dismiss</button>
        </div>
      )}

      {currentTournament.status === 'COMPLETED' && payoutLeaderboard.length > 0 && (
        <section className="tournament-complete-card" aria-live="polite">
          <div className="complete-header">
            <div>
              <span className="complete-kicker">Tournament Complete</span>
              <h2 className="complete-title">Final Leaderboard</h2>
            </div>
            <div className="complete-pool">
              <span className="label">Total paid out</span>
              <strong>{currencyFormatter.format(totalPrizePool)}</strong>
            </div>
          </div>

          <div className="winner-spotlight">
            <div className="winner-rank">1st</div>
            <div className="winner-details">
              <h3>{payoutLeaderboard[0]?.displayName ?? 'Champion'}</h3>
              <p>{payoutLeaderboard[0]?.wins ?? 0}W - {payoutLeaderboard[0]?.losses ?? 0}L</p>
            </div>
            <div className="winner-payout">{currencyFormatter.format(payoutLeaderboard[0]?.payout ?? 0)}</div>
          </div>

          <div className="placement-list">
            {payoutLeaderboard.slice(1).map((entry) => (
              <div key={`${entry.position}-${entry.displayName}`} className="placement-row">
                <div className="placement-rank">{entry.position}</div>
                <div className="placement-player">
                  <strong>{entry.displayName}</strong>
                  <span>{entry.wins}W - {entry.losses}L</span>
                </div>
                <div className="placement-payout">{currencyFormatter.format(entry.payout)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="workflow-card">
        <div className="workflow-header">
          <div className="workflow-header-copy">
            <span className="workflow-kicker">{activeWorkflowTab.detail}</span>
            <h2 className="section-title">{workflowTitle}</h2>
          </div>
          <div className="workflow-header-action">
            {!isTournamentReadOnly && showStartAction ? (
              <button className="start-action-pulse" onClick={handleStartTournament}>
                Start Tournament
              </button>
            ) : null}
          </div>
        </div>
        {workflowHint && <p className="workflow-hint">{workflowHint}</p>}

        <div className="workflow-tabs" role="tablist" aria-label="Tournament workflow">
          {WORKFLOW_TABS.map((tab) => {
            const Icon = tab.icon;
            const isDisabled = tab.value === 'BRACKET' ? !canAccessBracketTab : false;
            return (
              <button
                key={tab.value}
                type="button"
                className={`workflow-tab ${workflowTab === tab.value ? 'active' : ''}`}
                onClick={() => setWorkflowTab(tab.value)}
                disabled={isDisabled}
              >
                <span className="workflow-tab-icon">
                  <Icon size={18} strokeWidth={2.2} />
                </span>
                <span className="workflow-tab-copy">
                  <strong>{tab.label}</strong>
                  <small>{tab.detail}</small>
                </span>
              </button>
            );
          })}
        </div>

          {workflowTab === 'ROSTER' && (
            <div className="roster-builder">
              <form onSubmit={handleAddPlayer} className="add-player-form">
                <input
                  type="text"
                  className="player-input"
                  placeholder="Player name"
                  value={newPlayerName}
                  onChange={(e) => setNewPlayerName(e.target.value)}
                  disabled={currentTournament.bracketGenerated || isTournamentReadOnly}
                />
                <button type="submit" className="primary-action" disabled={currentTournament.bracketGenerated || isTournamentReadOnly}>
                  Add Player
                </button>
              </form>

              <div className="player-list">
                {rosterDisplayIds.map((playerId) => {
                  const player = players.find((item) => item.id === playerId);
                  if (!player) return null;
                  const playerIdentityMode = player.identityMode ?? 'UNRESOLVED';

                  return (
                    <div key={player.id} className="player-item">
                      <div className="player-info identity-layout">
                        <div className="player-headline">
                          <span className="seed-index">#{player.entryOrder ?? player.seed}</span>
                          <span className="player-name">{player.displayName}</span>
                        </div>
                        <div className="player-identity-meta">
                          <span className={`player-identity-badge player-identity-badge--${playerIdentityMode.toLowerCase()}`}>
                            {playerIdentityMode === 'UNRESOLVED'
                              ? canUsePlayerIdentity
                                ? 'Needs identity choice'
                                : 'Local-only entry'
                              : playerIdentityMode === 'LINKED'
                                ? `Linked ID: ${player.universalProfileId ?? 'N/A'}`
                                : 'Local-only entry'}
                          </span>
                          {canUsePlayerIdentity && !currentTournament.bracketGenerated && !isTournamentReadOnly && (
                            <button
                              type="button"
                              className="small-action-btn"
                              onClick={() =>
                                setIdentityPromptOpenByPlayerId((current) => ({
                                  ...current,
                                  [player.id]: !current[player.id]
                                }))
                              }
                            >
                              {identityPromptOpenByPlayerId[player.id] ? 'Hide ID Options' : 'Set ID'}
                            </button>
                          )}
                        </div>
                        {canUsePlayerIdentity && !currentTournament.bracketGenerated && !isTournamentReadOnly && identityPromptOpenByPlayerId[player.id] && (
                          <div className="player-identity-prompt">
                            <p>
                              Is this <strong>{player.displayName}</strong> from existing player records, should we create a new player profile, or keep local-only?
                            </p>
                            <div className="player-identity-actions">
                              <button
                                type="button"
                                className="small-action-btn"
                                onClick={() => handleUseExistingPlayerProfile(player.id)}
                              >
                                Use Existing Profile
                              </button>
                              <button
                                type="button"
                                className="small-action-btn"
                                onClick={() => handleCreatePlayerProfile(player.id)}
                              >
                                Create New Player Profile
                              </button>
                              <button
                                type="button"
                                className="small-action-btn"
                                onClick={() => handleSetPlayerLocalOnly(player.id)}
                              >
                                No, Keep Local-Only
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="player-actions">
                        {!currentTournament.bracketGenerated && !isTournamentReadOnly && (
                          <button className="danger-action" onClick={() => removePlayer(currentTournament.id, player.id)}>
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {workflowTab === 'PAYOUTS' && (
            <div className="summary-grid">
              {players.length === 0 && (
                <div className="payout-override">
                  <h3>Roster required</h3>
                  <p>Add players in the roster tab to generate payout structure totals.</p>
                </div>
              )}
              <div className="brief-panels">
                <article className="brief-panel">
                  <h3>Event Snapshot</h3>
                  <div className="brief-rows">
                    <div className="brief-row"><span>Format</span><strong>{formatLabel(currentTournament.format)}</strong></div>
                    <div className="brief-row"><span>Seeding</span><strong>{formatLabel(currentTournament.bracketGenerated ? currentTournament.seedingMethod : seedingMode)}</strong></div>
                    <div className="brief-row"><span>Players</span><strong>{players.length}</strong></div>
                    <div className="brief-row"><span>Tables</span><strong>{currentTournament.tableCount || 'Not set'}</strong></div>
                    <div className="brief-row"><span>Payout positions</span><strong>{currentTournament.payoutPositions}</strong></div>
                  </div>
                </article>

                <article className="brief-panel">
                  <h3>Financial Snapshot</h3>
                  <div className="brief-rows">
                    <div className="brief-row"><span>Prize pool</span><strong>{currencyFormatter.format(projectedPrizePool)}</strong></div>
                    <div className="brief-row"><span>Total entry / player</span><strong>{currencyFormatter.format(totalEntryPerPlayer)}</strong></div>
                    <div className="brief-row"><span>Green fee / player</span><strong>{currencyFormatter.format(greenFeePerPlayer)}</strong></div>
                    <div className="brief-row"><span>Prize contribution / player</span><strong>{currencyFormatter.format(prizeContributionPerPlayer)}</strong></div>
                    <div className="brief-row"><span>Collected total</span><strong>{currencyFormatter.format(totalCollected)}</strong></div>
                    <div className="brief-row"><span>Administrative total</span><strong>{currencyFormatter.format(totalGreenFees)}</strong></div>
                  </div>
                </article>
              </div>

              <div className="summary-payouts">
                <h3>Payouts</h3>
                {payouts.length === 0 ? (
                  <p>No payout pool configured yet.</p>
                ) : (
                  <div className="payout-lines">
                    {payouts
                      .slice(0, Math.min(currentTournament.payoutPositions, payouts.length))
                      .map((row) => (
                        <div key={row.position} className="payout-line">
                          <span>#{row.position} • {Math.round((row.percentage || 0) * 100)}%</span>
                          <strong>{currencyFormatter.format(row.amount)}</strong>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              <div className="payout-override">
                <button
                  type="button"
                  className="payout-accordion-trigger"
                  onClick={() => setIsPayoutOverrideOpen((current) => !current)}
                  aria-expanded={isPayoutOverrideOpen}
                  aria-controls="payout-override-panel"
                >
                  <span className="payout-accordion-copy">
                    <strong>Payout Structure Override</strong>
                    <small>{currentTournament.payoutPositions} positions • {payoutShareTotal}% allocated</small>
                  </span>
                  <span className="payout-accordion-chevron" aria-hidden="true">{isPayoutOverrideOpen ? '▲' : '▼'}</span>
                </button>

                {isPayoutOverrideOpen && (
                  <div id="payout-override-panel" className="payout-accordion-panel">
                    <p>
                      View-only payout breakdown is generated from player count and setup fees. You can override the number
                      of paid positions before start, and during active play with confirmation.
                    </p>
                    <div className="payout-override-controls">
                      <label className="control-group">
                        <span>Pay top N positions</span>
                        <input
                          type="number"
                          min={1}
                          max={Math.max(1, players.length || 1)}
                          value={payoutPositionsInput}
                          onChange={(event) => setPayoutPositionsInput(Math.max(1, Number(event.target.value || 1)))}
                          disabled={players.length === 0}
                        />
                      </label>
                      <button type="button" className="secondary-action" onClick={handleApplyPayoutOverride} disabled={players.length === 0}>
                        {currentTournament.status === 'ACTIVE' ? 'Override During Live Tournament' : 'Apply Payout Structure'}
                      </button>
                    </div>

                    <div className="payout-rainbow-board" aria-label="Winner share sliders">
                      <div className="payout-rainbow-head">
                        <strong>Winner Share Sliders</strong>
                        <span className={`share-total ${payoutShareTotal === 100 ? 'valid' : 'invalid'}`}>
                          Total {payoutShareTotal}%
                        </span>
                      </div>
                      {payoutShareDraft.map((share, index) => (
                        <div key={`share-${index}`} className={`share-row share-row--${(index % 6) + 1}`}>
                          <div className="share-row-label">
                            <span>#{index + 1}</span>
                            <strong>{share}%</strong>
                            <small>{currencyFormatter.format((projectedPrizePool * share) / 100)}</small>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={PAYOUT_PERCENT_STEP}
                            value={share}
                            onChange={(event) => updateShareAtIndex(index, Number(event.target.value || 0))}
                            disabled={players.length === 0 || payoutShareDraft.length === 1}
                          />
                          <input
                            className="share-percent-input"
                            type="number"
                            min={0}
                            max={100}
                            step={PAYOUT_PERCENT_STEP}
                            value={share}
                            onChange={(event) => updateShareAtIndex(index, Number(event.target.value || 0))}
                            disabled={players.length === 0 || payoutShareDraft.length === 1}
                            aria-label={`Payout share for place ${index + 1}`}
                          />
                        </div>
                      ))}
                      <button type="button" className="primary-action share-apply-btn" onClick={handleApplyShareOverride} disabled={players.length === 0}>
                        {currentTournament.status === 'ACTIVE' ? 'Apply Live Share Override' : 'Apply Share Overrides'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {workflowTab === 'BROADCAST' && (
            <div className="broadcast-tab">
              {!isPayingMember ? (
                <div className="broadcast-upgrade-card broadcast-upgrade-card--basic">
                  <div className="broadcast-upgrade-hero">
                    <div className="broadcast-upgrade-copy">
                      <span className="broadcast-upgrade-kicker">
                        <Crown size={18} />
                        Pro & higher
                      </span>
                      <h3>
                        <span>Take it</span>
                        <strong>LIVE</strong>
                      </h3>
                      <p>Upgrade to unlock the energetic tournament broadcast layer without burying what each plan really gets you.</p>
                      <div className="broadcast-upgrade-callout">
                        Pro unlocks in-room broadcast tools. <strong>Pro+</strong> is the tier that adds TDTV / TV Guide placement.
                      </div>
                    </div>

                    <div className="broadcast-upgrade-stage" aria-hidden="true">
                      <div className="broadcast-upgrade-stage-top">
                        <span className="broadcast-upgrade-live-pill">LIVE</span>
                      </div>
                      <div className="broadcast-upgrade-stage-camera">
                        <Camera size={22} />
                        <span>Table 3</span>
                      </div>
                      <div className="broadcast-upgrade-scoreboard">
                        <div className="broadcast-upgrade-scoreboard-player broadcast-upgrade-scoreboard-player--red">
                          <span>Carter</span>
                          <strong>2</strong>
                        </div>
                        <div className="broadcast-upgrade-scoreboard-player broadcast-upgrade-scoreboard-player--blue">
                          <span>Nguyen</span>
                          <strong>4</strong>
                        </div>
                      </div>
                      <p className="broadcast-upgrade-tag">Same game. Bigger audience.</p>
                    </div>
                  </div>

                  <div className="broadcast-upgrade-feature-list">
                    {BROADCAST_UPSELL_FEATURES.map((feature) => {
                      const Icon = feature.icon;
                      return (
                        <div key={feature.title} className="broadcast-upgrade-feature">
                          <span className="broadcast-upgrade-feature-icon">
                            <Icon size={22} />
                          </span>
                          <div className="broadcast-upgrade-feature-copy">
                            <strong>{feature.title}</strong>
                            <span>{feature.detail}</span>
                          </div>
                          <ArrowRight size={20} className="broadcast-upgrade-feature-arrow" />
                        </div>
                      );
                    })}
                  </div>

                  <Link to="/account?section=billing&offer=broadcast" className="broadcast-upgrade-cta">
                    <span>Compare Pro plans</span>
                    <strong>From $4.99/mo</strong>
                    <ArrowRight size={28} />
                  </Link>
                  <div className="broadcast-upgrade-footer">More control. More exposure. A bigger game.</div>
                </div>
              ) : (
                <>
                  <article className="broadcast-preview-wide">
                    <div className="broadcast-preview-wide-head">
                      <h3>Broadcast Preview</h3>
                      <span className={`broadcast-state-pill ${broadcastConfig.streamStatus === 'LIVE' ? 'live' : ''}`}>
                        {broadcastConfig.streamStatus === 'LIVE' ? 'LIVE' : 'INACTIVE'}
                      </span>
                    </div>
                    <div className="broadcast-preview-stage">
                      {cameraConnectionState === 'CONNECTED' ? (
                        <video ref={previewVideoRef} autoPlay muted playsInline />
                      ) : (
                        <div className="broadcast-preview-empty">
                          <strong>Broadcast preview inactive</strong>
                          <span>Connect a camera and map it to a table to preview the active feed.</span>
                        </div>
                      )}
                    </div>
                    <div className="broadcast-preview-meta">
                      <span>
                        Channel: {selectedBroadcastChannel ? formatChannelOptionLabel(selectedBroadcastChannel) : 'No eligible channel'}
                      </span>
                      <span>Camera table: {activeCameraTable ? `Table ${activeCameraTable}` : 'Not mapped'}</span>
                    </div>
                    <div className="broadcast-readiness-panel">
                      {broadcastReadinessChecklist.map((item) => (
                        <span key={item.id} className={`broadcast-readiness-chip ${item.ready ? 'ready' : 'blocked'}`}>
                          {item.ready ? 'Ready' : 'Needed'} • {item.label}
                        </span>
                      ))}
                    </div>
                  </article>

                  <div className="broadcast-grid">
                    <article className="broadcast-panel">
                      <div className="camera-setup-head">
                        <h3>Camera Hub</h3>
                        <button
                          type="button"
                          className="camera-tip-btn"
                          title="Camera phone and laptop must be on the same local network."
                          aria-label="Network setup tip"
                        >
                          i
                        </button>
                      </div>

                      <p className="broadcast-copy">
                        USB camera input is available on Pro and above. Pro uses QR pairing for the fastest wireless setup, while network camera sources unlock on Pro+ and above.
                      </p>
                      <small className="camera-tier-limit">
                        {maxCameraFeeds === null
                          ? `Multi-camera support is enabled on your tier (${connectedFeedCount} connected).`
                          : `Feed limit: ${maxCameraFeeds} camera${maxCameraFeeds === 1 ? '' : 's'} on your tier (${connectedFeedCount} connected).`}
                      </small>

                      <div className="camera-status-grid">
                        <div className={`camera-status-chip ${cameraConnectionState === 'CONNECTED' ? 'active' : ''}`}>
                          Camera {cameraConnectionState === 'CONNECTED' ? 'connected' : 'disconnected'}
                        </div>
                        <div className={`camera-status-chip ${cameraPairCode ? 'active' : ''}`}>
                          Pairing {cameraPairCode ? 'ready' : 'offline'}
                        </div>
                        <div className={`camera-status-chip ${broadcastConfig.streamStatus === 'LIVE' ? 'active' : ''}`}>
                          Output {broadcastConfig.streamStatus === 'LIVE' ? 'live' : 'standby'}
                        </div>
                      </div>

                      <div className="camera-control-deck">
                        <div className="camera-mode-grid" role="tablist" aria-label="Camera source type">
                          <button
                            type="button"
                            className={`camera-mode-tile ${cameraInputMode === 'QR' ? 'active' : ''}`}
                            onClick={() => setCameraInputMode('QR')}
                          >
                            <strong>QR Pair</strong>
                            <span>Recommended for Pro and above</span>
                          </button>
                          <button
                            type="button"
                            className={`camera-mode-tile ${cameraInputMode === 'USB' ? 'active' : ''}`}
                            onClick={() => setCameraInputMode('USB')}
                          >
                            <strong>USB Camera</strong>
                            <span>Pro and above</span>
                          </button>
                          <button
                            type="button"
                            className={`camera-mode-tile ${cameraInputMode === 'NETWORK' ? 'active' : ''}`}
                            onClick={() => setCameraInputMode('NETWORK')}
                            disabled={!canUseNetworkCamera}
                          >
                            <strong>Network Camera</strong>
                            <span>Pro+ and above</span>
                          </button>
                        </div>

                        {cameraInputMode === 'QR' && (
                          <div className="camera-pairing-shell">
                            <div className="camera-pairing-head">
                              <strong>Scan to pair phone camera</strong>
                              <span>{cameraPairStatus}</span>
                            </div>
                            <div className="camera-pairing-row">
                              <button
                                type="button"
                                className="secondary-action"
                                onClick={() => void handleStartRemotePairing()}
                                disabled={isRemotePairConnecting || !canUseQrCamera}
                              >
                                {isRemotePairConnecting ? 'Starting…' : 'Generate QR code'}
                              </button>
                              <button
                                type="button"
                                className="secondary-action"
                                onClick={handleDisconnectWirelessCamera}
                                disabled={!cameraPairCode}
                              >
                                End pairing
                              </button>
                              {cameraPairCode ? (
                                <button type="button" className="small-action-btn" onClick={() => void handleCopyPairLink()}>
                                  Send phone link
                                </button>
                              ) : null}
                            </div>
                            {cameraPairCode ? (
                              <div className="camera-pairing-active">
                                {cameraPairQrDataUrl ? (
                                  <div className="camera-qr-shell">
                                    <img src={cameraPairQrDataUrl} alt="QR code for phone camera pairing" />
                                  </div>
                                ) : null}
                                <div className="camera-pairing-code">
                                  <strong>{cameraPairCode}</strong>
                                  <small>Scan the QR code on the phone, allow camera access, and the rear camera will join this broadcast.</small>
                                  {signalTransport ? (
                                    <small>
                                      Signaling: {signalTransport === 'supabase' ? 'Supabase realtime' : 'Local browser channel'}
                                    </small>
                                  ) : null}
                                </div>
                              </div>
                            ) : (
                              <small>Generate a QR code, scan it with the phone, then tap Connect Camera there.</small>
                            )}
                          </div>
                        )}

                        {cameraInputMode === 'USB' && canUseUsbCamera && (
                          <>
                            <div className="camera-source-row">
                              <label className="control-group camera-source-field">
                                <span>USB or capture source</span>
                                <select
                                  value={cameraSourceId}
                                  onChange={(event) => setCameraSourceId(event.target.value)}
                                >
                                  {usbAndCaptureSources.length === 0 ? (
                                    <option value="">No local devices found yet</option>
                                  ) : (
                                    usbAndCaptureSources.map((camera) => (
                                      <option key={camera.id} value={camera.id}>
                                        {camera.name} • {camera.type}
                                      </option>
                                    ))
                                  )}
                                </select>
                              </label>
                              <button
                                type="button"
                                className="secondary-action"
                                onClick={() => void syncCameraInventory()}
                                disabled={isCameraScanning}
                              >
                                {isCameraScanning ? 'Scanning…' : 'Scan USB devices'}
                              </button>
                            </div>
                            <small className="camera-status-note">
                              Best for webcams, HDMI capture cards, and laptop-connected production cameras.
                            </small>
                          </>
                        )}

                        {cameraInputMode === 'NETWORK' && canUseNetworkCamera && (
                          <>
                            <div className="camera-network-grid">
                              <label className="control-group">
                                <span>Network camera name</span>
                                <input
                                  type="text"
                                  value={networkCameraName}
                                  onChange={(event) => setNetworkCameraName(event.target.value)}
                                  placeholder="Table 3 overhead"
                                />
                              </label>
                              <label className="control-group">
                                <span>Browser-compatible stream URL</span>
                                <input
                                  type="url"
                                  value={networkCameraUrl}
                                  onChange={(event) => setNetworkCameraUrl(event.target.value)}
                                  placeholder="https://camera.local/live.m3u8"
                                />
                              </label>
                            </div>
                            <small className="camera-status-note">
                              Use a browser-playable network source or bridge URL. Raw RTSP camera feeds typically need a bridge first.
                            </small>
                          </>
                        )}

                        <label className="control-group">
                          <span>Selected camera table mapping</span>
                          <select
                            value={activeCameraTable ?? 1}
                            onChange={(event) => {
                              if (!selectedCameraSource) return;
                              assignCameraToTable(selectedCameraSource.id, Number(event.target.value));
                            }}
                          >
                            {tableOptions.map((tableNumber) => (
                              <option key={`active-map-${tableNumber}`} value={tableNumber}>
                                Table {tableNumber}
                              </option>
                            ))}
                          </select>
                        </label>

                        <div className="camera-connect-row">
                          <button
                            type="button"
                            className="secondary-action"
                            onClick={() => void handleConnectSelectedCamera()}
                            disabled={
                              cameraInputMode === 'QR' ||
                              !selectedCameraSource ||
                              cameraConnectionState === 'CONNECTED' ||
                              isCameraConnecting ||
                              (cameraInputMode === 'NETWORK' && !canUseNetworkCamera)
                            }
                          >
                            {isCameraConnecting ? 'Connecting…' : cameraInputMode === 'NETWORK' ? 'Connect network camera' : 'Connect USB camera'}
                          </button>
                          <button
                            type="button"
                            className="secondary-action"
                            onClick={handleDisconnectWirelessCamera}
                            disabled={cameraConnectionState !== 'CONNECTED'}
                          >
                            Disconnect
                          </button>
                        </div>

                      </div>

                      <div className="camera-preview-shell">
                        <div className="camera-preview-stage">
                          <strong>Connected camera-to-table map</strong>
                          {connectedCameraSources.length === 0 ? (
                            <span>No connected feeds yet.</span>
                          ) : (
                            <div className="camera-table-map-list">
                              {connectedCameraSources.map((camera) => (
                                <label key={`camera-map-${camera.id}`} className="camera-table-map-row">
                                  <span>{camera.name}</span>
                                  <select
                                    value={broadcastConfig.cameraTableMap?.[camera.id] ?? 1}
                                    onChange={(event) => assignCameraToTable(camera.id, Number(event.target.value))}
                                  >
                                    {tableOptions.map((tableNumber) => (
                                      <option key={`camera-${camera.id}-table-${tableNumber}`} value={tableNumber}>
                                        Table {tableNumber}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="camera-status-note">{cameraStatusNote}</span>
                        {cameraError && <span className="camera-status-error">{cameraError}</span>}
                        {!canUseNetworkCamera && canUseQrCamera && (
                          <span className="camera-status-note">
                            QR phone pairing and USB camera input are included on Pro. Network camera sources unlock with Pro+, Venue, or Platform Admin access.
                          </span>
                        )}
                      </div>

                      <div className="camera-route-row">
                        <button
                          type="button"
                          className="primary-action"
                          onClick={handleGoLiveToChannel}
                          disabled={!canGoLive || isTournamentReadOnly}
                        >
                          Go live to TDTV channel
                        </button>
                        <button
                          type="button"
                          className="secondary-action"
                          onClick={handleStandbyBroadcast}
                          disabled={broadcastConfig.streamStatus !== 'LIVE'}
                        >
                          {isTournamentReadOnly ? 'End stream' : 'Return to standby'}
                        </button>
                      </div>
                    </article>
                  </div>

                  <article className="broadcast-panel">
                    <div className="broadcast-panel-head">
                      <h3>Sponsorship Slots</h3>
                      {canManageSponsorSlots && (
                        <button type="button" className="secondary-action" onClick={handleAddSponsorSlot}>
                          Add sponsor slot
                        </button>
                      )}
                    </div>
                    {!canManageSponsorSlots && (
                      <p className="broadcast-copy">
                        Sponsor slot creation is available for Pro+, Venue, and Platform Admin tiers.
                      </p>
                    )}
                    <div className="sponsor-list">
                      {broadcastConfig.sponsorCards.map((sponsor) => (
                        <div key={sponsor.id} className="sponsor-row">
                          {sponsor.logoDataUrl ? (
                            <div className="sponsor-thumb-shell" aria-hidden="true">
                              <img className="sponsor-thumb" src={sponsor.logoDataUrl} alt="" />
                            </div>
                          ) : (
                            <div className="sponsor-thumb-shell sponsor-thumb-shell--empty" aria-hidden="true">
                              <span>{sponsor.name.slice(0, 2).toUpperCase()}</span>
                            </div>
                          )}
                          <div className="sponsor-main">
                            <strong>{sponsor.name}</strong>
                            <span>{sponsor.durationSeconds}s • {sponsor.marketingBlip || 'No marketing blip yet'}</span>
                            <small>
                              {sponsor.permanent
                                ? 'Permanent slot (minimum 5s, fixed title/logo/blurb, cannot remove)'
                                : 'Editable sponsor slot'}
                            </small>
                          </div>
                          <div className="sponsor-actions">
                            <button
                              type="button"
                              className="small-action-btn"
                              onClick={() => setEditingSponsorId(sponsor.id)}
                              aria-label={`Edit ${sponsor.name}`}
                            >
                              ✎
                            </button>
                            {canManageSponsorSlots && !sponsor.permanent && (
                              <button
                                type="button"
                                className="danger-action"
                                onClick={() => handleRemoveSponsorSlot(sponsor.id)}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {editingSponsor && (
                      <div className="sponsor-editor">
                        <div className="sponsor-editor-head">
                          <h4>Edit Sponsor Slot</h4>
                          <button type="button" className="small-action-btn" onClick={() => setEditingSponsorId(null)}>
                            Done
                          </button>
                        </div>
                        {editingSponsor.logoDataUrl && (
                          <div className="sponsor-editor-preview">
                            <img src={editingSponsor.logoDataUrl} alt={`${editingSponsor.name} logo`} />
                          </div>
                        )}
                        {editingSponsor.permanent && (
                          <p className="broadcast-copy">
                            This permanent sponsorship card is baked in. Only the duration can be adjusted.
                          </p>
                        )}
                        <label className="control-group">
                          <span>Sponsor name</span>
                          <input
                            type="text"
                            value={editingSponsor.name}
                            onChange={(event) =>
                              handleSponsorFieldChange(editingSponsor.id, 'name', event.target.value)
                            }
                            disabled={editingSponsor.permanent}
                          />
                        </label>
                        <label className="control-group">
                          <span title={editingSponsor.permanent ? 'Permanent sponsor minimum is 5 seconds.' : 'Minimum slot duration is 10 seconds.'}>
                            Slot duration (seconds)
                          </span>
                          <input
                            type="number"
                            min={editingSponsor.permanent ? 5 : 10}
                            value={editingSponsor.durationSeconds}
                            onChange={(event) =>
                              handleSponsorFieldChange(editingSponsor.id, 'durationSeconds', event.target.value)
                            }
                          />
                        </label>
                        <label className="control-group">
                          <span>Marketing blip (25 words max)</span>
                          <textarea
                            value={editingSponsor.marketingBlip}
                            onChange={(event) =>
                              handleSponsorFieldChange(editingSponsor.id, 'marketingBlip', event.target.value)
                            }
                            rows={3}
                            disabled={editingSponsor.permanent}
                          />
                          <small>{marketingWordCount}/25 words</small>
                        </label>
                        <label className="control-group">
                          <span>Logo upload</span>
                          <input
                            type="file"
                            accept="image/*"
                            disabled={editingSponsor.permanent}
                            onChange={(event) =>
                              handleSponsorLogoUpload(editingSponsor.id, event.target.files?.[0] ?? null)
                            }
                          />
                        </label>
                      </div>
                    )}
                  </article>

                  <article className="broadcast-panel">
                    <h3>TDTV Channel Hub</h3>
                    {!canUseTdChannelHub ? (
                      <p className="broadcast-copy">
                        Live channel selection is available for Pro+, Venue, and Platform Admin tiers.
                      </p>
                    ) : (
                      <>
                        <div className="channel-convention-card">
                          <strong>Channel naming map</strong>
                          <ul>
                            {channelNamingConventionHelp.map((hint) => (
                              <li key={hint}>{hint}</li>
                            ))}
                          </ul>
                        </div>
                        {allowedBroadcastChannels.length === 0 ? (
                          <p className="broadcast-copy">
                            No eligible channels are assigned to this account yet.
                          </p>
                        ) : (
                          <>
                            <label className="control-group">
                              <span>Select eligible channel</span>
                              <select
                                value={broadcastConfig.channelId ?? ''}
                                onChange={(event) => handleSelectChannel(event.target.value)}
                              >
                                {allowedBroadcastChannels.map((channel) => (
                                  <option key={channel.id} value={channel.id}>
                                    {formatChannelOptionLabel(channel)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <div className="channel-selection-brief">
                              <span>This tournament will occupy:</span>
                              <strong>
                                {formatChannelOptionLabel(
                                  allowedBroadcastChannels.find((channel) => channel.id === broadcastConfig.channelId) ??
                                    allowedBroadcastChannels[0]
                                )}
                              </strong>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </article>
                </>
              )}
            </div>
          )}

          {isTableAssignModalOpen && (
            <div className="broadcast-modal-backdrop" role="dialog" aria-modal="true" aria-label="Camera table assignment">
              <div className="broadcast-modal">
                <h3>Assign camera coverage</h3>
                <p>Select which table this camera is covering so overlays remain accurate.</p>
                <label className="control-group">
                  <span>Covered table</span>
                  <select
                    value={pendingCameraTable}
                    onChange={(event) => setPendingCameraTable(Number(event.target.value))}
                  >
                    {tableOptions.map((tableNumber) => (
                      <option key={`pending-table-${tableNumber}`} value={tableNumber}>
                        Table {tableNumber}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="camera-route-row">
                  <button type="button" className="primary-action" onClick={handleConfirmTableAssignment}>
                    Save mapping
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => {
                      setIsTableAssignModalOpen(false);
                      setPendingCameraAssignmentId(null);
                    }}
                  >
                    Later
                  </button>
                </div>
              </div>
            </div>
          )}

          {isGoLiveConfirmOpen && (
            <div className="broadcast-modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirm go live">
              <div className="broadcast-modal">
                <h3>Confirm broadcast launch</h3>
                <p>Before going live, confirm sponsorship settings and agree to TD in a Box broadcast terms.</p>
                {canManageSponsorSlots && (
                  <label className="broadcast-check-row">
                    <input
                      type="checkbox"
                      checked={sponsorConfirmChecked}
                      onChange={(event) => setSponsorConfirmChecked(event.target.checked)}
                    />
                    <span>I reviewed sponsorship logos, durations, and marketing blips for this broadcast.</span>
                  </label>
                )}
                <label className="broadcast-check-row">
                  <input
                    type="checkbox"
                    checked={tosConfirmChecked}
                    onChange={(event) => setTosConfirmChecked(event.target.checked)}
                  />
                  <span>
                    I agree this stream follows ToS, including PG kid-appropriate content only and no prohibited content.
                    {' '}
                    <a href={getAppRouteUrl('/terms-of-service')} target="_blank" rel="noreferrer">View ToS</a>
                  </span>
                </label>
                <div className="camera-route-row">
                  <button type="button" className="primary-action" onClick={handleConfirmGoLive}>
                    Confirm and go live
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => setIsGoLiveConfirmOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {workflowTab === 'BRACKET' && (
            <div className="bracket-tab">
              <section className="bracket-setup-card">
                <div className="bracket-setup-head">
                  <div>
                    <h3>Bracket Setup</h3>
                    <p>
                      Choose how the field should be seeded before the bracket is generated.
                      Manual seeding opens a saved seed board so you can drag players into place.
                    </p>
                  </div>
                  <div className="bracket-setup-actions">
                    {seedingMode === 'MANUAL' && canCreateBracket && (
                      <button type="button" className="secondary-action bracket-setup-btn" onClick={openManualSeedModal}>
                        Edit Manual Seeds
                      </button>
                    )}
                    {canCreateBracket && (
                      <button type="button" className="primary-action bracket-setup-btn" onClick={handleCreateBracket} disabled={players.length < 2}>
                        Create Bracket
                      </button>
                    )}
                  </div>
                </div>

                <div className="bracket-setup-stack">
                  <label className="control-group bracket-seeding-control">
                    <span>Seed type</span>
                    <select
                      value={seedingMode}
                      onChange={(event) => handleSeedingModeChange(event.target.value as TournamentSeedMode)}
                      disabled={!canCreateBracket}
                    >
                      {SEEDING_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <small>
                      {seedingMode === 'MANUAL'
                        ? 'Manual seeding uses the saved order from your seed board.'
                        : 'This seed type will be applied when the bracket is generated.'}
                    </small>
                  </label>
                  <div className="bracket-seeding-preview">
                    <div className="bracket-seeding-preview-head">
                      <strong>Seed preview</strong>
                      <span>{seedingPreviewIds.length} players</span>
                    </div>
                    {seedingPreviewIds.length === 0 ? (
                      <p className="bracket-empty-copy">Add at least two players to build a seeded bracket.</p>
                    ) : (
                      <div className="bracket-seeding-list">
                        {seedingPreviewIds.map((playerId, index) => {
                          const player = players.find((entry) => entry.id === playerId);
                          if (!player) return null;
                          return (
                            <div key={`seed-preview-${player.id}`} className="bracket-seeding-row">
                              <span className="seed-index">#{index + 1}</span>
                              <strong>{player.displayName}</strong>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <div className="bracket-command-grid">
                <section className="bracket-stage-card">
                  <div className="bracket-stage-head">
                    <div>
                      <h3>Tournament Bracket</h3>
                      <p>
                        {currentTournament.bracketGenerated
                          ? currentTournament.status === 'ACTIVE'
                            ? 'Tournament is active. Swipe through the queue and score only the matches that are on table.'
                            : 'Bracket is built. Review the draw, then start the tournament when players are ready.'
                          : 'Select a seed type above, then generate the bracket from that saved order.'}
                      </p>
                    </div>
                    <div className="bracket-stage-actions">
                      <span className="bracket-stage-pill bracket-stage-pill--active">
                        <Trophy size={14} strokeWidth={2.2} />
                        Main Bracket
                      </span>
                      <button type="button" className="bracket-stage-pill" onClick={() => setIsBracketExpanded(true)}>
                        <Expand size={14} strokeWidth={2.2} />
                        Full Screen
                      </button>
                    </div>
                  </div>

                  <div className="bracket-hero-wrap">
                    <button type="button" className="bracket-hero" onClick={() => setIsBracketExpanded(true)}>
                      <div className="bracket-board bracket-board--mini">
                        {bracketRounds.length === 0 ? (
                          <div className="bracket-empty">Generate and start tournament to view bracket flow.</div>
                        ) : (
                          bracketRounds.map((round) => (
                            <div key={`round-mini-${round.round}`} className="bracket-round">
                              <h4>Round {round.round}</h4>
                              {round.matches.map((match) => (
                                <div key={match.id} className="bracket-match-card">
                                  {(match.entrants || []).slice(0, 2).map((entrantId, entrantIndex) => {
                                    const isWinner = match.winnerId === entrantId;
                                    const showByePill = entrantHasBye(match.id, entrantId);
                                    return (
                                      <span
                                        key={`${match.id}-${entrantId}`}
                                        className={`bracket-entrant bracket-entrant--${entrantIndex === 0 ? 'red' : 'blue'} ${isWinner ? 'winner' : ''}`}
                                      >
                                        <span>{getPlayerName(entrantId)}</span>
                                        {showByePill && <span className="bye-pill">BYE</span>}
                                      </span>
                                    );
                                  })}
                                </div>
                              ))}
                            </div>
                          ))
                        )}
                      </div>
                    </button>
                  </div>
                </section>

                <section className="bracket-controls bracket-controls--spotlight">
                  <div className="bracket-controls-head">
                    <div>
                      <h3>Match Control</h3>
                      <span>Swipe the full queue or tap any match to inspect how many are ahead.</span>
                    </div>
                    <span>{focusMatch ? `${carouselMatches.length} match${carouselMatches.length === 1 ? '' : 'es'} remaining` : 'Waiting'}</span>
                  </div>

                  {carouselMatches.length > 0 && (
                    <div className="match-carousel-shell">
                      <button
                        type="button"
                        className="carousel-nav-btn"
                        onClick={() => {
                          const currentIndex = carouselMatches.findIndex((match) => match.id === focusMatch?.id);
                          const nextIndex = currentIndex <= 0 ? carouselMatches.length - 1 : currentIndex - 1;
                          const nextMatchId = carouselMatches[nextIndex]?.id ?? null;
                          if (nextMatchId) setFocusedMatch(nextMatchId);
                        }}
                        aria-label="Show previous active match"
                      >
                        <ChevronLeft size={20} strokeWidth={2.6} />
                      </button>
                      <div
                        ref={matchCarouselTrackRef}
                        className="match-carousel-track"
                        role="list"
                        aria-label="Remaining match carousel"
                        onScroll={handleCarouselScroll}
                      >
                        {carouselMatches.map((match, index) => (
                          <button
                            key={`live-card-${match.id}`}
                            type="button"
                            className={`match-carousel-card ${focusMatch?.id === match.id ? 'active' : ''}`}
                            onClick={() => setFocusedMatch(match.id)}
                            ref={(node) => {
                              matchCarouselCardRefs.current[match.id] = node;
                            }}
                          >
                            <div className="match-carousel-card-head">
                              <strong>{getDisplayTableForMatch(match.id) ? `Table ${getDisplayTableForMatch(match.id)}` : `Match ${index + 1}`}</strong>
                              <div className="match-carousel-head-pills">
                                {isBroadcastLiveTable(match.id) ? <span className="tdtv-live-pill">TDTV</span> : null}
                                <span className={`match-carousel-state match-carousel-state--${getCarouselMatchStatusTone(getCarouselMatchStatusLabel(match.id, match.state))}`}>
                                  {getCarouselMatchStatusLabel(match.id, match.state)}
                                </span>
                              </div>
                            </div>
                            <small>Round {match.round} • Match {match.slot + 1}</small>
                            {getDisplayEntrants(match).map((entrant, entrantIndex) => (
                              <span
                                key={`live-${entrant.key}`}
                                className={`match-carousel-player ${
                                  actionableMatchIds.has(match.id)
                                    ? `match-carousel-player--${entrantIndex === 0 ? 'red' : 'blue'}`
                                    : `match-carousel-player--queued-${entrantIndex === 0 ? 'dark' : 'light'}`
                                }`}
                              >
                                <span>{entrant.label}</span>
                                {entrant.isBye && <span className="bye-pill">BYE</span>}
                              </span>
                            ))}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="carousel-nav-btn"
                        onClick={() => {
                          const currentIndex = carouselMatches.findIndex((match) => match.id === focusMatch?.id);
                          const nextIndex = currentIndex >= carouselMatches.length - 1 ? 0 : currentIndex + 1;
                          const nextMatchId = carouselMatches[nextIndex]?.id ?? null;
                          if (nextMatchId) setFocusedMatch(nextMatchId);
                        }}
                        aria-label="Show next active match"
                      >
                        <ChevronRight size={20} strokeWidth={2.6} />
                      </button>
                    </div>
                  )}

                  {carouselMatches.length > 1 && (
                    <div className="match-carousel-dots" role="tablist" aria-label="Match carousel pagination">
                      {carouselMatches.map((match, index) => (
                        <button
                          key={`match-dot-${match.id}`}
                          type="button"
                          className={`match-carousel-dot ${focusMatch?.id === match.id ? 'active' : ''}`}
                          aria-label={`Focus ${getDisplayTableForMatch(match.id) ? `table ${getDisplayTableForMatch(match.id)}` : `match ${index + 1}`}`}
                          aria-pressed={focusMatch?.id === match.id}
                          onClick={() => setFocusedMatch(match.id)}
                        />
                      ))}
                    </div>
                  )}

                  {focusMatch ? (
                    <>
                      <div className="match-control-hero">
                        <div className="match-control-hero-copy">
                          <div className="match-control-kicker-row">
                            <strong>{getDisplayTableForMatch(focusMatch.id) ? `Table ${getDisplayTableForMatch(focusMatch.id)}` : `Match ${focusMatch.slot + 1}`}</strong>
                            <span className={`bracket-live-pill ${focusMatchIsActionable ? 'active' : ''}`}>
                              <Play size={13} strokeWidth={2.4} />
                              {getCarouselMatchStatusLabel(focusMatch.id, focusMatch.state)}
                            </span>
                            {isBroadcastLiveTable(focusMatch.id) ? <span className="tdtv-live-pill">TDTV</span> : null}
                          </div>
                          <span className="match-control-round-copy">Round {focusMatch.round} • Match {focusMatch.slot + 1}</span>
                        </div>
                        <div className="match-race-pill">
                          <Info size={15} strokeWidth={2.2} />
                          <span>{getFocusedRaceLabel()}</span>
                        </div>
                      </div>
                      <div className="match-score-stage">
                        {focusEntrants[0] ? (
                          <div className={`match-player-card ${
                            focusMatchIsActionable
                              ? 'match-player-card--red'
                              : focusEntrants[0].isBye
                                ? 'match-player-card--bye'
                                : 'match-player-card--queued'
                          }`}>
                            <span className="match-player-label">Player A</span>
                            <strong>{focusEntrants[0].label}</strong>
                            <span className="match-player-stat">
                              {focusEntrants[0].playerId ? (players.find((entry) => entry.id === focusEntrants[0].playerId)?.wins ?? 0) : 0} tournament wins
                            </span>
                            {focusEntrants[0].isBye && <span className="bye-pill bye-pill--inline">BYE</span>}
                          </div>
                        ) : null}
                        <div className="match-score-versus" aria-hidden="true">VS</div>
                        {focusEntrants[1] ? (
                          <div className={`match-player-card ${
                            focusEntrants[1].isBye
                              ? 'match-player-card--bye'
                              : focusMatchIsActionable
                                ? 'match-player-card--blue'
                                : 'match-player-card--queued'
                          }`}>
                            <span className="match-player-label">Player B</span>
                            <strong>{focusEntrants[1].label}</strong>
                            <span className="match-player-stat">
                              {focusEntrants[1].playerId ? (players.find((entry) => entry.id === focusEntrants[1].playerId)?.wins ?? 0) : 0} tournament wins
                            </span>
                            {focusEntrants[1].isBye && <span className="bye-pill bye-pill--inline">BYE</span>}
                          </div>
                        ) : null}
                      </div>
                      <div className="match-race-note">
                        <Info size={16} strokeWidth={2.2} />
                        <span>
                          {currentTournament.format === 'MODIFIED_ELIMINATION'
                            ? focusedRacePlan.shifted && focusedRacePlan.shiftStartRound
                              ? `Late-bracket race plan active from round ${focusedRacePlan.shiftStartRound}: winners ${focusedRacePlan.winnersRaceTo}, losers ${focusedRacePlan.losersRaceTo}.`
                              : currentTournament.raceShiftStartRound
                                ? `Early-bracket race plan active. Winners ${focusedRacePlan.winnersRaceTo}, losers ${focusedRacePlan.losersRaceTo}; shifts on round ${currentTournament.raceShiftStartRound} to ${currentTournament.winnersRaceToAfterShift}/${currentTournament.losersRaceToAfterShift}.`
                                : `Modified elimination is active. Winners-side matches race to ${focusedRacePlan.winnersRaceTo}; losers-side matches race to ${focusedRacePlan.losersRaceTo}.`
                            : 'Tap the winner below to advance the bracket. This control is optimized for fast table-side operation.'}
                        </span>
                      </div>
                      {focusMatchIsActionable ? (
                        <div className="winner-pick-grid">
                          {(focusMatch.state === 'BYE' && focusByeEntrant ? [focusByeEntrant] : focusEntrants.filter((entrant) => !entrant.isBye && entrant.playerId)).map((entrant, index) => (
                            <button
                              key={`${focusMatch.id}-focus-${entrant.key}`}
                              type="button"
                              className={`winner-pick-btn winner-pick-btn--${index === 0 ? 'red' : 'blue'}`}
                              onClick={() => handleCompleteMatch(focusMatch.id, entrant.playerId as string)}
                              disabled={currentTournament.status !== 'ACTIVE'}
                            >
                              <Trophy size={18} strokeWidth={2.2} />
                              <span className="winner-pick-copy">
                                <span className="winner-pick-name">{focusMatch.state === 'BYE' ? `Advance ${entrant.label}` : `Mark ${entrant.label} as Winner`}</span>
                                <span className="winner-pick-sub">{focusMatch.state === 'BYE' ? 'Tap to advance the bracket' : 'Tap once to post result'}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="match-race-note">
                          <Info size={16} strokeWidth={2.2} />
                          <span>
                            {focusMatch.state === 'BYE'
                              ? 'This match is an automatic advance. The player with no opponent receives a bye.'
                              : 'This match is waiting on a table. You can review it now, but winner controls unlock only when the match becomes active.'}
                          </span>
                        </div>
                      )}
                      <div className="match-control-footer">
                        <span>{focusMatchIndex >= 0 ? `${focusMatchIndex} match${focusMatchIndex === 1 ? '' : 'es'} ahead of this one in the queue.` : 'Queue ready.'}</span>
                        <button type="button" className="small-action-btn" onClick={() => setIsBracketExpanded(true)}>
                          Expand full bracket
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="bracket-empty-copy">No actionable matches right now. Winners appear here as rounds progress.</p>
                  )}
                </section>
              </div>
            </div>
         )}
      </section>

      {isBracketExpanded && (
        <div className="bracket-overlay" role="dialog" aria-modal="true" aria-label="Expanded bracket">
          <div className="bracket-overlay-shell">
            <button type="button" className="bracket-overlay-close" onClick={() => setIsBracketExpanded(false)}>
              Close
            </button>
            <div className="bracket-board bracket-board--expanded">
              {bracketRounds.length === 0 ? (
                <div className="bracket-empty">No bracket available yet.</div>
              ) : (
                bracketRounds.map((round) => (
                  <div key={`round-expanded-${round.round}`} className="bracket-round">
                    <h4>Round {round.round}</h4>
                    {round.matches.map((match) => (
                      <div key={`expanded-${match.id}`} className="bracket-match-card">
                        {(match.entrants || []).slice(0, 2).map((entrantId, entrantIndex) => {
                          const isWinner = match.winnerId === entrantId;
                          const showByePill = entrantHasBye(match.id, entrantId);
                          return (
                            <span
                              key={`${match.id}-expanded-${entrantId}`}
                              className={`bracket-entrant bracket-entrant--${entrantIndex === 0 ? 'red' : 'blue'} ${isWinner ? 'winner' : ''}`}
                            >
                              <span>{getPlayerName(entrantId)}</span>
                              {showByePill && <span className="bye-pill">BYE</span>}
                            </span>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {isManualSeedModalOpen && (
        <div className="broadcast-modal-backdrop" role="dialog" aria-modal="true" aria-label="Manual seeding">
          <div className="broadcast-modal seeding-modal">
            <div className="seeding-modal-head">
              <div>
                <h3>Manual Seed Board</h3>
                <p>Drag players into position or use the arrow buttons, then save this seed order for bracket generation.</p>
              </div>
              <span className="bracket-stage-pill">Manual seeding</span>
            </div>

            <div className="seeding-modal-list">
              {manualSeedDraftOrder.map((playerId, index) => {
                const player = players.find((entry) => entry.id === playerId);
                if (!player) return null;
                return (
                  <div
                    key={`manual-seed-${player.id}`}
                    className={`seeding-modal-row ${draggingManualSeedId === player.id ? 'dragging' : ''}`}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', player.id);
                      setDraggingManualSeedId(player.id);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const draggedPlayerId = event.dataTransfer.getData('text/plain') || draggingManualSeedId;
                      if (draggedPlayerId) insertManualSeedBefore(draggedPlayerId, player.id);
                      setDraggingManualSeedId(null);
                    }}
                    onDragEnd={() => setDraggingManualSeedId(null)}
                  >
                    <div className="seeding-modal-row-main">
                      <span className="seed-index">#{index + 1}</span>
                      <span className="seeding-drag-handle" aria-hidden="true">≡</span>
                      <strong>{player.displayName}</strong>
                    </div>
                    <div className="seeding-modal-row-actions">
                      <button type="button" className="small-action-btn" onClick={() => moveManualSeedDraftPlayer(player.id, -1)}>
                        ↑
                      </button>
                      <button type="button" className="small-action-btn" onClick={() => moveManualSeedDraftPlayer(player.id, 1)}>
                        ↓
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="camera-route-row">
              <button type="button" className="primary-action" onClick={handleSaveManualSeedOrder}>
                Save Seed Order
              </button>
              <button
                type="button"
                className="secondary-action"
                onClick={() => {
                  setManualSeedDraftOrder(normalizeManualSeedIds(manualOrder));
                  setDraggingManualSeedId(null);
                  setIsManualSeedModalOpen(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
