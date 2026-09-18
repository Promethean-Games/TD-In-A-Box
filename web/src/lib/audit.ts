export interface AuditEntry {
  id: string;
  administrator: string;
  action: string;
  entity: string;
  previousValue: string | null;
  newValue: string | null;
  timestamp: string;
}

const AUDIT_LOG_KEY = 'tdiab_admin_audit_log';

function normalizeAuditEntry(value: Partial<AuditEntry> | null | undefined): AuditEntry | null {
  if (!value || typeof value.action !== 'string' || typeof value.entity !== 'string') {
    return null;
  }

  return {
    id: typeof value.id === 'string' && value.id.length > 0 ? value.id : `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    administrator: typeof value.administrator === 'string' ? value.administrator : 'System',
    action: value.action,
    entity: value.entity,
    previousValue: typeof value.previousValue === 'string' ? value.previousValue : null,
    newValue: typeof value.newValue === 'string' ? value.newValue : null,
    timestamp: typeof value.timestamp === 'string' && value.timestamp.length > 0 ? value.timestamp : new Date().toISOString()
  };
}

export function getAuditLogEntries(): AuditEntry[] {
  if (typeof window === 'undefined') return [];

  const raw = window.localStorage.getItem(AUDIT_LOG_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((entry) => normalizeAuditEntry(entry as Partial<AuditEntry>))
      .filter((entry): entry is AuditEntry => entry !== null)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  } catch {
    return [];
  }
}

export function recordAuditAction(input: {
  administrator: string;
  action: string;
  entity: string;
  previousValue?: string | null;
  newValue?: string | null;
}): AuditEntry {
  const entry: AuditEntry = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    administrator: input.administrator,
    action: input.action,
    entity: input.entity,
    previousValue: input.previousValue ?? null,
    newValue: input.newValue ?? null,
    timestamp: new Date().toISOString()
  };

  if (typeof window !== 'undefined') {
    const entries = getAuditLogEntries();
    const nextEntries = [entry, ...entries].slice(0, 50);
    window.localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(nextEntries));
  }

  return entry;
}

export function getEntityAuditEntries(entityName: string): AuditEntry[] {
  const needle = entityName.trim().toLowerCase();
  if (!needle) return [];
  return getAuditLogEntries().filter((entry) => {
    return entry.entity.toLowerCase().includes(needle) || entry.action.toLowerCase().includes(needle);
  });
}
