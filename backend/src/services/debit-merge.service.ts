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
import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import * as s from '../db/schema';
import { db } from '../db';
import { liveDebitOpsExpense, liveDebitTripExpense, standaloneDebitTripRevenue } from './live-debit-expense-scope';
import { Role, sumExcludingNegative } from '@tingting/shared';
import type {
  DebitMergeChiHo,
  DebitMergeInvoiceFee,
  DebitMergeItem,
  DebitMergeResponse,
  ShipmentDebitDetail,
} from '@tingting/shared';
import { effectiveLclFreight } from './lcl-effective-freight';
import { intakeFreezeCountsForLot, loadLotTripPresence, loadRevenueOverrideByLot } from './revenue-override-read.service';
import { applyDebitRateOverridesToCells } from './accounting-debit-close.service';
import { billOrBookNumberFor } from './cus-workspace-mapping.service';
import { activeTripConditions } from './active-trip-scope';
import { cusVisibilityCondition } from './cus-visibility.service';
import { resolveLotPortZoneConfigBatch } from './zone-surcharge.service';
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

/** Lạch Huyện's expense-type code. Its `amount` is the điều vận cost —
 *  NEVER billed on this grid — so only its negotiated charge may join the
 *  receivable (the board's thu seam). */
const ZONE_SURCHARGE_CODE = 'ZONE_SURCHARGE';

/** SIL-896 round 8 — the name a fee line renders (Tên phí): the entry's own
 *  feeName when its writer set one, else the expense-type catalog's name.
 *  Round 11 (QA build 2530c955): the advances writer stores '' (never NULL)
 *  when the operator leaves Tên phí blank, and '' is not nullish — the
 *  catalog fallback never fired and QA's 'Hải quan luồng xanh' / 'Chọn vỏ'
 *  rendered empty TÊN PHÍ cells. Blank (empty or whitespace-only) counts as
 *  unset; the name must live somewhere visible. */
export function debitMergeFeeNameOf(row: { feeName: string | null; typeName: string | null }): string | null {
  const entryName = row.feeName?.trim();
  return entryName ? row.feeName : row.typeName ?? null;
}

/** SIL-896 round 8 — one ops row's contribution to the receivable's
 *  ops-charge side (Tổng TC). A negotiated charge joins as-is (negative
 *  included — existing semantics); an UN-negotiated fee rides the
 *  receivableForCost identity the chi-hộ cell money already uses:
 *  charge ?? paid, so the grid's control figure counts the same fee money
 *  the group 4/5 cells show. Round 11 (QA build 2530c955): the advances
 *  writer (receivableForCost) stores **0 — not NULL** — when no customer
 *  charge was entered, so `charge != null` answered 0 and QA's two pending
 *  GN fees (450.000₫ + 50.000₫) dropped out of Tổng TC again (31.013.200₫
 *  instead of 31.513.200₫). On this wire 0 IS the un-negotiated sentinel,
 *  so 0 falls through to the amount side. Lạch Huyện never falls back (its
 *  amount is the điều vận cost, never billed here), and a negative
 *  un-negotiated amount is absent (the builders' drop law). Returns null =
 *  the row contributes nothing and does not arm the side. */
export function debitMergeOpsChargeContribution(row: {
  expenseTypeCode: string | null;
  charge: string | null;
  amount: string | null;
}): number | null {
  const charge = row.charge == null ? null : toNumber(row.charge);
  if (charge != null && charge !== 0) return charge;
  if (row.expenseTypeCode === ZONE_SURCHARGE_CODE) return null;
  const amount = row.amount == null ? null : toNumber(row.amount);
  return amount != null && amount >= 0 ? amount : null;
}

/** Raw invoiced chi-hộ row shape the pure builder consumes (unit-tested
 *  without a db). `charge` = the customer side (null falls back to the paid
 *  amount — the receivableForCost identity for invoice rows); `paid` = Thực
 *  chi; negative rows are dropped (card 20260928_197: behave as absent).
 *  SIL-883 (3.1) — `pending` = the row awaits Kế toán duyệt (no confirm
 *  stamp on its OPS accounting-source link). */
export interface RawChiHoFeeRow {
  category: string | null;
  charge: string | null;
  paid: string | null;
  feeName: string | null;
  invoiceNumber: string | null;
  pending: boolean;
  /** SIL-1024 (K6.24) — the entry's save stamp (ISO); rides pending rows
   *  only (absent/null on approved lines — no đối soát stamp needed). */
  savedAt?: string | null;
}

/** Pure group-4 assembly: bucket the fixture rows into the 4 sub-groups. */
export function buildDebitMergeChiHo(rows: RawChiHoFeeRow[]): DebitMergeChiHo {
  const chiHo: DebitMergeChiHo = { csht: [], lift: [], drop: [], other: [] };
  for (const row of rows) {
    const paid = row.paid == null ? null : toNumber(row.paid);
    if (paid != null && paid < 0) continue;
    const amount = paid ?? 0;
    const base: DebitMergeInvoiceFee = {
      invoiceNumber: row.invoiceNumber,
      amount: String(row.charge != null ? toNumber(row.charge) : amount),
    };
    const fee: DebitMergeInvoiceFee = row.pending
      ? (row.savedAt ? { ...base, pending: true, savedAt: row.savedAt } : { ...base, pending: true })
      : base;
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
 *  of it — unknown, never a fabricated 0. SIL-883 (3.1) — the side carries
 *  ≥1 entry awaiting Kế toán duyệt. SIL-896 round 11 — each line also names
 *  its family (`side`), so the Phí GN/PS OP TC cells render ONE money line
 *  per fee (QA build 2530c955 rejected the single 500.000₫ aggregate of
 *  450.000₫ + 50.000₫); a line without a family renders name-only. */
export interface NoInvoiceGroupResult {
  gnFee: number | null;
  gnPaid: number | null;
  psFee: number | null;
  psPaid: number | null;
  /** SIL-883 (3.1) — the side carries ≥1 entry awaiting Kế toán duyệt. */
  gnFeePending: boolean;
  gnPaidPending: boolean;
  psFeePending: boolean;
  psPaidPending: boolean;
  fees: Array<{ name: string | null; amount: number; side?: 'gn' | 'ps'; pending?: boolean; savedAt?: string }>;
}

/** Pure group-5 assembly over the no-invoice Ops rows (costGroup carries the
 *  family: OPS_REGULAR = Giao nhận Ops, OPS_INCIDENTAL = Phát sinh Ops).
 *  Thực thu reads the customer charge (receivableForCost law: 0 when the
 *  row never negotiated one); negative rows are dropped like group 4.
 *  SIL-883 (3.1) — `pending` rides the row; a family side reads pending when
 *  ANY contributing entry of that side still awaits Kế toán duyệt. */
export function buildDebitMergeNoInvoice(
  rows: Array<{ costGroup: string | null; charge: string | null; paid: string | null; feeName: string | null; pending: boolean; savedAt?: string | null }>,
): NoInvoiceGroupResult {
  let gnFeeKnown = false;
  let gnFee = 0;
  let gnFeePending = false;
  let gnPaidKnown = false;
  let gnPaid = 0;
  let gnPaidPending = false;
  let psFeeKnown = false;
  let psFee = 0;
  let psFeePending = false;
  let psPaidKnown = false;
  let psPaid = 0;
  let psPaidPending = false;
  const fees: Array<{ name: string | null; amount: number; pending?: boolean }> = [];
  for (const row of rows) {
    const fee = row.paid == null ? null : toNumber(row.paid);
    if (fee != null && fee < 0) continue;
    const paid = row.charge == null ? null : toNumber(row.charge);
    if (row.costGroup === 'OPS_REGULAR') {
      if (fee != null) { gnFeeKnown = true; gnFee += fee; if (row.pending) gnFeePending = true; }
      if (paid != null) { gnPaidKnown = true; gnPaid += paid; if (row.pending) gnPaidPending = true; }
    } else if (row.costGroup === 'OPS_INCIDENTAL') {
      if (fee != null) { psFeeKnown = true; psFee += fee; if (row.pending) psFeePending = true; }
      if (paid != null) { psPaidKnown = true; psPaid += paid; if (row.pending) psPaidPending = true; }
    }
    const line: { name: string | null; amount: number; side?: 'gn' | 'ps'; pending?: boolean; savedAt?: string } = { name: row.feeName, amount: fee ?? 0 };
    if (row.costGroup === 'OPS_REGULAR') line.side = 'gn';
    else if (row.costGroup === 'OPS_INCIDENTAL') line.side = 'ps';
    if (row.pending) {
      line.pending = true;
      if (row.savedAt) line.savedAt = row.savedAt;
    }
    fees.push(line);
  }
  return {
    gnFee: gnFeeKnown ? gnFee : null,
    gnPaid: gnPaidKnown ? gnPaid : null,
    psFee: psFeeKnown ? psFee : null,
    psPaid: psPaidKnown ? psPaid : null,
    gnFeePending,
    gnPaidPending,
    psFeePending,
    psPaidPending,
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

/**
 * SIL-944 (K9.19) — the dedicated 'Thông số' cell facts for an LCL lot: the
 * 'Lẻ · Thu: X · Trả: Y' label (vehicle-size-class CODES, the FB-094 law —
 * the class name never reaches the cell) plus the group principal ref behind
 * 'Ghép cùng Bill X' (a member reads its group's LIVE order-1 lot's bill/
 * booking; the principal itself carries null). null for FCL/ungrouped lots —
 * absence is not data. Pure so the label/ref precedence stays unit-pinned.
 */
export function debitMergeLclParams(row: {
  cargoMode: string | null;
  revVehicleClassId: number | null;
  costVehicleClassId: number | null;
  revGroupId: string | null;
  revGroupOrder: number | null;
  costGroupId: string | null;
  costGroupOrder: number | null;
}, classCodes: Map<number, string>, principalRefs: Map<string, string>): { label: string; ghepCungRef: string | null } | null {
  if (row.cargoMode !== 'LCL') return null;
  const label = [
    'Lẻ',
    row.revVehicleClassId != null && classCodes.has(row.revVehicleClassId)
      ? `Thu: ${classCodes.get(row.revVehicleClassId)}` : null,
    row.costVehicleClassId != null && classCodes.has(row.costVehicleClassId)
      ? `Trả: ${classCodes.get(row.costVehicleClassId)}` : null,
  ].filter(Boolean).join(' · ');
  const ghepCungRef = row.revGroupId != null && (row.revGroupOrder ?? 1) > 1
    ? principalRefs.get(row.revGroupId) ?? null
    : row.costGroupId != null && (row.costGroupOrder ?? 1) > 1
      ? principalRefs.get(row.costGroupId) ?? null
      : null;
  return { label, ghepCungRef };
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
  /** SIL-1022 — narrow the board to explicit lots (the cost-lock freeze). */
  shipmentIds?: number[];
  team?: 'true' | 'false';
  actor?: AuthUser;
}): Promise<DebitMergeResponse> {
  const conditions = [isNull(s.shipments.deletedAt)];
  if (query.customerId != null) conditions.push(eq(s.shipments.customerId, query.customerId));
  if (query.shipmentIds != null && query.shipmentIds.length > 0) {
    conditions.push(inArray(s.shipments.id, query.shipmentIds));
  }
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
    // SIL-944 (K9.19) — the 'Thông số' cell facts: cost-group identity for
    // the ghép-TRẢ-ĐV principal ref + the two vehicle classes behind the
    // 'Lẻ · Thu: X · Trả: Y' label (FB-094 law, same columns the chot-debit
    // board reads).
    costGroupId: s.shipments.costGroupId,
    costGroupOrder: s.shipments.costGroupOrder,
    revVehicleClassId: s.shipments.revVehicleClassId,
    costVehicleClassId: s.shipments.costVehicleClassId,
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

  // SIL-944 (K9.19) — vehicle-class codes + each grouped lot's LIVE principal
  // reference behind the dedicated 'Thông số' cell ('Ghép cùng Bill X'): the
  // chot-debit board's FB-094 law, same query shapes (card 181026145000's
  // ghost-principal guard — a soft-deleted order-1 row never shadows the
  // promoted principal).
  const lclVehicleClassIds = [...new Set(
    lots.flatMap((lot) => [lot.costVehicleClassId, lot.revVehicleClassId])
      .filter((id): id is number => id != null),
  )];
  const lclClassCodes = new Map(
    lclVehicleClassIds.length === 0
      ? []
      : (await db.select({ id: s.vehicleSizeClasses.id, code: s.vehicleSizeClasses.code })
        .from(s.vehicleSizeClasses)
        .where(inArray(s.vehicleSizeClasses.id, lclVehicleClassIds)))
        .map((row) => [row.id, row.code] as const),
  );
  const lclGroupIds = [...new Set(lots.flatMap((lot) => [lot.costGroupId, lot.revGroupId]).filter((id): id is string => id != null))];
  const lclPrincipalRefs = new Map<string, string>();
  if (lclGroupIds.length > 0) {
    const costPrincipals = await db.select({
      costGroupId: s.shipments.costGroupId,
      blNumber: s.shipments.blNumber,
      bookingRef: s.shipments.bookingRef,
    }).from(s.shipments)
      .where(and(
        isNull(s.shipments.deletedAt),
        eq(s.shipments.costGroupOrder, 1),
        inArray(s.shipments.costGroupId, lclGroupIds),
      ));
    const revPrincipals = await db.select({
      revGroupId: s.shipments.revGroupId,
      blNumber: s.shipments.blNumber,
      bookingRef: s.shipments.bookingRef,
    }).from(s.shipments)
      .where(and(
        isNull(s.shipments.deletedAt),
        eq(s.shipments.revGroupOrder, 1),
        inArray(s.shipments.revGroupId, lclGroupIds),
      ));
    for (const principal of costPrincipals) {
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
  // SIL-1050 (K2.61) — chân đã hủy không tính cước: a lot whose every trip
  // is CANCELED must not resurrect the intake freeze through the
  // `tripLegs ?? intake` fallback (its priced legs drop out by the
  // active-trip scope, and the fallback used to re-arm the pre-cancel price).
  const tripPresence = await loadLotTripPresence(db, lotIds);
  for (const lot of lotIds) {
    const legs = tripLegs.get(lot);
    const intakeRow = intake.get(lot);
    const pick = legs ?? (intakeRow != null && intakeFreezeCountsForLot(tripPresence.get(lot)) ? intakeRow : undefined);
    if (pick !== undefined) psAutoByLot.set(lot, pick.surcharge);
  }

  // F-2/FB-145 — the ONE effective freight rule (`effectiveLclFreight`), the
  // override channel loaded through the shared reader.
  const overrideByLot = await loadRevenueOverrideByLot(db, lotIds);
  const effectiveFreightByLot = new Map<number, { value: number | null; reason: string | null }>();
  for (const lot of lots) {
    const override = overrideByLot.get(lot.id) ?? null;
    const legs = tripLegs.get(lot.id);
    const intakeRow = intake.get(lot.id);
    const snapshotChannel = legs !== undefined
      ? { total: legs.freight, formulaNote: null }
      : (intakeRow != null && intakeFreezeCountsForLot(tripPresence.get(lot.id))
        ? { total: intakeRow.freight, formulaNote: intakeRow.formulaNote }
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
  // ops-charge side: ONE ops-rows read feeding everything. Scope = LIVE
  // money (CR-010.1 SIL-896): liveDebitOpsExpense + not-REJECTED — the same
  // law the summary/lot-payables/zone surfaces ride, so a registry-voided
  // twin (the vantai ×5 merge) can never be reborn as duplicate grid money.
  // The auto Cước/Phụ phí channel above reads freight snapshots, not ops
  // rows, so group 3's Lạch Huyện cell now agrees with zone-surcharge's
  // board value on voided lots too.
  const opsRows = await db.select({
    shipmentId: s.opsExpenseEntries.shipmentId,
    expenseTypeCode: s.opsExpenseEntries.expenseTypeCode,
    costGroup: s.opsExpenseEntries.costGroup,
    category: s.forwarderExpenseTypes.category,
    // SIL-896 r8 — the catalog name behind Tên phí: the advances-flow writer
    // leaves the entry's feeName null, the name lives here.
    typeName: s.forwarderExpenseTypes.name,
    amount: s.opsExpenseEntries.amount,
    charge: s.opsExpenseEntries.customerChargeAmount,
    feeName: s.opsExpenseEntries.feeName,
    invoiceNumber: s.opsExpenseEntries.invoiceNumber,
    // SIL-883 (3.1) — the duyệt axis: the OPS accounting-source link's
    // confirm stamp decides chờ duyệt (null) vs đã duyệt, and the entry's
    // own approval_status decides từ chối (REJECTED — the row vanishes).
    approvalStatus: s.opsExpenseEntries.approvalStatus,
    confirmedAt: s.expenseAccountingSources.confirmedAt,
    // SIL-1024 (K6.24) — giờ lưu của phí: the entry's save stamp rides the
    // wire so pending lines can render HH:MM for đối soát.
    createdAt: s.opsExpenseEntries.createdAt,
  }).from(s.opsExpenseEntries)
    .leftJoin(s.forwarderExpenseTypes, eq(s.forwarderExpenseTypes.code, s.opsExpenseEntries.expenseTypeCode))
    .leftJoin(s.expenseAccountingSources, and(
      eq(s.expenseAccountingSources.sourceKind, 'OPS'),
      eq(s.expenseAccountingSources.sourceId, s.opsExpenseEntries.id),
    ))
    .where(and(
      inArray(s.opsExpenseEntries.shipmentId, lotIds),
      // CR-010.1 (SIL-896) — LIVE money only: the registry law every other
      // debit money surface rides (summary/detail/lot-payables/zone, via
      // live-debit-expense-scope). A VOIDED row or a registry-voided source
      // is dead money — the vantai ×5-twin merge left voided twins on the
      // books that used to be reborn here as 5 red CSHT lines and an
      // inflated Tổng TC, while /advances (registry-filtered) showed the
      // one real record. A REJECTED row is absent from this grid too
      // (SIL-882's "tự động gỡ" law — it used to leak into the Lạch Huyện
      // and ops-charge sums through the trailing accumulators).
      liveDebitOpsExpense(),
      ne(s.opsExpenseEntries.approvalStatus, 'REJECTED'),
    ));

  const chiHoRawByLot = new Map<number, RawChiHoFeeRow[]>();
  const noInvoiceRawByLot = new Map<number, Array<{ costGroup: string | null; charge: string | null; paid: string | null; feeName: string | null; pending: boolean; savedAt: string | null }>>();
  const opsChargeByLot = new Map<number, { known: boolean; total: number }>();
  // Lạch Huyện charge side (the board's thu seam — `amount` is the điều vận
  // cost, never billed on this grid).
  const zoneCode = ZONE_SURCHARGE_CODE;
  const zoneChargeByLot = new Map<number, number>();
  // SIL-883 (3.1)/(3.2) — per-lot count of saved fees awaiting Kế toán
  // duyệt; the grid renders the cells red and hard-blocks the money chain.
  const pendingFeeCountByLot = new Map<number, number>();
  for (const row of opsRows) {
    const lot = row.shipmentId;
    if (lot == null) continue;
    // The read's live scope (SIL-896) already dropped REJECTED/VOIDED rows,
    // so pending here is exactly "saved, live, not yet Kế-toán-approved".
    const pending = row.confirmedAt == null;
    // SIL-1024 (K6.24) — giờ lưu rides ONLY pending lines (approved fees
    // need no đối soát stamp; absence keeps the wire slim and the old
    // exact-shape fee tests meaningful).
    const savedAt = pending && row.createdAt != null ? row.createdAt.toISOString() : null;
    if (pending) pendingFeeCountByLot.set(lot, (pendingFeeCountByLot.get(lot) ?? 0) + 1);
    if (row.expenseTypeCode === zoneCode) {
      // Lạch Huyện charge side (the board's `lachHuyen` cell).
      if (row.charge != null) {
        zoneChargeByLot.set(lot, (zoneChargeByLot.get(lot) ?? 0) + toNumber(row.charge));
      }
      // SIL-1072 (K6.55) — a saved-but-unapproved zone fee must still be
      // VISIBLE: with no negotiated charge it enters no bucket (no
      // lachHuyen cell, no group-4/5 line) and only the invisible
      // pendingFeeCount knew it existed — kế toán saw an all-empty row for
      // a lot carrying a pending "Phí nâng/hạ theo vùng". Pending rows
      // also join the group-5 no-invoice family as a named red line (same
      // render as every other pending fee). PENDING ONLY — an approved
      // zone fee bills in the Lạch Huyện cell and never in group 5, and
      // the receivable law (debitMergeOpsChargeContribution) keeps
      // excluding zone rows, so this display bucket never moves Tổng TC.
      if (pending) {
        const bucket = noInvoiceRawByLot.get(lot) ?? [];
        bucket.push({
          costGroup: row.costGroup ?? null,
          charge: row.charge,
          paid: row.amount,
          feeName: debitMergeFeeNameOf({ feeName: row.feeName, typeName: row.typeName }),
          pending,
          savedAt,
        });
        noInvoiceRawByLot.set(lot, bucket);
      }
    } else if (row.costGroup != null && row.costGroup.startsWith('INVOICED_')) {
      // ONE record lands in ONE cluster: an INVOICED_* row bills in group 4
      // (bucketed by the catalog category below) and never in group 5; a
      // live OPS_* row bills in group 5 and never here (SIL-896 law).
      const bucket = chiHoRawByLot.get(lot) ?? [];
      bucket.push({
        category: row.category ?? null,
        charge: row.charge,
        paid: row.amount,
        feeName: debitMergeFeeNameOf({ feeName: row.feeName, typeName: row.typeName }),
        invoiceNumber: row.invoiceNumber,
        pending,
        savedAt,
      });
      chiHoRawByLot.set(lot, bucket);
    } else {
      const bucket = noInvoiceRawByLot.get(lot) ?? [];
      bucket.push({ costGroup: row.costGroup ?? null, charge: row.charge, paid: row.amount, feeName: debitMergeFeeNameOf({ feeName: row.feeName, typeName: row.typeName }), pending, savedAt });
      noInvoiceRawByLot.set(lot, bucket);
    }
    // Receivable's ops-charge side (card _56 + SIL-896 r8): the negotiated
    // customer charge, and for an UN-negotiated (null-charge) fee the
    // receivableForCost identity (charge ?? paid) — Tổng TC counts the same
    // money the fee cells show (QA round 8: the two pending GN fees'
    // 500.000₫ dropped out of Tổng TC exactly because no charge was entered).
    const contribution = debitMergeOpsChargeContribution(row);
    if (contribution != null) {
      const entry = opsChargeByLot.get(lot) ?? { known: false, total: 0 };
      entry.known = true;
      entry.total += contribution;
      opsChargeByLot.set(lot, entry);
    }
  }
  const chiHoByLot = new Map<number, DebitMergeChiHo>(
    [...chiHoRawByLot].map(([lot, rows]) => [lot, buildDebitMergeChiHo(rows)]),
  );
  const noInvoiceByLot = new Map<number, ReturnType<typeof buildDebitMergeNoInvoice>>(
    [...noInvoiceRawByLot].map(([lot, rows]) => [lot, buildDebitMergeNoInvoice(rows)]),
  );
  // K2.121: fall back to port_zone_surcharges config when a lot has no Ops
  // ZONE_SURCHARGE override row (matches accounting-debit-close).
  const portZoneConfigByLot = await resolveLotPortZoneConfigBatch(lotIds, db);
  for (const [lot, configAmount] of portZoneConfigByLot) {
    if (!zoneChargeByLot.has(lot)) zoneChargeByLot.set(lot, configAmount);
  }

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
      // Match shipment-debit-summary's live + standalone scope: exclude voided
      // rows and OPS-projected trip_expenses (already counted in opsChargeByLot).
      // Fulfillment-NULL trips remain out of chốt totals.
      inArray(s.trips.shipmentId, lotIds),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
      isNotNull(s.trips.fulfillmentId),
      liveDebitTripExpense(),
      standaloneDebitTripRevenue(),
    ));
  const revenueByLot = new Map<number, { hasRows: boolean; otherSell: number; derived: number }>();
  for (const row of revenueRows) {
    if (row.shipmentId == null) continue;
    const entry = revenueByLot.get(row.shipmentId) ?? { hasRows: true, otherSell: 0, derived: 0 };
    if (row.expenseType === 'OTHER') entry.otherSell += toNumber(row.sell);
    else if (toNumber(row.buy) >= 0) entry.derived += toNumber(row.buy);
    revenueByLot.set(row.shipmentId, entry);
  }

  // ── SIL-974 (K10.54 §10.8.6) — the ngoài-chốt trips per lot: fulfillment-
  // NULL work whose fees the board must SHOW (display-only section under the
  // grid) while EXCLUDING from every chốt total. Same scope + wire shape as
  // the per-lot debit-detail section (card 20260924_3): active trips only,
  // live expense rows, feeTotal drops negative rows.
  const unattachedTripRows = await db.select({
    shipmentId: s.trips.shipmentId,
    id: s.trips.id,
    code: s.trips.tripCode,
    departureDate: s.trips.departureDate,
    status: s.trips.status,
  }).from(s.trips)
    .where(and(
      inArray(s.trips.shipmentId, lotIds),
      ...activeTripConditions(),
      isNull(s.trips.fulfillmentId),
    ));
  const unattachedExpenseRows = unattachedTripRows.length === 0 ? [] : await db.select({
    tripId: s.tripExpenses.tripId,
    id: s.tripExpenses.id,
    expenseType: s.tripExpenses.expenseType,
    feeName: s.tripExpenses.feeName,
    buyAmount: s.tripExpenses.buyAmount,
    sellAmount: s.tripExpenses.sellAmount,
    note: s.tripExpenses.recoveryNote,
    invoiceNumber: s.tripExpenses.invoiceNumber,
  }).from(s.tripExpenses)
    .where(and(
      inArray(s.tripExpenses.tripId, unattachedTripRows.map((trip) => trip.id)),
      liveDebitTripExpense(),
    ));
  const unattachedByLot = new Map<number, ShipmentDebitDetail['unattachedTrips']>();
  // SIL-1016 — CR-011 §2.5.1/§10.6.8 display key per ngoài-chốt row: the lot's
  // Bill/Booking (house direction law, same as the board's Chứng từ cell) and
  // customer short name, so /debit-merge identifies the row instead of '—'.
  const lotById = new Map(lots.map((lot) => [lot.id, lot]));
  for (const trip of unattachedTripRows) {
    if (trip.shipmentId == null) continue;
    const identity = lotById.get(trip.shipmentId);
    const rows = unattachedExpenseRows.filter((row) => row.tripId === trip.id);
    const section: ShipmentDebitDetail['unattachedTrips'][number] = {
      tripId: trip.id,
      tripCode: trip.code,
      billOrBooking: identity
        ? billOrBookNumberFor(identity.tradeDirection, identity.blNumber, identity.bookingRef)
        : null,
      customerName: identity?.customerName ?? null,
      departureDate: trip.departureDate,
      status: trip.status,
      chotIncluded: false as const,
      items: rows.map((expense) => ({
        id: expense.id,
        expenseType: expense.expenseType,
        feeName: expense.feeName,
        amount: Number(expense.buyAmount),
        // The same recharge semantics as the debit-detail section: invoiced
        // rows recharge at cost; Phí khác carries the typed sell.
        thuKhach: expense.expenseType === 'OTHER'
          ? (expense.sellAmount == null ? null : Number(expense.sellAmount))
          : Number(expense.buyAmount),
        note: expense.note,
        invoiceNumber: expense.invoiceNumber,
      })),
      feeTotal: sumExcludingNegative(rows, (expense) => expense.buyAmount),
    };
    const lot = unattachedByLot.get(trip.shipmentId) ?? [];
    lot.push(section);
    unattachedByLot.set(trip.shipmentId, lot);
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
  // SAME merged cells as the chot-debit board. SIL-864 — overrides are per
  // (lot, container); this LOT-level grid reads the BASELINE rows
  // (shipment_container_id NULL) — exactly the board's top-level cells — so
  // a container-scoped edit never bleeds into the lot view, and legacy
  // one-row-per-lot data reads unchanged.
  const rateOverrideRows = await db.select()
    .from(s.shipmentDebitRateOverrides)
    .where(and(
      inArray(s.shipmentDebitRateOverrides.shipmentId, lotIds),
      isNull(s.shipmentDebitRateOverrides.shipmentContainerId),
    ));
  const rateOverrideByLot = new Map(rateOverrideRows.map((row) => [row.shipmentId, row] as const));

  const frozenNumber = (snapshot: unknown, key: string): number | null => {
    if (snapshot == null || typeof snapshot !== 'object') return null;
    const value = (snapshot as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) return Number(value);
    return null;
  };
  // SIL-855 — the accountant's lot-level SIL-805 cước-thu cell override as a
  // number; null when the cell carries no numeric override.
  const cuocThuOverrideValue = (raw: string | null | undefined): number | null => {
    if (raw == null || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };

  const items: DebitMergeItem[] = lots.map((lot) => {
    const effectiveFreight = effectiveFreightByLot.get(lot.id) ?? { value: null, reason: null };
    // SIL-855 QA 23/11 (round 5 posted half its money) — Tổng TC reads the
    // SAME merged Cước thu cell the boards bill: the SIL-805 cell override
    // rides ahead of the auto channel, with applyDebitRateOverridesToCells'
    // 24/10 zero law (non-zero prices; typed 0 arms only a computed channel
    // zero) — so entering cước always syncs control.tongTc with doanh thu
    // (QA round 5: revenue full 3.952.000 ₫ while control.tongTc stayed null).
    const cuocThuCellOverride = cuocThuOverrideValue(rateOverrideByLot.get(lot.id)?.cuocThu);
    const freightAuto = cuocThuCellOverride != null && (cuocThuCellOverride !== 0 || effectiveFreight.value != null)
      ? cuocThuCellOverride
      : effectiveFreight.value;
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

    const noInvoice = noInvoiceByLot.get(lot.id) ?? {
      gnFee: null, gnPaid: null, psFee: null, psPaid: null,
      gnFeePending: false, gnPaidPending: false, psFeePending: false, psPaidPending: false, fees: [],
    };
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
        gnFeePending: noInvoice.gnFeePending,
        gnPaidPending: noInvoice.gnPaidPending,
        psFeePending: noInvoice.psFeePending,
        psPaidPending: noInvoice.psPaidPending,
        fees: noInvoice.fees.map((fee) => ({ name: fee.name, amount: String(fee.amount), side: fee.side, pending: fee.pending, savedAt: fee.savedAt })),
      },
      control: {
        tongTc: tongTc == null ? null : String(tongTc),
        lockStatus: (lock != null ? 'LOCKED' : 'OPEN') as 'LOCKED' | 'OPEN',
        lockedAt: lock?.lockedAt.toISOString() ?? null,
        pendingFeeCount: pendingFeeCountByLot.get(lot.id) ?? 0,
      },
      cargoMode: (lot.cargoMode ?? null) as 'FCL' | 'LCL' | null,
      revGroupId: lot.revGroupId,
      revGroupOrder: lot.revGroupOrder,
      lclParams: debitMergeLclParams(lot, lclClassCodes, lclPrincipalRefs),
      unattachedTrips: unattachedByLot.get(lot.id) ?? [],
    };
  });
  return { items, total: items.length };
}
