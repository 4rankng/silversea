// Card 20260921_21 — KẾ HOẠCH ĐIỀU ĐỘNG TỔNG HỢP (accounting chốt-debit CORE):
// per-lot thu/trả board + rate-adjustment requests that block debit export.
//
// Column sources (plan rev 4 §A3, P1 arithmetic):
//   thu:  Cước thu auto = active freight-rate snapshots (freightAmount) —
//         F-2 ruling (b): an LCL REV-grouped/override-stamped lot reads the
//         trip_financial_state.revenue override channel instead (spec §4:
//         Lô 1 = 100% tiền cước nhóm, lô phụ = 0 ₫);
//         Lạch Huyện auto = ops ZONE_SURCHARGE rows' customerChargeAmount;
//         Phụ ps auto = snapshot surchargeAmount;
//         Phát sinh cus = OTHER trip_expenses sellAmount;
//         Tổng thu = sum of the knowns when ANY is known (debit-summary
//         precedent) — null only when nothing is known.
//   trả:  Cước trả ĐV = trip_carrier_info.external_freight_cost (known iff
//         every active trip has one); Lạch huyện ĐV = ops ZONE_SURCHARGE cost
//         amount; Phát sinh ĐV = other ops-expense cost; Tổng 1 = their sum —
//         PHÍ RU EXCLUDED (own column after Tổng 1, per P1).
//   Lợi nhuận = Tổng thu − Tổng 1 − Phí RU; null when any component null.
//   Phí RU = pricing_tables rate_key='RU' (DATA — Chưa xác định until the
//   customer populates the rate; convention flagged CẦN THÔNG TIN).
//
// "Duyệt" per the card's 2026-09-21 user ruling = confirmation columns, not
// an approval queue: confirm/withdraw NEVER change rates (đối soát only).
import { and, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import * as s from '../db/schema';
import { db, type Executor } from '../db';
import { sumExcludingNegative } from '@tingting/shared';
import { ApiError } from '../errors';
import { activeTripConditions } from './active-trip-scope';
import { billOrBookNumberFor } from './cus-workspace-mapping.service';
import { operationalName } from '../db/master-data-name';
import { loadRevenueOverrideByLot } from './revenue-override-read.service';
import { effectiveLclFreight } from './lcl-effective-freight';
import type { Tx } from './trip-shared';
import { lockApplicationOwnedUniquenessSet } from './application-owned-uniqueness.service';
import { carrierKeysForLot } from './debit-settlement-shared';
import { loadDispatchExpenseNotes } from './dispatch-expense-notes.service';

function toNumber(value: string | number | null | undefined): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

const money = (value: number | null): string | null =>
  value == null ? null : String(value);

export interface AccountingDebitBoardRow {
  shipmentId: number;
  code: string | null;
  customerName: string | null;
  customerId: number | null;
  carrierKeys: string[];
  ngay: string | null;
  billOrBooking: string | null;
  containers: string[];
  phanXe: string[];
  /** FB-094 — LCL grouping facts: the container-params label cites the thu/tra
   *  vehicle classes, and the two plates drive the orange "Báo khách (Ảo)"
   *  badge when billing differs from the actual. Null on FCL/ungrouped rows. */
  lcl: {
    label: string;
    actualTruckNo: string | null;
    billingTruckNo: string | null;
    ghépCùngRef: string | null;
    /** Card 211026024348 — the REV group id (null = not in a rev group): the
     *  row's "Tách nhóm" action needs it to call the existing
     *  `POST /shipments/lcl/unmerge-group` — never a second unmerge path. */
    revGroupId: string | null;
  } | null;
  thu: {
    cuocThu: string | null;
    lachHuyen: string | null;
    phuPs: string | null;
    phatSinhCus: string | null;
    tongThu: string | null;
  };
  tra: {
    cuocTraDv: string | null;
    lachHuyenDv: string | null;
    phatSinhDv: string | null;
    tong1: string | null;
    phiRu: string | null;
  };
  loiNhuan: string | null;
  ghiChu: string | null;
  adjustment: {
    status: 'NONE' | 'PENDING' | 'CONFIRMED';
    requestId: number | null;
    requestedAt: string | null;
    confirmedAt: null | string;
  };
  /** FB-094 (card 201026112300) — ACTIVE cost-lock time (ISO) or null: the
   *  consolidated debit-note export only accepts locked lots, so the board
   *  row carries its export eligibility. */
  costLockedAt: string | null;
}

export async function getAccountingDebitBoard(query: {
  dateFrom?: string;
  dateTo?: string;
}, executor: Executor = db): Promise<{ items: AccountingDebitBoardRow[]; total: number }> {
  const conditions = [isNull(s.shipments.deletedAt)];
  if (query.dateFrom) conditions.push(gte(s.shipments.expectedDeliveryDate, query.dateFrom));
  if (query.dateTo) conditions.push(lte(s.shipments.expectedDeliveryDate, query.dateTo));
  const lots = await executor.select({
    id: s.shipments.id,
    code: s.shipments.shipmentCode,
    customerId: s.shipments.customerId,
    // Card 191026202000: the board names ride the master-data short name —
    // same coalesce law every other grid projection reads (fallback full name).
    customerName: operationalName(s.customers.shortName, s.customers.name),
    routeId: s.shipments.routeId,
    ngay: s.shipments.expectedDeliveryDate,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
    tradeDirection: s.shipments.tradeDirection,
    // FB-094 LCL grouping facts for the container-params cell + plate badge.
    cargoMode: s.shipments.cargoMode,
    costGroupId: s.shipments.costGroupId,
    costGroupOrder: s.shipments.costGroupOrder,
    revGroupId: s.shipments.revGroupId,
    revGroupOrder: s.shipments.revGroupOrder,
    actualTruckNo: s.shipments.actualTruckNo,
    billingTruckNo: s.shipments.billingTruckNo,
    costVehicleClassId: s.shipments.costVehicleClassId,
    revVehicleClassId: s.shipments.revVehicleClassId,
  })
    .from(s.shipments)
    .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId))
    .where(and(...conditions))
    .orderBy(s.shipments.expectedDeliveryDate, s.shipments.id);
  if (lots.length === 0) return { items: [], total: 0 };
  const lotIds = lots.map((lot) => lot.id);

  // FB-094 — vehicle-class codes for the LCL container-params label, plus each
  // grouped lot's principal reference ("Ghép cùng Bill X").
  const lclVehicleClassIds = [...new Set(
    lots.flatMap((lot) => [lot.costVehicleClassId, lot.revVehicleClassId])
      .filter((id): id is number => id != null),
  )];
  const lclClassCodes = new Map(
    lclVehicleClassIds.length === 0
      ? []
      : (await executor.select({ id: s.vehicleSizeClasses.id, code: s.vehicleSizeClasses.code })
        .from(s.vehicleSizeClasses)
        .where(inArray(s.vehicleSizeClasses.id, lclVehicleClassIds)))
        .map((row) => [row.id, row.code] as const),
  );
  const lclGroupIds = [...new Set(lots.flatMap((lot) => [lot.costGroupId, lot.revGroupId]).filter((id): id is string => id != null))];
  const lclPrincipalRefs = new Map<string, string>();
  if (lclGroupIds.length > 0) {
    // LIVE principals only: a soft-deleted lot keeps its group id (§4
    // renumbering never strips the leaver), so a ghost order-1 row must
    // never shadow the promoted principal (card 181026145000).
    const principals = await executor.select({
      costGroupId: s.shipments.costGroupId,
      revGroupId: s.shipments.revGroupId,
      blNumber: s.shipments.blNumber,
      bookingRef: s.shipments.bookingRef,
    }).from(s.shipments)
      .where(and(
        isNull(s.shipments.deletedAt),
        eq(s.shipments.costGroupOrder, 1),
        inArray(s.shipments.costGroupId, lclGroupIds),
      ));
    const revPrincipals = await executor.select({
      revGroupId: s.shipments.revGroupId,
      blNumber: s.shipments.blNumber,
      bookingRef: s.shipments.bookingRef,
    }).from(s.shipments)
      .where(and(
        isNull(s.shipments.deletedAt),
        eq(s.shipments.revGroupOrder, 1),
        inArray(s.shipments.revGroupId, lclGroupIds),
      ));
    for (const principal of principals) {
      const ref = principal.blNumber ?? principal.bookingRef;
      if (ref == null || principal.costGroupId == null) continue;
      lclPrincipalRefs.set(principal.costGroupId, ref);
    }
    for (const principal of revPrincipals) {
      const ref = principal.blNumber ?? principal.bookingRef;
      if (ref == null || principal.revGroupId == null) continue;
      lclPrincipalRefs.set(principal.revGroupId, ref);
    }
  }

  // Cước thu auto + Phụ ps auto: the active freight-rate grain (per-trip
  // freezes are additive legs; the dispatch freeze supersedes the intake
  // freeze) — same grain rule as shipment-debit-summary. Cước thu = the
  // freight component; Phụ ps = the surcharge component of the same grain.
  const grainRows = await executor.select({
    shipmentId: s.freightRateSnapshots.shipmentId,
    tripId: s.freightRateSnapshots.tripId,
    freightAmount: s.freightRateSnapshots.freightAmount,
    surchargeAmount: s.freightRateSnapshots.surchargeAmount,
    // FB-145 — the intake row's formula note decides live price vs group
    // artifact (member-zero tail / "chờ định giá lại") for ungrouped lots.
    formulaText: s.freightRateSnapshots.formulaText,
  }).from(s.freightRateSnapshots)
    .leftJoin(s.trips, eq(s.trips.id, s.freightRateSnapshots.tripId))
    .where(and(
      inArray(s.freightRateSnapshots.shipmentId, lotIds),
      or(isNull(s.freightRateSnapshots.tripId), and(...activeTripConditions())),
      sql`(${s.freightRateSnapshots.id}) = (
        select max(latest.id) from ${s.freightRateSnapshots} latest
        where latest.shipment_id = ${s.freightRateSnapshots.shipmentId}
          and latest.trip_id is not distinct from ${s.freightRateSnapshots.tripId}
      )`,
    ));
  const psAutoByLot = new Map<number, number>();
  const tripLegs = new Map<number, { freight: number; surcharge: number }>();
  const intake = new Map<number, { freight: number; surcharge: number; formulaNote: string | null }>();
  for (const row of grainRows) {
    const lot = row.shipmentId;
    if (lot == null) continue;
    const leg = {
      freight: toNumber(row.freightAmount),
      surcharge: toNumber(row.surchargeAmount),
    };
    if (row.tripId != null) {
      const acc = tripLegs.get(lot) ?? { freight: 0, surcharge: 0 };
      acc.freight += leg.freight;
      acc.surcharge += leg.surcharge;
      tripLegs.set(lot, acc);
    } else {
      intake.set(lot, { ...leg, formulaNote: row.formulaText ?? null });
    }
  }
  for (const lot of lotIds) {
    const pick = tripLegs.get(lot) ?? intake.get(lot);
    if (pick !== undefined) {
      psAutoByLot.set(lot, pick.surcharge);
    }
  }

  // F-2 (card 161026113900, owner ruling b) + FB-145 (card 231026163927):
  // CƯỚC THU (TỰ ĐỘNG) follows the SAME pure rule as the debit board —
  // `effectiveLclFreight` (lcl-effective-freight.ts): override channel for a
  // REV-grouped / stamped LCL lot (Σ live-trip revenue, falling back to the
  // snapshot channel for merged-but-undispatched lots), snapshot channel for
  // everyone else — and, since FB-145, a group artifact (member-zero tail or
  // the "chờ định giá lại" citation) behind an UNGROUPED lot's money reads
  // "Chưa xác định", never a stale 0₫. Spec §4: Lô 1 hiện 100% tiền cước
  // nhóm, các lô phụ hiện 0 ₫. Phụ ps stays on the snapshot channel — the
  // merge owns only the freight/revenue figure.
  const overrideByLot = await loadRevenueOverrideByLot(executor, lotIds);
  const effectiveFreightByLot = new Map<number, number | null>();
  for (const lot of lots) {
    const override = overrideByLot.get(lot.id) ?? null;
    const legs = tripLegs.get(lot.id);
    const snapshotChannel = legs !== undefined
      ? { total: legs.freight, formulaNote: null }
      : (intake.get(lot.id) != null
        ? { total: intake.get(lot.id)!.freight, formulaNote: intake.get(lot.id)!.formulaNote }
        : null);
    effectiveFreightByLot.set(lot.id, effectiveLclFreight({
      snapshotChannel,
      override: override == null
        ? null
        : { total: override.total, reason: override.reason, stamped: override.stamped },
      revGroupId: lot.revGroupId ?? null,
      revGroupOrder: lot.revGroupOrder ?? null,
      cargoMode: lot.cargoMode,
    }).value);
  }

  // Lạch Huyện cells + Phát sinh ĐV: ops-expense rows per lot.
  // ZONE_SURCHARGE rows carry BOTH sides (amount = điều vận cost;
  // customerChargeAmount = negotiated customer charge). Other ops rows =
  // Phát sinh ĐV. Known when rows exist — never a fabricated 0.
  const zoneCode = 'ZONE_SURCHARGE';
  const opsRows = await executor.select({
    shipmentId: s.opsExpenseEntries.shipmentId,
    expenseTypeCode: s.opsExpenseEntries.expenseTypeCode,
    amount: s.opsExpenseEntries.amount,
    customerChargeAmount: s.opsExpenseEntries.customerChargeAmount,
  }).from(s.opsExpenseEntries)
    .where(inArray(s.opsExpenseEntries.shipmentId, lotIds));
  const zoneCostByLot = new Map<number, number>();
  const zoneChargeByLot = new Map<number, number>();
  const otherOpsByLot = new Map<number, number>();
  // Card 20260928_197 — ops cost `amount` is signed, so a negative row must
  // leave the board exactly as if it did not exist. Bucketing happens first and
  // the money is then read through the one shared rule (`sumExcludingNegative`),
  // so both maps below count only the same rows. `customerChargeAmount` (the
  // receivable side) is NOT signed and keeps its plain add.
  const zoneCostRows = new Map<number, Array<{ amount: string }>>();
  const otherOpsRows = new Map<number, Array<{ amount: string }>>();
  for (const row of opsRows) {
    const lot = row.shipmentId;
    if (lot == null) continue;
    if (row.expenseTypeCode === zoneCode) {
      const bucket = zoneCostRows.get(lot) ?? [];
      bucket.push({ amount: row.amount });
      zoneCostRows.set(lot, bucket);
      if (row.customerChargeAmount != null) {
        zoneChargeByLot.set(lot, (zoneChargeByLot.get(lot) ?? 0) + toNumber(row.customerChargeAmount));
      }
    } else {
      const bucket = otherOpsRows.get(lot) ?? [];
      bucket.push({ amount: row.amount });
      otherOpsRows.set(lot, bucket);
    }
  }
  for (const [lot, bucket] of zoneCostRows) {
    // A lot whose only ZONE_SURCHARGE rows are negative must not read as a
    // KNOWN 0, so the "known" flag is set from the counted rows.
    if (bucket.some((row) => Number(row.amount) >= 0)) {
      zoneCostByLot.set(lot, sumExcludingNegative(bucket, (row) => row.amount));
    }
  }
  for (const [lot, bucket] of otherOpsRows) {
    if (bucket.some((row) => Number(row.amount) >= 0)) {
      otherOpsByLot.set(lot, sumExcludingNegative(bucket, (row) => row.amount));
    }
  }

  // Phát sinh cus: OTHER trip_expenses sell side (existing receivable rollup
  // precedent). Known when the lot has trip-expense rows at all.
  const revenueRows = await executor.select({
    shipmentId: s.trips.shipmentId,
    expenseType: s.tripExpenses.expenseType,
    sell: s.tripExpenses.sellAmount,
  }).from(s.tripExpenses)
    .innerJoin(s.trips, and(
      eq(s.trips.id, s.tripExpenses.tripId),
      inArray(s.trips.shipmentId, lotIds),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
      // Q10 (card 20260922_78): soft-voided fee rows leave the money math.
      ne(s.tripExpenses.approvalStatus, 'VOIDED'),
    ));
  const otherSellByLot = new Map<number, number>();
  const otherSellKnown = new Set<number>();
  for (const row of revenueRows) {
    if (row.shipmentId == null) continue;
    otherSellKnown.add(row.shipmentId);
    if (row.expenseType === 'OTHER') {
      otherSellByLot.set(row.shipmentId, (otherSellByLot.get(row.shipmentId) ?? 0) + toNumber(row.sell));
    }
  }

  // Cước trả ĐV: carrier cost known iff every active trip has one
  // (debit-summary precedent).
  const carrierRows = await executor.select({
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

  // Phân xe labels: a trip's truck shows the OWNING carrier customer's name
  // when subcontracted (trucks.carrierId), otherwise the own-fleet plate;
  // external-carrier trips show the customer-as-carrier name
  // (accounting-transport-register precedent).
  const tripRows = await executor.select({
    shipmentId: s.trips.shipmentId,
    licensePlate: s.trucks.licensePlate,
    truckCarrierId: s.trucks.carrierId,
    externalEntityId: s.tripCarrierInfo.externalEntityId,
    externalEntityType: s.tripCarrierInfo.externalEntityType,
    externalPlate: s.tripCarrierInfo.externalPlateNumber,
  }).from(s.trips)
    .leftJoin(s.trucks, eq(s.trucks.id, s.trips.truckId))
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
    .where(and(
      inArray(s.trips.shipmentId, lotIds),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
    ));
  const phanXeRaw = new Map<number, Array<{ plate: string | null; carrierId: number | null; externalId: number | null; externalPlate: string | null }>>();
  const carrierNameIds = new Set<number>();
  for (const row of tripRows) {
    if (row.shipmentId == null) continue;
    const list = phanXeRaw.get(row.shipmentId) ?? [];
    list.push({
      plate: row.truckCarrierId == null ? row.licensePlate : null,
      carrierId: row.truckCarrierId,
      externalId: row.externalEntityType === 'CUSTOMER' && row.externalEntityId != null
        ? row.externalEntityId
        : null,
      externalPlate: row.externalPlate,
    });
    phanXeRaw.set(row.shipmentId, list);
    if (row.truckCarrierId != null) carrierNameIds.add(row.truckCarrierId);
    if (row.externalEntityType === 'CUSTOMER' && row.externalEntityId != null) carrierNameIds.add(row.externalEntityId);
  }

  // SPEC 18/10/2026 §6.2 — an LCL cost group persists its vehicle source on the
  // lot's "phân bổ xe" fulfillment channel before any trip exists. Without this
  // fallback the Phân xe carrier half rendered "—" for a grouped lot that had
  // not been issued yet, even though the dispatcher had chosen SilverSea/a nhà
  // xe. FCL keeps its trip-only projection (no behavior change).
  const plannedCarrierRows = lotIds.length > 0 ? await executor.select({
    shipmentId: s.shipmentFulfillments.shipmentId,
    carrierType: s.shipmentFulfillments.plannedCarrierType,
    externalCarrierId: s.shipmentFulfillments.plannedExternalCarrierId,
    plate: s.shipmentFulfillments.plannedVehiclePlateNumber,
  }).from(s.shipmentFulfillments)
    .where(and(
      inArray(s.shipmentFulfillments.shipmentId, lotIds),
      isNull(s.shipmentFulfillments.canceledAt),
    )) : [];
  const plannedCarrierByLot = new Map<number, { carrierType: string | null; externalId: number | null; plate: string | null }>();
  for (const row of plannedCarrierRows) {
    if (row.shipmentId == null || plannedCarrierByLot.has(row.shipmentId)) continue;
    plannedCarrierByLot.set(row.shipmentId, {
      carrierType: row.carrierType,
      externalId: row.externalCarrierId,
      plate: row.plate,
    });
    if (row.externalCarrierId != null) carrierNameIds.add(row.externalCarrierId);
  }

  // Thông số container labels per lot (shipment_containers).
  const containerRows = await executor.select({
    shipmentId: s.shipmentContainers.shipmentId,
    containerNumber: s.shipmentContainers.containerNumber,
    containerTypeId: s.shipmentContainers.containerTypeId,
  }).from(s.shipmentContainers)
    .where(inArray(s.shipmentContainers.shipmentId, lotIds));
  const containerTypeRows = await executor.select({ id: s.containerTypes.id, name: s.containerTypes.name })
    .from(s.containerTypes);
  const containerTypeLabels = new Map(containerTypeRows.map((r) => [r.id, r.name]));
  const containersByLot = new Map<number, string[]>();
  for (const row of containerRows) {
    const lot = row.shipmentId;
    if (lot == null) continue;
    const labels = containersByLot.get(lot) ?? [];
    const typeLabel = row.containerTypeId == null ? '' : containerTypeLabels.get(row.containerTypeId) ?? '';
    const label = [row.containerNumber ?? '', typeLabel].filter(Boolean).join(' · ');
    if (label) labels.push(label);
    containersByLot.set(lot, labels);
  }

  // Phí RU: pricing_tables rate_key='RU' — latest effectiveDate ≤ the lot's
  // delivery date per customer+route; falls back to the latest when none is
  // applicable yet. DATA-driven: absent until the customer populates rows.
  const routeIds = [...new Set(lots.map((lot) => lot.routeId).filter((v): v is number => v != null))];
  const ruRateRows = routeIds.length > 0 ? await executor.select({
    customerId: s.pricingTables.customerId,
    routeId: s.pricingTables.routeId,
    price: s.pricingTables.price,
    effectiveDate: s.pricingTables.effectiveDate,
  }).from(s.pricingTables)
    .where(and(
      eq(s.pricingTables.rateKey, 'RU'),
      inArray(s.pricingTables.routeId, routeIds),
      isNull(s.pricingTables.deletedAt),
    )) : [];
  const ruByLot = new Map<number, number>();
  for (const lot of lots) {
    if (lot.routeId == null || lot.customerId == null) continue;
    const candidates = ruRateRows.filter((row) =>
      row.routeId === lot.routeId && row.customerId === lot.customerId);
    if (candidates.length === 0) continue;
    const applicable = candidates
      .filter((row) => lot.ngay == null || row.effectiveDate <= lot.ngay)
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
    const pick = applicable[0] ?? [...candidates].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
    if (pick) ruByLot.set(lot.id, toNumber(pick.price));
  }

  // Rate-adjustment state per lot: latest non-withdrawn PENDING/CONFIRMED.
  const adjRows = await executor.select({
    id: s.shipmentRateAdjustmentRequests.id,
    shipmentId: s.shipmentRateAdjustmentRequests.shipmentId,
    status: s.shipmentRateAdjustmentRequests.status,
    requestedAt: s.shipmentRateAdjustmentRequests.requestedAt,
    confirmedAt: s.shipmentRateAdjustmentRequests.confirmedAt,
  }).from(s.shipmentRateAdjustmentRequests)
    .where(and(
      inArray(s.shipmentRateAdjustmentRequests.shipmentId, lotIds),
      isNull(s.shipmentRateAdjustmentRequests.withdrawnAt),
      inArray(s.shipmentRateAdjustmentRequests.status, ['PENDING', 'CONFIRMED']),
      sql`(${s.shipmentRateAdjustmentRequests.id}) = (
        select max(latest.id) from ${s.shipmentRateAdjustmentRequests} latest
        where latest.shipment_id = ${s.shipmentRateAdjustmentRequests.shipmentId}
          and latest.withdrawn_at is null
      )`,
    ));
  const adjByLot = new Map(adjRows.map((row) => [row.shipmentId, row]));

  // FB-094 (card 201026112300): the consolidated debit-note export only
  // accepts lots with an ACTIVE cost lock, so the board carries each lot's
  // lock timestamp — the row's export eligibility the close flow needs
  // (historic unlocked locks stay null: only unlockedAt IS NULL counts).
  const activeLockRows = await executor.select({
    shipmentId: s.shipmentCostLocks.shipmentId,
    lockedAt: s.shipmentCostLocks.lockedAt,
  }).from(s.shipmentCostLocks)
    .where(and(
      inArray(s.shipmentCostLocks.shipmentId, lotIds),
      isNull(s.shipmentCostLocks.unlockedAt),
    ));
  const activeLockByLot = new Map(activeLockRows.map((row) => [row.shipmentId, row.lockedAt] as const));

  // Resolve external-carrier names in ONE customers query, then assemble
  // Phân xe labels per lot: OWN plate and/or carrier name (+ external plate
  // fallback when the carrier has no name row).
  const externalNameRows = carrierNameIds.size > 0 ? await executor.select({
    id: s.customers.id,
    // Card 191026202000: Phân xe carrier labels ride the short name too.
    name: operationalName(s.customers.shortName, s.customers.name),
  }).from(s.customers)
    .where(inArray(s.customers.id, [...carrierNameIds])) : [];
  const externalNames = new Map(externalNameRows.map((r) => [r.id, r.name]));
  const phanXeByLot = new Map<number, string[]>();
  for (const [lotId, entries] of phanXeRaw) {
    const labels: string[] = [];
    for (const entry of entries) {
      const carrierName = entry.carrierId != null ? externalNames.get(entry.carrierId) : null;
      if (carrierName) labels.push(carrierName);
      else if (entry.plate) labels.push(entry.plate);
      if (entry.externalId != null) {
        const name = externalNames.get(entry.externalId);
        if (name) labels.push(name);
        else if (entry.externalPlate) labels.push(entry.externalPlate);
      }
    }
    phanXeByLot.set(lotId, [...new Set(labels)]);
  }
  // SPEC 18/10/2026 §6.2 — trip-less LCL lots keep their assigned vehicle
  // source visible (the trip projection above has no row to read).
  for (const lot of lots) {
    if (lot.cargoMode !== 'LCL' || phanXeByLot.has(lot.id)) continue;
    const planned = plannedCarrierByLot.get(lot.id);
    if (planned == null) continue;
    const labels: string[] = [];
    if (planned.carrierType === 'OWN') {
      labels.push('Đội xe nội bộ SilverSea');
    } else if (planned.externalId != null) {
      const name = externalNames.get(planned.externalId);
      if (name) labels.push(name);
      else if (planned.plate) labels.push(planned.plate);
    } else if (planned.plate) {
      labels.push(planned.plate);
    }
    if (labels.length > 0) phanXeByLot.set(lot.id, [...new Set(labels)]);
  }

  // Card 20260928_162 criterion 3 (lead ruling (b)). This board carries a
  // "Ghi chú" column that was hardcoded null, so the reason an uncharged Ops
  // cost is REQUIRED to carry never reached the page whose title matches the
  // card verbatim — and the page where kế toán ticks rows and bills the customer
  // on the debit. Reuses the SAME projection as the dispatch board; no second
  // copy of the note is derived here. Same executor default (db) as this file.
  const opsNotesByShipment = await loadDispatchExpenseNotes(lots.map((lot) => lot.id), executor);

  // Row assembly — P1 arithmetic: Tổng 1 EXCLUDES Phí RU; lợi nhuận =
  // Tổng thu − Tổng 1 − Phí RU (null when any component null).
  const items: AccountingDebitBoardRow[] = lots.map((lot) => {
    // F-2 ruling (b): the override-channel value when the lot qualifies, the
    // snapshot value otherwise — ONE effective freight drives Cước thu and
    // Tổng thu so the merged 100%/0₫ law cannot desync between them.
    const freight = effectiveFreightByLot.get(lot.id) ?? null;
    const psAuto = psAutoByLot.get(lot.id);
    const zoneCharge = zoneChargeByLot.get(lot.id);
    const otherSell = otherSellByLot.get(lot.id);
    const otherSellKnownFlag = otherSellKnown.has(lot.id);
    const zoneCost = zoneCostByLot.get(lot.id);
    const otherOps = otherOpsByLot.get(lot.id);
    const carrier = carrierByLot.get(lot.id);
    const adj = adjByLot.get(lot.id);
    const cuocThu = freight != null ? money(freight) : null;
    const lachHuyenThu = zoneChargeByLot.has(lot.id) ? money(zoneChargeByLot.get(lot.id)!) : null;
    const phuPs = psAuto != null ? money(psAuto) : null;
    const phatSinhCus = otherSellKnownFlag ? money(otherSell ?? 0) : null;
    const thuComponents = [
      { known: freight != null, value: freight ?? 0 },
      { known: zoneChargeByLot.has(lot.id), value: zoneCharge ?? 0 },
      { known: psAuto != null, value: psAuto ?? 0 },
      { known: otherSellKnownFlag, value: otherSell ?? 0 },
    ];
    const tongThu = thuComponents.some((c) => c.known)
      ? money(thuComponents.reduce((sum, c) => sum + c.value, 0))
      : null;
    const cuocTraDv = carrier?.known ? money(carrier.total) : null;
    const lachHuyenDv = zoneCostByLot.has(lot.id) ? money(zoneCost ?? 0) : null;
    const phatSinhDv = otherOpsByLot.has(lot.id) ? money(otherOps ?? 0) : null;
    const traComponents = [
      { known: carrier?.known ?? false, value: carrier?.known ? (carrier.total ?? 0) : 0 },
      { known: zoneCostByLot.has(lot.id), value: zoneCost ?? 0 },
      { known: otherOpsByLot.has(lot.id), value: otherOps ?? 0 },
    ];
    const tong1 = traComponents.some((c) => c.known)
      ? money(traComponents.reduce((sum, c) => sum + c.value, 0))
      : null;
    const phiRu = ruByLot.has(lot.id) ? money(ruByLot.get(lot.id)!) : null;
    const thuNum = tongThu == null ? null : Number(tongThu);
    const traNum = tong1 == null ? null : Number(tong1);
    const ruNum = phiRu == null ? null : Number(phiRu);
    const loiNhuan = thuNum != null && traNum != null && ruNum != null
      ? money(thuNum - traNum - ruNum)
      : null;
    return {
      shipmentId: lot.id,
      code: lot.code,
      customerName: lot.customerName,
      customerId: lot.customerId,
      carrierKeys: carrierKeysForLot(phanXeRaw.get(lot.id) ?? []),
      ngay: lot.ngay,
      billOrBooking: billOrBookNumberFor(lot.tradeDirection, lot.blNumber, lot.bookingRef),
      containers: containersByLot.get(lot.id) ?? [],
      // FB-094 (card 201026112300): ACTIVE lock time — the row's eligibility
      // for the consolidated debit-note export.
      costLockedAt: activeLockByLot.get(lot.id)?.toISOString() ?? null,
      // Card 161026232419: the LCL PHÂN XE cell renders its line 1 name from
      // THESE labels — derived in memory from the ONE batched trip query
      // above, never a per-row read — so every LCL lot ships the same nhà xe
      // identity the FCL cell shows.
      phanXe: phanXeByLot.get(lot.id) ?? [],
      lcl: lot.cargoMode === 'LCL' ? {
        label: [
          'Lẻ',
          lot.revVehicleClassId != null && lclClassCodes.has(lot.revVehicleClassId)
            ? `Thu: ${lclClassCodes.get(lot.revVehicleClassId)}` : null,
          lot.costVehicleClassId != null && lclClassCodes.has(lot.costVehicleClassId)
            ? `Trả: ${lclClassCodes.get(lot.costVehicleClassId)}` : null,
        ].filter(Boolean).join(' · '),
        actualTruckNo: lot.actualTruckNo,
        billingTruckNo: lot.billingTruckNo,
        revGroupId: lot.revGroupId,
        ghépCùngRef: (lot.revGroupId != null && (lot.revGroupOrder ?? 1) > 1
          ? lclPrincipalRefs.get(lot.revGroupId) ?? null
          : lot.costGroupId != null && (lot.costGroupOrder ?? 1) > 1
            ? lclPrincipalRefs.get(lot.costGroupId) ?? null
            : null),
      } : null,
      thu: { cuocThu, lachHuyen: lachHuyenThu, phuPs, phatSinhCus, tongThu },
      tra: { cuocTraDv, lachHuyenDv, phatSinhDv, tong1, phiRu },
      loiNhuan,
      ghiChu: opsNotesByShipment.get(lot.id)?.join(' · ') ?? null,
      adjustment: adj == null
        ? { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null }
        : {
            status: adj.status as 'PENDING' | 'CONFIRMED',
            requestId: adj.id,
            requestedAt: adj.requestedAt.toISOString(),
            confirmedAt: adj.confirmedAt?.toISOString() ?? null,
          },
    };
  });
  return { items, total: items.length };
}

// ─── Rate-adjustment requests (đối soát only — NEVER changes rates) ────────
// P3: confirm/withdraw NEVER touch any money field; corrections live in the
// existing editing surfaces. Roles enforced at the route level (office set).

/** P2: a lot with an ACTIVE cost lock is frozen — no new requests. */

export async function createRateAdjustmentRequests(input: {
  shipmentIds: number[];
  ghiChu?: string;
  userId: number;
}, transaction?: Tx): Promise<{ requested: number[]; alreadyPending: number[]; locked: number[] }> {
  const execute = async (tx: Tx) => {
    const shipmentIds = [...new Set(input.shipmentIds)].sort((a, b) => a - b);
    await lockApplicationOwnedUniquenessSet(tx, shipmentIds.map((id) => ({ scope: 'shipment-rate-adjustment', parts: [id] })));
    const requested: number[] = [];
    const alreadyPending: number[] = [];
    const locked: number[] = [];
    if (shipmentIds.length === 0) return { requested, alreadyPending, locked };

    // Three set reads instead of three reads per shipment; per-item outcomes
    // are resolved in memory in the same sorted order as before.
    const existingShipments = await tx.select({ id: s.shipments.id }).from(s.shipments)
      .where(and(inArray(s.shipments.id, shipmentIds), isNull(s.shipments.deletedAt)));
    const existingIds = new Set(existingShipments.map((r) => r.id));
    const missingId = shipmentIds.find((id) => !existingIds.has(id));
    if (missingId !== undefined) throw new ApiError(404, 'Lô hàng không tồn tại hoặc đã bị xóa.');

    const activeLockRows = await tx.select({ shipmentId: s.shipmentCostLocks.shipmentId })
      .from(s.shipmentCostLocks)
      .where(and(inArray(s.shipmentCostLocks.shipmentId, shipmentIds), isNull(s.shipmentCostLocks.unlockedAt)));
    const lockedIds = new Set(activeLockRows.map((r) => r.shipmentId));

    const pendingRows = await tx.select({ shipmentId: s.shipmentRateAdjustmentRequests.shipmentId })
      .from(s.shipmentRateAdjustmentRequests)
      .where(and(inArray(s.shipmentRateAdjustmentRequests.shipmentId, shipmentIds),
        eq(s.shipmentRateAdjustmentRequests.status, 'PENDING'), isNull(s.shipmentRateAdjustmentRequests.withdrawnAt)));
    const pendingIds = new Set(pendingRows.map((r) => r.shipmentId));

    const insertValues: Array<{ shipmentId: number; ghiChu: string | null; requestedBy: number }> = [];
    for (const shipmentId of shipmentIds) {
      if (lockedIds.has(shipmentId)) { locked.push(shipmentId); continue; }
      if (pendingIds.has(shipmentId)) { alreadyPending.push(shipmentId); continue; }
      insertValues.push({ shipmentId, ghiChu: input.ghiChu ?? null, requestedBy: input.userId });
      requested.push(shipmentId);
    }
    if (insertValues.length > 0) {
      await tx.insert(s.shipmentRateAdjustmentRequests).values(insertValues);
    }
    return { requested, alreadyPending, locked };
  };
  return transaction ? execute(transaction) : db.transaction(execute);
}

export async function confirmRateAdjustmentRequests(input: {
  requestIds: number[];
  userId: number;
}, executor: Executor = db): Promise<{ confirmed: number }> {
  const updated = await executor.update(s.shipmentRateAdjustmentRequests)
    .set({ status: 'CONFIRMED', confirmedBy: input.userId, confirmedAt: new Date() })
    .where(and(
      inArray(s.shipmentRateAdjustmentRequests.id, input.requestIds),
      eq(s.shipmentRateAdjustmentRequests.status, 'PENDING'),
      isNull(s.shipmentRateAdjustmentRequests.withdrawnAt),
    ))
    .returning({ id: s.shipmentRateAdjustmentRequests.id });
  return { confirmed: updated.length };
}

export async function withdrawRateAdjustmentRequests(input: {
  requestIds: number[];
  userId: number;
}, executor: Executor = db): Promise<{ withdrawn: number }> {
  const updated = await executor.update(s.shipmentRateAdjustmentRequests)
    .set({ withdrawnAt: new Date() })
    .where(and(
      inArray(s.shipmentRateAdjustmentRequests.id, input.requestIds),
      eq(s.shipmentRateAdjustmentRequests.status, 'PENDING'),
      isNull(s.shipmentRateAdjustmentRequests.withdrawnAt),
    ))
    .returning({ id: s.shipmentRateAdjustmentRequests.id });
  return { withdrawn: updated.length };
}

/** The debit-export guard (both issuance routes 409 while PENDING). */
export async function assertNoPendingRateAdjustment(shipmentIds: number[], executor: Executor = db): Promise<void> {
  if (shipmentIds.length === 0) return;
  const pending = await executor.select({
    shipmentId: s.shipmentRateAdjustmentRequests.shipmentId,
    code: s.shipments.shipmentCode,
  }).from(s.shipmentRateAdjustmentRequests)
    .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentRateAdjustmentRequests.shipmentId))
    .where(and(
      inArray(s.shipmentRateAdjustmentRequests.shipmentId, shipmentIds),
      eq(s.shipmentRateAdjustmentRequests.status, 'PENDING'),
      isNull(s.shipmentRateAdjustmentRequests.withdrawnAt),
    ));
  if (pending.length > 0) {
    throw new ApiError(409, `Lô ${pending.map((p) => p.code ?? `#${p.shipmentId}`).join(', ')} đang chờ đối soát cước`);
  }
}
