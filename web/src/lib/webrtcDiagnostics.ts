export type IceCandidateType = 'host' | 'srflx' | 'relay' | 'prflx' | 'unknown';

function readCandidateLine(candidate: RTCIceCandidate | RTCIceCandidateInit | null | undefined): string {
  if (!candidate) return '';
  return typeof candidate.candidate === 'string' ? candidate.candidate : '';
}

export function getIceCandidateType(candidate: RTCIceCandidate | RTCIceCandidateInit | null | undefined): IceCandidateType {
  const line = readCandidateLine(candidate);
  const match = /\btyp\s+([a-z0-9]+)/i.exec(line);
  const candidateType = match?.[1]?.toLowerCase();
  switch (candidateType) {
    case 'host':
    case 'srflx':
    case 'relay':
    case 'prflx':
      return candidateType;
    default:
      return 'unknown';
  }
}

function getIceCandidateProtocol(candidate: RTCIceCandidate | RTCIceCandidateInit | null | undefined): string {
  const line = readCandidateLine(candidate);
  const match = /^candidate:[^\s]+\s+\d+\s+([a-z0-9]+)/i.exec(line);
  return match?.[1]?.toLowerCase() ?? 'unknown';
}

export function describeIceCandidate(candidate: RTCIceCandidate | RTCIceCandidateInit | null | undefined): string {
  const candidateType = getIceCandidateType(candidate);
  const protocol = getIceCandidateProtocol(candidate);
  return `candidateType=${candidateType}; protocol=${protocol}; relay=${candidateType === 'relay'}`;
}

function readCandidateTypeFromStats(report: RTCStats | undefined): string {
  if (!report) return 'unknown';
  const candidateType = (report as RTCStats & Record<string, unknown>).candidateType;
  return typeof candidateType === 'string' ? candidateType : 'unknown';
}

function readProtocolFromStats(report: RTCStats | undefined): string {
  if (!report) return 'unknown';
  const protocol = (report as RTCStats & Record<string, unknown>).protocol;
  return typeof protocol === 'string' ? protocol : 'unknown';
}

export async function describeSelectedCandidatePair(peer: RTCPeerConnection): Promise<string | null> {
  const stats = await peer.getStats();
  const reportsById = new Map<string, RTCStats>();
  stats.forEach((report) => {
    reportsById.set(report.id, report);
  });

  let selectedPair: RTCStats | null = null;
  stats.forEach((report) => {
    if (selectedPair) return;
    if (report.type !== 'transport') return;
    const pairId = (report as RTCStats & Record<string, unknown>).selectedCandidatePairId;
    if (typeof pairId === 'string') {
      selectedPair = reportsById.get(pairId) ?? null;
    }
  });

  if (!selectedPair) {
    stats.forEach((report) => {
      if (selectedPair) return;
      if (report.type !== 'candidate-pair') return;
      const candidatePair = report as RTCStats & Record<string, unknown>;
      if (candidatePair.state === 'succeeded' && candidatePair.nominated === true) {
        selectedPair = report;
      }
    });
  }

  if (!selectedPair) {
    return null;
  }

  const pairRecord = selectedPair as RTCStats & Record<string, unknown>;
  const localCandidateId = typeof pairRecord.localCandidateId === 'string' ? pairRecord.localCandidateId : null;
  const remoteCandidateId = typeof pairRecord.remoteCandidateId === 'string' ? pairRecord.remoteCandidateId : null;
  const localCandidate = localCandidateId ? reportsById.get(localCandidateId) : undefined;
  const remoteCandidate = remoteCandidateId ? reportsById.get(remoteCandidateId) : undefined;
  const localType = readCandidateTypeFromStats(localCandidate);
  const remoteType = readCandidateTypeFromStats(remoteCandidate);
  const protocol = readProtocolFromStats(localCandidate);
  const relaySelected = localType === 'relay' || remoteType === 'relay';
  const pairState = typeof pairRecord.state === 'string' ? pairRecord.state : 'unknown';

  return `selectedPair local=${localType}; remote=${remoteType}; protocol=${protocol}; state=${pairState}; relay=${relaySelected}`;
}
