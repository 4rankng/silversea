/**
 * Wave 3 M4.7 (slice 1) — no-invoice disbursement enforcement.
 *
 * Complements the M4.6 invoice-required guard. When a trip_expense's
 * forwarderExpenseType has requiresInvoice=FALSE, this guard enforces
 * the M04-07 rules for the no-invoice branch:
 *
 *   1. substituteEvidenceAllowed must be TRUE on the FET — otherwise the
 *      category doesn't permit no-invoice expenses at all.
 *   2. The expense must carry a non-empty note (the substitute-evidence
 *      description / lý do + mô tả chứng cứ).
 *   3. Tiered approval by amount:
 *        ≤ DIRECTOR_THRESHOLD (5M)  → any FINANCIAL role can approve
 *        > DIRECTOR_THRESHOLD       → only MANAGER or ADMIN
 *
 * Default thresholds per Q13/Q14 (business-logic-qa-proposals.md):
 *   PER_ITEM_THRESHOLD = 1_000_000 (advisory; doesn't block on its own)
 *   DIRECTOR_THRESHOLD = 5_000_000 (ACCOUNTANT cannot approve above this)
 *   DAY_AGGREGATE_THRESHOLD = 10_000_000 (deferred — anti-splitting
 *     aggregation is a follow-up slice).
 *
 * Wired into transitionApproval next to assertInvoiceRequiredForExpense.
 * Only runs on APPROVED transitions; rejections bypass. Expenses on the
 * requiresInvoice=true path are handled by M4.6 and skip this guard.
 */
import { db } from '../db';
import * as s from '../db/schema';
import { and, desc, eq, gte, lte, or, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import { Role } from '@tingting/shared';

// Tiered-approval thresholds (VND). Per Q14:
//   Trưởng phòng Tài chính/Kế toán trưởng duyệt đến 5M/khoản.
//   Giám đốc duyệt >5M/khoản or >10M/day aggregated.
export const DIRECTOR_THRESHOLD = 5_000_000;
// Per-item advisory threshold (Q13). Doesn't block on its own in this
// slice — surfaced in the report (slice 2). The blocking rule is the
// DIRECTOR_THRESHOLD above.
export const PER_ITEM_THRESHOLD = 1_000_000;

/**
 * Enforcement entrypoint. Loads the trip_expense, resolves its FET, and
 * applies the M04-07 rules for the no-invoice branch. Throws ApiError
 * with a Vietnamese field-specific message when a rule is violated.
 *
 * Call BEFORE transitioning a trip_expense to APPROVED. Rejections bypass.
 *
 * `actorRole` is the role of the user attempting the approval — needed
 * for the tiered-amount check.
 */
export async function assertNoInvoiceDisbursementAllowed(
  expenseId: number,
  actorRole: string,
  tx?: Tx,
): Promise<void> {
  const q = tx ?? db;
  const [expense] = await q.select({
    id: s.tripExpenses.id,
    expenseType: s.tripExpenses.expenseType,
    invoiceNumber: s.tripExpenses.invoiceNumber,
    buyAmount: s.tripExpenses.buyAmount,
    note: s.tripExpenses.note,
  })
    .from(s.tripExpenses)
    .where(eq(s.tripExpenses.id, expenseId))
    .limit(1);

  // Missing expense → let the transition's own 404 fire.
  if (!expense) return;

  // This guard only applies to the NO-INVOICE branch. If the expense HAS
  // an invoice, M4.6 (assertInvoiceRequiredForExpense) owns the check.
  // Also, if the FET has requiresInvoice=true, M4.6 blocks when the
  // invoice is missing — we don't double-enforce here.
  const hasInvoice = !!(expense.invoiceNumber && expense.invoiceNumber.trim());
  if (hasInvoice) return;

  // Resolve the FET by code. Fail open when unknown (backward compat for
  // legacy codes — same policy as M4.6's checkTripExpenseInvoiceByCode).
  const [fet] = await q.select({
    requiresInvoice: s.forwarderExpenseTypes.requiresInvoice,
    substituteEvidenceAllowed: s.forwarderExpenseTypes.substituteEvidenceAllowed,
  })
    .from(s.forwarderExpenseTypes)
    .where(eq(s.forwarderExpenseTypes.code, expense.expenseType))
    .limit(1);

  if (!fet) return; // unknown code → fail open
  if (fet.requiresInvoice) return; // M4.6 owns the requiresInvoice=true path

  // Rule 1: category must permit no-invoice expenses.
  const substituteAllowed = fet.substituteEvidenceAllowed ?? true;
  if (!substituteAllowed) {
    throw new ApiError(
      400,
      `Chi phí #${expenseId}: hạng mục "${expense.expenseType}" không cho phép chi hộ không hóa đơn`,
    );
  }

  // Rule 2: substitute evidence required (non-empty note).
  if (!expense.note || !expense.note.trim()) {
    throw new ApiError(
      400,
      `Chi phí #${expenseId}: thiếu căn cứ thay thế — ghi chú lý do và mô tả chứng cứ là bắt buộc cho khoản không hóa đơn`,
    );
  }

  // Rule 3: tiered approval by amount.
  const amount = Number(expense.buyAmount);
  if (amount > DIRECTOR_THRESHOLD) {
    // Only MANAGER or ADMIN can approve above the director threshold.
    if (actorRole !== Role.ADMIN && actorRole !== Role.MANAGER) {
      throw new ApiError(
        403,
        `Chi phí #${expenseId}: số tiền ${amount.toLocaleString('vi-VN')} ₫ vượt ngưỡng trưởng phòng (${DIRECTOR_THRESHOLD.toLocaleString('vi-VN')} ₫) — cần giám đốc phê duyệt`,
      );
    }
  }
}

// ─── M4.7 slice 2: no-invoice disbursement report ────────────────────────────

export interface NoInvoiceDisbursementItem {
  expenseId: number;
  tripId: number;
  tripCode: string | null;
  expenseTypeCode: string;
  expenseTypeName: string;
  buyAmount: number;
  note: string | null;
  supplierId: number | null;
  supplierName: string | null;
  approverId: number | null;
  approverName: string | null;
  approvedAt: string | null;
  overThreshold: boolean;
  createdAt: string;
}

export interface NoInvoiceDisbursementReport {
  from: string;
  to: string;
  items: NoInvoiceDisbursementItem[];
  totals: {
    count: number;
    sumBuyAmount: number;
    overThresholdCount: number;
    overThresholdSum: number;
  };
}

/**
 * M04-07-01 report: "Báo cáo tách riêng khoản không có hóa đơn và vẫn
 * truy ngược được người duyệt".
 *
 * Lists APPROVED trip_expenses where invoiceNumber IS NULL or empty
 * (the no-invoice set), joined with:
 *   - forwarderExpenseTypes (type name)
 *   - trips (trip code)
 *   - suppliers (supplier name)
 *   - audit_logs (approver attribution — latest TRIP_EXPENSE_APPROVED
 *     entry for the expenseId)
 *
 * Filters: date range on the audit timestamp (approval moment),
   optional approverId, optional categoryCode.
 */
export async function getNoInvoiceDisbursementReport(opts: {
  from: string;
  to: string;
  approverId?: number;
  categoryCode?: string;
} = { from: '1970-01-01', to: '2999-12-31' }): Promise<NoInvoiceDisbursementReport> {
  // 1. Fetch APPROVED no-invoice expenses in the date range.
  //    "No-invoice" = invoiceNumber IS NULL or trim(invoiceNumber) = ''.
  //    Date axis: expense.createdAt (the audit timestamp join happens next).
  const expenseRows = await db.select({
    id: s.tripExpenses.id,
    tripId: s.tripExpenses.tripId,
    expenseType: s.tripExpenses.expenseType,
    buyAmount: s.tripExpenses.buyAmount,
    note: s.tripExpenses.note,
    supplierId: s.tripExpenses.supplierId,
    invoiceNumber: s.tripExpenses.invoiceNumber,
    createdAt: s.tripExpenses.createdAt,
  })
    .from(s.tripExpenses)
    .where(and(
      eq(s.tripExpenses.approvalStatus, 'APPROVED'),
      or(
        sql`${s.tripExpenses.invoiceNumber} IS NULL`,
        sql`btrim(${s.tripExpenses.invoiceNumber}) = ''`,
      ),
      gte(sql`DATE(${s.tripExpenses.createdAt})`, opts.from),
      lte(sql`DATE(${s.tripExpenses.createdAt})`, opts.to),
      opts.categoryCode ? eq(s.tripExpenses.expenseType, opts.categoryCode) : sql`TRUE`,
    ));

  if (expenseRows.length === 0) {
    return {
      from: opts.from, to: opts.to, items: [],
      totals: { count: 0, sumBuyAmount: 0, overThresholdCount: 0, overThresholdSum: 0 },
    };
  }

  const expenseIds = expenseRows.map(e => e.id);

  // 2. Resolve type names, trip codes, supplier names.
  const typeCodes = [...new Set(expenseRows.map(e => e.expenseType))];
  const [typeRows, tripRows, supplierRows] = await Promise.all([
    db.select({ code: s.forwarderExpenseTypes.code, name: s.forwarderExpenseTypes.name })
      .from(s.forwarderExpenseTypes)
      .where(inArrayFallback(s.forwarderExpenseTypes.code, typeCodes)),
    db.select({ id: s.trips.id, tripCode: s.trips.tripCode })
      .from(s.trips)
      .where(inArrayFallback(s.trips.id, expenseRows.map(e => e.tripId))),
    (async () => {
      const supplierIds = [...new Set(expenseRows.map(e => e.supplierId).filter((v): v is number => v != null))];
      if (supplierIds.length === 0) return [];
      return db.select({ id: s.suppliers.id, name: s.suppliers.name })
        .from(s.suppliers)
        .where(inArrayFallback(s.suppliers.id, supplierIds));
    })(),
  ]);

  // 3. Resolve approver attribution from audit_logs.
  //    entityType = 'trip-expenses', event_type = 'TRIP_EXPENSE_APPROVED'.
  //    Take the LATEST entry per entityId (re-approvals overwrite).
  const auditRows = await db.select({
    entityId: s.auditLogs.entityId,
    userId: s.auditLogs.userId,
    actorName: s.auditLogs.actorName,
    timestamp: s.auditLogs.timestamp,
  })
    .from(s.auditLogs)
    .where(and(
      eq(s.auditLogs.entityType, 'trip-expenses'),
      inArrayFallback(s.auditLogs.entityId, expenseIds),
      // Filter by message pattern since audit_logs has no event_type column;
      // the message for TRIP_EXPENSE_APPROVED starts with actor + "đã phê duyệt".
      sql`${s.auditLogs.message} LIKE '%đã phê duyệt%'`,
    ))
    .orderBy(desc(s.auditLogs.timestamp));

  // Build maps.
  const typeMap = new Map(typeRows.map(r => [r.code, r.name]));
  const tripMap = new Map(tripRows.map(r => [r.id, r.tripCode]));
  const supplierMap = new Map(supplierRows.map(r => [r.id, r.name]));
  // Latest audit entry per entityId wins.
  const auditMap = new Map<number, { userId: number | null; actorName: string | null; timestamp: Date }>();
  for (const a of auditRows) {
    if (a.entityId != null && !auditMap.has(a.entityId)) {
      auditMap.set(a.entityId, { userId: a.userId, actorName: a.actorName, timestamp: a.timestamp });
    }
  }

  // 4. Assemble items.
  const items: NoInvoiceDisbursementItem[] = [];
  for (const e of expenseRows) {
    const audit = auditMap.get(e.id);
    const approverId = audit?.userId ?? null;
    // Apply optional approverId filter.
    if (opts.approverId != null && approverId !== opts.approverId) continue;

    const buyAmount = Number(e.buyAmount);
    const overThreshold = buyAmount > DIRECTOR_THRESHOLD;
    items.push({
      expenseId: e.id,
      tripId: e.tripId,
      tripCode: tripMap.get(e.tripId) ?? null,
      expenseTypeCode: e.expenseType,
      expenseTypeName: typeMap.get(e.expenseType) ?? e.expenseType,
      buyAmount,
      note: e.note,
      supplierId: e.supplierId,
      supplierName: e.supplierId ? (supplierMap.get(e.supplierId) ?? null) : null,
      approverId,
      approverName: audit?.actorName ?? null,
      approvedAt: audit ? audit.timestamp.toISOString() : null,
      overThreshold,
      createdAt: e.createdAt.toISOString(),
    });
  }

  items.sort((a, b) => b.buyAmount - a.buyAmount);

  const totals = {
    count: items.length,
    sumBuyAmount: items.reduce((sum, i) => sum + i.buyAmount, 0),
    overThresholdCount: items.filter(i => i.overThreshold).length,
    overThresholdSum: items.filter(i => i.overThreshold).reduce((sum, i) => sum + i.buyAmount, 0),
  };

  return { from: opts.from, to: opts.to, items, totals };
}

/** Helper: inArray with a safe fallback for empty arrays (drizzle's inArray
 *  throws on empty arrays; we want a no-op filter instead). */
function inArrayFallback<T>(column: T, values: unknown[]) {
  if (values.length === 0) return sql`FALSE`;
  // Use sql.raw to build a safe IN list — values are already validated
  // numbers from our own queries, not user input.
  return sql`${column} IN (${sql.join(values.map(v => sql`${v}`), sql`, `)})`;
}
