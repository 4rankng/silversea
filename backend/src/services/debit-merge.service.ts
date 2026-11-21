// Task 2.3 (18/11) — Bảng Ghép bộ Debit: ONE per-lot 6-group rollup behind
// GET /api/accounting/debit-merge, read by BOTH the staff surface
// (/accounting/ghep-bo-debit) and the rebuilt CUS settlement screen
// (/shipments-debit).
//
// Every money column follows an EXISTING seam — nothing here invents a new
// aggregation:
//   Group 3 (Cước phải thu: Cước | Lạch Huyện | Phụ phí | Phát sinh | Tổng)
//     = the chot-debit board's thu cells (accounting-debit-close.service):
//     the same freight-rate grain query, the same `effectiveLclFreight`
//     channel, the same ZONE_SURCHARGE charge side, the same OTHER sell side,
//     merged through `applyDebitRateOverridesToCells` so kế toán's per-cell
//     overrides read identically on both boards.
//   Group 4 (PHÍ CHI HỘ Có hóa đơn) = live ops_expense_entries rows whose
//     costGroup is INVOICED_* (card 20260921_4's invoice-bearing chi-hộ
//     families), sub-grouped by the expense-type catalog's settlement
//     `category` (CSHT / LIFT / DROP / everything else) — the same
//     data-driven rule `opsInvoicedCostGroupOf` writes, read back here.
//   Group 5 (PHÍ KHÔNG HÓA ĐƠN) = the costGroup families OPS_REGULAR
//     ('Giao nhận Ops' — the ticket's 'GN') and OPS_INCIDENTAL ('Phát sinh
//     Ops' — 'PS'); per family Phí = entry amount and Thực thu =
//     customerChargeAmount (receivableForCost law) — SIL-876's five
//     columns: Phí GN OP TC | Thực thu | Phí PS OP TC | Thực thu | Tên phí.
//   Group 6 (KIỂM SOÁT) = Tổng TC reads the summary's receivable law
//     (receivableDetermined / receivableDisplayValue + the frozen-lock
//     snapshot); lockStatus follows the ACTIVE shipment_cost_locks row.
//
// Scoping: a CUS actor resolves through cusVisibilityCondition (same law as
// getShipmentDebitSummary — own-only by default, `team: 'true'` widens to the
// ACTIVE groups). Staff roles are never scoped. The contract carries NO giá
// vốn by construction (SIL-776 REV2): only the thu-khách side and the chi-hộ
// rows the CUS detail already shows ride the wire.
import { and, desc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import * as s from '../db/schema';
import { db } from '../db';
import { Role } from '@tingting/shared';
import type {
  DebitMergeChiHo,
  DebitMergeInvoiceFee,
  DebitMergeItem,
  DebitMergeResponse,
} from '@tingting/shared';
import { effectiveLclFreight } from './lcl-effective-freight';
import { loadRevenueOverrideByLot } from './revenue-override-read.service';
import { applyDebitRateOverridesToCells } from './accounting-debit-close.service';
import { billOrBookNumberFor } from './cus-workspace-mapping.service';
import { activeTripConditions } from './active-trip-scope';
import { cusVisibilityCondition } from './cus-visibility.service';
import { receivableCellFreightKnown, receivableDetermined, receivableDisplayValue } from './debit-receivable-arming';
import { operationalName } from '../db/master-data-name';
import type { AuthUser } from '../middleware/auth';

function toNumber(value: string | number | null | undefined): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

/** Group 4 sub-group of an invoiced chi-hộ row: the catalog's settlement
 *  `category` decides (null/unclassified → the Phí khác catch-all, so no
 *  money can silently leave the totals — the card 20260919_3 law). */
export function debitChiHoGroupOf(category: string | null | undefined): keyof DebitMergeChiHo {
  if (category === 'CSHT') return 'csht';
  if (category === 'LIFT') return 'lift';
  if (category === 'DROP') return 'drop';
  return 'other';
}

/** Raw invoiced chi-hộ row shape the pure builder consumes (unit-tested
 *  without a db). `charge` = the customer side (null falls back to the paid
 *  amount — the receivableForCost identity for invoice rows); `paid` = Thực
 *  chi; negative rows are dropped (card 20260928_197: behave as absent). */
export interface RawChiHoFeeRow {
  category: string | null;
  charge: string | null;
  paid: string | null;
  feeName: string | null;
  invoiceNumber: string | null;
}

/** Pure group-4 assembly: bucket the fixture rows into the 4 sub-groups. */
export function buildDebitMergeChiHo(rows: RawChiHoFeeRow[]): DebitMergeChiHo {
  const chiHo: DebitMergeChiHo = { csht: [], lift: [], drop: [], other: [] };
  for (const row of rows) {
    const paid = row.paid == null ? null : toNumber(row.paid);
    if (paid != null && paid < 0) continue;
    const amount = paid ?? 0;
    const fee: DebitMergeInvoiceFee = {
      invoiceNumber: row.invoiceNumber,
      amount: String(row.charge != null ? toNumber(row.charge) : amount),
    };
    switch (debitChiHoGroupOf(row.category)) {
      case 'csht':
        chiHo.csht.push(fee);
        break;
      case 'lift':
        chiHo.lift.push({ ...fee, actualAmount: paid == null ? null : String(paid) });
        break;
      case 'drop':
        chiHo.drop.push({ ...fee, actualAmount: paid == null ? null : String(paid) });
        break;
      case 'other':
        chiHo.other.push({ ...fee, feeName: row.feeName });
        break;
    }
  }
  return chiHo;
}

/** Group-5 accumulator result for one lot. Per family the pair follows the
 *  card-20260921_5 law: `*Fee` = Phí (the entry amount), `*Paid` = Thực thu
 *  (the negotiated customer charge). `fees` keeps the named rows in row
 *  order (Tên phí column); a side stays null while the lot has no known rows
 *  of it — unknown, never a fabricated 0. */
export interface NoInvoiceGroupResult {
  gnFee: number | null;
  gnPaid: number | null;
  psFee: number | null;
  psPaid: number | null;
  fees: Array<{ name: string | null; amount: number }>;
}

/** Pure group-5 assembly over the no-invoice Ops rows (costGroup carries the
 *  family: OPS_REGULAR = Giao nhận Ops, OPS_INCIDENTAL = Phát sinh Ops).
 *  Thực thu reads the customer charge (receivableForCost law: 0 when the
 *  row never negotiated one); negative rows are dropped like group 4. */
export function buildDebitMergeNoInvoice(
  rows: Array<{ costGroup: string | null; charge: string | null; paid: string | null; feeName: string | null }>,
): NoInvoiceGroupResult {
  let gnFeeKnown = false;
  let gnFee = 0;
  let gnPaidKnown = false;
  let gnPaid = 0;
  let psFeeKnown = false;
  let psFee = 0;
  let psPaidKnown = false;
  let psPaid = 0;
  const fees: Array<{ name: string | null; amount: number }> = [];
  for (const row of rows) {
    const fee = row.paid == null ? null : toNumber(row.paid);
    if (fee != null && fee < 0) continue;
    const paid = row.charge == null ? null : toNumber(row.charge);
    if (row.costGroup === 'OPS_REGULAR') {
      if (fee != null) { gnFeeKnown = true; gnFee += fee; }
      if (paid != null) { gnPaidKnown = true; gnPaid += paid; }
    } else if (row.costGroup === 'OPS_INCIDENTAL') {
      if (fee != null) { psFeeKnown = true; psFee += fee; }
      if (paid != null) { psPaidKnown = true; psPaid += paid; }
    }
    fees.push({ name: row.feeName, amount: fee ?? 0 });
  }
  return {
    gnFee: gnFeeKnown ? gnFee : null,
    gnPaid: gnPaidKnown ? gnPaid : null,
    psFee: psFeeKnown ? psFee : null,
    psPaid: psPaidKnown ? psPaid : null,
    fees,
  };
}

/** 18/11 Task 1.2 — the query→team-widening decision, split out pure so the
 *  scoping test can pin it without a db: only the exact string 'true' (the
 *  FE toggle's wire value) widens the scope past OWN-ONLY. */
export function debitMergeIncludeTeam(team: string | 'true' | 'false' | undefined | null): boolean {
  return team === 'true';
}

/** The WHERE arms for the lots query: staff roles pass unscoped, a CUS actor
 *  resolves the one visibility law (own-only, team-widened on demand). */
export async function debitMergeScopeConditions(
  executor: typeof db,
  actor: Pick<AuthUser, 'userId' | 'role'> | undefined,
  team: string | 'true' | 'false' | undefined | null,
): Promise<SQL[]> {
  if (actor?.role !== Role.CUS) return [];
  return cusVisibilityCondition(executor, actor, { includeTeam: debitMergeIncludeTeam(team) });
}

/** Tổng TC for an UNLOCKED lot — the shipment-debit-summary receivable law
 *  (determination over the four revenue sides, then the rollup). Split out
 *  pure so the SIL-814 regression test can pin the no-trip-revenue shape:
 *  `receivableDetermined` arms on freight/PS/ops-charge alone, so a lot
 *  priced by freight snapshots but without any trip_expense rows reaches the
 *  rollup with `revenue` undefined — its revenue sides contribute 0, never a
 *  TypeError (ab50b4c9 dereferenced `revenue!.otherSell` and 500'd the whole
 *  board for one such lot; mirrors shipment-debit-summary.service.ts's
 *  `(revenue?.otherSell ?? 0) + (revenue?.derived ?? 0)`). */
export function debitMergeTongTcUnlocked(input: {
  revenue: { otherSell: number; derived: number } | undefined;
  freightAuto: number | null;
  psKnownTotal: number | null;
  opsChargeKnownTotal: number | null;
}): number | null {
  const revenue = input.revenue;
  const hasAnyRevenue = receivableDetermined({
    hasRevenueRows: revenue != null,
    freightKnown: input.freightAuto != null,
    psKnownTotal: input.psKnownTotal,
    opsChargeKnownTotal: input.opsChargeKnownTotal,
    revenueRowsTotal: revenue != null ? revenue.otherSell + revenue.derived : null,
  });
  if (!hasAnyRevenue) return null;
  return (revenue?.otherSell ?? 0)
    + (revenue?.derived ?? 0)
    + (input.freightAuto ?? 0)
    + (input.psKnownTotal ?? 0)
    + (input.opsChargeKnownTotal ?? 0);
}

export async function getDebitMergeBoard(query: {
  customerId?: number;
  team?: 'true' | 'false';
  actor?: AuthUser;
}): Promise<DebitMergeResponse> {
  const conditions = [isNull(s.shipments.deletedAt)];
  if (query.customerId != null) conditions.push(eq(s.shipments.customerId, query.customerId));
  conditions.push(...await debitMergeScopeConditions(db, query.actor, query.team));
  const lots = await db.select({
    id: s.shipments.id,
    code: s.shipments.shipmentCode,
    customerId: s.shipments.customerId,
    customerName: operationalName(s.customers.shortName, s.customers.name),
    factoryName: sql<string | null>`coalesce(
      ${operationalName(s.operationalSites.shortName, s.operationalSites.name)},
      nullif(btrim(${s.shipments.factoryName}), '')
    )`,
    routeName: sql<string | null>`coalesce(
      ${operationalName(s.routes.shortName, s.routes.name)},
      (select nullif(btrim(sc.raw_route_name), '')
         from ${s.shipmentContainers} sc
        where sc.shipment_id = ${s.shipments.id} and nullif(btrim(sc.raw_route_name), '') is not null
        limit 1)
    )`,
    deliveryDate: s.shipments.expectedDeliveryDate,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
    tradeDirection: s.shipments.tradeDirection,
    cargoMode: s.shipments.cargoMode,
    revGroupId: s.shipments.revGroupId,
    revGroupOrder: s.shipments.revGroupOrder,
    // 18/11 Task 1.2 — NV phụ trách.
    creatorName: s.users.fullName,
    creatorCode: s.users.employeeCode,
  })
    .from(s.shipments)
    .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId))
    .leftJoin(s.operationalSites, eq(s.operationalSites.id, s.shipments.operationalSiteId))
    .leftJoin(s.routes, eq(s.routes.id, s.shipments.routeId))
    .leftJoin(s.users, eq(s.users.id, s.shipments.createdBy))
    .where(and(...conditions))
    // SIL-867 — newest first (DESC theo ngày vận chuyển): the board opens on
    // the CURRENT lots, not September's empty fee rows.
    .orderBy(desc(s.shipments.expectedDeliveryDate), desc(s.shipments.id));
  if (lots.length === 0) return { items: [], total: 0 };
  const lotIds = lots.map((lot) => lot.id);

  // ── Containers (child lines): one shipment_containers row each, loại cont
  // from the container-types catalog (e.g. "20'DC").
  const containerRows = await db.select({
    id: s.shipmentContainers.id,
    shipmentId: s.shipmentContainers.shipmentId,
    containerNumber: s.shipmentContainers.containerNumber,
    containerTypeId: s.shipmentContainers.containerTypeId,
  }).from(s.shipmentContainers)
    .where(inArray(s.shipmentContainers.shipmentId, lotIds));
  const containerTypeRows = await db.select({ id: s.containerTypes.id, name: s.containerTypes.name })
    .from(s.containerTypes);
  const containerTypeLabels = new Map(containerTypeRows.map((row) => [row.id, row.name]));
  const containersByLot = new Map<number, Array<{ id: number; containerNumber: string | null; containerType: string | null }>>();
  for (const row of containerRows) {
    const lot = row.shipmentId;
    if (lot == null) continue;
    const list = containersByLot.get(lot) ?? [];
    list.push({
      id: row.id,
      containerNumber: row.containerNumber ?? null,
      containerType: row.containerTypeId == null ? null : containerTypeLabels.get(row.containerTypeId) ?? null,
    });
    containersByLot.set(lot, list);
  }

  // ── Group 3, Cước + Phụ phí: the freight-rate grain (the chot-debit
  // board's exact query — per-trip additive legs vs the trip-NULL intake
  // freeze, SIL-814 unpriced-freeze guard included).
  const grainRows = await db.select({
    shipmentId: s.freightRateSnapshots.shipmentId,
    tripId: s.freightRateSnapshots.tripId,
    freightAmount: s.freightRateSnapshots.freightAmount,
    surchargeAmount: s.freightRateSnapshots.surchargeAmount,
    rateTermsId: s.freightRateSnapshots.rateTermsId,
    pricingTableId: s.freightRateSnapshots.pricingTableId,
    fuelNormId: s.freightRateSnapshots.fuelNormId,
    fuelPricePeriodId: s.freightRateSnapshots.fuelPricePeriodId,
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
    const leg = { freight: toNumber(row.freightAmount), surcharge: toNumber(row.surchargeAmount) };
    if (leg.freight === 0 && leg.surcharge === 0
      && (row.rateTermsId === 0 || row.pricingTableId === 0
        || row.fuelNormId === 0 || row.fuelPricePeriodId === 0)) {
      continue;
    }
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
    if (pick !== undefined) psAutoByLot.set(lot, pick.surcharge);
  }

  // F-2/FB-145 — the ONE effective freight rule (`effectiveLclFreight`), the
  // override channel loaded through the shared reader.
  const overrideByLot = await loadRevenueOverrideByLot(db, lotIds);
  const effectiveFreightByLot = new Map<number, { value: number | null; reason: string | null }>();
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
    }));
  }

  // ── Lạch Huyện charge side + Group 4 + Group 5 + the receivable's
  // ops-charge side: ONE ops-rows read feeding everything. Scope = the
  // chot-debit BOARD's law (ALL ops rows, voided OPS-projected rows included
  // — board reads no live-filter here), so group 3 cannot disagree with the
  // board on the same lot (review 18/11: the two surfaces must show one
  // auto value; the board-vs-summary divergence is pre-existing, out of
  // scope here).
  const opsRows = await db.select({
    shipmentId: s.opsExpenseEntries.shipmentId,
    expenseTypeCode: s.opsExpenseEntries.expenseTypeCode,
    costGroup: s.opsExpenseEntries.costGroup,
    category: s.forwarderExpenseTypes.category,
    amount: s.opsExpenseEntries.amount,
    charge: s.opsExpenseEntries.customerChargeAmount,
    feeName: s.opsExpenseEntries.feeName,
    invoiceNumber: s.opsExpenseEntries.invoiceNumber,
  }).from(s.opsExpenseEntries)
    .leftJoin(s.forwarderExpenseTypes, eq(s.forwarderExpenseTypes.code, s.opsExpenseEntries.expenseTypeCode))
    .where(inArray(s.opsExpenseEntries.shipmentId, lotIds));

  const chiHoRawByLot = new Map<number, RawChiHoFeeRow[]>();
  const noInvoiceRawByLot = new Map<number, Array<{ costGroup: string | null; charge: string | null; paid: string | null; feeName: string | null }>>();
  const opsChargeByLot = new Map<number, { known: boolean; total: number }>();
  // Lạch Huyện charge side (the board's thu seam — `amount` is the điều vận
  // cost, never billed on this grid).
  const zoneCode = 'ZONE_SURCHARGE';
  const zoneChargeByLot = new Map<number, number>();
  for (const row of opsRows) {
    const lot = row.shipmentId;
    if (lot == null) continue;
    if (row.expenseTypeCode === zoneCode) {
      // Lạch Huyện charge side (the board's `lachHuyen` cell).
      if (row.charge != null) {
        zoneChargeByLot.set(lot, (zoneChargeByLot.get(lot) ?? 0) + toNumber(row.charge));
      }
    } else if (row.costGroup != null && row.costGroup.startsWith('INVOICED_')) {
      const bucket = chiHoRawByLot.get(lot) ?? [];
      bucket.push({
        category: row.category ?? null,
        charge: row.charge,
        paid: row.amount,
        feeName: row.feeName,
        invoiceNumber: row.invoiceNumber,
      });
      chiHoRawByLot.set(lot, bucket);
    } else {
      const bucket = noInvoiceRawByLot.get(lot) ?? [];
      bucket.push({ costGroup: row.costGroup ?? null, charge: row.charge, paid: row.amount, feeName: row.feeName });
      noInvoiceRawByLot.set(lot, bucket);
    }
    // Receivable's ops-charge side (card _56): only the NEGOTIATED customer
    // charge; a null charge contributes nothing but keeps the side known.
    const entry = opsChargeByLot.get(lot) ?? { known: false, total: 0 };
    if (row.charge != null) { entry.known = true; entry.total += toNumber(row.charge); }
    opsChargeByLot.set(lot, entry);
  }
  const chiHoByLot = new Map<number, DebitMergeChiHo>(
    [...chiHoRawByLot].map(([lot, rows]) => [lot, buildDebitMergeChiHo(rows)]),
  );
  const noInvoiceByLot = new Map<number, ReturnType<typeof buildDebitMergeNoInvoice>>(
    [...noInvoiceRawByLot].map(([lot, rows]) => [lot, buildDebitMergeNoInvoice(rows)]),
  );

  // ── Phát sinh cus + the receivable's revenue side: live trip expenses
  // (summary's stricter live scope — voided rows and OPS-projected rows out).
  const revenueRows = await db.select({
    shipmentId: s.trips.shipmentId,
    expenseType: s.tripExpenses.expenseType,
    buy: s.tripExpenses.buyAmount,
    sell: s.tripExpenses.sellAmount,
  }).from(s.tripExpenses)
    .innerJoin(s.trips, and(
      eq(s.trips.id, s.tripExpenses.tripId),
      // Board's trip-revenue law: voided BILLING rows out; no live-scope
      // filter (review 18/11 — board parity on Phát sinh/Tổng thu).
      inArray(s.trips.shipmentId, lotIds),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
      isNull(s.trips.fulfillmentId),
      ne(s.tripExpenses.approvalStatus, 'VOIDED'),
    ));
  const revenueByLot = new Map<number, { hasRows: boolean; otherSell: number; derived: number }>();
  for (const row of revenueRows) {
    if (row.shipmentId == null) continue;
    const entry = revenueByLot.get(row.shipmentId) ?? { hasRows: true, otherSell: 0, derived: 0 };
    if (row.expenseType === 'OTHER') entry.otherSell += toNumber(row.sell);
    else if (toNumber(row.buy) >= 0) entry.derived += toNumber(row.buy);
    revenueByLot.set(row.shipmentId, entry);
  }

  // ── PS thực tế (the receivable's container-side component).
  const psRows = await db.select({
    shipmentId: s.shipmentContainers.shipmentId,
    total: sql<string>`coalesce(sum(${s.shipmentContainers.psActualAmount}), 0)::text`,
    known: sql<number>`count(${s.shipmentContainers.psActualAmount})::int`,
  }).from(s.shipmentContainers)
    .where(inArray(s.shipmentContainers.shipmentId, lotIds))
    .groupBy(s.shipmentContainers.shipmentId);
  const psByLot = new Map(psRows.map((row) => [row.shipmentId, { known: row.known > 0, total: toNumber(row.total) }]));

  // ── KIỂM SOÁT: the ACTIVE cost lock drives lockStatus + the frozen
  // receivable snapshot (card _19 law, byte-for-byte with the summary).
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

  // ── Kế toán's per-cell rate overrides (SIL-805): the merge grid shows the
  // SAME merged cells as the chot-debit board.
  const rateOverrideRows = await db.select()
    .from(s.shipmentDebitRateOverrides)
    .where(inArray(s.shipmentDebitRateOverrides.shipmentId, lotIds));
  const rateOverrideByLot = new Map(rateOverrideRows.map((row) => [row.shipmentId, row] as const));

  const frozenNumber = (snapshot: unknown, key: string): number | null => {
    if (snapshot == null || typeof snapshot !== 'object') return null;
    const value = (snapshot as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) return Number(value);
    return null;
  };

  const items: DebitMergeItem[] = lots.map((lot) => {
    const effectiveFreight = effectiveFreightByLot.get(lot.id) ?? { value: null, reason: null };
    const freightAuto = effectiveFreight.value;
    const psAuto = psAutoByLot.get(lot.id);
    const revenue = revenueByLot.get(lot.id);
    const ps = psByLot.get(lot.id);
    const lock = lockedByLot.get(lot.id);
    const cells = applyDebitRateOverridesToCells({
      cuocThu: freightAuto != null ? String(freightAuto) : null, cuocThuKnown: freightAuto != null,
      lachHuyen: zoneChargeByLot.has(lot.id) ? String(zoneChargeByLot.get(lot.id)!) : null,
      lachHuyenKnown: zoneChargeByLot.has(lot.id),
      phuPs: psAuto != null ? String(psAuto) : null, phuPsKnown: psAuto != null,
      phatSinhCus: revenue != null ? String(revenue.otherSell) : null, phatSinhCusKnown: revenue != null,
      // The merge grid carries no trả-ĐV side — giá vốn stays off the wire
      // (SIL-776 REV2); the overrides table still merges without it.
      cuocTraDv: null, cuocTraDvKnown: false,
      lachHuyenDv: null, lachHuyenDvKnown: false,
      phatSinhDv: null, phatSinhDvKnown: false,
      phiRu: null,
    }, rateOverrideByLot.get(lot.id));

    // Tổng TC — the summary's receivable law (determination → freeze gate →
    // display gate). Locked lots read their own frozen snapshot.
    let tongTc = lock != null
      ? frozenNumber(lock.snapshot, 'receivableTotal')
      : debitMergeTongTcUnlocked({
        revenue,
        freightAuto,
        psKnownTotal: ps?.known ? ps.total : null,
        opsChargeKnownTotal: opsChargeByLot.get(lot.id)?.known ? opsChargeByLot.get(lot.id)!.total : null,
      });
    tongTc = receivableDisplayValue({
      value: tongTc,
      freightKnown: receivableCellFreightKnown({
        locked: lock != null,
        frozenFreight: lock != null ? frozenNumber(lock.snapshot, 'freightAuto') : null,
        liveFreight: freightAuto,
      }),
      merged: lot.revGroupId != null,
    });

    const noInvoice = noInvoiceByLot.get(lot.id) ?? { gnFee: null, gnPaid: null, psFee: null, psPaid: null, fees: [] };
    return {
      shipmentId: lot.id,
      code: lot.code,
      customerId: lot.customerId ?? null,
      customerName: lot.customerName,
      factoryName: lot.factoryName ?? null,
      routeName: lot.routeName ?? null,
      deliveryDate: lot.deliveryDate ?? null,
      billOrBookNumber: billOrBookNumberFor(lot.tradeDirection, lot.blNumber, lot.bookingRef),
      creatorName: lot.creatorName ?? null,
      creatorCode: lot.creatorCode ?? null,
      containers: containersByLot.get(lot.id) ?? [],
      revenue: {
        cuoc: cells.thu.cuocThu,
        cuocReason: effectiveFreight.reason,
        lachHuyen: cells.thu.lachHuyen,
        phuPhi: cells.thu.phuPs,
        phatSinh: cells.thu.phatSinhCus,
        tong: cells.thu.tongThu,
      },
      chiHo: chiHoByLot.get(lot.id) ?? { csht: [], lift: [], drop: [], other: [] },
      noInvoice: {
        gnFee: noInvoice.gnFee == null ? null : String(noInvoice.gnFee),
        gnPaid: noInvoice.gnPaid == null ? null : String(noInvoice.gnPaid),
        psFee: noInvoice.psFee == null ? null : String(noInvoice.psFee),
        psPaid: noInvoice.psPaid == null ? null : String(noInvoice.psPaid),
        fees: noInvoice.fees.map((fee) => ({ name: fee.name, amount: String(fee.amount) })),
      },
      control: {
        tongTc: tongTc == null ? null : String(tongTc),
        lockStatus: (lock != null ? 'LOCKED' : 'OPEN') as 'LOCKED' | 'OPEN',
        lockedAt: lock?.lockedAt.toISOString() ?? null,
      },
      cargoMode: (lot.cargoMode ?? null) as 'FCL' | 'LCL' | null,
      revGroupId: lot.revGroupId,
      revGroupOrder: lot.revGroupOrder,
    };
  });
  return { items, total: items.length };
}
