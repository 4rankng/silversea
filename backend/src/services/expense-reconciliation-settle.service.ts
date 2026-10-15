import { eq } from 'drizzle-orm';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';
import { ApiError } from '../errors';
import { requireExpenseFinance, type ExpenseActor } from './expense-accounting-write.service';
import { lockApplicationOwnedUniqueness } from './application-owned-uniqueness.service';
import { getExpenseReconciliation } from './expense-accounting-reads.service';

/**
 * Card 20261005 — ô chốt "đã hoàn ứng xong": một thao tác lưu của kế toán
 * (không auto-write sau render). Chỉ chốt khi số tiền còn phải hoàn đã về 0;
 * `settled: false` gỡ chốt để sửa nhầm. expense_reconciliations không có cột
 * version, nên expectedVersion là token trạng thái chốt (1 = chưa chốt,
 * 2 = đã chốt) — lệch thì 409, chặn double-click / hai tab cũ ghi đè nhau.
 */
export async function settleExpenseReconciliationRefund(tx: Tx, actor: ExpenseActor, id: number, input: { expectedVersion: number; settled: boolean }) {
  requireExpenseFinance(actor);
  await lockApplicationOwnedUniqueness(tx, 'expense-reconciliation', [id]);
  const [batch] = await tx.select().from(s.expenseReconciliations).where(eq(s.expenseReconciliations.id, id)).for('update');
  if (!batch) throw new ApiError(404, 'Không tìm thấy đợt hoàn ứng.');
  if (batch.voidedAt) throw new ApiError(409, 'Bảng hoàn ứng đã được hủy đối chiếu.');
  const current = await getExpenseReconciliation(actor, id, tx);
  const expectedState = batch.refundSettledAt ? 2 : 1;
  if (input.expectedVersion !== expectedState) {
    throw new ApiError(409, 'Trạng thái chốt hoàn ứng đã thay đổi. Tải lại trước khi tiếp tục.');
  }
  if (current.remainingDifference !== 0) {
    throw new ApiError(409, 'Chỉ chốt hoàn ứng khi số tiền còn phải hoàn đã bằng 0.');
  }
  const [after] = await tx.update(s.expenseReconciliations).set({
    refundSettledAt: input.settled ? new Date() : null,
    refundSettledBy: input.settled ? actor.userId : null,
  }).where(eq(s.expenseReconciliations.id, id)).returning();
  await tx.insert(s.auditLogs).values({
    userId: actor.userId,
    message: input.settled ? 'EXPENSE_RECONCILIATION_REFUND_SETTLED' : 'EXPENSE_RECONCILIATION_REFUND_SETTLE_CLEARED',
    entityType: 'expense_reconciliation', entityId: id,
    payload: { before: batch, after, remainingDifference: current.remainingDifference },
  });
  return after;
}
