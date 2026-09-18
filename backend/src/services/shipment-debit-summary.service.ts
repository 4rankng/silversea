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

/** Attribute debit-note lines to lots like the CUS workspace builders: TRIP
 *  lines follow the source trip's shipment, EXPENSE lines the expense's
 *  trip's shipment. A lot carrying unattributable NON-ZERO lines reads as
 *  unknown money — chưa xác định beats a wrong number. */
export function attributeDebitLinesToLots(lines: AttributeLine[], lotIds: ReadonlySet<number>): Map<number, { total: number | null; unknown: boolean }> {
  const byLot = new Map<number, { total: number | null; unknown: boolean }>();
  for (const id of lotIds) byLot.set(id, { total: null, unknown: false });
  for (const line of lines) {
    const owner = lineOwnerOf(line);
    const lot = owner != null ? byLot.get(owner) : undefined;
    if (!lot || lot.unknown) continue;
    lot.total = (lot.total ?? 0) + lineEffectiveAmount(line);
  }
  for (const line of lines) {
    if (lineOwnerOf(line) != null) continue;
    if (lineEffectiveAmount(line) === 0) continue;
    const lot = byLot.get(line.shipmentId);
    if (lot) lot.unknown = true;
  }
  return byLot;
}

interface AttributeLine {
  documentId: number;
  lineId: number;
  shipmentId: number;
  sourceType: string;
  sourceTripShipmentId: number | null;
  sourceExpenseShipmentId: number | null;
  excluded: boolean;
  grossAmount: string | null;
  baseAmount: string | null;
  amountOverride: string | null;
  vatTreatment: string | null;
}

function lineOwnerOf(line: AttributeLine): number | null {
  if (line.sourceType === 'TRIP') return line.sourceTripShipmentId;
  if (line.sourceType === 'EXPENSE') return line.sourceExpenseShipmentId;
  return null;
}

const ISSUED_DEBIT_NOTE_CONDITION = sql`coalesce(${s.billingDocuments.debitNoteStatus}, 'DRAFT') in ('SENT', 'PENDING_CONFIRM', 'CONFIRMED', 'PARTIAL_PAID', 'PAID')`;

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
  }).from(s.shipmentCostLocks)
    .where(and(
      inArray(s.shipmentCostLocks.shipmentId, lotIds),
      isNull(s.shipmentCostLocks.unlockedAt),
    ));
  const lockedByLot = new Map(lockRows.map((row) => [row.shipmentId, row.lockedAt]));

  // Receivable: issued debit-note lines attributed per lot.
  const sourceTrip = aliasedTable(s.trips, 'debit_source_trip');
  const expenseTrip = aliasedTable(s.trips, 'debit_expense_trip');
  const lineRows = await db.select({
    documentId: s.billingDocumentLines.documentId,
    lineId: s.billingDocumentLines.id,
    shipmentId: s.trips.shipmentId,
    sourceType: s.billingDocumentLines.sourceType,
    sourceTripShipmentId: sql<number | null>`case when ${s.billingDocumentLines.sourceType} = 'TRIP' then ${sourceTrip.shipmentId} else null end`,
    sourceExpenseShipmentId: sql<number | null>`case when ${s.billingDocumentLines.sourceType} = 'EXPENSE' then ${expenseTrip.shipmentId} else null end`,
    excluded: s.billingDocumentLines.excluded,
    grossAmount: s.billingDocumentLines.grossAmount,
    baseAmount: s.billingDocumentLines.baseAmount,
    amountOverride: s.billingDocumentLines.amountOverride,
    vatTreatment: s.billingDocumentLines.vatTreatment,
  }).from(s.billingDocumentTripClaims)
    .innerJoin(s.trips, and(
      eq(s.trips.id, s.billingDocumentTripClaims.tripId),
      inArray(s.trips.shipmentId, lotIds),
      ne(s.trips.status, 'CANCELED'),
      isNull(s.trips.deletedAt),
    ))
    .innerJoin(s.billingDocuments, and(
      eq(s.billingDocuments.id, s.billingDocumentTripClaims.documentId),
      eq(s.billingDocuments.type, 'DEBIT_NOTE'),
      isNull(s.billingDocuments.deletedAt),
      sql`${s.billingDocuments.issuedAt} is not null`,
      ISSUED_DEBIT_NOTE_CONDITION,
      eq(s.billingDocuments.authorityState, 'CURRENT'),
      sql`${s.billingDocuments.authorityWarningAt} is null`,
    ))
    .innerJoin(s.billingDocumentLines, eq(s.billingDocumentLines.documentId, s.billingDocuments.id))
    .leftJoin(sourceTrip, and(
      eq(s.billingDocumentLines.sourceType, 'TRIP'),
      eq(sourceTrip.id, s.billingDocumentLines.sourceId),
    ))
    .leftJoin(s.tripExpenses, and(
      eq(s.billingDocumentLines.sourceType, 'EXPENSE'),
      eq(s.tripExpenses.id, s.billingDocumentLines.sourceId),
    ))
    .leftJoin(expenseTrip, eq(expenseTrip.id, s.tripExpenses.tripId))
    .where(isNull(s.billingDocumentTripClaims.releasedAt));
  const receivableByLot = attributeDebitLinesToLots(lineRows, new Set(lotIds));
  const items: ShipmentDebitSummaryItem[] = lots.map((lot) => {
    const freightAuto = freightByLot.get(lot.id);
    const chiHo = chiHoByLot.get(lot.id);
    const hasTrips = (tripCountByLot.get(lot.id) ?? 0) > 0;
    const receivableState = receivableByLot.get(lot.id);
    const receivableKnown = receivableState != null && !receivableState.unknown;
    const receivableValue = receivableKnown ? (receivableState.total ?? 0) : null;
    const profit = receivableValue != null && freightAuto != null && chiHo != null
      ? receivableValue - freightAuto - chiHo
      : null;
    const receivableTotal = receivableValue == null ? null : String(receivableValue);
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
      receivableTotal,
      profit: profit == null ? null : String(profit),
      lockStatus: (lockedByLot.has(lot.id) ? 'LOCKED' : 'OPEN') as 'LOCKED' | 'OPEN',
      lockedAt: lockedByLot.get(lot.id)?.toISOString() ?? null,
    };
  });
  const visible = query.lockStatus === 'ALL'
    ? items
    : items.filter((item) => item.lockStatus === query.lockStatus);
  return { items: visible, total: visible.length };
}
