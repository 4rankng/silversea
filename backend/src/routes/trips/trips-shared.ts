/**
 * Shared helpers for the trips route leaves. Split verbatim from the old
 * single-file routes/trips.ts; leaves import from here so request-shape
 * helpers stay single-sourced.
 */
import { z } from 'zod';
import { TRIP_LIST_SORT_KEYS } from '../../services/trip-queries.service';
import { ApiError } from '../../errors';

export function getExpectedVersion(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const value = (body as Record<string, unknown>).expectedVersion;
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new ApiError(400, 'Phiên bản chuyến đi không hợp lệ');
  }
  return value as number;
}

export function getRequiredGovernanceReason(body: unknown): string {
  const value = body && typeof body === 'object'
    ? (body as Record<string, unknown>).governanceReason
      ?? (body as Record<string, unknown>).reason
    : undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, 'Lý do điều chỉnh là bắt buộc');
  }
  return value.trim();
}

// Sort params for the trips list — optional; absent params keep the default
// departureDate-desc order. Keys must match TRIP_LIST_SORT_SQL in
// trip-queries.service.ts (the server-side whitelist).
export const tripListSortQuerySchema = z.object({
  sortBy: z.enum(TRIP_LIST_SORT_KEYS).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

// Report-cache invalidation lives in lib/report-cache.ts (single key registry);
// route leaves import it directly from there.
