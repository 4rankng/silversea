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
//         amount; Phát sinh ĐV = other ops-expense cost; Tổng trả = their sum —
//         PHÍ RU EXCLUDED (own column after Tổng trả, per P1).
//   Lợi nhuận = Tổng thu − Tổng trả − Chi phí ngoài (SIL-771, khách chốt
//         09/11/2026 — thay công thức P1 'Tổng thu − Tổng 1 − Phí RU'; Phí RU
//         còn HIỂN THỊ nhưng không còn trừ riêng). Chi phí ngoài là input kế
//         toán (shipments.debit_external_cost); null = chưa nhập → đóng góp 0,
//         KHÔNG khiến lợi nhuận null. Null khi Tổng thu/Tổng trả chưa xác định.
//   Phí RU = pricing_tables rate_key='RU' (DATA — Chưa xác định until the
//         customer populates the rate; convention flagged CẦN THÔNG TIN).
//
// "Duyệt" per the card's 2026-09-21 user ruling = confirmation columns, not
// an approval queue: confirm/withdraw NEVER change rates (đối soát only).
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import * as s from '../db/schema';
import { db, type Executor } from '../db';
import { sumExcludingNegative, OWN_FLEET_CARRIER_LABEL } from '@tingting/shared';
import { ApiError } from '../errors';
import { activeTripConditions } from './active-trip-scope';
import { isRevGroupNote } from './lcl-rev-notes';
import { opsChargeReceivableContribution, derivedTripReceivable, zoneFeeBillsLachHuyenCells, ZONE_SURCHARGE_CODE } from './debit-receivable-arming';
import { liveDebitOpsExpense, liveDebitTripExpense, standaloneDebitTripRevenue } from './live-debit-expense-scope';
import { resolveCarrierPaymentTermWarnings } from './carrier-payment-term.service';
import { billOrBookNumberFor } from './cus-workspace-mapping.service';
import { operationalName } from '../db/master-data-name';
import { ROUTE_DISPLAY_NAME } from './cus-workspace-sql.service';
import { intakeFreezeCountsForLot, loadLotTripPresence, loadRevenueOverrideByLot } from './revenue-override-read.service';
import { effectiveLclFreight } from './lcl-effective-freight';
import { carrierKeysForLot } from './debit-settlement-shared';
import { loadDispatchExpenseNotes } from './dispatch-expense-notes.service';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock-reads.service';
import { assertShipmentCostUnlocked } from './shipment-cost-lock.service';
import { mergeDeclarationNumbersByLot } from './shipment-debit-summary.service';
import { resolveLotPortZoneConfigBatch } from './zone-surcharge.service';

function toNumber(value: string | number | null | undefined): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

const money = (value: number | null): string | null =>
  value == null ? null : String(value);

/**
 * K2.45 — the lot row's carrier payment-term warning: the DISTINCT reasons
 * of the lot's own external carrier customers, in first-seen carrier order,
 * joined on one line (a lot may run several carriers with broken
 * carrier↔supplier links; identical sentences collapse). Null = every
 * carrier's link is intact — the row stays silent. Pure by the BE
 * unit-only law: the batch resolver feeds the map, this only assembles.
 */
export function paymentTermWarningForLot(
  carrierIds: readonly number[],
  warningsByCarrierId: ReadonlyMap<number, string | null>,
): string | null {
  const reasons: string[] = [];
  for (const id of carrierIds) {
    const reason = warningsByCarrierId.get(id);
    if (reason != null && !reasons.includes(reason)) reasons.push(reason);
  }
  return reasons.length > 0 ? reasons.join(' · ') : null;
}

/**
 * Phí RU per lot: pricing_tables rate_key='RU' — latest effectiveDate ≤ the
 * lot's delivery date per customer+route; falls back to the latest when none
 * is applicable yet. DATA-driven: absent until the customer populates rows.
 * Single RU lookup in the codebase — the P&L cost-structure line (SIL-943)
 * reads the same engine, never a second copy.
 */
export async function loadRoadUsageFeeByLot(
  lots: Array<{ id: number; customerId: number | null; routeId: number | null; ngay: string | null }>,
  executor: Executor = db,
): Promise<Map<number, number>> {
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
  return ruByLot;
}

/**
 * SIL-771 — Lợi nhuận = Tổng thu − Tổng trả − Chi phí ngoài (khách chốt
 * 09/11/2026, thay công thức P1 'Tổng thu − Tổng 1 − Phí RU').
 *
 * Chi phí ngoài là INPUT kế toán: null = chưa nhập → đóng góp 0, không phải
 * "chưa xác định" — hàng tự động còn thiếu (tổng thu/tổng trả) mới là lý do
 * lợi nhuận chưa tính được. Kết quả string để đi dây đúng chuẩn tiền của bảng
 * (money fields string|null — Chưa xác định, never a fabricated 0).
 */
export function computeDebitBoardProfit(
  tongThu: string | null,
  tongTra: string | null,
  chiPhiNgoai: string | null,
): string | null {
  if (tongThu == null || tongTra == null) return null;
  const external = chiPhiNgoai == null ? 0 : Number(chiPhiNgoai);
  return money(Number(tongThu) - Number(tongTra) - external);
}

// ─── SIL-805 — kế toán sửa trực tiếp ô giá/chi phí trên dòng ───────────────

/** The WIRE names of the 8 accountant-editable money cells (route + FE). */
export type DebitRateOverrideField =
  | 'cuocThu' | 'lachHuyen' | 'phuPs' | 'phatSinhCus'
  | 'cuocTraDv' | 'lachHuyenDv' | 'phatSinhDv' | 'phiRu';

export type DebitRateOverrideInput = Partial<Record<DebitRateOverrideField, number | null>>;

/** One lot's stored overrides (shipments_debit_rate_overrides row, string|null). */
export interface ShipmentDebitRateOverrides {
  cuocThu: string | null;
  lachHuyenThu: string | null;
  phuPs: string | null;
  phatSinhCus: string | null;
  cuocTraDv: string | null;
  lachHuyenDv: string | null;
  phatSinhDv: string | null;
  phiRu: string | null;
}

/** The derived cell values + their per-channel KNOWN flags (§ known law). */
export interface DebitBoardDerivedCells {
  cuocThu: string | null; cuocThuKnown: boolean;
  lachHuyen: string | null; lachHuyenKnown: boolean;
  phuPs: string | null; phuPsKnown: boolean;
  phatSinhCus: string | null; phatSinhCusKnown: boolean;
  cuocTraDv: string | null; cuocTraDvKnown: boolean;
  lachHuyenDv: string | null; lachHuyenDvKnown: boolean;
  phatSinhDv: string | null; phatSinhDvKnown: boolean;
  phiRu: string | null;
}

/**
 * SIL-805 — merge the accountant's overrides into the derived money cells.
 * An override replaces the derived value of ITS cell and counts as KNOWN;
 * every other cell keeps its derived channel. Tổng thu/Tổng trả roll from
 * the merged cells (Phí RU stays display-only), so Lợi nhuận
 * (= Tổng thu − Tổng trả − Chi phí ngoài) reads the override too.
 *
 * Luật 24/10 cho ô override = 0 (QA 19/11, lô R3K-J1): 0 chỉ là GIÁ TRỊ khi
 * kênh tự động của ô đó ĐÃ BIẾT (computed financial zero, card
 * 20261002_293). Gõ 0 vào ô CHƯA XÁC ĐỊNH không định giá lô — ô giữ kênh
 * tự động (trống) thay vì bịa '0' giả trên lô mở chưa có giá; lô ghép hiển
 * 0 theo miễn trừ riêng của mình. Override ≠ 0 luôn định giá ô.
 */
export function applyDebitRateOverridesToCells(
  derived: DebitBoardDerivedCells,
  overrides: ShipmentDebitRateOverrides | undefined,
): { thu: AccountingDebitBoardRow['thu']; tra: AccountingDebitBoardRow['tra'] } {
  const merge = (
    override: string | null | undefined,
    value: string | null,
    known: boolean,
  ): { value: string | null; known: boolean } =>
    override != null && (toNumber(override) !== 0 || value != null)
      ? { value: money(toNumber(override)), known: true }
      : { value, known };
  const thuCells = [
    merge(overrides?.cuocThu, derived.cuocThu, derived.cuocThuKnown),
    merge(overrides?.lachHuyenThu, derived.lachHuyen, derived.lachHuyenKnown),
    merge(overrides?.phuPs, derived.phuPs, derived.phuPsKnown),
    merge(overrides?.phatSinhCus, derived.phatSinhCus, derived.phatSinhCusKnown),
  ];
  const traCells = [
    merge(overrides?.cuocTraDv, derived.cuocTraDv, derived.cuocTraDvKnown),
    merge(overrides?.lachHuyenDv, derived.lachHuyenDv, derived.lachHuyenDvKnown),
    merge(overrides?.phatSinhDv, derived.phatSinhDv, derived.phatSinhDvKnown),
  ];
  const sumKnown = (cells: Array<{ value: string | null; known: boolean }>): string | null =>
    cells.some((cell) => cell.known)
      ? money(cells.reduce((sum, cell) => sum + (cell.known ? Number(cell.value) : 0), 0))
      : null;
  return {
    thu: {
      cuocThu: thuCells[0].value,
      lachHuyen: thuCells[1].value,
      phuPs: thuCells[2].value,
      phatSinhCus: thuCells[3].value,
      tongThu: sumKnown(thuCells),
    },
    tra: {
      cuocTraDv: traCells[0].value,
      lachHuyenDv: traCells[1].value,
      phatSinhDv: traCells[2].value,
      tong1: sumKnown(traCells),
      phiRu: merge(overrides?.phiRu, derived.phiRu, true).value,
    },
  };
}

export interface AccountingDebitBoardRow {
  shipmentId: number;
  code: string | null;
  customerName: string | null;
  customerId: number | null;
  carrierKeys: string[];
  /** K2.45 — the carrier payment-term warning (hạn thanh toán chưa xác
   *  định): the named reason when one of the lot's OWN external carrier
   *  customers lost its linked supplier, quoted verbatim from the server.
   *  Distinct reasons join on one line; null = silent. Optional so older
   *  wires (tests, preview family) keep reading. */
  paymentTermWarning?: string | null;
  ngay: string | null;
  billOrBooking: string | null;
  /** K3.61 — số tờ khai của lô, gộp cả hai store (per-cont attribute trước,
   *  entity rows sau, dedup): display key thứ hai ngay sau Bill/Booking trên
   *  màn công nợ. Null = lô không có tờ khai. */
  customsNumber: string | null;
  containers: string[];
  phanXe: string[];
  /** SIL-838 điểm 1 — nhà máy/kho hàng của lô dưới tên KH: coalesce (site
   *  catalog Nhà máy → factoryName gõ tay). SIL-865 — the warehouse-site
   *  fallback was removed (port-named warehouse sites leaked into the
   *  column); null khi lô không mang nguồn nào. */
  factoryName: string | null;
  /** SIL-838 điểm 1 — tuyến dưới tên KH: route catalog names (trip chain →
   *  container chain → lot-level ROUTE_DISPLAY_NAME → factory site route).
   *  SIL-865 — port-pair tiers removed; null khi lô không có tuyến catalog. */
  routeName: string | null;
  /** SIL-838 điểm 2 — BKS thực của lô từ trip (own fleet + external plate),
   *  đã lọc bỏ biển mà nhãn phân xe đã hiện (dòng đội nội bộ tự gọi bằng
   *  biển). Rỗng khi chưa có xe nào gán — FE rồi lật tới actualTruckNo. */
  truckPlates: string[];
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
    /** SIL-191 (QA R42) — the COST (ghép trả ĐV) group id the strip's
     *  "Tách nhóm" reads to pick the unmerge dimension (revGroupId is null
     *  on cost-merged lots, where only ghépCùngRef named the group). */
    costGroupId: string | null;
  } | null;
  /** K2.23 (SIL-1084) — the PRE-override engine/contract value of the Cước
   *  thu cell (what the cell shows with no accountant override): kế toán
   *  đối chiếu beside the input while editing. Null = Chưa xác định (never a
   *  fabricated 0). The FE reason-dialog compares against it too. */
  cuocThuAuto: string | null;
  /** The engine formula note behind cuocThuAuto (freight snapshot
   *  formula_text; null on the summed trip-legs channel — "nếu có"). */
  cuocThuAutoFormula: string | null;
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
  /** SIL-771 — 'Chi phí ngoài' kế toán nhập (shipments.debit_external_cost).
   *  Null = chưa nhập; tham gia công thức lợi nhuận với trọng số 0. */
  chiPhiNgoai: string | null;
  loiNhuan: string | null;
  ghiChu: string | null;
  adjustment: {
    status: 'NONE' | 'PENDING' | 'CONFIRMED';
    requestId: number | null;
    requestedAt: string | null;
    confirmedAt: null | string;
  };
  /** SIL-773 — dòng đã 'Lưu - Phê duyệt từng dòng và ẩn' (ISO) hoặc null:
   *  hidden rows leave the operations list but stay viewable with
   *  includeHidden, so the history remains traceable. */
  debitHiddenAt: string | null;
  /** FB-094 (card 201026112300) — ACTIVE cost-lock time (ISO) or null: the
   *  consolidated debit-note export only accepts locked lots, so the board
   *  row carries its export eligibility. */
  costLockedAt: string | null;
}

// SIL-838 điểm 1 — site catalog alias for the nhà máy coalesce under the
// Lô cell's customer name (the shipment may point at it, carry only the
// typed factoryName, or neither — SIL-865: a lot with neither renders NO
// factory line, never a port/warehouse site name).
const debitBoardFactorySite = alias(s.operationalSites, 'debit_board_factory_site');
// SIL-838 QA (fd0f7f14) — tuyến authority rides the container grain first
// (FB-074): FCL truth lives on shipment_containers.route_id / raw_route_name,
// the lot-level chain is empty on prod data. Catalog name via this alias so
// the subquery's routes join never collides with the outer lot-level one.
// SIL-865 (hotfix CR-009.1) — the customer REMOVED the cảng nâng/hạ pair
// tiers from this column ('Cảng Đình Vũ → Cảng Đình Vũ' read as port names
// where a TUYẾN ĐƯỜNG belongs): the label serves route CATALOG names only,
// and a route-less lot stays null (the FE renders no line / '—').
const debitBoardContainerRoute = alias(s.routes, 'debit_board_container_route');
const debitBoardContainerRouteCatalogLabel = sql<string | null>`${operationalName(debitBoardContainerRoute.shortName, debitBoardContainerRoute.name)}`;
// SIL-865 — the trip tier keeps its non-canceled scope but reads the route
// CATALOG name (the canonicalOrigin/destination pairs are port names too).
const debitBoardTripRoute = alias(s.routes, 'debit_board_trip_route');
const debitBoardTripRouteCatalogLabel = sql<string | null>`${operationalName(debitBoardTripRoute.shortName, debitBoardTripRoute.name)}`;
const debitBoardFactoryRoute = alias(s.routes, 'debit_board_factory_route');

export async function getAccountingDebitBoard(query: {
  dateFrom?: string;
  dateTo?: string;
  /** SIL-773 — true = hiện cả các dòng đã 'Lưu - Phê duyệt từng dòng và ẩn'
   *  (lịch sử); mặc định chỉ danh sách tác nghiệp (debit_hidden_at null). */
  includeHidden?: boolean;
}, executor: Executor = db): Promise<{ items: AccountingDebitBoardRow[]; total: number }> {
  const conditions = [isNull(s.shipments.deletedAt)];
  if (!query.includeHidden) conditions.push(isNull(s.shipments.debitHiddenAt));
  if (query.dateFrom) conditions.push(gte(s.shipments.expectedDeliveryDate, query.dateFrom));
  if (query.dateTo) conditions.push(lte(s.shipments.expectedDeliveryDate, query.dateTo));
  const lots = await executor.select({
    id: s.shipments.id,
    code: s.shipments.shipmentCode,
    customerId: s.shipments.customerId,
    // Card 191026202000: the board names ride the master-data short name —
    // same coalesce law every other grid projection reads (fallback full name).
    customerName: operationalName(s.customers.shortName, s.customers.name),
    // SIL-838 điểm 1 — nhà máy/kho hàng + tuyến dưới tên KH. Catalog site
    // names ride the same operational short-name law as customerName; the
    // typed factoryName (nhập tay) bridges lots without a catalog link.
    // SIL-865 — the warehouse-site fallback is GONE: pickup warehouse sites
    // on prod are port-named ('Cảng Mipec'), and an un-factory lot must
    // render no line, not a port.
    factoryName: sql<string | null>`coalesce(
      nullif(btrim(${s.shipments.factoryNameSnapshot}), ''),
      ${operationalName(debitBoardFactorySite.shortName, debitBoardFactorySite.name)},
      nullif(btrim(${s.shipments.factoryName}), '')
    )`,
    // SIL-865 (hotfix CR-009.1) — the TUYẾN ĐƯỜNG line names the ROUTE, in
    // catalog-name form ('KCN Đồng Văn, Hà Nam'), never a cảng pair: the
    // port-pair tiers of SIL-838 round-3 (container cảng nâng→hạ, trip
    // canonicalOrigin→destination, LCL pickup/delivery points) printed port
    // names under the customer name and the customer struck them from the
    // column. Chain: trip route catalog → container route catalog →
    // lot-level ROUTE_DISPLAY_NAME (catalog name, typed raw text fallback)
    // → the factory site's canonical route. A route-less lot stays null —
    // the FE renders no line (or '—'), never a port name.
    routeName: sql<string | null>`coalesce(
      (select string_agg(distinct ${debitBoardTripRouteCatalogLabel}, ' · ')
         from ${s.trips}
         left join ${s.routes} debit_board_trip_route on debit_board_trip_route.id = ${s.trips.routeId}
        where ${s.trips.shipmentId} = ${s.shipments.id}
          and ${s.trips.deletedAt} is null
          and ${s.trips.status} <> 'CANCELED'),
      (select string_agg(distinct ${debitBoardContainerRouteCatalogLabel}, ' · ')
         from ${s.shipmentContainers}
         left join ${s.routes} debit_board_container_route on debit_board_container_route.id = ${s.shipmentContainers.routeId}
        where ${s.shipmentContainers.shipmentId} = ${s.shipments.id}),
      ${ROUTE_DISPLAY_NAME},
      (select ${operationalName(debitBoardFactoryRoute.shortName, debitBoardFactoryRoute.name)}
         from ${s.routes} debit_board_factory_route
        where debit_board_factory_route.id = ${debitBoardFactorySite.routeId})
    )`,
    // SIL-838 điểm 4 — ghi chú CUS (customer-facing) + Điều vận (internal).
    customerNotes: s.shipments.customerNotes,
    operationalNotes: s.shipments.operationalNotes,
    routeId: s.shipments.routeId,
    ngay: s.shipments.expectedDeliveryDate,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
    tradeDirection: s.shipments.tradeDirection,
    // SIL-771 — 'Chi phí ngoài' the accountant types on the board.
    debitExternalCost: s.shipments.debitExternalCost,
    // SIL-773 — 'Lưu - Phê duyệt từng dòng và ẩn' marker for the history view.
    debitHiddenAt: s.shipments.debitHiddenAt,
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
    .leftJoin(s.routes, eq(s.routes.id, s.shipments.routeId))
    .leftJoin(debitBoardFactorySite, eq(debitBoardFactorySite.id, s.shipments.operationalSiteId))
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
    // SIL-814 — the unpriced-freeze guard below needs the engine's trace ids
    // (the same `isManual` predicate the snapshot lifecycle view uses).
    rateTermsId: s.freightRateSnapshots.rateTermsId,
    pricingTableId: s.freightRateSnapshots.pricingTableId,
    fuelNormId: s.freightRateSnapshots.fuelNormId,
    fuelPricePeriodId: s.freightRateSnapshots.fuelPricePeriodId,
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
  const tripLegs = new Map<number, { freight: number; surcharge: number; surchargeComputed: boolean }>();
  const intake = new Map<number, { freight: number; surcharge: number; surchargeComputed: boolean; formulaNote: string | null }>();
  for (const row of grainRows) {
    const lot = row.shipmentId;
    if (lot == null) continue;
    // SIL-814 (the shipment-debit-summary guard, byte-for-byte law): an
    // UNPRICED freeze (any zeroed trace id — the engine's MANUAL fallbacks)
    // carrying zero money is never a live price: dropping the row keeps the
    // 24/10 rule (a not-yet-priced lot reads TRỐNG, never a fabricated 0₫
    // on CƯỚC THU (TỰ ĐỘNG) / Phụ ps / TỔNG). A genuinely-priced 0 (D02)
    // freezes a full trace and still counts.
    const leg = {
      freight: toNumber(row.freightAmount),
      surcharge: toNumber(row.surchargeAmount),
      // K2.120: a 0 surcharge with missing fuel trace ids (fuelNormId=0 or
      // fuelPricePeriodId=0) means fuel surcharge was never computed, not 0₫.
      surchargeComputed: toNumber(row.surchargeAmount) > 0
        || (row.fuelNormId !== 0 && row.fuelPricePeriodId !== 0),
    };
    // QA 28/11 finding 09 — the REV merge's materialized member rows carry
    // all-zero trace ids BY DESIGN (insertRevMergeSnapshot) and cite 0₫ with
    // the group note. This guard must not swallow them: the grouped
    // secondary lot's explicit zero share (spec §4) is exactly what Chọn
    // Debit needs to close both lots. An UNGROUPED lot's cited-zero tail
    // still reads unset through effectiveLclFreight's FB-145 rule (1).
    if (leg.freight === 0 && leg.surcharge === 0
      && !isRevGroupNote(row.formulaText)
      && (row.rateTermsId === 0 || row.pricingTableId === 0
        || row.fuelNormId === 0 || row.fuelPricePeriodId === 0)) {
      continue;
    }
    if (row.tripId != null) {
      const acc = tripLegs.get(lot) ?? { freight: 0, surcharge: 0, surchargeComputed: false };
      acc.freight += leg.freight;
      acc.surcharge += leg.surcharge;
      acc.surchargeComputed = acc.surchargeComputed || leg.surchargeComputed;
      tripLegs.set(lot, acc);
    } else {
      intake.set(lot, { ...leg, formulaNote: row.formulaText ?? null });
    }
  }
  // SIL-1050 (K2.61) — chân đã hủy không tính cước: a lot whose every trip
  // is CANCELED must not resurrect the intake freeze through the
  // `tripLegs ?? intake` fallback (its priced legs drop out by the
  // active-trip scope, and the fallback used to re-arm the pre-cancel price
  // on the Kiểm soát lô hàng board).
  const tripPresence = await loadLotTripPresence(executor, lotIds);
  for (const lot of lotIds) {
    const legs = tripLegs.get(lot);
    const intakeRow = intake.get(lot);
    const pick = legs ?? (intakeRow != null && intakeFreezeCountsForLot(tripPresence.get(lot)) ? intakeRow : undefined);
    if (pick !== undefined && pick.surchargeComputed) {
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
  // K2.23 (SIL-1084) — the engine formula note riding the snapshot channel,
  // surfaced beside the Cước thu input for đối chiếu (null on the summed
  // trip-legs channel, whose freezes carry no single formula string).
  const freightAutoFormulaByLot = new Map<number, string | null>();
  for (const lot of lots) {
    const override = overrideByLot.get(lot.id) ?? null;
    const legs = tripLegs.get(lot.id);
    const intakeRow = intake.get(lot.id);
    const snapshotChannel = legs !== undefined
      ? { total: legs.freight, formulaNote: null }
      : (intakeRow != null && intakeFreezeCountsForLot(tripPresence.get(lot.id))
        ? { total: intakeRow.freight, formulaNote: intakeRow.formulaNote }
        : null);
    freightAutoFormulaByLot.set(lot.id, snapshotChannel?.formulaNote ?? null);
    effectiveFreightByLot.set(lot.id, effectiveLclFreight({
      snapshotChannel,
      override: override == null
        ? null
        : { total: override.total, reason: override.reason, stamped: override.stamped },
      revGroupId: lot.revGroupId ?? null,
      revGroupOrder: lot.revGroupOrder ?? null,
      // SIL-1235 — the member's 0₫ citation names the LIVE Lô 1 (the same
      // ref the 'Ghép cùng Bill X' cell reads).
      revPrincipalRef: lot.revGroupId != null ? lclPrincipalRefs.get(lot.revGroupId) ?? null : null,
      cargoMode: lot.cargoMode,
    }).value);
  }

  // Lạch Huyện cells + Phát sinh ĐV: ops-expense rows per lot.
  // ZONE_SURCHARGE rows carry BOTH sides (amount = điều vận cost;
  // customerChargeAmount = negotiated customer charge). Other ops rows =
  // Phát sinh ĐV. Known when rows exist — never a fabricated 0.
  const zoneCode = ZONE_SURCHARGE_CODE;
  const opsRows = await executor.select({
    shipmentId: s.opsExpenseEntries.shipmentId,
    expenseTypeCode: s.opsExpenseEntries.expenseTypeCode,
    // SIL-1243 — the family discriminator for the 0-charge law (below).
    costGroup: s.opsExpenseEntries.costGroup,
    amount: s.opsExpenseEntries.amount,
    customerChargeAmount: s.opsExpenseEntries.customerChargeAmount,
    // SIL-1226 — the duyệt axis: a pending zone fee must not bill the
    // Lạch Huyện cells (see zoneFeeBillsLachHuyenCells). The confirm stamp
    // lives on the OPS accounting-source registry link (same as the merge
    // board's SIL-883 axis), not on the entry row.
    confirmedAt: s.expenseAccountingSources.confirmedAt,
  }).from(s.opsExpenseEntries)
    .leftJoin(s.expenseAccountingSources, and(
      eq(s.expenseAccountingSources.sourceKind, 'OPS'),
      eq(s.expenseAccountingSources.sourceId, s.opsExpenseEntries.id),
    ))
    .where(and(
      inArray(s.opsExpenseEntries.shipmentId, lotIds),
      // SIL-1128 — LIVE money only (CR-010.1 SIL-896, the law summary/Chi tiết
      // Debit/lot-payables already ride): a VOIDED row (native or registry-
      // voided through expense_accounting_sources) and a REJECTED row
      // (SIL-882 tự động gỡ — owner evidence comment 09:23: the reject path
      // shares the void leak's root) are dead money. Without this scope the
      // board's Phát sinh ĐV / Lạch Huyện ĐV / Tổng trả counted fees Chi tiết
      // Debit had already dropped (lô 6 EHPH26080202: bảng 1.105.000 ₫ vs chi
      // tiết 705.000 ₫) and deleting a fee moved the detail but not the board.
      liveDebitOpsExpense(),
      ne(s.opsExpenseEntries.approvalStatus, 'REJECTED'),
    ));
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
  // QA 28/11 finding 01 — the receivable's ops-charge side (Tổng TC's law,
  // ONE shared rule with the merge board): the negotiated customer charge,
  // else charge ?? paid for an un-negotiated fee. Without it the chốt đợt's
  // Tổng thu missed exactly the chi-hộ money the frozen lock billed, so a
  // lot with an approved expense could never reconcile its Debit Note
  // against the đợt (1514: 4.638.000 vs 3.998.800, delta = surcharge −
  // expense).
  const opsChargeByLot = new Map<number, { known: boolean; total: number }>();
  for (const row of opsRows) {
    const lot = row.shipmentId;
    if (lot == null) continue;
    const chargeContribution = opsChargeReceivableContribution({
      expenseTypeCode: row.expenseTypeCode,
      charge: row.customerChargeAmount,
      amount: row.amount,
      costGroup: row.costGroup,
    });
    if (chargeContribution != null) {
      const entry = opsChargeByLot.get(lot) ?? { known: false, total: 0 };
      entry.known = true;
      entry.total += chargeContribution;
      opsChargeByLot.set(lot, entry);
    }
    if (row.expenseTypeCode === zoneCode) {
      // SIL-1226 — a PENDING zone fee bills NEITHER cell: its un-negotiated
      // charge 0 used to read as a negotiated 0 (zeroing the thu cell so the
      // config fallback never ran) and its cost overwrote the trả cell while
      // only awaiting Kế toán duyệt. It stays visible in the group-5
      // no-invoice family (SIL-1072 display law); an APPROVED row bills the
      // cells — the Ops override wins (unchanged).
      if (zoneFeeBillsLachHuyenCells(row.confirmedAt)) {
        const bucket = zoneCostRows.get(lot) ?? [];
        bucket.push({ amount: row.amount });
        zoneCostRows.set(lot, bucket);
        if (row.customerChargeAmount != null) {
          zoneChargeByLot.set(lot, (zoneChargeByLot.get(lot) ?? 0) + toNumber(row.customerChargeAmount));
        }
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
  // K2.121: fall back to port_zone_surcharges config (e.g. Hateco 500k/đầu)
  // whenever a lot has no manual Ops ZONE_SURCHARGE override row.
  const portZoneConfigByLot = await resolveLotPortZoneConfigBatch(lotIds, executor);
  for (const [lot, configAmount] of portZoneConfigByLot) {
    if (!zoneChargeByLot.has(lot)) zoneChargeByLot.set(lot, configAmount);
    if (!zoneCostByLot.has(lot)) zoneCostByLot.set(lot, configAmount);
  }

  // Phát sinh thu khách: the trip-expenses sell side (OTHER sells) + the
  // derived recharge (non-OTHER rows' buy ≥ 0) + the ops-charge side above —
  // ONE receivable law with the merge board's Tổng TC (QA 28/11 finding 01:
  // the two laws must sum the same components or lock/chốt/export can never
  // reconcile). Scope mirrors the summary/merge live scope exactly: voided
  // rows out (Q10, card 20260922_78), OPS-projected rows out (their native
  // ops row already counts once — spec ch6 §101 "cộng đúng một lần"),
  // ngoài-chốt fulfillment-null trips out (SIL-974: display-only).
  const revenueRows = await executor.select({
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
      isNotNull(s.trips.fulfillmentId),
      liveDebitTripExpense(),
      standaloneDebitTripRevenue(),
      // Q10 (card 20260922_78): soft-voided fee rows leave the money math.
      ne(s.tripExpenses.approvalStatus, 'VOIDED'),
    ));
  const otherSellByLot = new Map<number, number>();
  const revenueKnownLots = new Set<number>();
  for (const row of revenueRows) {
    if (row.shipmentId == null) continue;
    revenueKnownLots.add(row.shipmentId);
    if (row.expenseType === 'OTHER') {
      otherSellByLot.set(row.shipmentId, (otherSellByLot.get(row.shipmentId) ?? 0) + toNumber(row.sell));
    } else {
      // SIL-1243 — the row's own customer charge governs (0 included); only a
      // row without a recorded charge falls back to the pass-at-cost recharge.
      otherSellByLot.set(row.shipmentId, (otherSellByLot.get(row.shipmentId) ?? 0) + derivedTripReceivable(row));
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
  // when subcontracted (trucks.carrierId); an own-fleet trip names the fixed
  // internal-fleet label (SIL-838 QA fd0f7f14 — the plate rides "Thực:");
  // external-carrier trips show the customer-as-carrier name
  // (accounting-transport-register precedent).
  const tripRows = await executor.select({
    shipmentId: s.trips.shipmentId,
    licensePlate: s.trucks.licensePlate,
    truckCarrierId: s.trucks.carrierId,
    carrierType: s.tripCarrierInfo.carrierType,
    externalEntityId: s.tripCarrierInfo.externalEntityId,
    externalEntityType: s.tripCarrierInfo.externalEntityType,
    externalPlate: s.tripCarrierInfo.externalPlateNumber,
    // Ticket 18/11 Task 2.2 — per-container vehicle facts: the fulfillment
    // pins a dispatched trip to one shipment container (null = lot-level /
    // legacy trip the per-container rows cannot claim).
    fulfillmentContainerId: s.shipmentFulfillments.shipmentContainerId,
  }).from(s.trips)
    .leftJoin(s.trucks, eq(s.trucks.id, s.trips.truckId))
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
    .leftJoin(s.shipmentFulfillments, eq(s.trips.fulfillmentId, s.shipmentFulfillments.id))
    .where(and(
      inArray(s.trips.shipmentId, lotIds),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
    ));
  const phanXeRaw = new Map<number, Array<{ plate: string | null; carrierId: number | null; externalId: number | null; externalPlate: string | null; containerId: number | null }>>();
  const carrierNameIds = new Set<number>();
  // K2.45 — the carrier customers whose payment deadline cannot be
  // determined, per lot: EXTERNAL trips carrying a CUSTOMER-typed carrier
  // (the same gate the trip close runs — only those post a carrier payable
  // against a linked supplier). Batch-resolved once per page below.
  const termWarningCarrierIdsByLot = new Map<number, number[]>();
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
      containerId: row.fulfillmentContainerId ?? null,
    });
    phanXeRaw.set(row.shipmentId, list);
    if (row.truckCarrierId != null) carrierNameIds.add(row.truckCarrierId);
    if (row.externalEntityType === 'CUSTOMER' && row.externalEntityId != null) carrierNameIds.add(row.externalEntityId);
    if (row.carrierType === 'EXTERNAL' && row.externalEntityType === 'CUSTOMER' && row.externalEntityId != null) {
      const ids = termWarningCarrierIdsByLot.get(row.shipmentId) ?? [];
      if (!ids.includes(row.externalEntityId)) ids.push(row.externalEntityId);
      termWarningCarrierIdsByLot.set(row.shipmentId, ids);
    }
  }
  const termWarningsByCarrierId = await resolveCarrierPaymentTermWarnings(
    executor,
    [...new Set([...termWarningCarrierIdsByLot.values()].flat())],
  );

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

  // Thông số container labels per lot (shipment_containers). Id + stable id
  // order so the per-container detail rows align with the labels the board
  // splits into per-container lines (ticket 18/11 Task 2.2).
  const containerRows = await executor.select({
    id: s.shipmentContainers.id,
    shipmentId: s.shipmentContainers.shipmentId,
    containerNumber: s.shipmentContainers.containerNumber,
    containerTypeId: s.shipmentContainers.containerTypeId,
    declarationNumber: s.shipmentContainers.declarationNumber,
  }).from(s.shipmentContainers)
    .where(inArray(s.shipmentContainers.shipmentId, lotIds))
    .orderBy(asc(s.shipmentContainers.id));
  // K3.61 — the lot's số tờ khai resolves BOTH stores (per-cont attribute in
  // `containerRows` above first, then the lot-level entity rows): the second
  // display key after Bill/Booking. Merge law shared with the debit summary.
  const declarationEntityRows = await executor.select({
    shipmentId: s.shipmentDeclarations.shipmentId,
    declarationNumber: s.shipmentDeclarations.declarationNumber,
  }).from(s.shipmentDeclarations)
    .where(inArray(s.shipmentDeclarations.shipmentId, lotIds))
    .orderBy(asc(s.shipmentDeclarations.id));
  const declarationNumbersByLot = mergeDeclarationNumbersByLot(containerRows, declarationEntityRows);
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

  // Phí RU: the shared lookup engine (loadRoadUsageFeeByLot) — display-only
  // per the 09/11 ruling.
  const ruByLot = await loadRoadUsageFeeByLot(lots, executor);

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

  // SIL-805 — the accountant's overrides, keyed (lot, container). Only the
  // NULL-container LOT rows feed the board (KB Ch.10 §10.6.1 — SIL-1075
  // ruling: Kế hoạch điều động tổng hợp renders one row per lot); container
  // rows persist through the setter but render nowhere.
  const rateOverrideRows = await executor.select()
    .from(s.shipmentDebitRateOverrides)
    .where(inArray(s.shipmentDebitRateOverrides.shipmentId, lotIds));
  const rateOverrideByLot = new Map(
    rateOverrideRows.filter((row) => row.shipmentContainerId == null)
      .map((row) => [row.shipmentId, row] as const),
  );

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
      // SIL-838 QA (fd0f7f14): an own-fleet trip must NAME the fleet, not
      // label the cell by plate — the plate rides `truckPlates` ("Thực:")
      // instead, so every row shows nhà xe + BKS thực. Same fixed label the
      // trip-less LCL fallback below has always used.
      else if (entry.plate) labels.push(OWN_FLEET_CARRIER_LABEL);
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
      labels.push(OWN_FLEET_CARRIER_LABEL);
    } else if (planned.externalId != null) {
      const name = externalNames.get(planned.externalId);
      if (name) labels.push(name);
      else if (planned.plate) labels.push(planned.plate);
    } else if (planned.plate) {
      labels.push(planned.plate);
    }
    if (labels.length > 0) phanXeByLot.set(lot.id, [...new Set(labels)]);
  }

  // SIL-838 điểm 2 — BKS thực per lot: the plates the lot's trips actually
  // run (own-fleet truck plate + external plate). A plate already shown by
  // the phân xe label is dropped, so the cell never prints the same plate
  // twice (subcontracted carriers still label by carrier name; the plate
  // stays visible here).
  const platesByLot = new Map<number, string[]>();
  for (const [lotId, entries] of phanXeRaw) {
    const labels = phanXeByLot.get(lotId) ?? [];
    const plates = new Set<string>();
    for (const entry of entries) {
      for (const plate of [entry.plate, entry.externalPlate]) {
        const trimmed = plate?.trim();
        if (!trimmed || labels.includes(trimmed)) continue;
        plates.add(trimmed);
      }
    }
    if (plates.size > 0) platesByLot.set(lotId, [...plates]);
  }

  // SIL-838 điểm 2 — same-bill conts share one consignment's vehicle
  // identity (the KH repro: bill K5K5346365 ×2 cont, the second row lost
  // VĂN LAN because only the first cont's trip carried the carrier). A cont
  // whose OWN projection found no vehicle facts at all (no trip, no planned
  // fulfillment) borrows its same-bill siblings' labels + plates. Own data
  // always wins — the borrow never overwrites a row that found its own
  // truck, and a bill-less lot has nothing to borrow against.
  const refByLot = new Map(lots.map((lot) => [
    lot.id,
    billOrBookNumberFor(lot.tradeDirection, lot.blNumber, lot.bookingRef) ?? '',
  ] as const));
  const labelsByRef = new Map<string, string[]>();
  const platesByRef = new Map<string, string[]>();
  const lotIdsWithOwnVehicle = new Set<number>();
  for (const lot of lots) {
    const hasOwn = (phanXeByLot.get(lot.id)?.length ?? 0) > 0
      || (platesByLot.get(lot.id)?.length ?? 0) > 0
      || (lot.actualTruckNo?.trim() ? true : false);
    if (!hasOwn) continue;
    lotIdsWithOwnVehicle.add(lot.id);
    const ref = refByLot.get(lot.id);
    if (!ref) continue;
    const labels = phanXeByLot.get(lot.id) ?? [];
    const plates = [...(platesByLot.get(lot.id) ?? [])];
    if (labels.length > 0) {
      const pooled = labelsByRef.get(ref) ?? [];
      for (const label of labels) if (!pooled.includes(label)) pooled.push(label);
      labelsByRef.set(ref, pooled);
    }
    if (plates.length > 0) {
      const pooled = platesByRef.get(ref) ?? [];
      for (const plate of plates) if (!pooled.includes(plate)) pooled.push(plate);
      platesByRef.set(ref, pooled);
    }
  }
  for (const lot of lots) {
    if (lotIdsWithOwnVehicle.has(lot.id)) continue;
    const ref = refByLot.get(lot.id);
    if (!ref) continue;
    const borrowedLabels = labelsByRef.get(ref);
    if (borrowedLabels?.length) phanXeByLot.set(lot.id, [...borrowedLabels]);
    const borrowedPlates = platesByRef.get(ref);
    if (borrowedPlates?.length) platesByLot.set(lot.id, [...borrowedPlates]);
  }

  // Card 20260928_162 criterion 3 (lead ruling (b)). This board carries a
  // "Ghi chú" column that was hardcoded null, so the reason an uncharged Ops
  // cost is REQUIRED to carry never reached the page whose title matches the
  // card verbatim — and the page where kế toán ticks rows and bills the customer
  // on the debit. Reuses the SAME projection as the dispatch board; no second
  // copy of the note is derived here. Same executor default (db) as this file.
  const opsNotesByShipment = await loadDispatchExpenseNotes(lots.map((lot) => lot.id), executor);

  // Row assembly — SIL-771 arithmetic: Lợi nhuận = Tổng thu − Tổng trả − Chi
  // phí ngoài (chi phí ngoài null = chưa nhập → 0). Phí RU hiển thị riêng,
  // không còn trừ vào lợi nhuận (khách chốt 09/11/2026).
  const items: AccountingDebitBoardRow[] = lots.map((lot) => {
    // F-2 ruling (b): the override-channel value when the lot qualifies, the
    // snapshot value otherwise — ONE effective freight drives Cước thu and
    // Tổng thu so the merged 100%/0₫ law cannot desync between them.
    const freight = effectiveFreightByLot.get(lot.id) ?? null;
    const psAuto = psAutoByLot.get(lot.id);
    const otherSell = otherSellByLot.get(lot.id);
    // QA 28/11 finding 01 — Phát sinh (thu khách) = the trip-revenue side +
    // the ops-charge side (ONE receivable law with the merge board). The
    // 24/10 arming law (K2.120's Σ≠0 wording) still holds: revenue rows
    // alone never fabricate a known 0 — only a non-zero revenue Σ or a
    // known ops-charge side arms the cell.
    const opsCharge = opsChargeByLot.get(lot.id);
    const revenueTotal = otherSellByLot.get(lot.id);
    const otherSellKnownFlag = (revenueKnownLots.has(lot.id) && (revenueTotal ?? 0) !== 0)
      || (opsCharge?.known ?? false);
    const otherSellTotal = (otherSell ?? 0) + (opsCharge?.known ? opsCharge.total : 0);
    const zoneCost = zoneCostByLot.get(lot.id);
    const otherOps = otherOpsByLot.get(lot.id);
    const carrier = carrierByLot.get(lot.id);
    const adj = adjByLot.get(lot.id);
    // SIL-864 — the DERIVED channels are lot facts (freight snapshot, zone
    // surcharge, trip expenses): one input feeds the lot cells AND every
    // per-container row below.
    const derivedCells = {
      cuocThu: freight != null ? money(freight) : null, cuocThuKnown: freight != null,
      lachHuyen: zoneChargeByLot.has(lot.id) ? money(zoneChargeByLot.get(lot.id)!) : null,
      lachHuyenKnown: zoneChargeByLot.has(lot.id),
      phuPs: psAuto != null ? money(psAuto) : null, phuPsKnown: psAuto != null,
      phatSinhCus: otherSellKnownFlag ? money(otherSellTotal) : null,
      phatSinhCusKnown: otherSellKnownFlag,
      cuocTraDv: carrier?.known ? money(carrier.total) : null, cuocTraDvKnown: carrier?.known ?? false,
      lachHuyenDv: zoneCostByLot.has(lot.id) ? money(zoneCost ?? 0) : null,
      lachHuyenDvKnown: zoneCostByLot.has(lot.id),
      phatSinhDv: otherOpsByLot.has(lot.id) ? money(otherOps ?? 0) : null,
      phatSinhDvKnown: otherOpsByLot.has(lot.id),
      phiRu: ruByLot.has(lot.id) ? money(ruByLot.get(lot.id)!) : null,
    };
    // SIL-805 — the accountant's overrides replace the derived cells BEFORE
    // the rollups, so Tổng thu/Tổng trả/Lợi nhuận always read what the board
    // shows. No override row → the assembly is byte-identical to the old
    // derived channels (unit-pinned in debit-board-rate-overrides.test.ts).
    // SIL-1235 (KB Ch.9 §9.6) — AFTER the override merge, the read-time
    // member zero law: a REV-merge lô phụ (revGroupOrder > 1) reads 0₫
    // CƯỚC/PHỤ PHÍ/TỔNG on this board too, regardless of stale stored
    // override/snapshot money (QA 28/11 build 2122c1a2: lô 1551 still thu
    // 1.520.000₫ while ghépCùngRef cited Lô 1; lô 1264 zeroed freight but
    // leaked 506.714₫ Phụ PS). Chi hộ (the tra side) stays untouched — the
    // zero law is revenue-only; Lô 1 and ungrouped lots keep their numbers
    // byte-for-byte.
    const isRevMergeMember = lot.revGroupId != null && (lot.revGroupOrder ?? 1) > 1;
    const cells = applyDebitRateOverridesToCells(derivedCells, rateOverrideByLot.get(lot.id));
    if (isRevMergeMember) {
      cells.thu = { ...cells.thu, cuocThu: '0', phuPs: '0', tongThu: '0' };
    }
    const chiPhiNgoai = lot.debitExternalCost == null ? null : money(toNumber(lot.debitExternalCost));
    const loiNhuan = computeDebitBoardProfit(cells.thu.tongThu, cells.tra.tong1, chiPhiNgoai);
    // KB Ch.10 §10.6.1 (SIL-1075 ruling, Frank 26/11 — "follow KB") — Kế
    // hoạch điều động tổng hợp renders ONE row per lot; the row's money face
    // is the derived channels + the lot-level override, the same lot total
    // settlement rounds and the Debit note read. Container-level override
    // rows stay in the data model (setter contract) but never render — the
    // per-container split duplicated the lot total on every row (K10.29).
    return {
      shipmentId: lot.id,
      code: lot.code,
      customerName: lot.customerName,
      customerId: lot.customerId,
      carrierKeys: carrierKeysForLot(phanXeRaw.get(lot.id) ?? []),
      paymentTermWarning: paymentTermWarningForLot(
        termWarningCarrierIdsByLot.get(lot.id) ?? [],
        termWarningsByCarrierId,
      ),
      ngay: lot.ngay,
      billOrBooking: billOrBookNumberFor(lot.tradeDirection, lot.blNumber, lot.bookingRef),
      customsNumber: (declarationNumbersByLot.get(lot.id) ?? []).join(', ') || null,
      containers: containersByLot.get(lot.id) ?? [],
      factoryName: lot.factoryName,
      routeName: lot.routeName,
      truckPlates: platesByLot.get(lot.id) ?? [],
      // Ticket 18/11 Task 2.4 (SIL-855) — BKS báo khách at TOP level: the FE
      // type documents this wire for the Debit Note preview family; the LCL
      // bucket below keeps the grouped-cell copy.
      billingTruckNo: lot.billingTruckNo,
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
        // SIL-191 (QA R42): the strip "Tách nhóm" must know a ghép TRẢ ĐV
        // (COST) group from a ghép cước thu khách (REV) one — `ghépCùngRef`
        // alone falls back to the cost principal, which is exactly how the
        // QA's cost-merged lots (R39B1-LCL01: revGroupId null, ref set)
        // rendered the merge note with NO reachable unmerge.
        costGroupId: lot.costGroupId,
        ghépCùngRef: (lot.revGroupId != null && (lot.revGroupOrder ?? 1) > 1
          ? lclPrincipalRefs.get(lot.revGroupId) ?? null
          : lot.costGroupId != null && (lot.costGroupOrder ?? 1) > 1
            ? lclPrincipalRefs.get(lot.costGroupId) ?? null
            : null),
      } : null,
      thu: cells.thu,
      tra: cells.tra,
      // K2.23 (SIL-1084) — the engine/contract anchor beside the Cước thu
      // input: the cell value BEFORE the accountant override (the same
      // derived channel applyDebitRateOverridesToCells merges over), plus
      // the snapshot formula note when the engine recorded one.
      cuocThuAuto: derivedCells.cuocThu,
      cuocThuAutoFormula: freightAutoFormulaByLot.get(lot.id) ?? null,
      chiPhiNgoai,
      loiNhuan,
      debitHiddenAt: lot.debitHiddenAt?.toISOString() ?? null,
      // SIL-838 điểm 4 — GHI CHÚ & ĐỐI SOÁT tự mang ghi chú CUS
      // (customer_notes) + Điều vận (operational_notes) của lô, rồi các note
      // phục hồi/đ-cost phát sinh ops (tiền lệ card 20260928_162). Rỗng khi
      // lô không có ghi chú nào.
      ghiChu: [
        lot.customerNotes?.trim(),
        lot.operationalNotes?.trim(),
        ...(opsNotesByShipment.get(lot.id) ?? []),
      ].filter((note): note is string => note != null && note !== '').join(' · ') || null,
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

/** The debit-export guard for the retired rate-adjustment rule (V22) was
 *  removed per spec alignment 24/11 (mục 12): the customer dropped the
 *  'chờ duyệt điều chỉnh cước' flow on 12/11/2026, so a historical PENDING
 *  rate-adjustment row no longer blocks Khóa lô / Chọn Debit / Xuất Debit
 *  Note. The only hard block on those actions is V33 (pending Ops fees,
 *  assertNoPendingApprovalFees). The confirm/withdraw endpoints above stay
 *  for historical rows. */

/**
 * SIL-771 — ghi 'Chi phí ngoài' kế toán gõ trên bảng Kiểm soát lô hàng
 * (shipments.debit_external_cost). null = xoá giá trị (chưa nhập). Lô đã
 * khóa chi phí / khóa sổ kế toán được đóng băng như mọi con số khác trên
 * bảng (same asserts the BKS edit runs) — sửa sau khóa sẽ lệch với giấy báo
 * nợ đã xuất.
 */
export async function setShipmentDebitExternalCost(input: {
  shipmentId: number;
  chiPhiNgoai: number | null;
}): Promise<{ shipmentId: number; chiPhiNgoai: string | null }> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ id: s.shipments.id })
      .from(s.shipments)
      .where(and(eq(s.shipments.id, input.shipmentId), isNull(s.shipments.deletedAt)))
      .for('update');
    if (!row) throw new ApiError(404, 'Không tìm thấy lô hàng');
    await assertShipmentCostUnlocked(tx, row.id);
    await assertShipmentAccountingUnlocked(tx, row.id);
    const next = input.chiPhiNgoai == null ? null : String(input.chiPhiNgoai);
    await tx.update(s.shipments)
      .set({ debitExternalCost: next })
      .where(eq(s.shipments.id, row.id));
    return { shipmentId: row.id, chiPhiNgoai: next };
  });
}

/**
 * SIL-805 — kế toán sửa trực tiếp ô giá/chi phí trên bảng Kiểm soát lô hàng
 * (shipments_debit_rate_overrides, một dòng mỗi lô). Mỗi key trong `rates`
 * là MỘT ô được lưu: number nguyên VND = ghi đè giá trị tự động của ô đó;
 * null = xoá override (ô quay về đọc giá trị tự động). Lô đã khóa chi phí /
 * khóa sổ kế toán bị chặn như mọi con số khác trên bảng (same asserts the
 * external-cost setter runs) — sửa sau khóa sẽ lệch với giấy báo nợ đã xuất.
 * Mỗi lần lưu ghi audit_logs before/after (DEBIT_RATE_OVERRIDE_SET); lưu lại
 * đúng giá trị máy đang giữ là no-op — không write, không audit noise.
 */
const RATE_WIRE_TO_COLUMN = {
  cuocThu: 'cuocThu',
  lachHuyen: 'lachHuyenThu',
  phuPs: 'phuPs',
  phatSinhCus: 'phatSinhCus',
  cuocTraDv: 'cuocTraDv',
  lachHuyenDv: 'lachHuyenDv',
  phatSinhDv: 'phatSinhDv',
  phiRu: 'phiRu',
} as const satisfies Record<DebitRateOverrideField, keyof ShipmentDebitRateOverrides>;

const RATE_COLUMN_TO_WIRE = Object.fromEntries(
  Object.entries(RATE_WIRE_TO_COLUMN).map(([wire, column]) => [column, wire]),
) as Record<keyof ShipmentDebitRateOverrides, DebitRateOverrideField>;

export async function setShipmentDebitRateOverrides(input: {
  shipmentId: number;
  /** SIL-864 — the edit's own container row (FCL ≥2 conts); omitted/NULL
   *  = the lot baseline row (single-row + LCL lots, legacy callers). */
  containerId?: number | null;
  rates: DebitRateOverrideInput;
  userId: number;
  /** K2.23 (SIL-1084) — the grounds for a Cước-thu edit that differs from
   *  the engine/contract price; the FE dialog demands it before the write
   *  and this audit stores it verbatim (null when the save carried none). */
  reason?: string;
}): Promise<{ shipmentId: number; containerId: number | null; rates: DebitRateOverrideInput }> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ id: s.shipments.id })
      .from(s.shipments)
      .where(and(eq(s.shipments.id, input.shipmentId), isNull(s.shipments.deletedAt)))
      .for('update');
    if (!row) throw new ApiError(404, 'Không tìm thấy lô hàng');
    let containerId: number | null = null;
    if (input.containerId != null) {
      const [container] = await tx.select({ id: s.shipmentContainers.id })
        .from(s.shipmentContainers)
        .where(and(
          eq(s.shipmentContainers.id, input.containerId),
          eq(s.shipmentContainers.shipmentId, row.id),
        ))
        .limit(1);
      if (!container) throw new ApiError(404, 'Không tìm thấy container trên lô hàng này');
      containerId = container.id;
    }
    await assertShipmentCostUnlocked(tx, row.id);
    await assertShipmentAccountingUnlocked(tx, row.id);
    const [existing] = await tx.select()
      .from(s.shipmentDebitRateOverrides)
      .where(and(
        eq(s.shipmentDebitRateOverrides.shipmentId, row.id),
        containerId == null
          ? isNull(s.shipmentDebitRateOverrides.shipmentContainerId)
          : eq(s.shipmentDebitRateOverrides.shipmentContainerId, containerId),
      ))
      .for('update');
    const before: ShipmentDebitRateOverrides = {
      cuocThu: existing?.cuocThu ?? null,
      lachHuyenThu: existing?.lachHuyenThu ?? null,
      phuPs: existing?.phuPs ?? null,
      phatSinhCus: existing?.phatSinhCus ?? null,
      cuocTraDv: existing?.cuocTraDv ?? null,
      lachHuyenDv: existing?.lachHuyenDv ?? null,
      phatSinhDv: existing?.phatSinhDv ?? null,
      phiRu: existing?.phiRu ?? null,
    };
    const after: ShipmentDebitRateOverrides = { ...before };
    const changedFields: DebitRateOverrideField[] = [];
    for (const [wire, value] of Object.entries(input.rates) as Array<[DebitRateOverrideField, number | null | undefined]>) {
      if (value === undefined) continue;
      const column = RATE_WIRE_TO_COLUMN[wire];
      const next = value == null ? null : String(value);
      if (after[column] === next) continue;
      after[column] = next;
      changedFields.push(wire);
    }
    if (changedFields.length === 0) {
      // Saving what the server already holds is not an edit: no write, no
      // version bump, no audit noise (saveBillingPlate precedent).
      return { shipmentId: row.id, containerId, rates: toWireRates(after) };
    }
    await tx.insert(s.shipmentDebitRateOverrides)
      .values({ shipmentId: row.id, shipmentContainerId: containerId, ...after, updatedBy: input.userId })
      .onConflictDoUpdate({
        target: [s.shipmentDebitRateOverrides.shipmentId, s.shipmentDebitRateOverrides.shipmentContainerId],
        set: { ...after, updatedBy: input.userId, updatedAt: new Date() },
      });
    await tx.insert(s.auditLogs).values({
      userId: input.userId,
      entityType: 'shipment',
      entityId: row.id,
      message: 'DEBIT_RATE_OVERRIDE_SET',
      // K2.23 (SIL-1084) — the reason rides the audit payload beside the
      // before/after so the nhật ký answers "sao sửa" (giá cuối đàm phán
      // phải ghi lý do — KB §5.2.8).
      payload: { containerId, before, after, changedFields, reason: input.reason ?? null },
    });
    return { shipmentId: row.id, containerId, rates: toWireRates(after) };
  });
}

/** Stored columns → wire names (lachHuyenThu column rides wire `lachHuyen`). */
function toWireRates(overrides: ShipmentDebitRateOverrides): DebitRateOverrideInput {
  return Object.fromEntries(
    (Object.keys(RATE_COLUMN_TO_WIRE) as Array<keyof ShipmentDebitRateOverrides>)
      .map((column) => [RATE_COLUMN_TO_WIRE[column], overrides[column] == null ? null : Number(overrides[column])]),
  ) as DebitRateOverrideInput;
}

/**
 * SIL-773 — nút 'Lưu - Phê duyệt từng dòng và ẩn': các dòng kế toán chọn
 * được lưu/đối soát từng dòng rồi ẩn khỏi danh sách tác nghiệp. Ẩn là ghi
 * dấu (debit_hidden_at/by) — KHÔNG xoá dữ liệu, bật includeHidden vẫn tra
 * lại được lịch sử. Không chặn lô đã khóa: thao tác chỉ đổi CHỖ HIỆN của
 * dòng trên bảng, không đổi một con số nào.
 */
export async function reconcileAndHideDebitLots(input: {
  shipmentIds: number[];
  userId: number;
}): Promise<{ hidden: number[] }> {
  const updated = await db.update(s.shipments)
    .set({ debitHiddenAt: new Date(), debitHiddenBy: input.userId })
    .where(and(
      inArray(s.shipments.id, input.shipmentIds),
      isNull(s.shipments.deletedAt),
      isNull(s.shipments.debitHiddenAt),
    ))
    .returning({ id: s.shipments.id });
  return { hidden: updated.map((row) => row.id) };
}
