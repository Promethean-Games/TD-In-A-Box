import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  createPairSignalClient,
  DEFAULT_ICE_SERVERS,
  type PairSignalClient,
  type PairSignalMessage
} from '@/lib/webrtcPairing';
import './CameraSender.css';

export default function CameraSender() {
  const { pairCode = '' } = useParams<{ pairCode: string }>();
  const normalizedPairCode = useMemo(() => pairCode.trim().toUpperCase(), [pairCode]);
  const [status, setStatus] = useState('Waiting to connect');
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [signalTransport, setSignalTransport] = useState<'supabase' | 'broadcast-channel' | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const signalClientRef = useRef<PairSignalClient | null>(null);

  const stopSession = async () => {
    const signalClient = signalClientRef.current;
    if (signalClient) {
      await signalClient.send({ type: 'stop', from: 'sender', ts: Date.now() });
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
    setIsConnected(false);
    setStatus('Disconnected');
  };

  useEffect(() => {
    return () => {
      void stopSession();
    };
  }, []);

  const handleSignalMessage = async (message: PairSignalMessage) => {
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
        return;
      }
      if (message.type === 'ice' && message.payload) {
        await peer.addIceCandidate(message.payload as RTCIceCandidateInit);
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
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser does not support camera capture.');
      return;
    }

    setIsConnecting(true);
    setError(null);
    setStatus('Opening camera...');
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

      await signalClient.send({ type: 'ready', from: 'sender', ts: Date.now() });
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

      {error ? (
        <p className="camera-sender-error" role="alert">
          {error}
        </p>
      ) : null}

      <video ref={previewRef} className="camera-sender-preview" autoPlay muted playsInline controls />
    </section>
  );
}
