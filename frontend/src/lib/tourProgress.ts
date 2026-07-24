// tourProgress — per-browser tour completion/resume state (v1: localStorage).
//
// Schema-versioned so a future server-side migration (users.preferences JSONB)
// can import it cleanly. Multi-device-unsafe by design — on-demand tours never
// nag, so a fresh browser simply doesn't know about completion elsewhere, which
// is the intended v1 trade-off (see the plan's WS-E).
const SCHEMA_VERSION = 1 as const;
const KEY_PREFIX = 'tingting:tour:v2:';
const LEGACY_KEY_PREFIX = 'tingting:tour:v1:';

interface ProgressRecord {
  schema: 1;
  status: 'in_progress' | 'completed';
  currentStep: number;
  updatedAt: number;
  tourVersion: number;
}

function key(tourId: string, tourVersion: number): string {
  return `${KEY_PREFIX}${tourId}:${tourVersion}`;
}

function read(tourId: string, tourVersion: number): ProgressRecord | null {
  try {
    localStorage.removeItem(`${LEGACY_KEY_PREFIX}${tourId}`);
    const raw = localStorage.getItem(key(tourId, tourVersion));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProgressRecord>;
    if (parsed.schema !== SCHEMA_VERSION || parsed.tourVersion !== tourVersion) return null;
    if (parsed.status !== 'in_progress' && parsed.status !== 'completed') return null;
    return {
      schema: 1,
      status: parsed.status,
      currentStep: typeof parsed.currentStep === 'number' ? parsed.currentStep : 0,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      tourVersion,
    };
  } catch {
    return null;
  }
}

function write(tourId: string, record: ProgressRecord): void {
  try {
    localStorage.setItem(key(tourId, record.tourVersion), JSON.stringify(record));
  } catch {
    // localStorage may be unavailable (private mode) — progress is best-effort.
  }
}

export function isTourCompleted(tourId: string, tourVersion: number): boolean {
  return read(tourId, tourVersion)?.status === 'completed';
}

/**
 * Last-updated timestamp (epoch ms) of the cached record, or 0 if none.
 * Phase 4 reconcile compares this against the server's `updatedAt` to pick the
 * freshest side on tour start (server wins on tie / clock skew, since the
 * server timestamp is authoritative).
 */
export function getUpdatedAt(tourId: string, tourVersion: number): number {
  return read(tourId, tourVersion)?.updatedAt ?? 0;
}

/** Step index of an in-progress tour, or null when none/already completed. */
export function getInProgressStep(tourId: string, tourVersion: number): number | null {
  const rec = read(tourId, tourVersion);
  return rec?.status === 'in_progress' ? rec.currentStep : null;
}

export function markTourStep(tourId: string, tourVersion: number, currentStep: number): void {
  write(tourId, { schema: 1, status: 'in_progress', currentStep, updatedAt: Date.now(), tourVersion });
}

export function markTourCompleted(tourId: string, tourVersion: number): void {
  write(tourId, { schema: 1, status: 'completed', currentStep: 0, updatedAt: Date.now(), tourVersion });
}

export function clearTourProgress(tourId: string, tourVersion: number): void {
  try {
    localStorage.removeItem(key(tourId, tourVersion));
  } catch {
    // ignore
  }
}
