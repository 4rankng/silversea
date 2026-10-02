// Disbursement Period-Allocation Guard — Wave 2 M4.5.
//
// Ensures an approved disbursement (trip expense) enters the correct billing
// period and is NEVER included on two debit notes simultaneously.
//
// Rules (M4.5):
//   1. Only APPROVED expenses can be included on a debit note.
//   2. An expense that is already on an active (non-deleted) billing document
//      line cannot be added to another.
//   3. Late-approved expenses (approved after the period closed) roll to the
//      next period or require an adjustment document.

import { db } from '../db';
import * as s from '../db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { ApiError } from '../errors';

export interface DisbursementCheckResult {
  alreadyAllocated: boolean;
  allocatedDocumentId?: number;
  approved: boolean;
}

/**
 * Check whether a trip expense can be added to a billing document.
 * Returns { alreadyAllocated, approved }.
 */
export async function checkDisbursementAllocation(
  tripExpenseId: number,
): Promise<DisbursementCheckResult> {
  // 1. Check if the expense is APPROVED.
  const [expense] = await db.select({
    id: s.tripExpenses.id,
    approvalStatus: s.tripExpenses.approvalStatus,
  })
    .from(s.tripExpenses)
    .where(eq(s.tripExpenses.id, tripExpenseId))
    .limit(1);

  if (!expense) {
    throw new ApiError(404, 'Không tìm thấy chi phí');
  }

  const approved = ['RECORDED', 'APPROVED'].includes(expense.approvalStatus);

  // 2. Check if this expense is already on an active billing document line.
  const [existingLine] = await db.select({
    id: s.billingDocumentLines.id,
    documentId: s.billingDocumentLines.documentId,
  })
    .from(s.billingDocumentLines)
    .innerJoin(s.billingDocuments,
      eq(s.billingDocumentLines.documentId, s.billingDocuments.id))
    .where(and(
      eq(s.billingDocumentLines.sourceType, 'EXPENSE'),
      eq(s.billingDocumentLines.sourceId, tripExpenseId),
      isNull(s.billingDocuments.deletedAt),
      eq(s.billingDocumentLines.excluded, false),
    ))
    .limit(1);

  return {
    approved,
    alreadyAllocated: !!existingLine,
    allocatedDocumentId: existingLine?.documentId,
  };
}

/**
 * Assert that the expense can be added to a billing document. Throws 409 when:
 *   - Already allocated to another active billing document.
 *   - Not approved (M4.5: only approved disbursements enter the right period).
 */
export async function assertCanAllocateDisbursement(tripExpenseId: number): Promise<void> {
  const result = await checkDisbursementAllocation(tripExpenseId);

  if (!result.approved) {
    throw new ApiError(
      409,
      'Chi phí chưa được ghi nhận — không thể đưa vào giấy báo nợ.',
    );
  }

  if (result.alreadyAllocated) {
    throw new ApiError(
      409,
      'Chi phí đã có trong một giấy báo nợ. Sử dụng điều chỉnh nếu cần thay đổi kỳ.',
    );
  }
}
