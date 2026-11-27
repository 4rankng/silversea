import { and, eq, gte, inArray, isNotNull, lte, notInArray, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import type { ExpenseActor } from './expense-accounting-write.service';
import { requireExpenseFinance } from './expense-accounting-write.service';
import { getOutstandingAdvanceBalances, getSettlementEligibleStaffBalances, getSignedOutstandingAdvanceBalances } from './advance-shared.service';
import { ApiError } from '../errors';
import { expenseDateSchema } from '@tingting/shared';

export const OPS_RECONCILIATION_DIRECTIONS = ['CTY_THANH_TOAN_HOAN_UNG', 'CTY_YEU_CAU_HOAN_TRA', 'CTY_YEU_CAU_THU_TIEN_UNG', 'KHONG_CON_GI'] as const;
export type OpsReconciliationDirection = typeof OPS_RECONCILIATION_DIRECTIONS[number];

export interface OpsReconciliationReportRow {
  staffId: number;
  staffName: string;
  dntt: number;
  advanced: number;
  /** SIL-806 — ĐÃ ỨNG cho bảng Quỹ cá nhân: TỔNG phiếu tạm ứng đã giải ngân
   *  (RECORDED) trong kỳ, không trừ gì cả. Scoped to a đợt, the lot's own
   *  allocations. Khác `advanced` (tiền CÒN NẮM sau netting) — cột ĐÃ ỨNG của
   *  bảng đối soát chi phí đọc số GỘC theo UAT 12/11. */
  advancedRecorded: number;
  /** SỔ QUỸ (held money, ≥ 0): the number the Sổ quỹ 'Tạm ứng OPS còn tồn'
   *  and /advance-balances read — it nets the settled-through-phiếu amount,
   *  so `remaining == max(0, remainingSigned)` by construction. */
  remaining: number;
  /** 'Còn phải hoàn ứng' — the SIGNED settlement balance (tổng đã ứng − tổng
   *  ĐNTT đã xác nhận − tổng đã nộp lại − tổng đã tất toán qua phiếu): (+) cá
   *  nhân hoàn lại, (−) công ty trả thêm. One number for every surface that
   *  opens it — cột 'Còn phải hoàn ứng' của Báo cáo hoàn ứng, cột 'Số dư quỹ'
   *  của bảng Quỹ cá nhân, cửa sổ lập phiếu hoàn ứng và /advance-balances
   *  (?includeAll=true). Scoped đợt = ĐÃ ỨNG phân bổ − ĐNTT đợt. */
  remainingSigned: number;
  /** Số dư tạm ứng CÓ DẤU (card 141026230770) — the BOOKKEEPING authority:
   *  min(đã cấp, đã giải ngân) − đã tiêu − đã trả, không kẹp về 0. Âm = nhân
   *  viên nắm/đã tiêu vượt số được cấp. Khác `remainingSigned` (số dư tất
   *  toán thật); dùng cho nút thu hồi, không dùng cho cột hiển thị. */
  outstandingSigned: number;
  /** Báo cáo DƯƠNG và sổ quỹ còn số cần thu — đề nghị nhân viên hoàn lại
   *  tiền ứng. Âm (công ty trả thêm) không bao giờ bật cờ này. */
  needsCollection: boolean;
  direction: OpsReconciliationDirection;
  note: string;
}
export interface OpsReconciliationReport {
  from: string; to: string;
  /** Card 20260928_169 — set when the caller scoped the report to one đợt. */
  reconciliation?: { id: number; code: string; from: string; to: string };
  rows: OpsReconciliationReportRow[];
  // SIL-839 — `advancedRecorded` rides the totals so the Báo cáo hoàn ứng rail
  // reads the SAME gross disbursement query the Quỹ cá nhân table reads
  // (recordedByStaff) — the two surfaces cannot fork on ĐÃ ỨNG.
  totals: { dntt: number; advanced: number; advancedRecorded: number; remaining: number; remainingSigned: number };
}

/** Card 20260921_11 — the monthly reconciliation summary (báo cáo tổng hợp
 *  hoàn ứng tháng). Per staff: ĐNTT = confirmed ops costs in the period (the
 *  card-10 confirmed spine; unconfirmed rows never count), ĐÃ ỨNG = the
 *  advance the staff still holds (RECORDED advance requests minus what the
 *  existing reconciliations already consumed), CÒN PHẢI HOÀN ỨNG = the SỔ QUỸ
 *  closing formula — min(đã ứng, đã cấp) − đã tiêu — per the 2026-09-29 PM
 *  ruling (card 168 board block "RULING PM", câu 1), which supersedes this
 *  report's own ĐNTT − ĐÃ ỨNG: the number is the money actually granted and
 *  still unconsumed, so the OPS-account row in Sổ quỹ and this report are the
 *  same definition and cannot diverge. ĐNTT and ĐÃ ỨNG stay as displayed
 *  columns; the phiếu direction still comes from the đợt's own difference
 *  (the reconciliation engine's number), which the row action reads. */
export async function listMonthlyReconciliationReport(actor: ExpenseActor, query: { from?: string; to?: string; reconciliationId?: number; opsUserId?: number }): Promise<OpsReconciliationReport> {
  requireExpenseFinance(actor);
  const today = new Date().toISOString().slice(0, 10);
  const from = query.from ?? `${today.slice(0, 7)}-01`;
  const to = query.to ?? today;
  expenseDateSchema.parse(from);
  expenseDateSchema.parse(to);
  if (from > to) throw new ApiError(400, 'Khoảng ngày không hợp lệ.');

  // Card 20260928_169 — the "đợt làm đề nghị" filter.
  //
  // A "đợt" is an `expense_reconciliations` lot. The PRD (OpsVanHanh §9.2)
  // defines it by semantics — a batch that OWNS a set of costs, ALLOCATES
  // received advances to them, and never lets one item land in two batches.
  // The lot owns exactly the cost rows it stamped
  // (`expense_accounting_sources.reconciliation_id`, set by
  // createExpenseReconciliation) and allocates advances through
  // `expense_reconciliation_advances`.
  //
  // When a đợt is selected it DEFINES the report: its own window and its own
  // single staff member. An explicit from/to that disagrees with the lot would
  // produce a number the lot does not own, so the lot wins and the caller is
  // told which window was used.
  let batchStaffId: number | null = null;
  let batchInfo: OpsReconciliationReport['reconciliation'];
  if (query.reconciliationId !== undefined) {
    const [lot] = await db.select({
      id: s.expenseReconciliations.id,
      code: s.expenseReconciliations.code,
      opsUserId: s.expenseReconciliations.opsUserId,
      from: s.expenseReconciliations.from,
      to: s.expenseReconciliations.to,
      voidedAt: s.expenseReconciliations.voidedAt,
    }).from(s.expenseReconciliations)
      .where(eq(s.expenseReconciliations.id, query.reconciliationId));
    if (!lot) throw new ApiError(404, 'Không tìm thấy đợt đối soát.');
    if (lot.voidedAt) throw new ApiError(400, 'Đợt đối soát đã bị hủy, không dùng để báo cáo.');
    if (query.opsUserId !== undefined && query.opsUserId !== lot.opsUserId) {
      throw new ApiError(400, 'Đợt đối soát thuộc nhân viên khác với bộ lọc nhân viên.');
    }
    batchStaffId = lot.opsUserId;
    batchInfo = {
      id: lot.id,
      code: lot.code,
      from: String(lot.from).slice(0, 10),
      to: String(lot.to).slice(0, 10),
    };
  }
  const costFrom = batchInfo ? batchInfo.from : from;
  const costTo = batchInfo ? batchInfo.to : to;
  // Card 20260928_197 — ĐNTT is a SQL aggregate, so it takes the query-level
  // equivalent of `sumExcludingNegative`: `filter (where amount >= 0)`. Same
  // rule as the in-memory helper (strictly negative rows dropped, 0 kept), and
  // the sum stays integer `::int` — no float touches the money.
  // Card 20260928_169 — scoped to one đợt, ĐNTT counts exactly the costs the
  // lot OWNS (the sources it stamped), never a window approximation: PRD §9.2
  // "một khoản chi không được tính toàn bộ vào nhiều đợt", so another
  // confirmed cost of the same staff inside the same window must not leak in.
  const sourceJoin = [
    eq(s.expenseAccountingSources.sourceKind, 'OPS'),
    eq(s.expenseAccountingSources.sourceId, s.opsExpenseEntries.id),
    isNotNull(s.expenseAccountingSources.confirmedAt),
  ];
  if (batchInfo) sourceJoin.push(eq(s.expenseAccountingSources.reconciliationId, batchInfo.id));
  const costRows = await db.select({
    staffId: s.opsExpenseEntries.paidById,
    dntt: sql<number>`coalesce(sum(${s.opsExpenseEntries.amount}) filter (where ${s.opsExpenseEntries.amount} >= 0), 0)::int`,
  }).from(s.opsExpenseEntries)
    .innerJoin(s.expenseAccountingSources, and(...sourceJoin))
    .where(and(
      eq(s.opsExpenseEntries.approvalStatus, 'RECORDED'),
      // Card 20261005 — a shipment-level accountant expense has no payer
      // (paidById NULL); it belongs to no employee, so it must not aggregate
      // into a per-staff report row ('NV #NaN').
      isNotNull(s.opsExpenseEntries.paidById),
      // Unscoped, the report is the monthly per-staff view: costs are owned by
      // the period window. Scoped, the lot's own rows are the period — its
      // window only rides along on the response for display.
      batchInfo ? undefined : gte(s.opsExpenseEntries.paidAt, costFrom),
      batchInfo ? undefined : lte(s.opsExpenseEntries.paidAt, costTo),
    ))
    .groupBy(s.opsExpenseEntries.paidById);
  const costByStaff = new Map(costRows.map((row) => [row.staffId, Number(row.dntt)] as const));
  const heldRows = await db.select({
    staffId: s.advanceRequests.requesterId,
    held: sql<number>`coalesce(sum(${s.advanceRequests.amount}), 0)::int`,
  }).from(s.advanceRequests)
    .where(eq(s.advanceRequests.status, 'RECORDED'))
    .groupBy(s.advanceRequests.requesterId);
  // SIL-806 (UAT 12/11) — cột ĐÃ ỨNG của bảng Quỹ cá nhân đọc số GỐC: tổng
  // phiếu tạm ứng ĐÃ GIẢI NGÂN (RECORDED) trong kỳ, không net settlement/đợt
  // và không kẹp 0 (Nguyễn Huy Hoàng 5 phiếu 520.000₫ phải hiện 520.000₫ chứ
  // không 0₫ sau netting). Ngày trong kỳ = ngày giải ngân (approvedAt) — phiếu
  // ghi thẳng RECORDED không qua duyệt dùng createdAt. Chỉ tính trên nhánh
  // unscoped: báo cáo đợt phân bổ qua expense_reconciliation_advances và đọc
  // `allocated` bên dưới.
  const recordedRows = await db.select({
    staffId: s.advanceRequests.requesterId,
    recorded: sql<number>`coalesce(sum(${s.advanceRequests.amount}), 0)::int`,
  }).from(s.advanceRequests)
    .where(and(
      eq(s.advanceRequests.status, 'RECORDED'),
      sql`coalesce(${s.advanceRequests.approvedAt}, ${s.advanceRequests.createdAt})::date >= ${costFrom}::date`,
      sql`coalesce(${s.advanceRequests.approvedAt}, ${s.advanceRequests.createdAt})::date <= ${costTo}::date`,
    ))
    .groupBy(s.advanceRequests.requesterId);
  const recordedByStaff: Record<string, number> = Object.fromEntries(recordedRows.map((row) => [String(row.staffId), Number(row.recorded)] as const));
  // SIL-728 (QA fail 09/11, staging c4cea6b6) — the legacy settlement phiếu
  // (advance_settlements — the /advances "Phiếu hoàn ứng" family) consumes the
  // staff's advance REQUESTS outside the đợt system, but ĐÃ ỨNG netted only
  // đợt allocations: a fully-settled staff kept a ghost âm "Còn phải hoàn ứng"
  // forever (Vũ Đình Cường −4.300.000₫ with the wallet authority already at 0).
  // Net the SAME consumption the signed-wallet authority reads so the report
  // converges once the phiếu posts (card 20260928_168: "sau khi phiếu post,
  // sổ quỹ và báo cáo hội tụ về một số").
  const legacySettledRows = await db.select({
    staffId: s.advanceRequests.requesterId,
    settled: sql<number>`coalesce(sum(${s.advanceSettlementRequests.allocatedAmount}), 0)::int`,
  }).from(s.advanceSettlementRequests)
    .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.advanceSettlementRequests.settlementId))
    .innerJoin(s.advanceRequests, eq(s.advanceRequests.id, s.advanceSettlementRequests.advanceRequestId))
    .where(notInArray(s.advanceSettlements.status, ['VOIDED', 'REVERSED']))
    .groupBy(s.advanceRequests.requesterId);
  const consumedRows = await db.select({
    staffId: s.expenseReconciliations.opsUserId,
    consumed: sql<number>`coalesce(sum(${s.expenseReconciliationAdvances.amount}), 0)::int`,
  }).from(s.expenseReconciliationAdvances)
    .innerJoin(s.expenseReconciliations, eq(s.expenseReconciliations.id, s.expenseReconciliationAdvances.reconciliationId))
    .where(sql`${s.expenseReconciliations.voidedAt} is null`)
    .groupBy(s.expenseReconciliations.opsUserId);
  const heldByStaff = new Map<string, number>();
  if (batchInfo) {
    // Scoped to one đợt: "ĐÃ ỨNG" is what the lot ALLOCATED, not what the staff
    // happens to still hold. PRD §9.2 — "tiền ứng thực nhận được phân bổ";
    // using the staff's whole held balance here would charge advances to a
    // batch that never received them.
    const [row] = await db.select({
      allocated: sql<number>`coalesce(sum(${s.expenseReconciliationAdvances.amount}), 0)::int`,
    }).from(s.expenseReconciliationAdvances)
      .where(eq(s.expenseReconciliationAdvances.reconciliationId, batchInfo.id));
    if (row) {
      heldByStaff.set(String(batchStaffId), Number(row.allocated));
      recordedByStaff[String(batchStaffId)] = Number(row.allocated);
    }
  } else {
    for (const row of heldRows) heldByStaff.set(String(row.staffId), Number(row.held));
    for (const row of legacySettledRows) {
      const key = String(row.staffId);
      heldByStaff.set(key, Math.max(0, (heldByStaff.get(key) ?? 0) - Number(row.settled)));
    }
    for (const row of consumedRows) {
      const key = String(row.staffId);
      heldByStaff.set(key, (heldByStaff.get(key) ?? 0) - Number(row.consumed));
    }
    // ĐÃ ỨNG is money the staff actually holds for the period — a phiếu chain
    // that over-consumed the net grant never makes it negative.
    for (const [key, held] of heldByStaff) {
      if (held < 0) heldByStaff.set(key, 0);
    }
  }
  const staffKeys = new Set<string>([
    ...[...costByStaff.keys()].map((id) => String(id)),
    ...[...heldByStaff.keys()],
    // SIL-806 — a staff whose only footprint in the kỳ is a RECORDED advance
    // phiếu (held netted to 0, no confirmed cost yet) still belongs in the
    // Quỹ cá nhân table with their gross ĐÃ ỨNG.
    ...Object.keys(recordedByStaff),
  ]);
  // SIL-911 — Còn phải hoàn ứng (`remaining`) is the ONE canonical held money
  // (KB closing law §2.4.6/§5.4.5/§6.4: ĐÃ ỨNG − ĐNTT đã xác nhận − đã nộp
  // lại, floored ≥ 0) read from the SAME authority the fund book, treasury
  // and /advance-balances read, so every surface is one definition and can
  // never report different numbers. Scoped to a đợt the book number is still
  // the staff's own — the lot fixes the staff, never the number.
  // Card 141026230770 — the report ALSO carries the signed view
  // (outstandingSigned): the per-request bookkeeping aggregation
  // (min(granted, funded) − allocations) without the ≥ 0 clamp, so a staff
  // who consumed/returned more than was granted shows the deficit instead of
  // a misleading 0. `remaining` stays the floored held number (Sổ quỹ parity).
  const [outstandingByStaff, signedOutstandingByStaff, canonicalSignedByStaff] = await Promise.all([
    getOutstandingAdvanceBalances(batchStaffId ?? undefined),
    getSignedOutstandingAdvanceBalances(batchStaffId ?? undefined),
    getSettlementEligibleStaffBalances(batchStaffId ?? undefined),
  ]);
  const outstandingMap = new Map(outstandingByStaff.items.map((item) => [String(item.forwarderId), item.outstanding] as const));
  const outstandingSignedMap = new Map(signedOutstandingByStaff.items.map((item) => [String(item.forwarderId), item.outstanding] as const));
  const canonicalSignedMap = new Map(canonicalSignedByStaff.items.map((item) => [String(item.forwarderId), item.outstanding] as const));
  for (const key of outstandingMap.keys()) staffKeys.add(key);
  for (const key of outstandingSignedMap.keys()) staffKeys.add(key);
  for (const key of canonicalSignedMap.keys()) staffKeys.add(key);
  const staffIdNumbers = [...staffKeys].map((key) => Number(key)).filter((id) => Number.isInteger(id) && id > 0);
  const staffRows = staffIdNumbers.length
    ? await db.select({ id: s.users.id, fullName: s.users.fullName, username: s.users.username })
        .from(s.users).where(inArray(s.users.id, staffIdNumbers))
    : [];
  const nameByStaff = new Map(staffRows.map((row) => [row.id, row.fullName || row.username] as const));
  const rows: OpsReconciliationReportRow[] = [];
  for (const key of staffKeys) {
    const staffId = Number(key);
    const dntt = costByStaff.get(staffId) ?? 0;
    const advanced = heldByStaff.get(key) ?? 0;
    const remaining = outstandingMap.get(key) ?? 0;
    const outstandingSigned = outstandingSignedMap.get(key) ?? 0;
    const advancedRecorded = recordedByStaff[String(staffId)] ?? 0;
    // HOT-05 (CR-011.2): compute remainingSigned BEFORE the empty-row guard so
    // staff carrying a non-zero prior-period deficit/surplus in
    // canonicalSignedMap (e.g. Lưu Danh Hùng -777.000đ with 0 monthly dntt/
    // advances) are included on Báo cáo hoàn ứng and totals match KPI TỒN TẠM ỨNG.
    const remainingSigned = batchInfo ? advanced - dntt : (canonicalSignedMap.get(key) ?? 0);
    if (dntt === 0 && advanced === 0 && remaining === 0 && outstandingSigned === 0 && advancedRecorded === 0 && remainingSigned === 0) continue;
    // 'Đề nghị thu tiền ứng' theo đúng DẤU của cột: DƯƠNG = cá nhân còn
    // nắm tiền phải hoàn trả về công ty. Âm (công ty trả thêm) không bao
    // giờ là 'thu tiền ứng'.
    const needsCollection = remainingSigned > 0;
    const direction: OpsReconciliationDirection = needsCollection ? 'CTY_YEU_CAU_THU_TIEN_UNG' : remainingSigned < 0 ? 'CTY_THANH_TOAN_HOAN_UNG' : 'KHONG_CON_GI';
    const note = direction === 'CTY_YEU_CAU_THU_TIEN_UNG' ? 'Đề nghị thu tiền ứng'
      : direction === 'CTY_THANH_TOAN_HOAN_UNG' ? 'Công ty trả thêm phần chi vượt ứng' : 'Không còn chênh lệch';
    rows.push({
      staffId,
      staffName: nameByStaff.get(staffId) ?? `NV #${staffId}`,
      dntt, advanced, advancedRecorded, remaining, remainingSigned, outstandingSigned, needsCollection, direction, note,
    });
  }
  // Card 20260928_169 — the employee axis: unscoped, a single staff filter
  // narrows the monthly view to that person (scoped mode already validated the
  // filter against the lot above). Totals derive from the visible rows.
  const visibleRows = query.opsUserId === undefined ? rows : rows.filter((row) => row.staffId === query.opsUserId);
  visibleRows.sort((a, b) => a.staffName.localeCompare(b.staffName, 'vi'));
  return {
    from: costFrom, to: costTo,
    ...(batchInfo ? { reconciliation: batchInfo } : {}),
    rows: visibleRows,
    totals: {
      dntt: visibleRows.reduce((sum, row) => sum + row.dntt, 0),
      advanced: visibleRows.reduce((sum, row) => sum + row.advanced, 0),
      // SIL-839 — the rail's 'Tổng số tiền đã ứng' totals the same GỐC
      // (Đã ghi nhận) number the Quỹ cá nhân reads: khớp 100% giữa 2 màn.
      advancedRecorded: visibleRows.reduce((sum, row) => sum + row.advancedRecorded, 0),
      remaining: visibleRows.reduce((sum, row) => sum + row.remaining, 0),
      remainingSigned: visibleRows.reduce((sum, row) => sum + row.remainingSigned, 0),
    },
  };
}

// ─── SIL-1056 QA bounce 26/11 #3 — KB K2.117 drill-down ──────────────────────
//
// "Mỗi số tổng mở ra được danh sách giao dịch": the 'Còn phải hoàn ứng' cell
// must open the transaction list that composes it. The cell is
// `remainingSigned`, so the drill-down decomposes THE SAME law the cell reads:
//
//   unscoped  CANONICAL      Đã ứng (RECORDED phiếu) − ĐNTT (chi đã xác nhận)
//                          − đã nộp lại (phiếu THU IN) − đã tất toán qua phiếu
//                          (advanceSettlements.refundAmount, đúng dấu) — the
//                          settlement authority's own number, read from
//                          {@link getSettlementEligibleStaffBalances} so the
//                          footer cannot drift from the cell.
//   scoped    LOT_ALLOCATION ĐÃ ỨNG phân bổ (expense_reconciliation_advances)
//                          − ĐNTT đợt (costs the lot owns) — the batch branch
//                          of {@link listMonthlyReconciliationReport}.
//
// No window here on purpose: the canonical balance is whole-book (the report
// window only shapes the ĐNTT / ĐÃ ỨNG columns), so filtering the groups by
// from/to would make Σ groups ≠ the clicked cell.

export interface OpsReconciliationDrillItem {
  id: number;
  /** Voucher / phiếu code when the row has one (PT-…, HU-THU-…). */
  code: string | null;
  label: string;
  date: string | null;
  /** Signed per the group's law — `settled` carries refundAmount đúng dấu
   *  (chi bù âm), every other group is a positive contribution. */
  amount: number;
}

export interface OpsReconciliationDrillGroup {
  label: string;
  items: OpsReconciliationDrillItem[];
  total: number;
}

export interface OpsReconciliationDrillDown {
  staffId: number;
  staffName: string;
  reconciliation?: { id: number; code: string; from: string; to: string };
  law: 'CANONICAL' | 'LOT_ALLOCATION';
  groups: {
    recorded: OpsReconciliationDrillGroup;
    dntt: OpsReconciliationDrillGroup;
    returned: OpsReconciliationDrillGroup;
    settled: OpsReconciliationDrillGroup;
  };
  /** The ONE number the clicked cell shows — Σ groups must equal it. */
  signedBalance: number;
}

function drillGroup(label: string, items: OpsReconciliationDrillItem[]): OpsReconciliationDrillGroup {
  return { label, items, total: items.reduce((sum, item) => sum + item.amount, 0) };
}

export async function getReconciliationReportDrillDown(
  actor: ExpenseActor,
  query: { opsUserId: number; reconciliationId?: number },
): Promise<OpsReconciliationDrillDown> {
  requireExpenseFinance(actor);
  const staffId = query.opsUserId;
  const [staff] = await db.select({ id: s.users.id, fullName: s.users.fullName, username: s.users.username })
    .from(s.users).where(eq(s.users.id, staffId));
  if (!staff) throw new ApiError(404, 'Không tìm thấy nhân viên.');

  if (query.reconciliationId !== undefined) {
    const [lot] = await db.select({
      id: s.expenseReconciliations.id,
      code: s.expenseReconciliations.code,
      opsUserId: s.expenseReconciliations.opsUserId,
      from: s.expenseReconciliations.from,
      to: s.expenseReconciliations.to,
      voidedAt: s.expenseReconciliations.voidedAt,
    }).from(s.expenseReconciliations).where(eq(s.expenseReconciliations.id, query.reconciliationId));
    if (!lot) throw new ApiError(404, 'Không tìm thấy đợt đối soát.');
    if (lot.voidedAt) throw new ApiError(400, 'Đợt đối soát đã bị hủy, không dùng để báo cáo.');
    if (lot.opsUserId !== staffId) throw new ApiError(400, 'Đợt đối soát thuộc nhân viên khác.');

    const allocationRows = await db.select({
      id: s.expenseReconciliationAdvances.id,
      amount: s.expenseReconciliationAdvances.amount,
      reason: s.advanceRequests.reason,
      approvedAt: s.advanceRequests.approvedAt,
      createdAt: s.advanceRequests.createdAt,
    }).from(s.expenseReconciliationAdvances)
      .innerJoin(s.advanceRequests, eq(s.advanceRequests.id, s.expenseReconciliationAdvances.advanceRequestId))
      .where(eq(s.expenseReconciliationAdvances.reconciliationId, lot.id));
    const costRows = await db.select({
      id: s.opsExpenseEntries.id,
      amount: s.opsExpenseEntries.amount,
      feeName: s.opsExpenseEntries.feeName,
      expenseTypeCode: s.opsExpenseEntries.expenseTypeCode,
      paidAt: s.opsExpenseEntries.paidAt,
    }).from(s.opsExpenseEntries)
      .innerJoin(s.expenseAccountingSources, and(
        eq(s.expenseAccountingSources.sourceKind, 'OPS'),
        eq(s.expenseAccountingSources.sourceId, s.opsExpenseEntries.id),
        isNotNull(s.expenseAccountingSources.confirmedAt),
        eq(s.expenseAccountingSources.reconciliationId, lot.id),
      ))
      .where(and(
        eq(s.opsExpenseEntries.approvalStatus, 'RECORDED'),
        sql`${s.opsExpenseEntries.amount} >= 0`,
      ));
    const allocated = allocationRows
      .map((row) => ({
        id: row.id, code: null,
        label: row.reason ?? 'Tạm ứng phân bổ vào đợt',
        date: row.approvedAt ? String(row.approvedAt).slice(0, 10) : String(row.createdAt).slice(0, 10),
        amount: Number(row.amount),
      }));
    const dntt = costRows.map((row) => ({
      id: row.id, code: null,
      label: row.feeName ?? row.expenseTypeCode ?? 'Khoản chi ĐNTT',
      date: String(row.paidAt).slice(0, 10),
      amount: Number(row.amount),
    }));
    const empty = drillGroup('', []);
    return {
      staffId,
      staffName: staff.fullName || staff.username || `NV #${staff.id}`,
      reconciliation: { id: lot.id, code: lot.code, from: String(lot.from).slice(0, 10), to: String(lot.to).slice(0, 10) },
      law: 'LOT_ALLOCATION',
      groups: {
        recorded: drillGroup('Tạm ứng phân bổ vào đợt', allocated),
        dntt: drillGroup('ĐNTT đợt (chi đã xác nhận)', dntt),
        returned: empty,
        settled: empty,
      },
      // The batch branch's own law (listMonthlyReconciliationReport: advanced
      // − dntt) — the same number the scoped cell renders.
      signedBalance: allocated.reduce((sum, item) => sum + item.amount, 0)
        - dntt.reduce((sum, item) => sum + item.amount, 0),
    };
  }

  // Unscoped — whole-book canonical. The authority supplies the footer number;
  // the groups list the exact rows its four sums count.
  const [canonical, recordedRows, dnttRows, returnedRows, settledRows] = await Promise.all([
    getSettlementEligibleStaffBalances(staffId),
    db.select({
      id: s.advanceRequests.id,
      amount: s.advanceRequests.amount,
      reason: s.advanceRequests.reason,
      approvedAt: s.advanceRequests.approvedAt,
      createdAt: s.advanceRequests.createdAt,
    }).from(s.advanceRequests)
      .where(and(eq(s.advanceRequests.status, 'RECORDED'), eq(s.advanceRequests.requesterId, staffId))),
    db.select({
      id: s.opsExpenseEntries.id,
      amount: s.opsExpenseEntries.amount,
      feeName: s.opsExpenseEntries.feeName,
      expenseTypeCode: s.opsExpenseEntries.expenseTypeCode,
      paidAt: s.opsExpenseEntries.paidAt,
    }).from(s.opsExpenseEntries)
      .innerJoin(s.expenseAccountingSources, and(
        eq(s.expenseAccountingSources.sourceKind, 'OPS'),
        eq(s.expenseAccountingSources.sourceId, s.opsExpenseEntries.id),
        isNotNull(s.expenseAccountingSources.confirmedAt),
      ))
      .where(and(
        eq(s.opsExpenseEntries.approvalStatus, 'RECORDED'),
        eq(s.opsExpenseEntries.paidById, staffId),
        sql`${s.opsExpenseEntries.amount} >= 0`,
      )),
    db.select({
      id: s.expenseCashVouchers.id,
      code: s.expenseCashVouchers.code,
      amount: s.treasuryMovements.amount,
      valueDate: s.treasuryMovements.valueDate,
    }).from(s.expenseCashVouchers)
      .innerJoin(s.treasuryMovements, eq(s.treasuryMovements.id, s.expenseCashVouchers.treasuryMovementId))
      .where(and(
        eq(s.expenseCashVouchers.counterpartyType, 'FORWARDER'),
        eq(s.expenseCashVouchers.counterpartyId, staffId),
        eq(s.expenseCashVouchers.status, 'RECORDED'),
        eq(s.treasuryMovements.direction, 'IN'),
      )),
    db.select({
      id: s.advanceSettlements.id,
      code: s.advanceSettlements.code,
      refundAmount: s.advanceSettlements.refundAmount,
      approvedAt: s.advanceSettlements.approvedAt,
      createdAt: s.advanceSettlements.createdAt,
    }).from(s.advanceSettlements)
      .where(and(eq(s.advanceSettlements.status, 'RECORDED'), eq(s.advanceSettlements.forwarderId, staffId))),
  ]);
  const recorded = recordedRows.map((row) => ({
    id: row.id, code: null,
    label: row.reason ?? 'Phiếu tạm ứng đã giải ngân',
    date: row.approvedAt ? String(row.approvedAt).slice(0, 10) : String(row.createdAt).slice(0, 10),
    amount: Number(row.amount),
  }));
  const dntt = dnttRows.map((row) => ({
    id: row.id, code: null,
    label: row.feeName ?? row.expenseTypeCode ?? 'Khoản chi ĐNTT',
    date: String(row.paidAt).slice(0, 10),
    amount: Number(row.amount),
  }));
  const returned = returnedRows.map((row) => ({
    id: row.id, code: row.code,
    label: 'Phiếu thu hoàn ứng',
    date: row.valueDate ? String(row.valueDate).slice(0, 10) : null,
    amount: Number(row.amount),
  }));
  const settled = settledRows.map((row) => ({
    id: row.id, code: row.code,
    label: 'Phiếu hoàn ứng',
    date: row.approvedAt ? String(row.approvedAt).slice(0, 10) : String(row.createdAt).slice(0, 10),
    amount: Number(row.refundAmount),
  }));
  return {
    staffId,
    staffName: staff.fullName || staff.username || `NV #${staff.id}`,
    law: 'CANONICAL',
    groups: {
      recorded: drillGroup('Tổng đã ứng (phiếu tạm ứng đã giải ngân)', recorded),
      dntt: drillGroup('Tổng ĐNTT (chi đã xác nhận)', dntt),
      returned: drillGroup('Đã nộp lại (phiếu thu hoàn ứng)', returned),
      settled: drillGroup('Đã tất toán qua phiếu hoàn ứng', settled),
    },
    signedBalance: canonical.items.find((row) => row.forwarderId === staffId)?.outstanding ?? 0,
  };
}
