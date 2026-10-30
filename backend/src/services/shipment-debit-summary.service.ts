// Chi phí - Quyết toán (Debit CUS) Lớp 1 — per-lot revenue rollup.
//
// One read-only service behind GET /api/shipments/debit-summary: per lot the
// auto freight (freight-rate snapshots; F-2 ruling (b): LCL REV-grouped or
// override-stamped lots read the trip_financial_state.revenue override
// channel instead), tổng chi hộ (trip expenses = what SS pays on the
// customer's behalf), tổng phải thu khách (attributed debit-note lines) and
// the derived profit. PRD money fields are nullable; null means
// "chưa xác định" — never a false 0.
//
// Debit-lock sync: 🔓/🔒 follows the shipment_cost_locks active lock (a lô
// lock, NOT the kỳ kế toán lock) — LOCKED + lockedAt while one is active.
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import * as s from '../db/schema';
import { db } from '../db';
import { liveDebitOpsExpense, liveDebitTripExpense, standaloneDebitTripRevenue } from './live-debit-expense-scope';
import type { ShipmentDebitSummaryItem, ShipmentDebitSummaryResponse } from '@tingting/shared';
import { effectiveLotContainerCount } from '@tingting/shared';
import { loadFreightSnapshotChannelByLot, loadRevenueOverrideByLot } from './revenue-override-read.service';
import { billOrBookNumberFor } from './cus-workspace-mapping.service';
import { effectiveLclFreight } from './lcl-effective-freight';

function toNumber(value: string | number | null | undefined): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

export async function getShipmentDebitSummary(query: {
  /** Card _202: absent = every customer, not "no rows". */
  customerId?: number;
  deliveryDateFrom?: string;
  deliveryDateTo?: string;
  lockStatus: 'ALL' | 'OPEN' | 'LOCKED';
}): Promise<ShipmentDebitSummaryResponse> {
  const conditions = [isNull(s.shipments.deletedAt)];
  if (query.customerId != null) conditions.push(eq(s.shipments.customerId, query.customerId));
  if (query.deliveryDateFrom) conditions.push(gte(s.shipments.expectedDeliveryDate, query.deliveryDateFrom));
  if (query.deliveryDateTo) conditions.push(lte(s.shipments.expectedDeliveryDate, query.deliveryDateTo));
  const lots = await db.select({
    id: s.shipments.id,
    code: s.shipments.shipmentCode,
    customerId: s.shipments.customerId,
    customerName: s.customers.name,
    factoryName: s.operationalSites.shortName,
    factoryAddress: s.operationalSites.address,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
    tradeDirection: s.shipments.tradeDirection,
    // SIL-478 — the phone row's meta line rides the lot's own delivery date
    // (the same edd the list orders/filters by).
    expectedDeliveryDate: s.shipments.expectedDeliveryDate,
    // GP-01 (2026-10-23) — cargo measures for the CUS merge bar's total
    // tấn/CBM (same columns the dispatch grids read).
    cargoWeightKg: s.shipments.cargoWeightKg,
    cargoVolumeCbm: s.shipments.cargoVolumeCbm,
    // FB-092/093 LCL grouping facts (read raw here; class codes + member
    // counts resolve in the batched lookups below).
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
  .leftJoin(s.operationalSites, eq(s.operationalSites.id, s.shipments.operationalSiteId))
    .where(and(...conditions))
    .orderBy(s.shipments.expectedDeliveryDate, s.shipments.id);
  if (lots.length === 0) return { items: [], total: 0, excludedCount: 0, excludedSum: '0', excludedTrips: [] };
  const lotIds = lots.map((lot) => lot.id);

  // FB-092/093 — vehicle class codes for both pricing dimensions (thu ≠ trả
  // by design: the spec prices one group at "Thu: 3.5T | Trả: 10T").
  const vehicleClassIds = [...new Set(
    lots.flatMap((lot) => [lot.costVehicleClassId, lot.revVehicleClassId])
      .filter((id): id is number => id != null),
  )];
  const vehicleClassCodesById = new Map(
    vehicleClassIds.length === 0
      ? []
      : (await db.select({ id: s.vehicleSizeClasses.id, code: s.vehicleSizeClasses.code })
        .from(s.vehicleSizeClasses)
        .where(inArray(s.vehicleSizeClasses.id, vehicleClassIds)))
        .map((row) => [row.id, row.code] as const),
  );
  // Group member counts + each member's principal reference, both dimensions.
  // LIVE rows only — a soft-deleted lot keeps its group id while the §4
  // delete-promotion renumbers the survivors, so ghosts must neither count
  // toward N nor be cited as the principal (card 181026145000).
  const costGroupIds = [...new Set(lots.map((lot) => lot.costGroupId).filter((id): id is string => id != null))];
  const revGroupIds = [...new Set(lots.map((lot) => lot.revGroupId).filter((id): id is string => id != null))];
  const countGroups = async (groupIds: string[], column: AnyPgColumn) => {
    if (groupIds.length === 0) return new Map<string, number>();
    const rows = await db.select({ groupId: column, memberCount: sql<number>`count(*)` })
      .from(s.shipments)
      .where(and(inArray(column, groupIds), isNull(s.shipments.deletedAt)))
      .groupBy(column);
    return new Map(rows.map((row) => [row.groupId as string, Number(row.memberCount)] as const));
  };
  const loadPrincipalRefs = async (
    groupIds: string[],
    groupColumn: AnyPgColumn,
    orderColumn: AnyPgColumn,
  ): Promise<Map<string, string>> => {
    if (groupIds.length === 0) return new Map();
    const principals = await db.select({
      groupId: groupColumn,
      blNumber: s.shipments.blNumber,
      bookingRef: s.shipments.bookingRef,
    }).from(s.shipments)
      .where(and(isNull(s.shipments.deletedAt), eq(orderColumn, 1), inArray(groupColumn, groupIds)));
    return new Map(principals
      .map((row) => [row.groupId!, row.blNumber ?? row.bookingRef ?? ''] as const)
      .filter(([, ref]) => ref !== ''));
  };
  const [costGroupCounts, revGroupCounts, costPrincipalRefs, revPrincipalRefs] = await Promise.all([
    countGroups(costGroupIds, s.shipments.costGroupId),
    countGroups(revGroupIds, s.shipments.revGroupId),
    loadPrincipalRefs(costGroupIds, s.shipments.costGroupId, s.shipments.costGroupOrder),
    loadPrincipalRefs(revGroupIds, s.shipments.revGroupId, s.shipments.revGroupOrder),
  ]);

  const declarations = await db.select({
    shipmentId: s.shipmentDeclarations.shipmentId,
    number: s.shipmentDeclarations.declarationNumber,
  }).from(s.shipmentDeclarations)
    .where(inArray(s.shipmentDeclarations.shipmentId, lotIds))
    .orderBy(s.shipmentDeclarations.id);
  const declarationNumbersByLot = new Map<number, Set<string>>();
  for (const declaration of declarations) {
    const number = declaration.number?.trim();
    if (!number) continue;
    const numbers = declarationNumbersByLot.get(declaration.shipmentId) ?? new Set<string>();
    numbers.add(number);
    declarationNumbersByLot.set(declaration.shipmentId, numbers);
  }

  // Auto freight: the SNAPSHOT channel assembly (INSERT-only supersede
  // semantics, per-trip additive legs vs the trip-NULL intake freeze) lives
  // in revenue-override-read.service — ONE reader rule shared with SIL-548's
  // manual-price prefill (`loadRevManualPriceByLot`), byte-for-byte.
  const snapshotChannelByLot = await loadFreightSnapshotChannelByLot(db, lotIds);

  // F-2 (card 161026113900, owner ruling b) + FB-145 (card 231026163927):
  // CƯỚC VẬN TẢI (AUTO) follows ONE pure rule — `effectiveLclFreight`
  // (lcl-effective-freight.ts, pinned by unit tests). LCL-only keeps every
  // FCL lot on the snapshot channel byte-for-byte. Spec §3.2: members read
  // 0₫ with the reason note; chi hộ still counts into TỔNG PHẢI THU KHÁCH —
  // only the freight component follows the group law. FB-145: once the lot
  // is UNGROUPED, a group artifact behind its money (member-zero tail or the
  // "chờ định giá lại" citation) reads "Chưa xác định" — never a stale 0₫.
  const overrideByLot = await loadRevenueOverrideByLot(db, lotIds);
  const effectiveFreightByLot = new Map<number, { value: number | null; reason: string | null }>();
  for (const lot of lots) {
    const override = overrideByLot.get(lot.id) ?? null;
    effectiveFreightByLot.set(lot.id, effectiveLclFreight({
      snapshotChannel: snapshotChannelByLot.get(lot.id) ?? null,
      override: override == null
        ? null
        : { total: override.total, reason: override.reason, stamped: override.stamped },
      revGroupId: lot.revGroupId ?? null,
      revGroupOrder: lot.revGroupOrder ?? null,
      revPrincipalRef: lot.revGroupId != null ? revPrincipalRefs.get(lot.revGroupId) ?? null : null,
      cargoMode: lot.cargoMode,
    }));
  }

  // Tổng chi hộ: what SS pays on the lot's live trips (CVC + Ops fees).
  // Card 20260928_181 — a negative expense row behaves as if it did not
  // exist, so the SQL aggregate filters it out (buy_amount > 0 means
  // "not negative" here: amounts are whole VND and 0 is rejected at intake).
  const chiHoRows = await db.select({
    shipmentId: s.trips.shipmentId,
    total: sql<string>`coalesce(sum(${s.tripExpenses.buyAmount}) filter (where ${s.tripExpenses.buyAmount} > 0), 0)::text`,
  }).from(s.tripExpenses)
    .innerJoin(s.trips, and(
      eq(s.trips.id, s.tripExpenses.tripId),
      liveDebitTripExpense(),
      inArray(s.trips.shipmentId, lotIds),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
      // Card 20260924_2: fulfillment-NULL trips render nowhere in Lớp 2 —
      // their fees are shadow money, out of the chốt-able totals.
      isNotNull(s.trips.fulfillmentId),
    ))
    .groupBy(s.trips.shipmentId);
  const chiHoByLot = new Map(chiHoRows.map((row) => [row.shipmentId, toNumber(row.total)]));
  const tripCountRows = await db.select({
    shipmentId: s.trips.shipmentId,
    total: sql<number>`count(*)::int`,
    // SIL-478 — the phone meta's "n cont": Σ container_count over the same
    // active-trip scope (physical containers on the lot — NOT the chốt's
    // fulfillment-only money scope; the shadow line still owns that law).
    // SIL-601 (id 702) supersedes that Σ for LCL only: the projection below
    // counts one LCL lot as exactly 1 cont (1 lô cont 1 cont).
    containers: sql<number>`coalesce(sum(${s.trips.containerCount}), 0)::int`,
  }).from(s.trips)
    .where(and(
      inArray(s.trips.shipmentId, lotIds),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
    ))
    .groupBy(s.trips.shipmentId);
  const tripCountByLot = new Map(tripCountRows.map((row) => [row.shipmentId, row.total]));
  const containerCountByLot = new Map(tripCountRows.map((row) => [row.shipmentId, row.containers]));

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
      liveDebitTripExpense(),
      standaloneDebitTripRevenue(),
      inArray(s.trips.shipmentId, lotIds),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
      // Same shadow exclusion as chi hộ: unrevenuedable in Lớp 2.
      isNotNull(s.trips.fulfillmentId),
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
      // Card 20260928_181 — a negative buy row behaves as if absent, so it
      // contributes nothing to the pass-through recharge either.
      const buy = Number(row.buy ?? 0);
      if (buy >= 0) entry.derived += buy;
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
    // Card 20260928_181 — a negative Ops expense row behaves as if absent
    // (`cnt` still counts the row: visibility is never suppressed, only the
    // money total is).
    total: sql<string>`coalesce(sum(${s.opsExpenseEntries.amount}) filter (where ${s.opsExpenseEntries.amount} > 0), 0)::text`,
    cnt: sql<number>`count(*)::int`,
  }).from(s.opsExpenseEntries)
    .where(and(inArray(s.opsExpenseEntries.shipmentId, lotIds), liveDebitOpsExpense()))
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
    .where(and(inArray(s.opsExpenseEntries.shipmentId, lotIds), liveDebitOpsExpense()))
    .groupBy(s.opsExpenseEntries.shipmentId);
  const opsChargeByLot = new Map(opsChargeRows.map((row) => [row.shipmentId, {
    known: row.known > 0,
    total: toNumber(row.total),
  }]));

  // Card 20260924_2 — shadow totals: fees on trips with fulfillment_id NULL
  // render nowhere in Lớp 2 (lotTrips join shipment_fulfillments), so they
  // stay OUT of the chốt-able totals above. Silent exclusion is banned —
  // the excluded money surfaces as one explicit line over the same filtered
  // lot scope: N = trips, X = the excluded fees' buy-sum.
  const [shadow] = await db.select({
    trips: sql<number>`count(distinct ${s.trips.id})::int`,
    total: sql<string>`coalesce(sum(${s.tripExpenses.buyAmount}) filter (where ${s.tripExpenses.buyAmount} > 0), 0)::text`,
  }).from(s.tripExpenses)
    .innerJoin(s.trips, and(
      eq(s.trips.id, s.tripExpenses.tripId),
      liveDebitTripExpense(),
      inArray(s.trips.shipmentId, lotIds),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
      isNull(s.trips.fulfillmentId),
    ));

  // Case 2026-10-17 — the line must answer WHICH trips it excludes. Same
  // predicates as the aggregate above and the same >0 buy-sum filter, one row
  // per trip, so Σ feeSum === excludedSum and length === excludedCount. The
  // aggregate query stays the single source of the two pinned scalars.
  const shadowTripRows = await db.select({
    tripId: s.trips.id,
    tripCode: s.trips.tripCode,
    shipmentId: s.trips.shipmentId,
    departureDate: s.trips.departureDate,
    feeSum: sql<string>`coalesce(sum(${s.tripExpenses.buyAmount}) filter (where ${s.tripExpenses.buyAmount} > 0), 0)::text`,
  }).from(s.tripExpenses)
    .innerJoin(s.trips, and(
      eq(s.trips.id, s.tripExpenses.tripId),
      liveDebitTripExpense(),
      inArray(s.trips.shipmentId, lotIds),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
      isNull(s.trips.fulfillmentId),
    ))
    .groupBy(s.trips.id)
    .orderBy(s.trips.id);

  /** Frozen L1 figures for locked lots: missing snapshot keys (locks frozen
   *  before this landing) read null — Chưa xác định, never a fabricated 0. */

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
    // F-2 ruling (b): the override-channel value when the lot qualifies, the
    // snapshot value otherwise — ONE effective freight drives the column, the
    // receivable addend and profit so the merged 100%/0₫ law cannot desync
    // between them. The locked-receivable freeze (card _19) never mutates;
    // only these live columns follow the channel.
    const effectiveFreight = effectiveFreightByLot.get(lot.id) ?? { value: null, reason: null };
    const freightAuto = effectiveFreight.value;
    const chiHo = chiHoByLot.get(lot.id);
    const hasTrips = (tripCountByLot.get(lot.id) ?? 0) > 0;
    const lock = lockedByLot.get(lot.id);
    const revenue = revenueByLot.get(lot.id);
    const ps = psByLot.get(lot.id);
    const hasAnyRevenue = revenue != null
      || freightAuto != null
      || (ps?.known ?? false)
      || (opsChargeByLot.get(lot.id)?.known ?? false);
    const receivableValue = lock != null
      ? frozenNumber(lock.snapshot, 'receivableTotal')
      : hasAnyRevenue
        ? (revenue?.otherSell ?? 0)
          + (revenue?.derived ?? 0)
          + (freightAuto ?? 0)
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
      // The row's OWN customer: the list can span customers, so the L2
      // workspace's fee catalog keys off this, never off the caller's filter.
      customerId: lot.customerId ?? null,
      shipmentId: lot.id,
      code: lot.code,
      customerName: lot.customerName,
      factoryName: lot.factoryName ?? null,
      factoryAddress: lot.factoryAddress,
      billOrBookNumber: billOrBookNumberFor(lot.tradeDirection, lot.blNumber, lot.bookingRef),
      customsNumber: [...(declarationNumbersByLot.get(lot.id) ?? [])].join(', ') || null,
      // SIL-478 — the phone row's meta segments (ngày giao · n cont). Both
      // null on an intake-only lot: the FE drops the segment, never a 0.
      deliveryDate: lot.expectedDeliveryDate ?? null,
      // SIL-601 (id 702, owner ruling 30/10/2026): one LCL lot ≡ 1-cont lot —
      // never 0 (intake-only lot) and never the Σ over trips (a multi-trip
      // lot read "N cont"). FCL keeps the active-trip Σ.
      containerCount: effectiveLotContainerCount(lot.cargoMode, tripCountByLot.has(lot.id) ? (containerCountByLot.get(lot.id) ?? null) : null),
      documentsSummary: null,
      // GP-01 — the merge bar's cargo totals read the lot's own measures.
      cargoWeightKg: lot.cargoWeightKg ?? null,
      cargoVolumeCbm: lot.cargoVolumeCbm ?? null,
      freightAuto: freightAuto == null ? null : String(freightAuto),
      // F-2: the override stamp behind the money column — the spec §3.2
      // "chú thích nhỏ bên dưới" under CƯỚC VẬN TẢI (AUTO) ("Ghép cước cùng
      // Bill X" / FB-095 re-stamps). null when the snapshot channel
      // produced the value.
      freightOverrideReason: effectiveFreight.reason,
      chiHoTotal: hasTrips || chiHo != null ? String(chiHo ?? 0) : null,
      receivableTotal: receivableValue == null ? null : String(receivableValue),
      // Redesign 23/10 — the payableTotal split, live values (a locked lot's
      // frozen payable rides its snapshot; the split columns stay live).
      carrierCostTotal: externalFreight == null ? null : String(externalFreight),
      opsCostTotal: opsTotal == null ? null : String(opsTotal),
      payableTotal,
      profit: profit == null ? null : String(profit),
      lockStatus: (lock != null ? 'LOCKED' : 'OPEN') as 'LOCKED' | 'OPEN',
      lockedAt: lock?.lockedAt.toISOString() ?? null,
      // FB-092/093 LCL grouping facts.
      cargoMode: lot.cargoMode ?? null,
      costGroupId: lot.costGroupId,
      costGroupOrder: lot.costGroupOrder,
      revGroupId: lot.revGroupId,
      revGroupOrder: lot.revGroupOrder,
      costGroupMemberCount: lot.costGroupId != null ? costGroupCounts.get(lot.costGroupId) ?? null : null,
      revGroupMemberCount: lot.revGroupId != null ? revGroupCounts.get(lot.revGroupId) ?? null : null,
      actualTruckNo: lot.actualTruckNo,
      billingTruckNo: lot.billingTruckNo,
      costVehicleClassCode: lot.costVehicleClassId != null
        ? vehicleClassCodesById.get(lot.costVehicleClassId) ?? null
        : null,
      revVehicleClassCode: lot.revVehicleClassId != null
        ? vehicleClassCodesById.get(lot.revVehicleClassId) ?? null
        : null,
      // Members cite their principal's Bill/Booking; a principal cites nothing.
      costGroupPrincipalRef: lot.costGroupId != null && (lot.costGroupOrder ?? 1) > 1
        ? costPrincipalRefs.get(lot.costGroupId) ?? null
        : null,
      revGroupPrincipalRef: lot.revGroupId != null && (lot.revGroupOrder ?? 1) > 1
        ? revPrincipalRefs.get(lot.revGroupId) ?? null
        : null,
    };
  });
  const visible = query.lockStatus === 'ALL'
    ? items
    : items.filter((item) => item.lockStatus === query.lockStatus);
  // Identity list rides the un-filtered `items` (every lot in lotIds — the
  // shadow aggregate's own scope), so a lockStatus filter never drops a lot's
  // label out from under a trip the line still counts.
  const lotByIdentity = new Map(items.map((item) => [item.shipmentId, item]));
  const excludedTrips = shadowTripRows.flatMap((trip) => {
    // trips.shipment_id is a nullable column, but the inArray(lotIds) scope
    // above can never match NULL — a shadow row always names its lot. The
    // guard satisfies the column type without widening the payload contract.
    if (trip.shipmentId == null) return [];
    const lot = lotByIdentity.get(trip.shipmentId);
    return [{
      tripId: trip.tripId,
      tripCode: trip.tripCode,
      shipmentId: trip.shipmentId,
      lotLabel: lot ? (lot.billOrBookNumber || lot.customsNumber || '—') : '—',
      customerName: lot?.customerName ?? null,
      departureDate: trip.departureDate,
      feeSum: trip.feeSum,
    }];
  });
  return {
    items: visible,
    total: visible.length,
    excludedCount: shadow?.trips ?? 0,
    excludedSum: String(shadow?.total ?? '0'),
    excludedTrips,
  };
}
