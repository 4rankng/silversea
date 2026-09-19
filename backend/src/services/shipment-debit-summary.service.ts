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
import { aliasedTable, and, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import * as s from '../db/schema';
import { db } from '../db';
import { ApiError } from '../errors';
import type { ShipmentDebitSummaryItem, ShipmentDebitSummaryResponse } from '@tingting/shared';
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

  // Auto freight: per-trip snapshots summed per lot; absent = unknown.
  const freightRows = await db.select({
    shipmentId: s.freightRateSnapshots.shipmentId,
    total: sql<string>`coalesce(sum(${s.freightRateSnapshots.totalAmount}), 0)::text`,
  }).from(s.freightRateSnapshots)
    .where(inArray(s.freightRateSnapshots.shipmentId, lotIds))
    .groupBy(s.freightRateSnapshots.shipmentId);
  const freightByLot = new Map(freightRows.map((row) => [row.shipmentId, toNumber(row.total)]));

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

  // TỔNG PHẢI THU KHÁCH (spec L138): the roll-up of ENTERED thu khách on the
  // lot's Bảng-2.2 expense rows (tripExpenses.sellAmount) — NOT issued
  // debit-note lines; Lớp 1 moves the moment CUS saves. For locked lots the
  // frozen snapshot value wins (card _19: an edit behind an issued note must
  // not move Lớp 1).
  const sellRows = await db.select({
    shipmentId: s.trips.shipmentId,
    total: sql<string>`coalesce(sum(${s.tripExpenses.sellAmount}), 0)::text`,
  }).from(s.tripExpenses)
    .innerJoin(s.trips, and(
      eq(s.trips.id, s.tripExpenses.tripId),
      inArray(s.trips.shipmentId, lotIds),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
    ))
    .groupBy(s.trips.shipmentId);
  const sellByLot = new Map(sellRows.map((row) => [row.shipmentId, toNumber(row.total)]));

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
    const enteredSell = sellByLot.get(lot.id);
    const receivableValue = lock != null
      ? frozenNumber(lock.snapshot, 'receivableTotal')
      : sellByLot.has(lot.id) ? (enteredSell ?? 0) : null;
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
