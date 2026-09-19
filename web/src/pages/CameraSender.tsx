import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  createPairSignalClient,
  DEFAULT_ICE_SERVERS,
  generatePairSessionId,
  getPairSignalDiagnostics,
  getPairingAvailabilityError,
  type PairSignalClient,
  type PairSignalMessage
} from '@/lib/webrtcPairing';
import { isSupabaseConfigured } from '@/lib/supabase';
import './CameraSender.css';

type FullscreenDoc = Document & {
  webkitFullscreenElement?: Element;
  msFullscreenElement?: Element;
  webkitExitFullscreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};

type BatteryManagerLike = {
  level: number;
  charging: boolean;
  addEventListener: (type: 'levelchange' | 'chargingchange', listener: () => void) => void;
  removeEventListener: (type: 'levelchange' | 'chargingchange', listener: () => void) => void;
};

type NetworkInformationLike = {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  type?: string;
  saveData?: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
};

type CameraSectionKey = 'pairCode' | 'guide' | 'preview' | 'connection' | 'advanced';

declare global {
  interface Window {
    __tdiabReconnectCamera?: () => void;
    __tdiabStopCamera?: () => void;
    __tdiabCameraState?: () => 'connected' | 'connecting' | 'disconnected';
  }
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatBatteryLabel(level: number | null, charging: boolean | null): string {
  if (level === null) return charging ? 'Charging' : 'Battery';
  const percentage = Math.round(level * 100);
  return charging ? `${percentage}% charging` : `${percentage}%`;
}

function describeConnection(
  online: boolean,
  effectiveType: string,
  downlink: number | null,
  isConnected: boolean,
  signalTransport: 'supabase' | 'broadcast-channel' | null
): { quality: string; detail: string } {
  if (!online) {
    return {
      quality: 'Offline',
      detail: 'Reconnect to Wi-Fi or cellular data.'
    };
  }

  if (downlink !== null && downlink >= 10) {
    return {
      quality: isConnected ? 'Excellent' : 'Strong',
      detail: signalTransport === 'supabase' ? 'Realtime transport locked.' : 'Ready for local channel pairing.'
    };
  }

  if (effectiveType === '4g') {
    return {
      quality: isConnected ? 'Excellent' : 'Strong',
      detail: signalTransport === 'supabase' ? 'Network relay active.' : 'High-speed network detected.'
    };
  }

  if (effectiveType === '3g') {
    return {
      quality: 'Good',
      detail: 'Stable enough for camera pairing.'
    };
  }

  if (effectiveType === '2g' || effectiveType === 'slow-2g') {
    return {
      quality: 'Weak',
      detail: 'Video may struggle on this connection.'
    };
  }

  return {
    quality: isConnected ? 'Connected' : 'Checking',
    detail: signalTransport === 'supabase' ? 'Waiting for host control.' : 'Checking network conditions.'
  };
}

export default function CameraSender() {
  const { pairCode = '' } = useParams<{ pairCode: string }>();
  const normalizedPairCode = useMemo(() => pairCode.trim().toUpperCase(), [pairCode]);
  const [pairInput, setPairInput] = useState(normalizedPairCode);
  const effectivePairCode = useMemo(
    () => (pairInput || normalizedPairCode).trim().toUpperCase(),
    [normalizedPairCode, pairInput]
  );
  const [status, setStatus] = useState('Waiting to connect');
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [signalTransport, setSignalTransport] = useState<'supabase' | 'broadcast-channel' | null>(null);
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [isCharging, setIsCharging] = useState<boolean | null>(null);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [networkState, setNetworkState] = useState(() => ({
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    effectiveType: '',
    downlink: null as number | null,
    rtt: null as number | null,
    type: '',
    saveData: false
  }));
  const [openSections, setOpenSections] = useState<Record<CameraSectionKey, boolean>>({
    pairCode: true,
    guide: true,
    preview: true,
    connection: false,
    advanced: false
  });
  const pairDiagnostics = useMemo(
    () => getPairSignalDiagnostics(effectivePairCode || 'pending'),
    [effectivePairCode]
  );
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const signalClientRef = useRef<PairSignalClient | null>(null);
  const previewShellRef = useRef<HTMLDivElement | null>(null);
  const topRef = useRef<HTMLElement | null>(null);
  const guideRef = useRef<HTMLDivElement | null>(null);
  const advancedRef = useRef<HTMLDivElement | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const senderSessionIdRef = useRef('');
  const hostSessionIdRef = useRef('');
  const manualStopRef = useRef(false);
  const hasActivatedSessionRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const isConnectingRef = useRef(false);
  const isConnectedRef = useRef(false);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const stopSessionRef = useRef<(notifyHost?: boolean) => Promise<void>>(async () => undefined);
  const connectCameraRef = useRef<(mode?: 'manual' | 'auto') => Promise<void>>(async () => undefined);

  const pairingAvailabilityError = useMemo(() => getPairingAvailabilityError(), []);
  const transportLabel = signalTransport === 'supabase' ? 'Supabase Realtime' : signalTransport === 'broadcast-channel' ? 'Local Channel' : 'Waiting';
  const connectionSummary = useMemo(
    () =>
      describeConnection(
        networkState.online,
        networkState.effectiveType,
        networkState.downlink,
        isConnected,
        signalTransport
      ),
    [isConnected, networkState.downlink, networkState.effectiveType, networkState.online, signalTransport]
  );
  const networkDiagnostics = useMemo(
    () => ({
      connectionType: networkState.type || (networkState.online ? 'Network connection' : 'Offline'),
      effectiveType: networkState.effectiveType || 'Unknown',
      downlink: networkState.downlink !== null ? `${networkState.downlink.toFixed(1)} Mbps` : 'Unknown',
      rtt: networkState.rtt !== null ? `${networkState.rtt} ms` : 'Unknown',
      recommendedPath: networkState.downlink !== null && networkState.downlink >= 10 ? 'High-quality feed is likely supported.' : 'High-quality feed works best on high-speed Wi‑Fi or wired Ethernet.',
      transport: signalTransport === 'supabase' ? 'Supabase Realtime' : signalTransport === 'broadcast-channel' ? 'Local Channel' : 'Waiting for transport',
      peerState: isConnected ? 'Live' : isConnecting ? 'Linking' : 'Standby',
      battery: formatBatteryLabel(batteryLevel, isCharging)
    }),
    [batteryLevel, isCharging, isConnected, isConnecting, networkState.downlink, networkState.effectiveType, networkState.online, networkState.rtt, networkState.type, signalTransport]
  );
  const healthMeter = useMemo(() => {
    switch (connectionSummary.quality) {
      case 'Excellent':
        return 4;
      case 'Strong':
      case 'Good':
        return 3;
      case 'Weak':
        return 2;
      case 'Offline':
        return 0;
      default:
        return 1;
    }
  }, [connectionSummary.quality]);
  const heroStateLabel = isConnected ? 'LIVE' : isConnecting ? 'LINKING' : error ? 'ATTENTION' : 'READY';
  const heroStateTone = isConnected ? 'live' : isConnecting ? 'linking' : error ? 'attention' : 'ready';
  const heroHeading = isConnected ? 'Remote Camera' : 'Remote Camera Standby';
  const heroSubheading = isConnected
    ? 'Connected to TDTV host'
    : isConnecting
      ? 'Securing camera and host session'
      : 'Waiting for your tournament broadcast to pair';

  const scrollToSection = (element: HTMLElement | null) => {
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const toggleSection = (key: CameraSectionKey) => {
    setOpenSections((current) => ({
      ...current,
      [key]: !current[key]
    }));
  };

  const notifyNativeStatus = (nextStatus: string) => {
    const bridge = (window as Window & {
      AndroidSender?: { onStatusChanged?: (status: string) => void };
    }).AndroidSender;
    if (!bridge?.onStatusChanged) return;
    bridge.onStatusChanged(nextStatus);
  };

  const notifyNativeConnection = (connected: boolean) => {
    const bridge = (window as Window & {
      AndroidSender?: { onConnectionStateChanged?: (connected: string) => void };
    }).AndroidSender;
    if (!bridge?.onConnectionStateChanged) return;
    bridge.onConnectionStateChanged(connected ? 'connected' : 'disconnected');
  };

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const releaseWakeLock = async () => {
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (!lock) return;
    try {
      await lock.release();
    } catch {
      // ignore wake lock release errors during teardown
    }
  };

  const requestWakeLock = async () => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    try {
      const wakeLockApi = navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
      };
      const lock = await wakeLockApi.wakeLock?.request('screen');
      if (lock) wakeLockRef.current = lock;
    } catch {
      // best effort only; continue without wake lock when unavailable
    }
  };

  const flushPendingIceCandidates = async (peer: RTCPeerConnection) => {
    if (pendingIceCandidatesRef.current.length === 0) return;
    const queuedCandidates = [...pendingIceCandidatesRef.current];
    pendingIceCandidatesRef.current = [];

    for (const candidate of queuedCandidates) {
      try {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        pendingIceCandidatesRef.current.push(candidate);
      }
    }
  };

  const stopSession = async (notifyHost = true) => {
    clearReconnectTimer();
    await releaseWakeLock();
    const signalClient = signalClientRef.current;
    if (notifyHost && signalClient) {
      try {
        await signalClient.send({ type: 'stop', from: 'sender', ts: Date.now(), sessionId: senderSessionIdRef.current });
      } catch {
        // ignore teardown signal errors while closing the session
      }
    }
    signalClient?.close();
    signalClientRef.current = null;
    senderSessionIdRef.current = '';
    hostSessionIdRef.current = '';
    const peer = peerRef.current;
    if (peer) {
      peer.close();
      peerRef.current = null;
    }
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (previewRef.current) {
      previewRef.current.srcObject = null;
    }
    pendingIceCandidatesRef.current = [];
    setIsConnected(false);
    isConnectedRef.current = false;
    setStatus('Disconnected');
  };
  stopSessionRef.current = stopSession;

  useEffect(() => {
    setPairInput(normalizedPairCode);
  }, [normalizedPairCode]);

  useEffect(() => {
    const clockTimer = window.setInterval(() => setClock(new Date()), 30000);
    return () => {
      window.clearInterval(clockTimer);
    };
  }, []);

  useEffect(() => {
    return () => {
      clearReconnectTimer();
    };
  }, []);

  useEffect(() => {
    const navigatorWithBattery = navigator as Navigator & {
      getBattery?: () => Promise<BatteryManagerLike>;
    };
    if (!navigatorWithBattery.getBattery) return;

    let batteryManager: BatteryManagerLike | null = null;
    const syncBattery = () => {
      if (!batteryManager) return;
      setBatteryLevel(batteryManager.level);
      setIsCharging(batteryManager.charging);
    };

    void navigatorWithBattery.getBattery().then((battery) => {
      batteryManager = battery;
      syncBattery();
      battery.addEventListener('levelchange', syncBattery);
      battery.addEventListener('chargingchange', syncBattery);
    });

    return () => {
      if (!batteryManager) return;
      batteryManager.removeEventListener('levelchange', syncBattery);
      batteryManager.removeEventListener('chargingchange', syncBattery);
    };
  }, []);

  useEffect(() => {
    const navigatorWithConnection = navigator as Navigator & {
      connection?: NetworkInformationLike;
      mozConnection?: NetworkInformationLike;
      webkitConnection?: NetworkInformationLike;
    };
    const connection =
      navigatorWithConnection.connection ??
      navigatorWithConnection.mozConnection ??
      navigatorWithConnection.webkitConnection ??
      null;

    const syncConnection = () => {
      setNetworkState({
        online: navigator.onLine,
        effectiveType: connection?.effectiveType ?? '',
        downlink: typeof connection?.downlink === 'number' ? connection.downlink : null,
        rtt: typeof connection?.rtt === 'number' ? connection.rtt : null,
        type: connection?.type ?? '',
        saveData: Boolean(connection?.saveData)
      });
    };

    syncConnection();
    window.addEventListener('online', syncConnection);
    window.addEventListener('offline', syncConnection);
    connection?.addEventListener?.('change', syncConnection);

    return () => {
      window.removeEventListener('online', syncConnection);
      window.removeEventListener('offline', syncConnection);
      connection?.removeEventListener?.('change', syncConnection);
    };
  }, []);

  useEffect(() => {
    isConnectingRef.current = isConnecting;
  }, [isConnecting]);

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  useEffect(() => {
    notifyNativeStatus(status);
  }, [status]);

  useEffect(() => {
    notifyNativeConnection(isConnected);
  }, [isConnected]);

  useEffect(() => {
    window.__tdiabReconnectCamera = () => {
      if (!hasActivatedSessionRef.current) return;
      if (manualStopRef.current) return;
      void connectCameraRef.current('auto');
    };
    window.__tdiabStopCamera = () => {
      manualStopRef.current = true;
      void stopSessionRef.current();
    };
    window.__tdiabCameraState = () => {
      if (isConnectingRef.current) return 'connecting';
      if (isConnectedRef.current) return 'connected';
      return 'disconnected';
    };

    return () => {
      delete window.__tdiabReconnectCamera;
      delete window.__tdiabStopCamera;
      delete window.__tdiabCameraState;
    };
  }, []);

  useEffect(() => {
    return () => {
      void stopSessionRef.current();
    };
  }, []);

  useEffect(() => {
    const syncFullscreenState = () => {
      const doc = document as FullscreenDoc;
      const fullscreenElement = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.msFullscreenElement ?? null;
      setIsPreviewFullscreen(fullscreenElement === previewShellRef.current);
    };

    document.addEventListener('fullscreenchange', syncFullscreenState);
    document.addEventListener('webkitfullscreenchange', syncFullscreenState as EventListener);
    document.addEventListener('MSFullscreenChange', syncFullscreenState as EventListener);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
      document.removeEventListener('webkitfullscreenchange', syncFullscreenState as EventListener);
      document.removeEventListener('MSFullscreenChange', syncFullscreenState as EventListener);
    };
  }, []);

  const handleSignalMessage = async (message: PairSignalMessage) => {
    if (message.from !== 'host') return;
    if (message.sessionId && hostSessionIdRef.current && message.sessionId !== hostSessionIdRef.current) {
      return;
    }
    if (message.sessionId && !hostSessionIdRef.current && (message.type === 'offer' || message.type === 'ice')) {
      hostSessionIdRef.current = message.sessionId;
    }
    const peer = peerRef.current;
    const signalClient = signalClientRef.current;
    if (!peer || !signalClient) return;
    try {
      if (message.type === 'offer') {
        if (message.sessionId) {
          hostSessionIdRef.current = message.sessionId;
        }
        const offer = message.payload as RTCSessionDescriptionInit;
        if (peer.signalingState !== 'stable' || peer.remoteDescription) {
          return;
        }
        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        await signalClient.send({ type: 'answer', from: 'sender', payload: answer, ts: Date.now(), sessionId: senderSessionIdRef.current });
        setStatus('Answer sent. Finishing connection...');
        await flushPendingIceCandidates(peer);
        return;
      }
      if (message.type === 'ice' && message.payload) {
        const candidate = message.payload as RTCIceCandidateInit;
        if (peer.remoteDescription) {
          await peer.addIceCandidate(new RTCIceCandidate(candidate));
        } else {
          pendingIceCandidatesRef.current.push(candidate);
        }
        return;
      }
      if (message.type === 'stop') {
        manualStopRef.current = true;
        await stopSession(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process host signal.');
    }
  };

  const connectCamera = async (mode: 'manual' | 'auto' = 'manual') => {
    if (isConnectingRef.current) return;
    const nextPairCode = effectivePairCode;
    if (!nextPairCode) {
      setError('Enter a valid pair code to connect your camera.');
      return;
    }
    if (!isSupabaseConfigured) {
      const nextPairingError = getPairingAvailabilityError();
      setError(nextPairingError ?? 'Remote camera pairing requires Supabase realtime signaling.');
      setStatus('Unavailable: Supabase signaling not configured');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser does not support camera capture.');
      return;
    }

    if (mode === 'manual') {
      manualStopRef.current = false;
      hasActivatedSessionRef.current = true;
    }

    setIsConnecting(true);
    isConnectingRef.current = true;
    setError(null);
    setStatus(mode === 'auto' ? 'Reconnecting camera…' : 'Opening camera...');
    try {
      clearReconnectTimer();
      await stopSession(false);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      if (!stream.getVideoTracks().length) {
        throw new Error('No video track was produced by the selected camera. Try another camera or browser.');
      }
      streamRef.current = stream;
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        previewRef.current.muted = true;
        previewRef.current.playsInline = true;
        try {
          await previewRef.current.play();
        } catch {
          setStatus('Camera is active but browser autoplay is blocked.');
        }
      }

      senderSessionIdRef.current = generatePairSessionId();
      const signalClient = await createPairSignalClient(nextPairCode, handleSignalMessage);
      signalClientRef.current = signalClient;
      setSignalTransport(signalClient.transport);

      const peer = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });
      peerRef.current = peer;
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      peer.onicecandidate = (event) => {
        if (!event.candidate || !signalClientRef.current) return;
        void signalClientRef.current.send({
          type: 'ice',
          from: 'sender',
          payload: event.candidate.toJSON(),
          ts: Date.now(),
          sessionId: senderSessionIdRef.current
        });
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') {
          setIsConnected(true);
          isConnectedRef.current = true;
          setStatus('Live connection established');
          setOpenSections((current) => ({
            ...current,
            pairCode: false,
            preview: true,
            connection: true
          }));
          void requestWakeLock();
        } else if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
          setStatus(`Connection ${peer.connectionState}`);
          setIsConnected(false);
          isConnectedRef.current = false;
          if (!manualStopRef.current) {
            clearReconnectTimer();
            reconnectTimerRef.current = window.setTimeout(() => {
              void connectCameraRef.current('auto');
            }, 1600);
          }
        }
      };
      peer.onnegotiationneeded = () => {
        // wait for host to send the offer; sender completes negotiation when it arrives
      };

      stream.getTracks().forEach((track) => {
        track.onended = () => {
          if (manualStopRef.current) return;
          setStatus('Camera track ended. Reconnecting…');
          clearReconnectTimer();
          reconnectTimerRef.current = window.setTimeout(() => {
            void connectCameraRef.current('auto');
          }, 900);
        };
      });

      const sendReadySignal = async (attempt: number) => {
        try {
          await signalClient.send({ type: 'ready', from: 'sender', ts: Date.now(), sessionId: senderSessionIdRef.current });
        } catch {
          // silent retry on transport issues
        }

        if (attempt < 3) {
          window.setTimeout(() => {
            void sendReadySignal(attempt + 1);
          }, 1200);
        }
      };

      await sendReadySignal(1);
      setStatus('Camera ready. Waiting for host offer...');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start camera sender session.');
    } finally {
      setIsConnecting(false);
      isConnectingRef.current = false;
    }
  };
  connectCameraRef.current = connectCamera;

  useEffect(() => {
    const tryReconnect = () => {
      if (!hasActivatedSessionRef.current) return;
      if (manualStopRef.current) return;
      if (document.visibilityState === 'hidden') return;
      const stream = streamRef.current;
      const tracksLive = Boolean(stream?.getVideoTracks().some((track) => track.readyState === 'live'));
      const peerState = peerRef.current?.connectionState;
      const healthy = tracksLive && (peerState === 'connected' || peerState === 'connecting');
      if (healthy || isConnectingRef.current) return;
      clearReconnectTimer();
      reconnectTimerRef.current = window.setTimeout(() => {
        void connectCameraRef.current('auto');
      }, 500);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        tryReconnect();
      }
    };

    window.addEventListener('focus', tryReconnect);
    window.addEventListener('pageshow', tryReconnect);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', tryReconnect);
      window.removeEventListener('pageshow', tryReconnect);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [normalizedPairCode, pairDiagnostics]);

  const togglePreviewFullscreen = async () => {
    const doc = document as FullscreenDoc;
    const previewShell = previewShellRef.current as FullscreenElement | null;
    if (!previewShell) return;
    const fullscreenElement = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.msFullscreenElement ?? null;
    if (fullscreenElement === previewShell) {
      if (doc.exitFullscreen) {
        await doc.exitFullscreen();
        return;
      }
      if (doc.webkitExitFullscreen) {
        await doc.webkitExitFullscreen();
        return;
      }
      if (doc.msExitFullscreen) {
        await doc.msExitFullscreen();
      }
      return;
    }

    if (previewShell.requestFullscreen) {
      await previewShell.requestFullscreen();
      return;
    }
    if (previewShell.webkitRequestFullscreen) {
      await previewShell.webkitRequestFullscreen();
      return;
    }
    if (previewShell.msRequestFullscreen) {
      await previewShell.msRequestFullscreen();
    }
  };

  return (
    <section className="camera-remote-page" ref={topRef}>
      <header className="camera-remote-header">
        <div className="camera-remote-statusbar">
          <span>{formatClock(clock)}</span>
          <div className="camera-remote-statusbar-meta">
            <span>{connectionSummary.quality}</span>
            <span>{formatBatteryLabel(batteryLevel, isCharging)}</span>
          </div>
        </div>

        <div className="camera-remote-brandbar">
          <div className="camera-remote-brand">
            <strong>TDTV</strong>
            <span>TDIAB Network</span>
          </div>
          <div className="camera-remote-brand-copy">
            <h1>Remote Camera</h1>
            <p>Capture • Stream • TDTV</p>
          </div>
          <button
            type="button"
            className="camera-remote-settings"
            onClick={() => scrollToSection(advancedRef.current)}
            aria-label="Open advanced troubleshooting"
          >
            ⚙
          </button>
        </div>
      </header>

      <section className={`camera-hero-card camera-hero-card--${heroStateTone}`}>
        <div className="camera-hero-head">
          <div className={`camera-live-pill camera-live-pill--${heroStateTone}`}>
            <span className="camera-live-pill-dot" />
            <strong>{heroStateLabel}</strong>
          </div>
          <button
            type="button"
            className="camera-quality-badge camera-quality-badge--button"
            onClick={() => setIsDiagnosticsOpen((current) => !current)}
            aria-expanded={isDiagnosticsOpen}
            aria-controls="camera-connection-diagnostics"
            aria-label="Toggle connection diagnostics"
          >
            <div className="camera-health-meter" aria-label={`Connection health ${connectionSummary.quality}`}>
              {[0, 1, 2, 3].map((index) => (
                <span key={index} className={index < healthMeter ? 'active' : ''} />
              ))}
            </div>
            <strong>{connectionSummary.quality}</strong>
            <span>{connectionSummary.detail}</span>
          </button>
        </div>

        {isDiagnosticsOpen && (
          <div id="camera-connection-diagnostics" className="camera-connection-diagnostics" role="dialog" aria-label="Connection diagnostics">
            <div className="camera-connection-diagnostics-head">
              <strong>Connection diagnostics</strong>
              <span>{connectionSummary.quality}</span>
            </div>
            <dl className="camera-connection-diagnostics-grid">
              <div>
                <dt>Signal</dt>
                <dd>{networkDiagnostics.effectiveType}</dd>
              </div>
              <div>
                <dt>Downlink</dt>
                <dd>{networkDiagnostics.downlink}</dd>
              </div>
              <div>
                <dt>RTT</dt>
                <dd>{networkDiagnostics.rtt}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{networkDiagnostics.connectionType}</dd>
              </div>
              <div>
                <dt>Transport</dt>
                <dd>{networkDiagnostics.transport}</dd>
              </div>
              <div>
                <dt>Battery</dt>
                <dd>{networkDiagnostics.battery}</dd>
              </div>
            </dl>
            <p className="camera-connection-diagnostics-note">{networkDiagnostics.recommendedPath}</p>
          </div>
        )}

        <div className="camera-hero-copy">
          <h2>{heroHeading}</h2>
          <p>{heroSubheading}</p>
        </div>

        <div className="camera-hero-brief">
          <div>
            <span>Pair code</span>
            <strong>{normalizedPairCode || 'Missing'}</strong>
          </div>
          <div>
            <span>Transport</span>
            <strong>{transportLabel}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{status}</strong>
          </div>
        </div>

        <div className="camera-hero-metrics">
          <div className={`camera-hero-metric ${isConnected ? 'camera-hero-metric--active' : ''}`}>
            <strong>{isConnected ? 'Camera Active' : isConnecting ? 'Connecting…' : 'Ready to Pair'}</strong>
            <span>Capture state</span>
          </div>
          <div className="camera-hero-metric">
            <strong>{formatBatteryLabel(batteryLevel, isCharging)}</strong>
            <span>Battery</span>
          </div>
          <div className="camera-hero-metric">
            <strong>{networkState.online ? connectionSummary.quality : 'Offline'}</strong>
            <span>{networkState.effectiveType || 'Network status'}</span>
          </div>
        </div>
      </section>

      <button
        type="button"
        className={`camera-primary-action ${isConnected ? 'camera-primary-action--stop' : 'camera-primary-action--start'}`}
        onClick={() => {
          if (isConnected) {
            manualStopRef.current = true;
            void stopSession();
            return;
          }
          void connectCamera('manual');
        }}
        disabled={isConnecting}
      >
        {isConnected ? 'Stop Camera' : isConnecting ? 'Connecting…' : 'Connect Camera'}
      </button>

      {error ? (
        <p className="camera-remote-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="camera-section-stack">
        <section className="camera-collapsible-card">
          <button type="button" className="camera-collapsible-head" onClick={() => toggleSection('pairCode')}>
            <div>
              <strong>{isConnected ? 'Pair Code (Not Needed)' : 'Pair Code'}</strong>
              <span>{isConnected ? 'Camera is currently connected.' : 'Use this code from the host broadcast tab.'}</span>
            </div>
            <span className="camera-collapsible-chevron">{openSections.pairCode ? '▾' : '▸'}</span>
          </button>
          {openSections.pairCode ? (
            <div className="camera-collapsible-body">
              <div className="camera-pair-code-panel">
                {isConnected ? (
                  <strong>{effectivePairCode || 'Ready'}</strong>
                ) : (
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={8}
                    className="camera-pair-code-input"
                    value={pairInput}
                    onChange={(event) => setPairInput(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                    placeholder="Enter QR code"
                    aria-label="Pair code"
                  />
                )}
                <p>
                  {isConnected
                    ? 'The camera is already live and paired with the host device.'
                    : effectivePairCode
                      ? `Open Tournament Broadcast, choose remote phone camera pairing, and enter ${effectivePairCode}.`
                      : 'Open this page from a valid remote camera link or type a code to pair manually.'}
                </p>
              </div>
            </div>
          ) : null}
        </section>

        <section className="camera-collapsible-card" ref={guideRef}>
          <button type="button" className="camera-collapsible-head" onClick={() => toggleSection('guide')}>
            <div>
              <strong>Setup Guide</strong>
              <span>3 quick steps to get this phone live.</span>
            </div>
            <span className="camera-collapsible-chevron">{openSections.guide ? '▾' : '▸'}</span>
          </button>
          {openSections.guide ? (
            <div className="camera-collapsible-body">
              <ol className="camera-guide-list">
                <li>
                  <span>1</span>
                  <div>
                    <strong>Open Tournament Broadcast</strong>
                    <p>Start a broadcast from the TDIAB app on the tournament host device.</p>
                  </div>
                </li>
                <li>
                  <span>2</span>
                  <div>
                    <strong>Get Pair Code</strong>
                    <p>Copy the remote phone pairing code from the broadcast flow.</p>
                  </div>
                </li>
                <li>
                  <span>3</span>
                  <div>
                    <strong>Connect Camera</strong>
                    <p>Open this link on the phone, confirm camera access, then tap Connect Camera.</p>
                  </div>
                </li>
              </ol>
            </div>
          ) : null}
        </section>

        <section className="camera-collapsible-card">
          <button type="button" className="camera-collapsible-head" onClick={() => toggleSection('preview')}>
            <div>
              <strong>Camera Preview</strong>
              <span>Frame the table so overlays and players stay readable.</span>
            </div>
            <span className="camera-collapsible-chevron">{openSections.preview ? '▾' : '▸'}</span>
          </button>
          {openSections.preview ? (
            <div className="camera-collapsible-body">
              <section className="camera-preview-card">
                <div className="camera-preview-head">
                  <strong>Live preview</strong>
                  <button type="button" className="camera-preview-fullscreen" onClick={togglePreviewFullscreen}>
                    {isPreviewFullscreen ? 'Exit full screen' : 'Full screen'}
                  </button>
                </div>
                <div className="camera-preview-stage" ref={previewShellRef}>
                  <video ref={previewRef} className="camera-sender-preview" autoPlay muted playsInline controls={false} />
                  <div className="camera-preview-overlay">
                    <div className="camera-preview-overlay-top">
                      <span className={`preview-live-pill ${isConnected ? 'active' : ''}`}>
                        {isConnected ? 'LIVE LINKED' : 'FRAMING'}
                      </span>
                      <span>TDTV remote camera preview</span>
                    </div>
                    <div className="camera-preview-overlay-lower-third">
                      <div className="overlay-player overlay-player--red">
                        <span>Red</span>
                        <strong>Player A</strong>
                      </div>
                      <span className="overlay-vs">VS</span>
                      <div className="overlay-player overlay-player--blue">
                        <span>Blue</span>
                        <strong>Player B</strong>
                      </div>
                    </div>
                  </div>
                </div>
                <p className="camera-preview-note">
                  Keep the cue ball, object balls, and player approach lanes visible. A slightly wider frame is safer than an aggressive crop.
                </p>
              </section>
            </div>
          ) : null}
        </section>

        <section className="camera-collapsible-card">
          <button type="button" className="camera-collapsible-head" onClick={() => toggleSection('connection')}>
            <div>
              <strong>Connection</strong>
              <span>Current link health and camera session state.</span>
            </div>
            <span className="camera-collapsible-chevron">{openSections.connection ? '▾' : '▸'}</span>
          </button>
          {openSections.connection ? (
            <div className="camera-collapsible-body">
              <div className="camera-connection-grid">
                <div className="camera-connection-tile">
                  <span>Host link</span>
                  <strong>{status}</strong>
                </div>
                <div className="camera-connection-tile">
                  <span>Network quality</span>
                  <strong>{connectionSummary.quality}</strong>
                </div>
                <div className="camera-connection-tile">
                  <span>Signal transport</span>
                  <strong>{transportLabel}</strong>
                </div>
                <div className="camera-connection-tile">
                  <span>Battery</span>
                  <strong>{formatBatteryLabel(batteryLevel, isCharging)}</strong>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="camera-collapsible-card" ref={advancedRef}>
          <button type="button" className="camera-collapsible-head" onClick={() => toggleSection('advanced')}>
            <div>
              <strong>Advanced / Troubleshooting</strong>
              <span>Diagnostics, compatibility, and exit actions.</span>
            </div>
            <span className="camera-collapsible-chevron">{openSections.advanced ? '▾' : '▸'}</span>
          </button>
          {openSections.advanced ? (
            <div className="camera-collapsible-body">
              <div className="camera-debug-card">
                <strong>Diagnostics</strong>
                <div className="camera-debug-grid">
                  <div>
                    <span>Transport</span>
                    <strong>{signalTransport ?? 'Waiting'}</strong>
                  </div>
                  <div>
                    <span>Supabase</span>
                    <strong>{pairDiagnostics.supabaseConfigured ? 'Configured' : 'Missing'}</strong>
                  </div>
                  <div>
                    <span>BroadcastChannel</span>
                    <strong>{pairDiagnostics.hasBroadcastChannel ? 'Supported' : 'Unavailable'}</strong>
                  </div>
                  <div>
                    <span>Signal key</span>
                    <strong>{pairDiagnostics.signalSessionKey}</strong>
                  </div>
                </div>
                {!pairDiagnostics.signalReady ? (
                  <small className="camera-debug-note">
                    {pairingAvailabilityError ??
                      'Remote camera pairing needs Supabase signaling or a compatible BroadcastChannel flow to exchange ICE and SDP offers.'}
                  </small>
                ) : null}
              </div>

              <div className="camera-advanced-actions">
                <button
                  type="button"
                  className="camera-advanced-action"
                  onClick={() => {
                    manualStopRef.current = false;
                    void connectCamera('manual');
                  }}
                  disabled={isConnecting}
                >
                  Retry camera link
                </button>
                <Link className="camera-advanced-link" to="/">
                  Return to Dashboard
                </Link>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <nav className="camera-bottom-nav" aria-label="Remote camera navigation">
        <button type="button" className="camera-bottom-nav-item active" onClick={() => scrollToSection(topRef.current)}>
          <strong>Camera</strong>
          <span>Live status</span>
        </button>
        <button type="button" className="camera-bottom-nav-item" onClick={() => scrollToSection(guideRef.current)}>
          <strong>Help</strong>
          <span>Setup guide</span>
        </button>
        <button type="button" className="camera-bottom-nav-item" onClick={() => scrollToSection(advancedRef.current)}>
          <strong>More</strong>
          <span>Advanced</span>
        </button>
      </nav>
    </section>
  );
}
