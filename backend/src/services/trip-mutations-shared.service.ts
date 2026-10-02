// Pure trip-mutation rules shared across the create / figure-update /
// lifecycle-ops leaves: commission guard, committed-legacy fuel freeze,
// revenue-resolution contract, and copy builders. Extracted from
// trip-mutations.service.ts verbatim (pure code movement).
import * as s from '../db/schema';
import { TripStatus } from '@tingting/shared';
import { ApiError } from '../errors';
import type { TripCompositeRow } from './trip-composite.service';

export function assertCustomerCommissionWithinRevenue(
  revenueInclVat: number,
  vatRate: number,
  customerCommission: number,
): void {
  const freightExVat = vatRate > 0
    ? Math.round(revenueInclVat / (1 + vatRate))
    : revenueInclVat;
  if (customerCommission > freightExVat) {
    throw new ApiError(
      400,
      'Hoa hồng khách hàng không được lớn hơn doanh thu chưa VAT',
    );
  }
}
export { applyCommittedLegacyFuelFreeze } from '@tingting/shared';
export type { CommittedLegacyFuelInput } from '@tingting/shared';

// ─── Revenue resolution (pure, unit-tested) ────────────────────────────────

/** Revenue fields a trip-figures update may carry. The signaling contract is
 *  load-bearing: `undefined` means "not provided / leave stored alone", `0`
 *  means "explicit zero". The frontend must send `undefined` (never `0`) for
 *  untouched split fields — otherwise every save zeroes stored revenue
 *  (feedback202606 A3 §9; see tests/revenue-persistence). */
export interface RevenueUpdateInput {
  revenue?: number;
  revenueEmptyReturn?: number;
  revenueCombine?: number;
  /** M2.1: mandatory reason when overriding an auto-computed (TIER/TABLE) revenue. */
  revenueOverrideReason?: string;
}

/** Stored trip revenue fields (drizzle numeric columns → string | null). */
export interface StoredRevenue {
  revenue?: string | number | null;
  revenueEmptyReturn?: string | number | null;
  revenueCombine?: string | number | null;
}

/**
 * Resolve the persisted trip `revenue` from a figures update. Revenue is
 * split-based in the UI (empty-return leg + combined-load leg); the `revenue`
 * field itself is derived. Rules:
 *   - any split provided  → sum(provided splits; unprovided use stored value)
 *   - else direct revenue → use it (non-UI callers)
 *   - else                → preserve stored revenue (nothing changed)
 * `undefined` = not-provided throughout; `0` is an explicit zero. Pure so the
 * contract is unit-testable.
 */
export function resolveRevenue(data: RevenueUpdateInput, stored: StoredRevenue): number {
  const splitProvided = data.revenueEmptyReturn !== undefined || data.revenueCombine !== undefined;
  if (splitProvided) {
    const emptyReturn = data.revenueEmptyReturn !== undefined
      ? data.revenueEmptyReturn
      : Number(stored.revenueEmptyReturn || 0);
    const combine = data.revenueCombine !== undefined
      ? data.revenueCombine
      : Number(stored.revenueCombine || 0);
    return emptyReturn + combine;
  }
  if (data.revenue !== undefined) return data.revenue;
  return Number(stored.revenue || 0);
}

/**
 * Whether this update should stamp the revenue-override audit fields
 * (`revenueOriginal` / `revenueOverriddenBy` / `revenueOverriddenAt`). Fires
 * only when a provided revenue value actually differs from stored — sending
 * `undefined` (untouched) never fires. Pure for testability.
 */
export function shouldMarkRevenueOverride(data: RevenueUpdateInput, stored: StoredRevenue): boolean {
  return (
    (data.revenue !== undefined && data.revenue !== Number(stored.revenue || 0)) ||
    (data.revenueEmptyReturn !== undefined && data.revenueEmptyReturn !== Number(stored.revenueEmptyReturn || 0)) ||
    (data.revenueCombine !== undefined && data.revenueCombine !== Number(stored.revenueCombine || 0))
  );
}
type TripLegRow = typeof s.tripLegs.$inferSelect;

// Identity / lifecycle / audit fields that must NOT carry over when copying a
// trip. Financial and carrier fields copy verbatim — the split routes them to
// their owning sidecar table via insertTripComposite.
const COPY_EXCLUDED_TRIP_FIELDS = new Set<string>([
  'id',
  'tripCode',
  'version',
  'status',
  'completedAt',
  'createdBy',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'revenueOverriddenBy',
  'revenueOverriddenAt',
]);

/**
 * Copy persisted plan and financial values, while resetting identity,
 * lifecycle, deletion, and audit metadata for a genuinely new trip.
 * Feeds insertTripComposite — the mixed object is split per owning table.
 */
export function buildCopiedTripValues(
  source: TripCompositeRow,
  tripCode: string,
  createdBy: number,
): Record<string, unknown> {
  const copiedFields = Object.fromEntries(
    Object.entries(source).filter(([key]) => !COPY_EXCLUDED_TRIP_FIELDS.has(key)),
  );

  return {
    ...copiedFields,
    tripCode,
    version: 1,
    status: TripStatus.CREATED,
    completedAt: null,
    createdBy,
    deletedAt: null,
    // The copied current revenue is the new trip's baseline. Carrying the
    // source's pre-override baseline would create audit history that never
    // happened on this new trip.
    revenueOriginal: source.revenue,
    revenueOverriddenBy: null,
    revenueOverriddenAt: null,
  };
}

export function buildCopiedTripLegValues(source: TripLegRow, tripId: number) {
  return {
    tripId,
    sequence: source.sequence,
    origin: source.origin,
    destination: source.destination,
    km: source.km,
    loadingType: source.loadingType,
    calculatedLiters: source.calculatedLiters,
  };
}
