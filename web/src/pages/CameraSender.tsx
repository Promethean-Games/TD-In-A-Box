import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  createPairSignalClient,
  DEFAULT_ICE_SERVERS,
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

export default function CameraSender() {
  const { pairCode = '' } = useParams<{ pairCode: string }>();
  const normalizedPairCode = useMemo(() => pairCode.trim().toUpperCase(), [pairCode]);
  const [status, setStatus] = useState('Waiting to connect');
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [signalTransport, setSignalTransport] = useState<'supabase' | 'broadcast-channel' | null>(null);
  const pairDiagnostics = useMemo(
    () => getPairSignalDiagnostics(normalizedPairCode || 'pending'),
    [normalizedPairCode]
  );
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const signalClientRef = useRef<PairSignalClient | null>(null);
  const previewShellRef = useRef<HTMLDivElement | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const manualStopRef = useRef(false);
  const hasActivatedSessionRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const isConnectingRef = useRef(false);
  const isConnectedRef = useRef(false);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const stopSessionRef = useRef<(notifyHost?: boolean) => Promise<void>>(async () => undefined);
  const connectCameraRef = useRef<(mode?: 'manual' | 'auto') => Promise<void>>(async () => undefined);
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);

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
        await signalClient.send({ type: 'stop', from: 'sender', ts: Date.now() });
      } catch {
        // ignore teardown signal errors while closing the session
      }
    }
    signalClient?.close();
    signalClientRef.current = null;
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
    return () => {
      clearReconnectTimer();
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
    console.debug('[camera-sender] signal message received', message);
    if (message.from !== 'host') return;
    const peer = peerRef.current;
    const signalClient = signalClientRef.current;
    if (!peer || !signalClient) return;
    try {
      if (message.type === 'offer') {
        const offer = message.payload as RTCSessionDescriptionInit;
        if (peer.signalingState !== 'stable' || peer.remoteDescription) {
          return;
        }
        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        await signalClient.send({ type: 'answer', from: 'sender', payload: answer, ts: Date.now() });
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
    if (!normalizedPairCode) {
      setError('Missing pair code in URL.');
      return;
    }
    if (!isSupabaseConfigured) {
      const pairingError = getPairingAvailabilityError();
      setError(pairingError ?? 'Remote camera pairing requires Supabase realtime signaling.');
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
    console.debug('[camera-sender] start connect', { pairCode: normalizedPairCode, diagnostics: pairDiagnostics });
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

      const signalClient = await createPairSignalClient(normalizedPairCode, handleSignalMessage);
      signalClientRef.current = signalClient;
      setSignalTransport(signalClient.transport);
      console.debug('[camera-sender] signaling transport ready', signalClient.transport, pairDiagnostics);

      const peer = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });
      peerRef.current = peer;
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      peer.onicecandidate = (event) => {
        if (!event.candidate || !signalClientRef.current) return;
        void signalClientRef.current.send({
          type: 'ice',
          from: 'sender',
          payload: event.candidate.toJSON(),
          ts: Date.now()
        });
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') {
          setIsConnected(true);
          isConnectedRef.current = true;
          setStatus('Live connection established');
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
          await signalClient.send({ type: 'ready', from: 'sender', ts: Date.now() });
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
    <section className="camera-sender-page">
      <header className="camera-sender-header">
        <p className="camera-sender-eyebrow">TDTV Remote Camera</p>
        <h1>Pair Code: {normalizedPairCode || 'Missing'}</h1>
        <p>Use this phone as a wireless table camera for the active tournament broadcast.</p>
      </header>

      <div className="camera-sender-actions">
        {!isConnected ? (
          <button type="button" className="btn-primary" onClick={() => void connectCamera('manual')} disabled={isConnecting}>
            {isConnecting ? 'Connecting...' : 'Connect Camera'}
          </button>
        ) : (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              manualStopRef.current = true;
              void stopSession();
            }}
          >
            Stop Camera Feed
          </button>
        )}
        <Link className="btn-link" to="/">
          Return to Dashboard
        </Link>
      </div>

      <div className="camera-sender-status" role="status" aria-live="polite">
        <strong>Status:</strong> {status}
        {signalTransport ? <span> via {signalTransport === 'supabase' ? 'Supabase signaling' : 'Local signaling'}</span> : null}
      </div>

      <div className="camera-sender-debug">
        <strong>Debug info</strong>
        <div className="camera-sender-debug-grid">
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
          <small className="camera-sender-status-note">
            Remote camera pairing needs Supabase signaling or a browser BroadcastChannel to exchange ICE and SDP offers.
          </small>
        ) : null}
      </div>

      {error ? (
        <p className="camera-sender-error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="camera-preview-card">
        <div className="camera-preview-head">
          <strong>Camera + overlay preview</strong>
          <button type="button" className="btn-secondary camera-preview-fullscreen" onClick={togglePreviewFullscreen}>
            {isPreviewFullscreen ? 'Exit Full Screen' : 'Full Screen Preview'}
          </button>
        </div>
        <div className="camera-preview-stage" ref={previewShellRef}>
          <video ref={previewRef} className="camera-sender-preview" autoPlay muted playsInline controls />
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
          Frame this view so player names and race overlays stay readable before the TD goes live.
        </p>
      </section>
    </section>
  );
}
