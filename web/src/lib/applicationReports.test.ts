import { describe, expect, it } from 'vitest';
import {
  formatApplicationReportTimestamp,
  getApplicationReportInstanceKey,
  getApplicationReportInstanceLabel,
  normalizeApplicationReport
} from './applicationReports';

describe('application reports', () => {
  it('keeps missing report timestamps stable instead of stamping them with the current time', () => {
    const normalized = normalizeApplicationReport({ id: 'report-1' });

    expect(normalized.occurred_at).toBe('');
  });

  it('formats valid report timestamps and falls back for invalid ones', () => {
    expect(formatApplicationReportTimestamp('2026-09-20T12:00:00.000Z')).toContain('2026');
    expect(formatApplicationReportTimestamp('')).toBe('Unknown');
  });

  it('extracts a pairing run tag from host and sender reports', () => {
    expect(
      getApplicationReportInstanceKey({
        source: 'web-host-connection',
        file_path: 'host:KQRVKG',
        stack_trace: 'stage=offer-sent; pairCode=KQRVKG; detail=Host offer sent to sender.'
      })
    ).toBe('pair:KQRVKG');
    expect(
      getApplicationReportInstanceLabel({
        source: 'android-connection',
        file_path: '/tmp/crash.json',
        stack_trace: 'stage=ready-sent; pairCode=KQRVKG; detail=Ready signal sent; waiting for host offer.'
      })
    ).toBe('Run KQRVKG');
  });
});
