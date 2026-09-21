import { and, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import type { ExpenseActor } from './expense-accounting-write.service';
import { requireExpenseFinance } from './expense-accounting-write.service';
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
  rows: OpsReconciliationReportRow[];
  totals: { dntt: number; advanced: number; remaining: number };
}

/** Card 20260921_11 — the monthly reconciliation summary (báo cáo tổng hợp
 *  hoàn ứng tháng). Per staff: ĐNTT = confirmed ops costs in the period (the
 *  card-10 confirmed spine; unconfirmed rows never count), ĐÃ ỨNG = the
 *  advance the staff still holds (RECORDED advance requests minus what the
 *  existing reconciliations already consumed), CÒN PHẢI HOÀN ỨNG = ĐNTT −
 *  ĐÃ ỨNG with an explicit direction label (+ company pays the worker back,
 *  − company collects the advance — never a bare negative). Vouchers ride the
 *  existing engine; once its phiếu chi/thu posts, the fund book and this
 *  report converge (the card-10 invariant). */
export async function listMonthlyReconciliationReport(actor: ExpenseActor, query: { from?: string; to?: string }): Promise<OpsReconciliationReport> {
  requireExpenseFinance(actor);
  const today = new Date().toISOString().slice(0, 10);
  const from = query.from ?? `${today.slice(0, 7)}-01`;
  const to = query.to ?? today;
  expenseDateSchema.parse(from);
  expenseDateSchema.parse(to);
  if (from > to) throw new ApiError(400, 'Khoảng ngày không hợp lệ.');
  const costRows = await db.select({
    staffId: s.opsExpenseEntries.paidById,
    dntt: sql<number>`coalesce(sum(${s.opsExpenseEntries.amount}), 0)::int`,
  }).from(s.opsExpenseEntries)
    .innerJoin(s.expenseAccountingSources, and(
      eq(s.expenseAccountingSources.sourceKind, 'OPS'),
      eq(s.expenseAccountingSources.sourceId, s.opsExpenseEntries.id),
      isNotNull(s.expenseAccountingSources.confirmedAt),
    ))
    .where(and(
      eq(s.opsExpenseEntries.approvalStatus, 'RECORDED'),
      gte(s.opsExpenseEntries.paidAt, from),
      lte(s.opsExpenseEntries.paidAt, to),
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
  for (const row of heldRows) heldByStaff.set(String(row.staffId), Number(row.held));
  for (const row of consumedRows) {
    const key = String(row.staffId);
    heldByStaff.set(key, (heldByStaff.get(key) ?? 0) - Number(row.consumed));
  }
  const heldByStaffKeyed = new Map<string, number>();
  for (const [staffKey, held] of heldByStaff) heldByStaffKeyed.set(staffKey, held);
  const staffKeys = new Set<string>([
    ...[...costByStaff.keys()].map((id) => String(id)),
    ...[...heldByStaffKeyed.keys()],
  ]);
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
    const advanced = heldByStaffKeyed.get(key) ?? 0;
    const remaining = dntt - advanced;
    if (dntt === 0 && advanced === 0) continue;
    const direction: OpsReconciliationDirection = remaining > 0 ? 'CTY_THANH_TOAN_HOAN_UNG'
      : remaining < 0 ? 'CTY_YEU_CAU_HOAN_TRA' : 'KHONG_CON_GI';
    const note = remaining > 0 ? 'Công ty thanh toán hoàn ứng'
      : remaining < 0 ? 'Công ty yêu cầu nhân viên hoàn trả tạm ứng' : 'Không còn chênh lệch';
    rows.push({
      staffId,
      staffName: nameByStaff.get(staffId) ?? `NV #${staffId}`,
      dntt, advanced, remaining, direction, note,
    });
  }
  rows.sort((a, b) => a.staffName.localeCompare(b.staffName, 'vi'));
  return {
    from, to,
    rows,
    totals: {
      dntt: rows.reduce((sum, row) => sum + row.dntt, 0),
      advanced: rows.reduce((sum, row) => sum + row.advanced, 0),
      remaining: rows.reduce((sum, row) => sum + row.remaining, 0),
    },
  };
}
