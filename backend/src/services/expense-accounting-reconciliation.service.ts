import { hydrateExpenseCashVoucher } from './expense-cash-voucher-source.service';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getAdvanceConsumedAmounts } from './advance-consumption.service';
import { TxnType, Role, type ExpenseReconciliationInput } from '@tingting/shared';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';
import { ApiError } from '../errors';
import { getExpenseForCommand, requireExpenseFinance, type ExpenseActor } from './expense-accounting-write.service';
import { LedgerService } from './ledger.service';
import { assertTreasuryFundAssigned, resolveTreasuryPaymentContract, insertTreasuryMovement } from './treasury.service';
import { createAdvanceRequest } from './advance-request.service';
import { assertActiveExpensePayer } from './expense-accounting-source.service';
import { lockApplicationOwnedUniqueness } from './application-owned-uniqueness.service';

export async function createExpenseReconciliation(tx: Tx, actor: ExpenseActor, input: ExpenseReconciliationInput) {
  requireExpenseFinance(actor);
  if (new Set(input.entries.map(e => `${e.sourceKind}:${e.sourceId}`)).size !== input.entries.length
    || new Set(input.advances.map(a => a.advanceRequestId)).size !== input.advances.length) throw new ApiError(400, 'Nguồn chi/ứng bị chọn trùng.');
  const payer = await assertActiveExpensePayer(tx, input.opsUserId);
  if (payer.role !== Role.OPS) throw new ApiError(400, 'Chọn nhân viên Ops.');
  await lockApplicationOwnedUniqueness(tx, 'expense-reconciliation-user', [input.opsUserId]);
  // Existing PT settlement takes the same advance locks before source locks.
  for (const id of input.advances.map(a => a.advanceRequestId).sort((a, b) => a - b)) await tx.execute(sql`select pg_advisory_xact_lock(6101, ${id})`);
  let advanceAmount = 0;
  for (const allocation of input.advances) {
    const [advance] = await tx.select().from(s.advanceRequests).where(eq(s.advanceRequests.id, allocation.advanceRequestId)).for('update');
    if (!advance || advance.requesterId !== input.opsUserId || advance.status !== 'RECORDED') throw new ApiError(409, 'Khoản ứng không còn hợp lệ hoặc khác nhân viên.');
    const [cash] = await tx.select({ id: s.treasuryMovements.id }).from(s.ledger).innerJoin(s.treasuryMovements, eq(s.treasuryMovements.ledgerEntryId, s.ledger.id))
      .where(and(eq(s.ledger.txnType, TxnType.OPS_ADVANCE), eq(s.ledger.txnId, advance.id), eq(s.treasuryMovements.direction, 'OUT'), eq(s.treasuryMovements.status, 'POSTED'))).limit(1);
    if (!cash) throw new ApiError(409, 'Khoản ứng chưa có giao dịch quỹ xác nhận tiền thực giao. Ghi nhận chi ứng trước.');
    const used = (await getAdvanceConsumedAmounts(tx, [advance.id])).get(advance.id) ?? 0;
    if (allocation.amount > Number(advance.amount) - used) throw new ApiError(409, 'Số tiền ứng đã được phân bổ cho đợt khác.');
    advanceAmount += allocation.amount;
  }
  const sources = [];
  for (const ref of [...input.entries].sort((a, b) => `${a.sourceKind}:${a.sourceId}`.localeCompare(`${b.sourceKind}:${b.sourceId}`))) {
    const row = await getExpenseForCommand(tx, actor, ref);
    if (row.paymentHistoryUnattributed) throw new ApiError(409, 'Lịch sử thu/chi chưa được phân bổ cho khoản chi cũ; không thể sử dụng thêm tiền ứng.');
    if (row.payableEntityType !== 'FORWARDER' || row.payableEntityId !== input.opsUserId || !row.confirmedAt || row.reconciliationId
      || row.expenseDate < input.from || row.expenseDate > input.to) throw new ApiError(409, `Khoản ${ref.sourceKind}-${ref.sourceId} không thuộc phạm vi đợt hoặc đã quyết toán.`);
    if (row.linkedTripExpenseId) {
      await tx.execute(sql`select pg_advisory_xact_lock(6102, ${row.linkedTripExpenseId})`);
      const [legacyClaim] = await tx.select({ id: s.settlementExpenses.id }).from(s.settlementExpenses)
        .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.settlementExpenses.settlementId))
        .where(and(eq(s.settlementExpenses.tripExpenseId, row.linkedTripExpenseId),
          sql`${s.advanceSettlements.status} not in ('VOIDED', 'REVERSED')`)).limit(1);
      if (legacyClaim) throw new ApiError(409, 'Khoản chi đã thuộc phiếu hoàn ứng khác.');
    }
    sources.push(row);
  }
  const amount = sources.reduce((sum, row) => sum + Number(row.amount), 0);
  if (![amount, advanceAmount].every(Number.isSafeInteger)) throw new ApiError(400, 'Tổng tiền vượt giới hạn.');
  const [batch] = await tx.insert(s.expenseReconciliations).values({ code: `HU-${randomUUID()}`, opsUserId: input.opsUserId,
    from: input.from, to: input.to, amount: String(amount), advanceAmount: String(advanceAmount), createdById: actor.userId, note: input.note }).returning();
  if (input.advances.length) await tx.insert(s.expenseReconciliationAdvances).values(input.advances.map(a => ({ reconciliationId: batch.id, advanceRequestId: a.advanceRequestId, amount: String(a.amount) })));
  let remainingAdvance = advanceAmount;
  for (const row of sources) {
    const allocated = Math.min(Number(row.amount), remainingAdvance);
    remainingAdvance -= allocated;
    await tx.update(s.expenseAccountingSources).set({ reconciliationId: batch.id, allocatedAdvanceAmount: String(allocated), version: row.version + 1, updatedAt: new Date() }).where(eq(s.expenseAccountingSources.id, row.id));
  }
  await tx.insert(s.auditLogs).values({ userId: actor.userId, message: 'EXPENSE_RECONCILIATION_RECORDED', entityType: 'expense_reconciliation', entityId: batch.id,
    payload: { batch, sourceIds: sources.map(s => s.id), advances: input.advances, initialDifference: amount - advanceAmount } });
  return batch;
}

export interface ExpenseFundFields { treasuryAccountId: number; valueDate: string; physicalReference: string; }

export async function recordFundedOpsAdvance(tx: Tx, actor: ExpenseActor, input: ExpenseFundFields & { opsUserId: number; amount: number; reason: string; advanceRequestId?: number }) {
  requireExpenseFinance(actor);
  const payer = await assertActiveExpensePayer(tx, input.opsUserId);
  if (payer.role !== Role.OPS) throw new ApiError(400, 'Chọn nhân viên Ops.');
  await assertTreasuryFundAssigned(tx, input.treasuryAccountId);
  const treasury = await resolveTreasuryPaymentContract(tx, input, new Date());
  let advance;
  if (input.advanceRequestId) {
    await tx.execute(sql`select pg_advisory_xact_lock(6101, ${input.advanceRequestId})`);
    [advance] = await tx.select().from(s.advanceRequests).where(eq(s.advanceRequests.id, input.advanceRequestId)).for('update');
    if (!advance || advance.status !== 'RECORDED' || advance.requesterId !== input.opsUserId || Number(advance.amount) !== input.amount) throw new ApiError(409, 'Khoản ứng thay đổi hoặc không đúng đối tượng/số tiền.');
  } else advance = await createAdvanceRequest(input.opsUserId, { amount: input.amount, reason: input.reason }, tx);
  const [ledger] = await tx.select().from(s.ledger).where(and(eq(s.ledger.txnType, TxnType.OPS_ADVANCE), eq(s.ledger.txnId, advance.id), eq(s.ledger.entityType, 'FORWARDER'), eq(s.ledger.entityId, input.opsUserId)));
  if (!ledger || !treasury.treasuryAccountId || !treasury.valueDate || !treasury.physicalReference) throw new ApiError(409, 'Khoản ứng chưa có nguồn tiền hợp lệ.');
  await insertTreasuryMovement(tx, { treasuryAccountId: treasury.treasuryAccountId, direction: 'OUT', amount: input.amount,
    valueDate: treasury.valueDate, physicalReference: treasury.physicalReference, ledgerEntryId: ledger.id, sourceVersion: advance.version, paymentContractVersion: 2, createdBy: actor.userId });
  return advance;
}

export async function refundExpenseReconciliation(tx: Tx, actor: ExpenseActor, id: number, input: ExpenseFundFields & { amount: number; reason: string }) {
  requireExpenseFinance(actor);
  await lockApplicationOwnedUniqueness(tx, 'expense-reconciliation', [id]);
  const [batch] = await tx.select().from(s.expenseReconciliations).where(eq(s.expenseReconciliations.id, id)).for('update');
  if (!batch) throw new ApiError(404, 'Không tìm thấy đợt hoàn ứng.');
  const existing = await tx.select({ amount: s.treasuryMovements.amount }).from(s.expenseCashVouchers)
    .innerJoin(s.treasuryMovements, eq(s.treasuryMovements.id, s.expenseCashVouchers.treasuryMovementId))
    .where(and(eq(s.expenseCashVouchers.reconciliationId, id), eq(s.treasuryMovements.direction, 'IN'), eq(s.expenseCashVouchers.status, 'RECORDED')));
  const remaining = Number(batch.advanceAmount) - Number(batch.amount) - existing.reduce((sum, row) => sum + Number(row.amount), 0);
  if (input.amount <= 0 || input.amount > remaining) throw new ApiError(409, `Đợt này chỉ còn phải hoàn ${Math.max(0, remaining)}đ.`);
  await assertTreasuryFundAssigned(tx, input.treasuryAccountId);
  const treasury = await resolveTreasuryPaymentContract(tx, input, new Date());
  if (!treasury.treasuryAccountId || !treasury.valueDate || !treasury.physicalReference) throw new ApiError(400, 'Chọn quỹ và thông tin tiền thực nhận.');
  const code = `HU-THU-${randomUUID()}`;
  const ledger = await LedgerService.postEntry(tx, { txnType: TxnType.OPS_SETTLEMENT, entityType: 'FORWARDER', entityId: batch.opsUserId,
    debit: input.amount, credit: 0, receiptId: code, note: input.reason });
  const movement = await insertTreasuryMovement(tx, { treasuryAccountId: treasury.treasuryAccountId, direction: 'IN', amount: input.amount,
    valueDate: treasury.valueDate, physicalReference: treasury.physicalReference, ledgerEntryId: ledger.id, sourceVersion: 1, paymentContractVersion: 2, createdBy: actor.userId });
  const [voucher] = await tx.insert(s.expenseCashVouchers).values({ code, counterpartyType: 'FORWARDER', counterpartyId: batch.opsUserId,
    treasuryMovementId: movement.id, reconciliationId: id, createdById: actor.userId, note: input.reason }).returning();
  return hydrateExpenseCashVoucher(tx, voucher);
}
