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
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

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

  const stopSession = async () => {
    const signalClient = signalClientRef.current;
    if (signalClient) {
      try {
        await signalClient.send({ type: 'stop', from: 'sender', ts: Date.now() });
      } catch {
        // ignore teardown signal errors while closing the session
      }
      signalClient.close();
      signalClientRef.current = null;
    }
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
    setStatus('Disconnected');
  };

  useEffect(() => {
    return () => {
      void stopSession();
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
        await stopSession();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process host signal.');
    }
  };

  const connectCamera = async () => {
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

    setIsConnecting(true);
    setError(null);
    setStatus('Opening camera...');
    console.debug('[camera-sender] start connect', { pairCode: normalizedPairCode, diagnostics: pairDiagnostics });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 60 }
        },
        audio: false
      });
      streamRef.current = stream;
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        try {
          await previewRef.current.play();
        } catch {
          // autoplay can be blocked by browser policy
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
          setStatus('Live connection established');
        } else if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
          setStatus(`Connection ${peer.connectionState}`);
        }
      };
      peer.onnegotiationneeded = () => {
        // wait for host to send the offer; sender completes negotiation when it arrives
      };

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
          <button type="button" className="btn-primary" onClick={connectCamera} disabled={isConnecting}>
            {isConnecting ? 'Connecting...' : 'Connect Camera'}
          </button>
        ) : (
          <button type="button" className="btn-secondary" onClick={() => void stopSession()}>
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

      <video ref={previewRef} className="camera-sender-preview" autoPlay muted playsInline controls />
    </section>
  );
}
