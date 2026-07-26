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
import { eq } from 'drizzle-orm';
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
