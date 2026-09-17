import { and, eq, inArray, or } from 'drizzle-orm';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';
import { ApiError } from '../errors';
import { requireExpenseFinance, type ExpenseActor } from './expense-accounting-write.service';
import { lockApplicationOwnedUniqueness } from './application-owned-uniqueness.service';

/** Releasing a noncash reconciliation returns its claims, never its cash.
 * All source/advance snapshots remain in history for reconstruction. */
export async function releaseExpenseReconciliation(tx: Tx, actor: ExpenseActor, id: number, reason: string) {
  requireExpenseFinance(actor);
  if (!reason.trim()) throw new ApiError(400, 'Nhập lý do hoàn tác đợt hoàn ứng.');
  const [identity] = await tx.select({ userId: s.expenseReconciliations.opsUserId }).from(s.expenseReconciliations).where(eq(s.expenseReconciliations.id, id));
  if (!identity) throw new ApiError(404, 'Không tìm thấy đợt hoàn ứng.');
  await lockApplicationOwnedUniqueness(tx, 'expense-reconciliation-user', [identity.userId]);
  await lockApplicationOwnedUniqueness(tx, 'expense-reconciliation', [id]);
  const [batch] = await tx.select().from(s.expenseReconciliations).where(eq(s.expenseReconciliations.id, id)).for('update');
  if (batch.voidedAt) return batch;
  const sources = await tx.select().from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.reconciliationId, id)).for('update');
  const advances = await tx.select().from(s.expenseReconciliationAdvances).where(eq(s.expenseReconciliationAdvances.reconciliationId, id));
  const allocated = sources.length ? await tx.select({ voucherId: s.expenseCashAllocations.voucherId }).from(s.expenseCashAllocations)
    .where(inArray(s.expenseCashAllocations.expenseAccountingSourceId, sources.map(source => source.id))) : [];
  const [cash] = await tx.select({ id: s.expenseCashVouchers.id }).from(s.expenseCashVouchers).where(and(eq(s.expenseCashVouchers.status, 'RECORDED'),
    or(eq(s.expenseCashVouchers.reconciliationId, id), allocated.length ? inArray(s.expenseCashVouchers.id, allocated.map(row => row.voucherId)) : undefined))).limit(1);
  if (cash) throw new ApiError(409, `Hoàn tác phiếu tiền ${cash.id} trước khi hoàn tác đợt hoàn ứng.`);
  const [after] = await tx.update(s.expenseReconciliations).set({ voidedAt: new Date() }).where(eq(s.expenseReconciliations.id, id)).returning();
  for (const source of sources) await tx.update(s.expenseAccountingSources).set({ reconciliationId: null, allocatedAdvanceAmount: '0', version: source.version + 1, updatedAt: new Date() }).where(eq(s.expenseAccountingSources.id, source.id));
  await tx.insert(s.auditLogs).values({ userId: actor.userId, message: 'EXPENSE_RECONCILIATION_RELEASED', entityType: 'expense_reconciliation', entityId: id,
    payload: { reason: reason.trim(), before: batch, after, sources, advances } });
  return after;
}
