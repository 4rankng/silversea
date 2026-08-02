/**
 * Audit event registry — routes register their events explicitly
 * instead of the middleware guessing from URL patterns.
 *
 * Two registration modes:
 *   1. Exact:  registerAuditEvent('POST', '/api/trips', TRIP_CREATED)
 *              → matches only POST /api/trips
 *   2. Suffix: registerAuditEvent('POST', '/api/trips/', '/complete', TRIP_COMPLETED)
 *              → matches POST /api/trips/:id/complete (any sub-path ending in /complete)
 *
 * Falls back to generic ENTITY_CREATED/UPDATED/DELETED if no match.
 */
import type { AuditEventType } from './audit-types';

type Method = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Registration {
  event: AuditEventType;
  /** If set, match only paths whose last segment equals this suffix (e.g. '/lock'). */
  suffix?: string;
  /** Base path prefix for suffix matching. */
  prefix?: string;
}

const exactRegistry = new Map<string, AuditEventType>();
const suffixRegistry: Registration[] = [];

function exactKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/**
 * Register an audit event.
 * - Two args (method, path, event): exact match on full path.
 * - Four args (method, prefix, suffix, event): match paths starting with prefix
 *   and ending with the given suffix segment (e.g. '/lock' matches /api/trips/42/lock).
 */
export function registerAuditEvent(
  method: Method,
  pathOrPrefix: string,
  eventOrSuffix: AuditEventType | string,
  event?: AuditEventType,
): void {
  if (event !== undefined) {
    // Suffix mode: registerAuditEvent('POST', '/api/trips/', '/complete', TRIP_COMPLETED)
    suffixRegistry.push({
      event: event,
      prefix: `${method.toUpperCase()} ${pathOrPrefix}`,
      suffix: eventOrSuffix as string,
    });
  } else {
    // Exact mode: registerAuditEvent('POST', '/api/trips', TRIP_CREATED)
    exactRegistry.set(exactKey(method, pathOrPrefix), eventOrSuffix as AuditEventType);
  }
}

/**
 * Look up the registered audit event for a method + path.
 */
export function resolveAuditEvent(method: string, rawPath: string): AuditEventType {
  const methodKey = method.toUpperCase();
  // Normalize a trailing slash so `POST /api/shipments/` resolves the same
  // exact-match registration as `POST /api/shipments`. Without this, every
  // exact-match audit registration (POST /api/trips, POST /api/shipments,
  // …) silently fell through to the generic ENTITY_* fallback whenever the
  // client added a trailing slash — producing misleading audit messages.
  // Keep the root path `/` intact (do not turn it into an empty string).
  const path = rawPath.length > 1 && rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;

  // Custom overrides for trip expenses approve/reject
  if (methodKey === 'POST' && path.includes('/expenses/') && path.endsWith('/approve')) {
    return 'TRIP_EXPENSE_APPROVED' as AuditEventType;
  }
  if (methodKey === 'POST' && path.includes('/expenses/') && path.endsWith('/reject')) {
    return 'TRIP_EXPENSE_REJECTED' as AuditEventType;
  }

  // 1. Try exact match
  const exact = exactRegistry.get(exactKey(method, path));
  if (exact) return exact;

  // 2. Try suffix matches (most specific first)
  let bestMatch: { event: AuditEventType; suffixLength: number } | null = null;
  for (const reg of suffixRegistry) {
    if (!path.startsWith(reg.prefix!.slice(methodKey.length + 1))) continue;
    if (reg.suffix && !path.endsWith(reg.suffix)) continue;
    const suffixLength = reg.suffix ? reg.suffix.length : 0;
    if (!bestMatch || suffixLength > bestMatch.suffixLength) {
      bestMatch = { event: reg.event, suffixLength };
    }
  }
  if (bestMatch) return bestMatch.event;

  // 3. Generic fallback
  if (method === 'POST') return 'ENTITY_CREATED' as AuditEventType;
  if (method === 'PUT' || method === 'PATCH') return 'ENTITY_UPDATED' as AuditEventType;
  if (method === 'DELETE') return 'ENTITY_DELETED' as AuditEventType;
  return 'ENTITY_UPDATED' as AuditEventType;
}
