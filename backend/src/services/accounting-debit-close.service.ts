// Card 20260921_21 — KẾ HOẠCH ĐIỀU ĐỘNG TỔNG HỢP (accounting chốt-debit CORE):
// per-lot thu/trả board + rate-adjustment requests that block debit export.
//
// Column sources (plan rev 4 §A3, P1 arithmetic):
//   thu:  Cước thu auto = active freight-rate snapshots (freightAmount);
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
import { db } from '../db';
import { ApiError } from '../errors';
import { activeTripConditions } from './active-trip-scope';
import { billOrBookNumberFor } from './cus-workspace-mapping.service';
import type { Tx } from './trip-shared';

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
  ngay: string | null;
  billOrBooking: string | null;
  containers: string[];
  phanXe: string[];
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
}

export async function getAccountingDebitBoard(query: {
  dateFrom?: string;
  dateTo?: string;
}): Promise<{ items: AccountingDebitBoardRow[]; total: number }> {
  const conditions = [isNull(s.shipments.deletedAt)];
  if (query.dateFrom) conditions.push(gte(s.shipments.expectedDeliveryDate, query.dateFrom));
  if (query.dateTo) conditions.push(lte(s.shipments.expectedDeliveryDate, query.dateTo));
  const lots = await db.select({
    id: s.shipments.id,
    code: s.shipments.shipmentCode,
    customerId: s.shipments.customerId,
    customerName: s.customers.name,
    routeId: s.shipments.routeId,
    ngay: s.shipments.expectedDeliveryDate,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
    tradeDirection: s.shipments.tradeDirection,
  })
    .from(s.shipments)
    .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId))
    .where(and(...conditions))
    .orderBy(s.shipments.expectedDeliveryDate, s.shipments.id);
  if (lots.length === 0) return { items: [], total: 0 };
  const lotIds = lots.map((lot) => lot.id);

  // Cước thu auto + Phụ ps auto: the active freight-rate grain (per-trip
  // freezes are additive legs; the dispatch freeze supersedes the intake
  // freeze) — same grain rule as shipment-debit-summary. Cước thu = the
  // freight component; Phụ ps = the surcharge component of the same grain.
  const grainRows = await db.select({
    shipmentId: s.freightRateSnapshots.shipmentId,
    tripId: s.freightRateSnapshots.tripId,
    freightAmount: s.freightRateSnapshots.freightAmount,
    surchargeAmount: s.freightRateSnapshots.surchargeAmount,
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
  const freightByLot = new Map<number, number>();
  const psAutoByLot = new Map<number, number>();
  const tripLegs = new Map<number, { freight: number; surcharge: number }>();
  const intake = new Map<number, { freight: number; surcharge: number }>();
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
      intake.set(lot, leg);
    }
  }
  for (const lot of lotIds) {
    const pick = tripLegs.get(lot) ?? intake.get(lot);
    if (pick !== undefined) {
      freightByLot.set(lot, pick.freight);
      psAutoByLot.set(lot, pick.surcharge);
    }
  }

  // Lạch Huyện cells + Phát sinh ĐV: ops-expense rows per lot.
  // ZONE_SURCHARGE rows carry BOTH sides (amount = điều vận cost;
  // customerChargeAmount = negotiated customer charge). Other ops rows =
  // Phát sinh ĐV. Known when rows exist — never a fabricated 0.
  const zoneCode = 'ZONE_SURCHARGE';
  const opsRows = await db.select({
    shipmentId: s.opsExpenseEntries.shipmentId,
    expenseTypeCode: s.opsExpenseEntries.expenseTypeCode,
    amount: s.opsExpenseEntries.amount,
    customerChargeAmount: s.opsExpenseEntries.customerChargeAmount,
  }).from(s.opsExpenseEntries)
    .where(inArray(s.opsExpenseEntries.shipmentId, lotIds));
  const zoneCostByLot = new Map<number, number>();
  const zoneChargeByLot = new Map<number, number>();
  const otherOpsByLot = new Map<number, number>();
  for (const row of opsRows) {
    const lot = row.shipmentId;
    if (lot == null) continue;
    if (row.expenseTypeCode === zoneCode) {
      zoneCostByLot.set(lot, (zoneCostByLot.get(lot) ?? 0) + toNumber(row.amount));
      if (row.customerChargeAmount != null) {
        zoneChargeByLot.set(lot, (zoneChargeByLot.get(lot) ?? 0) + toNumber(row.customerChargeAmount));
      }
    } else {
      otherOpsByLot.set(lot, (otherOpsByLot.get(lot) ?? 0) + toNumber(row.amount));
    }
  }

  // Phát sinh cus: OTHER trip_expenses sell side (existing receivable rollup
  // precedent). Known when the lot has trip-expense rows at all.
  const revenueRows = await db.select({
    shipmentId: s.trips.shipmentId,
    expenseType: s.tripExpenses.expenseType,
    sell: s.tripExpenses.sellAmount,
  }).from(s.tripExpenses)
    .innerJoin(s.trips, and(
      eq(s.trips.id, s.tripExpenses.tripId),
      inArray(s.trips.shipmentId, lotIds),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
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

  // Phân xe labels: a trip's truck shows the OWNING carrier customer's name
  // when subcontracted (trucks.carrierId), otherwise the own-fleet plate;
  // external-carrier trips show the customer-as-carrier name
  // (accounting-transport-register precedent).
  const tripRows = await db.select({
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

  // Thông số container labels per lot (shipment_containers).
  const containerRows = await db.select({
    shipmentId: s.shipmentContainers.shipmentId,
    containerNumber: s.shipmentContainers.containerNumber,
    containerTypeId: s.shipmentContainers.containerTypeId,
  }).from(s.shipmentContainers)
    .where(inArray(s.shipmentContainers.shipmentId, lotIds));
  const containerTypeRows = await db.select({ id: s.containerTypes.id, name: s.containerTypes.name })
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
  const ruRateRows = routeIds.length > 0 ? await db.select({
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
  const adjRows = await db.select({
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

  // Resolve external-carrier names in ONE customers query, then assemble
  // Phân xe labels per lot: OWN plate and/or carrier name (+ external plate
  // fallback when the carrier has no name row).
  const externalNameRows = carrierNameIds.size > 0 ? await db.select({
    id: s.customers.id,
    name: s.customers.name,
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

  // Row assembly — P1 arithmetic: Tổng 1 EXCLUDES Phí RU; lợi nhuận =
  // Tổng thu − Tổng 1 − Phí RU (null when any component null).
  const items: AccountingDebitBoardRow[] = lots.map((lot) => {
    const freight = freightByLot.get(lot.id);
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
      ngay: lot.ngay,
      billOrBooking: billOrBookNumberFor(lot.tradeDirection, lot.blNumber, lot.bookingRef),
      containers: containersByLot.get(lot.id) ?? [],
      phanXe: phanXeByLot.get(lot.id) ?? [],
      thu: { cuocThu, lachHuyen: lachHuyenThu, phuPs, phatSinhCus, tongThu },
      tra: { cuocTraDv, lachHuyenDv, phatSinhDv, tong1, phiRu },
      loiNhuan,
      ghiChu: null,
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
async function findActiveCostLock(shipmentId: number, conn: typeof db | Tx) {
  const [lock] = await conn.select({ id: s.shipmentCostLocks.id })
    .from(s.shipmentCostLocks)
    .where(and(
      eq(s.shipmentCostLocks.shipmentId, shipmentId),
      isNull(s.shipmentCostLocks.unlockedAt),
    ));
  return lock ?? null;
}

export async function createRateAdjustmentRequests(input: {
  shipmentIds: number[];
  ghiChu?: string;
  userId: number;
}, conn: typeof db | Tx = db): Promise<{ requested: number[]; alreadyPending: number[]; locked: number[] }> {
  const requested: number[] = [];
  const alreadyPending: number[] = [];
  const locked: number[] = [];
  for (const shipmentId of input.shipmentIds) {
    const lock = await findActiveCostLock(shipmentId, conn);
    if (lock) { locked.push(shipmentId); continue; }
    // INSERT..SELECT WHERE NOT EXISTS — atomic guard replacing the partial
    // unique index (P5). Runs inside the caller's tx when provided (the
    // runIdempotent boundary), so the idempotency record and the request
    // row commit or roll back together.
    await conn.execute(sql`insert into ${s.shipmentRateAdjustmentRequests} ("shipment_id", "ghi_chu", "requested_by")
      select ${shipmentId}, ${input.ghiChu ?? null}, ${input.userId}
      where not exists (
        select 1 from ${s.shipmentRateAdjustmentRequests}
        where "shipment_id" = ${shipmentId} and status = 'PENDING' and withdrawn_at is null
      )`);
    const [live] = await conn.select({ id: s.shipmentRateAdjustmentRequests.id })
      .from(s.shipmentRateAdjustmentRequests)
      .where(and(
        eq(s.shipmentRateAdjustmentRequests.shipmentId, shipmentId),
        eq(s.shipmentRateAdjustmentRequests.status, 'PENDING'),
        isNull(s.shipmentRateAdjustmentRequests.withdrawnAt),
      ));
    if (live) requested.push(shipmentId);
    else alreadyPending.push(shipmentId);
  }
  return { requested, alreadyPending, locked };
}

export async function confirmRateAdjustmentRequests(input: {
  requestIds: number[];
  userId: number;
}, conn: typeof db | Tx = db): Promise<{ confirmed: number }> {
  const updated = await conn.update(s.shipmentRateAdjustmentRequests)
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
}, conn: typeof db | Tx = db): Promise<{ withdrawn: number }> {
  const updated = await conn.update(s.shipmentRateAdjustmentRequests)
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
export async function assertNoPendingRateAdjustment(shipmentIds: number[]): Promise<void> {
  if (shipmentIds.length === 0) return;
  const pending = await db.select({
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
