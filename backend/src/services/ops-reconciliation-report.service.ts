import { and, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import type { ExpenseActor } from './expense-accounting-write.service';
import { requireExpenseFinance } from './expense-accounting-write.service';
import { getOutstandingAdvanceBalances } from './advance-shared.service';
import { ApiError } from '../errors';
import { expenseDateSchema } from '@tingting/shared';

export const OPS_RECONCILIATION_DIRECTIONS = ['CTY_THANH_TOAN_HOAN_UNG', 'CTY_YEU_CAU_HOAN_TRA', 'KHONG_CON_GI'] as const;
export type OpsReconciliationDirection = typeof OPS_RECONCILIATION_DIRECTIONS[number];

export interface OpsReconciliationReportRow {
  staffId: number;
  staffName: string;
  dntt: number;
  advanced: number;
  remaining: number;
  direction: OpsReconciliationDirection;
  note: string;
}
export interface OpsReconciliationReport {
  from: string; to: string;
  /** Card 20260928_169 — set when the caller scoped the report to one đợt. */
  reconciliation?: { id: number; code: string; from: string; to: string };
  rows: OpsReconciliationReportRow[];
  totals: { dntt: number; advanced: number; remaining: number };
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
    if (row) heldByStaff.set(String(batchStaffId), Number(row.allocated));
  } else {
    for (const row of heldRows) heldByStaff.set(String(row.staffId), Number(row.held));
    for (const row of consumedRows) {
      const key = String(row.staffId);
      heldByStaff.set(key, (heldByStaff.get(key) ?? 0) - Number(row.consumed));
    }
  }
  const staffKeys = new Set<string>([
    ...[...costByStaff.keys()].map((id) => String(id)),
    ...[...heldByStaff.keys()],
  ]);
  // Card 168 PM ruling (2026-09-29, board "RULING PM" câu 1): Còn phải hoàn
  // ứng is the Sổ quỹ closing formula — min(đã ứng, đã cấp) − đã tiêu — read
  // from the SAME canonical authority the fund book reads, so the two tables
  // are one definition and can never report different numbers. The per-request
  // floor at 0 keeps it non-negative; > 0 means the staff still holds granted,
  // unconsumed advance money. Scoped to a đợt the book number is still the
  // staff's own — the lot fixes the staff, never the number.
  const outstandingByStaff = new Map(
    (await getOutstandingAdvanceBalances(batchStaffId ?? undefined)).items
      .map((item) => [String(item.forwarderId), item.outstanding] as const),
  );
  for (const key of outstandingByStaff.keys()) staffKeys.add(key);
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
    const remaining = outstandingByStaff.get(key) ?? 0;
    if (dntt === 0 && advanced === 0 && remaining === 0) continue;
    const direction: OpsReconciliationDirection = remaining > 0 ? 'CTY_YEU_CAU_HOAN_TRA' : 'KHONG_CON_GI';
    const note = remaining > 0 ? 'Công ty yêu cầu nhân viên hoàn trả tạm ứng' : 'Không còn chênh lệch';
    rows.push({
      staffId,
      staffName: nameByStaff.get(staffId) ?? `NV #${staffId}`,
      dntt, advanced, remaining, direction, note,
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
      remaining: visibleRows.reduce((sum, row) => sum + row.remaining, 0),
    },
  };
}
