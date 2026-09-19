import { describe, expect, it } from 'vitest';
import {
  createBroadcastPublicationOverlayConfig,
  createDefaultBroadcastRuntimeConfig,
  getBroadcastOverlayFrames,
  type BroadcastPublication
} from './broadcast';

function buildPublication(overrides: Partial<BroadcastPublication> = {}): BroadcastPublication {
  return {
    channelId: 'channel-101',
    channelNumber: '101',
    channelName: 'Parlor Room',
    tournamentId: 'tournament-1',
    tournamentName: 'Video test - navigation',
    status: 'LIVE',
    now: 'Video test - navigation',
    next: 'Round 1',
    venue: 'Parlor Room',
    location: 'Parlor Room',
    format: 'Double Elimination',
    round: 'Featured Table',
    players: [
      { id: 'player-1', name: 'Player 1', score: 4 },
      { id: 'player-2', name: 'Player 2', score: 3 }
    ],
    cameraId: 'camera-1',
    cameraName: 'Main Camera',
    cameraType: 'USB',
    streamUrl: 'https://example.com/live.m3u8',
    tableNumber: 1,
    updatedAt: '2026-09-18T22:00:00.000Z',
    ...overrides
  };
}

describe('broadcast overlays', () => {
  it('builds timed overlay frames from pro+ publication settings', () => {
    const config = createDefaultBroadcastRuntimeConfig();
    config.raceTrackingEnabled = true;
    const publication = buildPublication({
      overlayConfig: createBroadcastPublicationOverlayConfig(config, 'PRO_PLUS')
    });

    const frames = getBroadcastOverlayFrames(publication);

    expect(frames.map((frame) => frame.kind)).toEqual(['LEADERBOARD', 'RACE', 'SPONSOR', 'SPONSOR']);
    expect(frames[0]?.title).toBe('Video test - navigation');
    expect(frames[1]?.showScores).toBe(true);
  });

  it('removes sponsor rotations when auto-rotation is disabled', () => {
    const config = createDefaultBroadcastRuntimeConfig();
    config.autoRotateSponsors = false;
    const publication = buildPublication({
      overlayConfig: createBroadcastPublicationOverlayConfig(config, 'PRO_PLUS')
    });

    const frames = getBroadcastOverlayFrames(publication);

    expect(frames.map((frame) => frame.kind)).toEqual(['LEADERBOARD', 'RACE']);
  });

  it('filters advanced sponsor slots for pro local-broadcast tiers', () => {
    const config = createDefaultBroadcastRuntimeConfig();
    const publication = buildPublication({
      overlayConfig: createBroadcastPublicationOverlayConfig(config, 'PRO')
    });

    const frames = getBroadcastOverlayFrames(publication);

    expect(frames.map((frame) => frame.kind)).toEqual(['LEADERBOARD', 'RACE']);
  });

  it('falls back to the legacy lower-third when no overlay snapshot exists', () => {
    const frames = getBroadcastOverlayFrames(buildPublication({ overlayConfig: undefined }));

    expect(frames).toHaveLength(1);
    expect(frames[0]?.kind).toBe('DEFAULT');
    expect(frames[0]?.subtitle).toBe('Parlor Room • Parlor Room');
  });
});
