import { describe, expect, it } from 'vitest';
import {
  formatApplicationReportTimestamp,
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
});
