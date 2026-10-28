// F-2 (card 161026113900) — owner ruling option (b): the money boards read
// the override channel `trip_financial_state.revenue` for the CƯỚC THU
// columns. per boss 21/10 the REV merge is per-lot (mỗi lô tự tính đơn giá
// Tuyến×KH × loại xe của chính nó — FB-093), so each lot's own AUTO cước
// reaches the boards that settle the money, and FB-095's re-stamp aftermath
// (per-lot, no money moved) is carried on the same channel.
//
// ONE read rule, shared by every board that displays the lot's cước thu:
//   qualified lot ⇔ an LCL lot (groups are LCL-only by FB-092/093 law, so
//   the scope keeps FCL lots on the snapshot channel byte-for-byte — the
//   ruling's money-logic caveat) that either has revGroupId set (the merge
//   stamps every lot from the class lane) OR any live trip carries a
//   revenue-override stamp (FB-095 re-stamps and can leave the survivor
//   UNGROUPED when a 2-lot group dissolves).
//   Unqualified lots keep the historical freight-snapshot grain byte-for-byte.
//
// Trip attribution mirrors FB-093's own loader (`loadLiveTripFactsByShipment`
// in lcl-grouping.service.ts): live trips linked directly (trips.shipment_id)
// OR via shipment_fulfillments, deleted/canceled excluded — a merge write is
// therefore always found by the read.
import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import * as s from '../db/schema';
import type { Executor } from '../db';
import { activeTripConditions } from './active-trip-scope';
import { revManualPrice } from './lcl-effective-freight';

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

/** The snapshot channel as the effective-freight rule reads it: trip legs win
 *  (additive per-trip freezes — real prices, never group artifacts);
 *  otherwise the intake row WITH its formula note (FB-145 classification). */
export interface FreightSnapshotChannel {
  total: number;
  formulaNote: string | null;
}

/**
 * The money boards' SNAPSHOT channel, extracted from the debit summary so
 * every reader of a lot's freight money shares ONE assembly (snapshots are
 * INSERT-only (supersede), so a superseded freeze counts in NO total. The
 * freight anchor semantics: per-trip freezes are the lot's additive legs
 * (matching Bảng 2.1's per-trip rows), and the dispatch freeze supersedes
 * the pre-dispatch intake freeze (trip-NULL whole-lot approximation) — a lot
 * with any active trip freeze reads only its trips' latest rows, while an
 * intake-only lot still counts once. Canceled legs never haul and drop out
 * (active-trip scope, matching Lớp 2)).
 */
export async function loadFreightSnapshotChannelByLot(
  executor: Executor,
  lotIds: number[],
): Promise<Map<number, FreightSnapshotChannel>> {
  const snapshotChannelByLot = new Map<number, FreightSnapshotChannel>();
  if (lotIds.length === 0) return snapshotChannelByLot;
  const grainRows = await executor.select({
    shipmentId: s.freightRateSnapshots.shipmentId,
    tripId: s.freightRateSnapshots.tripId,
    totalAmount: s.freightRateSnapshots.totalAmount,
    // FB-145 (card 231026163927) — the intake row's formula note decides
    // whether its amount is a live price or a group artifact (merge member
    // zero / "chờ định giá lại" citation) on an UNGROUPED lot.
    formulaText: s.freightRateSnapshots.formulaText,
  }).from(s.freightRateSnapshots)
    .leftJoin(s.trips, eq(s.trips.id, s.freightRateSnapshots.tripId))
    .where(and(
      inArray(s.freightRateSnapshots.shipmentId, lotIds),
      or(
        isNull(s.freightRateSnapshots.tripId),
        and(...activeTripConditions(), isNotNull(s.trips.fulfillmentId)),
      ),
      sql`(${s.freightRateSnapshots.id}) = (
        select max(latest.id) from ${s.freightRateSnapshots} latest
        where latest.shipment_id = ${s.freightRateSnapshots.shipmentId}
          and latest.trip_id is not distinct from ${s.freightRateSnapshots.tripId}
      )`,
    ));
  const tripLegFreight = new Map<number, number>();
  const intakeFreight = new Map<number, FreightSnapshotChannel>();
  for (const row of grainRows) {
    const lot = row.shipmentId;
    if (lot == null) continue;
    // The debit summary's own coercion, byte-for-byte: a NULL totalAmount on
    // a freeze row counts 0 (Number(null) is finite 0), never a skipped leg.
    const rawAmount = Number(row.totalAmount);
    const amount = Number.isFinite(rawAmount) ? rawAmount : 0;
    if (row.tripId != null) {
      tripLegFreight.set(lot, (tripLegFreight.get(lot) ?? 0) + amount);
    } else {
      // The latest-per-grain filter leaves at most one trip-NULL row per lot.
      intakeFreight.set(lot, { total: amount, formulaNote: row.formulaText ?? null });
    }
  }
  for (const lot of lotIds) {
    const legs = tripLegFreight.get(lot);
    if (legs !== undefined) {
      snapshotChannelByLot.set(lot, { total: legs, formulaNote: null });
    } else {
      const intake = intakeFreight.get(lot);
      if (intake != null) snapshotChannelByLot.set(lot, intake);
    }
  }
  return snapshotChannelByLot;
}

/**
 * SIL-548 (id 615, QA fail round 3) — per-lot SAVED manual "Giá cước thu
 * khách" (the §4.1 field-2 negotiated override), read back over BOTH money
 * channels through `revManualPrice` (the same channel precedence the money
 * boards print). The per-lot editor's reopen-prefill law rides this, so the
 * editor seeds from what was SAVED — never a stale row cache, never a blank.
 */
export async function loadRevManualPriceByLot(
  executor: Executor,
  lots: Array<{ id: number; revGroupId: string | null; revGroupOrder: number | null; cargoMode: string | null }>,
): Promise<Map<number, number | null>> {
  const manualByLot = new Map<number, number | null>();
  if (lots.length === 0) return manualByLot;
  const lotIds = lots.map((lot) => lot.id);
  const [snapshotChannelByLot, overrideByLot] = await Promise.all([
    loadFreightSnapshotChannelByLot(executor, lotIds),
    loadRevenueOverrideByLot(executor, lotIds),
  ]);
  for (const lot of lots) {
    const override = overrideByLot.get(lot.id) ?? null;
    manualByLot.set(lot.id, revManualPrice({
      snapshotChannel: snapshotChannelByLot.get(lot.id) ?? null,
      override: override == null
        ? null
        : { total: override.total, reason: override.reason, stamped: override.stamped },
      revGroupId: lot.revGroupId,
      revGroupOrder: lot.revGroupOrder,
      cargoMode: lot.cargoMode,
    }));
  }
  return manualByLot;
}
