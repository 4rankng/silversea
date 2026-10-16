// F-2 (card 161026113900) — owner ruling option (b): the money boards read
// the override channel `trip_financial_state.revenue` for the CƯỚC THU
// columns, so FB-093's 100%/0đ merge jump and FB-095's promote/transfer
// aftermath reach the boards that settle the money.
//
// ONE read rule, shared by every board that displays the lot's cước thu:
//   qualified lot ⇔ an LCL lot (groups are LCL-only by FB-092/093 law, so
//   the scope keeps FCL lots on the snapshot channel byte-for-byte — the
//   ruling's money-logic caveat) that either has revGroupId set (the merge
//   re-prices the principal AUTO from the class lane WITHOUT override
//   markers, so group membership is the only signal that catches it) OR any
//   live trip carries a revenue-override stamp (FB-095 writes the
//   transfer/zero re-stamps with markers and can leave the survivor
//   UNGROUPED when a 2-lot group dissolves).
//   Unqualified lots keep the historical freight-snapshot grain byte-for-byte.
//
// Trip attribution mirrors FB-093's own loader (`loadLiveTripFactsByShipment`
// in lcl-grouping.service.ts): live trips linked directly (trips.shipment_id)
// OR via shipment_fulfillments, deleted/canceled excluded — a merge write is
// therefore always found by the read.
import { and, asc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import * as s from '../db/schema';
import type { Executor } from '../db';

/** One lot's override-channel facts. */
export interface RevenueOverrideFacts {
  /** Σ live-trip revenue; null when no live trip carries a revenue value —
   *  "Chưa xác định", never a fabricated 0 (PRD money-state law). */
  total: number | null;
  /** The override reason stamp ("Ghép cước cùng Bill X", FB-095 re-stamps,
   *  operator M2.1 reasons) — null when no live trip is stamped. */
  reason: string | null;
  /** Any live trip carries revenueOverriddenAt — the FB-095/M2.1 signal. */
  stamped: boolean;
}

function toNumber(value: string | null): number | null {
  if (value == null) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

/**
 * Per-lot override-channel facts for the money boards. Loads the live-trip
 * revenue for every lot id; the CALLER decides qualification (rev-group
 * membership is lot data it already holds).
 */
export async function loadRevenueOverrideByLot(
  executor: Executor,
  lotIds: number[],
): Promise<Map<number, RevenueOverrideFacts>> {
  const facts = new Map<number, RevenueOverrideFacts>();
  if (lotIds.length === 0) return facts;
  const lotIdSet = new Set(lotIds);
  // Deterministic row order: the reason pick below surfaces the lowest-trip-
  // id stamp instead of whatever the planner returns first.
  const rows = await executor.select({
    directShipmentId: s.trips.shipmentId,
    fulfillmentShipmentId: s.shipmentFulfillments.shipmentId,
    revenue: s.tripFinancialState.revenue,
    overriddenAt: s.tripFinancialState.revenueOverriddenAt,
    reason: s.tripFinancialState.revenueOverrideReason,
  }).from(s.trips)
    .leftJoin(s.shipmentFulfillments, eq(s.trips.fulfillmentId, s.shipmentFulfillments.id))
    .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
    .where(and(
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
      or(
        inArray(s.trips.shipmentId, lotIds),
        inArray(s.shipmentFulfillments.shipmentId, lotIds),
      )!,
    ))
    .orderBy(asc(s.trips.id));
  for (const row of rows) {
    const owner = row.directShipmentId ?? row.fulfillmentShipmentId;
    if (owner == null || !lotIdSet.has(owner)) continue;
    const entry = facts.get(owner) ?? { total: null, reason: null, stamped: false };
    const revenue = toNumber(row.revenue);
    if (revenue != null) entry.total = (entry.total ?? 0) + revenue;
    if (row.overriddenAt != null) entry.stamped = true;
    // First non-empty stamp wins (LCL lots carry one live trip, so one
    // stamp; multi-trip lots surface any one of their override notes).
    if (entry.reason == null && row.reason != null && row.reason.trim() !== '') {
      entry.reason = row.reason.trim();
    }
    facts.set(owner, entry);
  }
  return facts;
}
