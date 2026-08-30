/**
 * Shared helpers for the trips route leaves. Split verbatim from the old
 * single-file routes/trips.ts; leaves import from here so request-shape
 * helpers stay single-sourced.
 */
import { z } from 'zod';
import { TRIP_LIST_SORT_KEYS } from '../../services/trip-queries.service';
import { cacheInvalidate, cacheInvalidatePattern } from '../../lib/redis';
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
    throw new ApiError(400, 'Lý do đề nghị kiểm tra và phê duyệt là bắt buộc');
  }
  return value.trim();
}

export const tripExpenseDecisionRequestSchema = z.object({
  reason: z.string().trim().min(1, 'Lý do xử lý chi phí là bắt buộc').max(1000),
  expectedVersion: z.number().int().positive('Phiên bản chi phí không hợp lệ'),
  evidence: z.object({
    reviewNote: z.string().trim().min(1, 'Căn cứ kiểm tra chi phí là bắt buộc').max(1000),
    attachmentRefs: z.array(z.string().trim().min(1).max(255)).max(20).default([]),
  }),
});

// Sort params for the trips list — optional; absent params keep the default
// departureDate-desc order. Keys must match TRIP_LIST_SORT_SQL in
// trip-queries.service.ts (the server-side whitelist).
export const tripListSortQuerySchema = z.object({
  sortBy: z.enum(TRIP_LIST_SORT_KEYS).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

export async function invalidateReportCaches(invalidatePnl?: boolean) {
  await Promise.all([
    cacheInvalidate('reports:dashboard'),
    cacheInvalidate('reports:dashboard:executive'),
    cacheInvalidatePattern('reports:entity-results:*'),   // trip writes change AR/AP aging
    cacheInvalidatePattern('reports:total-ar:*'),         // trip revenue posts CUSTOMER ledger rows
    cacheInvalidatePattern('reports:fuel-variance:*'),    // trip writes change fuel variance
    invalidatePnl ? cacheInvalidatePattern('reports:pnl:*') : Promise.resolve(),
  ]).catch(() => {});
}
