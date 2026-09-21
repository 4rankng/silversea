// Chi phí - Quyết toán (Debit CUS) Lớp 1 — per-lot revenue rollup.
//
// One read-only service behind GET /api/shipments/debit-summary: per lot the
// auto freight (freight-rate snapshots), tổng chi hộ (trip expenses = what SS
// pays on the customer's behalf), tổng phải thu khách (attributed debit-note
// lines) and the derived profit. PRD money fields are nullable; null means
// "chưa xác định" — never a false 0.
//
// Debit-lock sync: 🔓/🔒 follows the shipment_cost_locks active lock (a lô
// lock, NOT the kỳ kế toán lock) — LOCKED + lockedAt while one is active.
import { aliasedTable, and, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import * as s from '../db/schema';
import { db } from '../db';
import { ApiError } from '../errors';
import type { ShipmentDebitSummaryItem, ShipmentDebitSummaryResponse } from '@tingting/shared';
import { activeTripConditions } from './active-trip-scope';
import { billOrBookNumberFor } from './cus-workspace-mapping.service';

function toNumber(value: string | number | null | undefined): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function lineEffectiveAmount(line: {
  excluded: boolean;
  grossAmount: string | null;
  baseAmount: string | null;
  amountOverride: string | null;
}): number {
  if (line.excluded) return 0;
  if (line.grossAmount != null) return toNumber(line.grossAmount);
  return toNumber(line.amountOverride ?? line.baseAmount);
}

export async function getShipmentDebitSummary(query: {
  customerId: number;
  deliveryDateFrom?: string;
  deliveryDateTo?: string;
  lockStatus: 'ALL' | 'OPEN' | 'LOCKED';
}): Promise<ShipmentDebitSummaryResponse> {
  const conditions = [
    eq(s.shipments.customerId, query.customerId),
    isNull(s.shipments.deletedAt),
  ];
  if (query.deliveryDateFrom) conditions.push(gte(s.shipments.expectedDeliveryDate, query.deliveryDateFrom));
  if (query.deliveryDateTo) conditions.push(lte(s.shipments.expectedDeliveryDate, query.deliveryDateTo));
  const lots = await db.select({
    id: s.shipments.id,
    code: s.shipments.shipmentCode,
    customerName: s.customers.name,
    factoryName: s.operationalSites.shortName,
    factoryAddress: s.operationalSites.address,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
    tradeDirection: s.shipments.tradeDirection,
  })
  .from(s.shipments)
  .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId))
  .leftJoin(s.operationalSites, eq(s.operationalSites.id, s.shipments.operationalSiteId))
    .where(and(...conditions))
    .orderBy(s.shipments.expectedDeliveryDate, s.shipments.id);
  if (lots.length === 0) return { items: [], total: 0 };
  const lotIds = lots.map((lot) => lot.id);

  // Auto freight: snapshots are INSERT-only (supersede), so a superseded
  // freeze counts in NO total. The freight anchor semantics: per-trip freezes
  // are the lot's additive legs (matching Bảng 2.1's per-trip rows), and the
  // dispatch freeze supersedes the pre-dispatch intake freeze (trip-NULL
  // whole-lot approximation) — a lot with any active trip freeze reads only
  // its trips' latest rows, while an intake-only lot still counts once.
  // Canceled legs never haul and drop out (active-trip scope, matching Lớp 2).
  const grainRows = await db.select({
    shipmentId: s.freightRateSnapshots.shipmentId,
    tripId: s.freightRateSnapshots.tripId,
    totalAmount: s.freightRateSnapshots.totalAmount,
  }).from(s.freightRateSnapshots)
    .leftJoin(s.trips, eq(s.trips.id, s.freightRateSnapshots.tripId))
    .where(and(
      inArray(s.freightRateSnapshots.shipmentId, lotIds),
      or(
        isNull(s.freightRateSnapshots.tripId),
        and(...activeTripConditions()),
      ),
      sql`(${s.freightRateSnapshots.id}) = (
        select max(latest.id) from ${s.freightRateSnapshots} latest
        where latest.shipment_id = ${s.freightRateSnapshots.shipmentId}
          and latest.trip_id is not distinct from ${s.freightRateSnapshots.tripId}
      )`,
    ));
  const freightByLot = new Map<number, number>();
  const tripLegFreight = new Map<number, number>();
  const intakeFreight = new Map<number, number>();
  for (const row of grainRows) {
    const lot = row.shipmentId;
    if (lot == null) continue;
    if (row.tripId != null) {
      tripLegFreight.set(lot, (tripLegFreight.get(lot) ?? 0) + toNumber(row.totalAmount));
    } else {
      // The latest-per-grain filter leaves at most one trip-NULL row per lot.
      intakeFreight.set(lot, toNumber(row.totalAmount));
    }
  }
  for (const lot of lotIds) {
    const legs = tripLegFreight.get(lot);
    const intake = intakeFreight.get(lot);
    const freight = legs !== undefined ? legs : intake;
    if (freight !== undefined) freightByLot.set(lot, freight);
  }

  // Tổng chi hộ: what SS pays on the lot's live trips (CVC + Ops fees).
  const chiHoRows = await db.select({
    shipmentId: s.trips.shipmentId,
    total: sql<string>`coalesce(sum(${s.tripExpenses.buyAmount}), 0)::text`,
  }).from(s.tripExpenses)
    .innerJoin(s.trips, and(
      eq(s.trips.id, s.tripExpenses.tripId),
      inArray(s.trips.shipmentId, lotIds),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
    ))
    .groupBy(s.trips.shipmentId);
  const chiHoByLot = new Map(chiHoRows.map((row) => [row.shipmentId, toNumber(row.total)]));
  const tripCountRows = await db.select({
    shipmentId: s.trips.shipmentId,
    total: sql<number>`count(*)::int`,
  }).from(s.trips)
    .where(and(
      inArray(s.trips.shipmentId, lotIds),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
    ))
    .groupBy(s.trips.shipmentId);
  const tripCountByLot = new Map(tripCountRows.map((row) => [row.shipmentId, row.total]));

  // Debit-lock sync (card _19): the active cost lock drives 🔓/🔒 — a lot
  // with an active lock reads LOCKED with its lock time.
  const lockRows = await db.select({
    shipmentId: s.shipmentCostLocks.shipmentId,
    lockedAt: s.shipmentCostLocks.lockedAt,
    snapshot: s.shipmentCostLocks.costSnapshot,
  }).from(s.shipmentCostLocks)
    .where(and(
      inArray(s.shipmentCostLocks.shipmentId, lotIds),
      isNull(s.shipmentCostLocks.unlockedAt),
    ));
  const lockedByLot = new Map(lockRows.map((row) => [row.shipmentId, row]));

  // TỔNG PHẢI THU KHÁCH (user ruling 2026-09-19, doc-proven arithmetic): both
  // revenue tables roll up. 2.2 contributes the thu khách cells — typed on
  // Phí khác rows; for pass-through/invoiced rows the recharge derives from
  // the expense-type rule (cost pass-through today). 2.1 contributes its row
  // totals (freight snapshots, entered PS thực tế, customs bucket) with PS
  // counted once inside the row, never separately. Only a lot with NO data
  // in either table reads null (Chưa xác định).
  const revenueRows = await db.select({
    shipmentId: s.trips.shipmentId,
    expenseType: s.tripExpenses.expenseType,
    buy: s.tripExpenses.buyAmount,
    sell: s.tripExpenses.sellAmount,
  }).from(s.tripExpenses)
    .innerJoin(s.trips, and(
      eq(s.trips.id, s.tripExpenses.tripId),
      inArray(s.trips.shipmentId, lotIds),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
    ));
  const revenueByLot = new Map<number, { hasRows: boolean; otherSell: number; derived: number }>();
  for (const row of revenueRows) {
    if (row.shipmentId == null) continue;
    const entry = revenueByLot.get(row.shipmentId) ?? { hasRows: true, otherSell: 0, derived: 0 };
    if (row.expenseType === 'OTHER') {
      entry.otherSell += Number(row.sell ?? 0);
    } else {
      // Pass-through recharge at cost; the type's markup rule says otherwise
      // only when a markup mechanism exists — none lands before one does.
      entry.derived += Number(row.buy ?? 0);
    }
    revenueByLot.set(row.shipmentId, entry);
  }

  // TỔNG PHẢI TRẢ components, live: Cước trả = Σ trip_carrier_info
  // .external_freight_cost over the lot's active trips (unknown while any
  // trip lacks its carrier cost); ops total = the lot's ops_expense_entries
  // (unknown at zero rows). The classification buckets land with card
  // 20260919_3's category column.
  const carrierRows = await db.select({
    shipmentId: s.trips.shipmentId,
    total: sql<string>`coalesce(sum(${s.tripCarrierInfo.externalFreightCost}), 0)::text`,
    known: sql<number>`count(${s.tripCarrierInfo.externalFreightCost})::int`,
    trips: sql<number>`count(*)::int`,
  }).from(s.trips)
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
    .where(and(
      inArray(s.trips.shipmentId, lotIds),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
    ))
    .groupBy(s.trips.shipmentId);
  const carrierByLot = new Map(carrierRows.map((row) => [row.shipmentId, {
    known: row.trips > 0 && row.known === row.trips,
    total: toNumber(row.total),
  }]));

  const opsRows = await db.select({
    shipmentId: s.opsExpenseEntries.shipmentId,
    total: sql<string>`coalesce(sum(${s.opsExpenseEntries.amount}), 0)::text`,
    cnt: sql<number>`count(*)::int`,
  }).from(s.opsExpenseEntries)
    .where(inArray(s.opsExpenseEntries.shipmentId, lotIds))
    .groupBy(s.opsExpenseEntries.shipmentId);
  const opsByLot = new Map(opsRows.map((row) => [row.shipmentId, {
    known: row.cnt > 0,
    total: toNumber(row.total),
  }]));

  // 2.1's PS thực tế and customs contributions, bulk per lot.
  const psRows = await db.select({
    shipmentId: s.shipmentContainers.shipmentId,
    total: sql<string>`coalesce(sum(${s.shipmentContainers.psActualAmount}), 0)::text`,
    known: sql<number>`count(${s.shipmentContainers.psActualAmount})::int`,
  }).from(s.shipmentContainers)
    .where(inArray(s.shipmentContainers.shipmentId, lotIds))
    .groupBy(s.shipmentContainers.shipmentId);
  const psByLot = new Map(psRows.map((row) => [row.shipmentId, { known: row.known > 0, total: toNumber(row.total) }]));

  // Receivable side of ops rows (card _56): only the NEGOTIATED customer
  // charge (customer_charge_amount) joins TỔNG PHẢI THU KHÁCH — never the
  // cost amount (PRD AC-CP-OPS-02/03: the two sides are independent). Rows
  // with an un-entered charge (null) stay unknown and contribute nothing.
  const opsChargeRows = await db.select({
    shipmentId: s.opsExpenseEntries.shipmentId,
    total: sql<string>`coalesce(sum(${s.opsExpenseEntries.customerChargeAmount}), 0)::text`,
    known: sql<number>`count(${s.opsExpenseEntries.customerChargeAmount})::int`,
  }).from(s.opsExpenseEntries)
    .where(inArray(s.opsExpenseEntries.shipmentId, lotIds))
    .groupBy(s.opsExpenseEntries.shipmentId);
  const opsChargeByLot = new Map(opsChargeRows.map((row) => [row.shipmentId, {
    known: row.known > 0,
    total: toNumber(row.total),
  }]));

  /** Frozen L1 figures for locked lots: missing snapshot keys (locks frozen
   *  before this landing) read null — Chưa xác định, never a fabricated 0. */
  const frozenNumber = (snapshot: unknown, key: string): number | null => {
    if (snapshot == null || typeof snapshot !== 'object') return null;
    const value = (snapshot as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) return Number(value);
    return null;
  };

  const items: ShipmentDebitSummaryItem[] = lots.map((lot) => {
    const freightAuto = freightByLot.get(lot.id);
    const chiHo = chiHoByLot.get(lot.id);
    const hasTrips = (tripCountByLot.get(lot.id) ?? 0) > 0;
    const lock = lockedByLot.get(lot.id);
    const revenue = revenueByLot.get(lot.id);
    const ps = psByLot.get(lot.id);
    const hasAnyRevenue = revenue != null
      || freightByLot.has(lot.id)
      || (ps?.known ?? false)
      || (opsChargeByLot.get(lot.id)?.known ?? false);
    const receivableValue = lock != null
      ? frozenNumber(lock.snapshot, 'receivableTotal')
      : hasAnyRevenue
        ? (revenue?.otherSell ?? 0)
          + (revenue?.derived ?? 0)
          + (freightByLot.get(lot.id) ?? 0)
          + (ps?.known ? ps.total : 0)
          + (opsChargeByLot.get(lot.id)?.known ? opsChargeByLot.get(lot.id)!.total : 0)
        : null;
    const carrier = carrierByLot.get(lot.id);
    const ops = opsByLot.get(lot.id);
    const externalFreight = carrier?.known ? carrier.total : null;
    const opsTotal = ops?.known ? ops.total : null;
    const payableTotal = lock != null
      ? (() => { const frozen = frozenNumber(lock.snapshot, 'payableTotal'); return frozen == null ? null : String(frozen); })()
      : externalFreight != null && opsTotal != null
        ? String(externalFreight + opsTotal)
        : null;
    const profit = receivableValue != null && freightAuto != null && chiHo != null
      ? receivableValue - freightAuto - chiHo
      : null;
    return {
      shipmentId: lot.id,
      code: lot.code,
      customerName: lot.customerName,
      factoryName: lot.factoryName ?? null,
      factoryAddress: lot.factoryAddress,
      billOrBookNumber: billOrBookNumberFor(lot.tradeDirection, lot.blNumber, lot.bookingRef),
      customsNumber: null,
      documentsSummary: null,
      freightAuto: freightAuto == null ? null : String(freightAuto),
      chiHoTotal: hasTrips || chiHo != null ? String(chiHo ?? 0) : null,
      receivableTotal: receivableValue == null ? null : String(receivableValue),
      payableTotal,
      profit: profit == null ? null : String(profit),
      lockStatus: (lock != null ? 'LOCKED' : 'OPEN') as 'LOCKED' | 'OPEN',
      lockedAt: lock?.lockedAt.toISOString() ?? null,
    };
  });
  const visible = query.lockStatus === 'ALL'
    ? items
    : items.filter((item) => item.lockStatus === query.lockStatus);
  return { items: visible, total: visible.length };
}
