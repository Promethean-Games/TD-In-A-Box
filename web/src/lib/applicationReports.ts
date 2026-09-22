import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export interface ApplicationReport {
  id: string;
  occurred_at: string;
  source: string;
  severity: string;
  title: string;
  summary: string;
  exception_class: string;
  message: string | null;
  stack_trace: string;
  thread_name: string;
  package_name: string;
  app_name: string;
  version_name: string;
  version_code: number;
  build_type: string;
  device_model: string;
  device_manufacturer: string;
  android_version: string;
  sdk_int: number;
  file_path: string;
  upload_status: string;
}

const APPLICATION_REPORTS_KEY = 'tdiab_application_reports';
const REPORT_QUERY_LIMIT = 500;
const MAX_STORED_REPORTS = 10000;

export function formatApplicationReportTimestamp(occurredAt: string): string {
  const parsed = new Date(occurredAt);
  return Number.isNaN(parsed.getTime()) ? 'Unknown' : parsed.toLocaleString();
}

export function getApplicationReportInstanceKey(report: Pick<ApplicationReport, 'source' | 'file_path' | 'stack_trace'>): string {
  const blob = `${report.file_path}\n${report.stack_trace}\n${report.source}`;
  const pairCodeMatch =
    blob.match(/pairCode=([A-Z0-9]+)/i) ??
    blob.match(/host:([A-Z0-9]+)/i) ??
    blob.match(/pair:([A-Z0-9]+)/i);

  if (pairCodeMatch?.[1]) {
    return `pair:${pairCodeMatch[1].toUpperCase()}`;
  }

  if (report.source.toLowerCase().includes('connection')) {
    return `connection:${report.source}`;
  }

  return `report:${report.source}`;
}

export function getApplicationReportInstanceLabel(report: Pick<ApplicationReport, 'source' | 'file_path' | 'stack_trace'>): string {
  const key = getApplicationReportInstanceKey(report);
  if (key.startsWith('pair:')) {
    return `Run ${key.slice(5)}`;
  }
  if (report.source.toLowerCase().includes('connection')) {
    return 'Unpaired connection report';
  }
  return 'Crash report';
}

export function normalizeApplicationReport(
  report: Partial<ApplicationReport> & Record<string, unknown>,
  occurredAtFallback = ''
): ApplicationReport {
  const fallbackId = globalThis.crypto?.randomUUID?.() ?? `report-${Date.now()}`;
  return {
    id: String(report.id ?? fallbackId),
    occurred_at:
      typeof report.occurred_at === 'string' && report.occurred_at.trim().length > 0
        ? report.occurred_at
        : occurredAtFallback,
    source: String(report.source ?? 'android'),
    severity: String(report.severity ?? 'FATAL'),
    title: String(report.title ?? 'Unhandled exception'),
    summary: String(report.summary ?? 'Crash report received'),
    exception_class: String(report.exception_class ?? 'UnknownException'),
    message: typeof report.message === 'string' ? report.message : null,
    stack_trace: String(report.stack_trace ?? ''),
    thread_name: String(report.thread_name ?? 'main'),
    package_name: String(report.package_name ?? 'com.promethean.tdiab'),
    app_name: String(report.app_name ?? 'TD in a Box'),
    version_name: String(report.version_name ?? 'unknown'),
    version_code: Number(report.version_code ?? 0),
    build_type: String(report.build_type ?? 'debug'),
    device_model: String(report.device_model ?? 'unknown'),
    device_manufacturer: String(report.device_manufacturer ?? 'unknown'),
    android_version: String(report.android_version ?? 'unknown'),
    sdk_int: Number(report.sdk_int ?? 0),
    file_path: String(report.file_path ?? ''),
    upload_status: String(report.upload_status ?? 'pending')
  };
}

function readStoredApplicationReports(): ApplicationReport[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const raw = window.localStorage.getItem(APPLICATION_REPORTS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>[];
    return Array.isArray(parsed) ? parsed.map((report) => normalizeApplicationReport(report)) : [];
  } catch {
    return [];
  }
}

export function readCachedApplicationReports(): ApplicationReport[] {
  return readStoredApplicationReports();
}

export async function listApplicationReports(): Promise<ApplicationReport[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from('application_reports')
      .select('id,occurred_at,source,severity,title,summary,exception_class,message,stack_trace,thread_name,package_name,app_name,version_name,version_code,build_type,device_model,device_manufacturer,android_version,sdk_int,file_path,upload_status')
      .order('occurred_at', { ascending: false })
      .limit(REPORT_QUERY_LIMIT);

    if (error) {
      const detailSuffix = error.details ? ` (${error.details})` : '';
      throw new Error(`Supabase reports query failed: ${error.message}${detailSuffix}`);
    }

    return (data ?? []).map((report) => normalizeApplicationReport(report as Record<string, unknown>));
  }

  if (typeof window === 'undefined') {
    return [];
  }

  return readStoredApplicationReports();
}

export function persistApplicationReports(reports: ApplicationReport[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(APPLICATION_REPORTS_KEY, JSON.stringify(reports));
}

export async function createApplicationReport(
  report: Partial<ApplicationReport> & Record<string, unknown>
): Promise<void> {
  const occurredAt =
    typeof report.occurred_at === 'string' && report.occurred_at.trim().length > 0
      ? report.occurred_at
      : new Date().toISOString();
  const normalized = normalizeApplicationReport(report, occurredAt);

  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase
      .from('application_reports')
      .insert([normalized]);

    if (!error) {
      return;
    }
  }

  if (typeof window === 'undefined') {
    return;
  }

  const raw = window.localStorage.getItem(APPLICATION_REPORTS_KEY);
  const existing = (() => {
    if (!raw) return [] as ApplicationReport[];
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>[];
      return Array.isArray(parsed) ? parsed.map((entry) => normalizeApplicationReport(entry)) : [];
    } catch {
      return [] as ApplicationReport[];
    }
  })();
  persistApplicationReports([normalized, ...existing].slice(0, MAX_STORED_REPORTS));
}
