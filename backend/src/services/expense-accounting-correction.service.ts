import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import { TxnType, type ExpenseAccountingUpdate, type ExpenseSourceKind } from '@tingting/shared';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';
import { ApiError } from '../errors';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import { hydrateExpenseAccountingSource, upsertExpenseAccountingSource } from './expense-accounting-source.service';
import { getExpenseForCommand, requireExpenseFinance, updateAccountingExpense, confirmAccountingExpenses, type ExpenseActor } from './expense-accounting-write.service';
import { LedgerService } from './ledger.service';
import { propagateRecordedExpense } from './source-change.service';

/** Immutable correction: preserve the original native record and its financial
 * history; reverse only its net obligation, then confirm one linked replacement. */
export async function correctAccountingExpense(tx: Tx, actor: ExpenseActor, kind: ExpenseSourceKind, id: number, input: ExpenseAccountingUpdate) {
  requireExpenseFinance(actor);
  if (kind !== 'OPS' && kind !== 'DRIVER') throw new ApiError(400, 'Điều chỉnh từ màn hình nguồn của khoản chi này.');
  const before = await getExpenseForCommand(tx, actor, { sourceKind: kind, sourceId: id, expectedVersion: input.expectedVersion });
  await assertShipmentAccountingUnlocked(tx, before.shipmentId);
  if (!before.confirmedAt) throw new ApiError(409, 'Khoản chưa đối chiếu có thể sửa trực tiếp.');
  if (before.paymentHistoryUnattributed) throw new ApiError(409, 'Đối chiếu lịch sử thanh toán cũ trước khi điều chỉnh.');
  if (before.reconciliationId) throw new ApiError(409, `Hoàn tác đợt hoàn ứng ${before.reconciliationId} trước khi điều chỉnh khoản chi.`);
  if (input.tripId || input.photoStorageKeys) throw new ApiError(400, 'Điều chỉnh tiền không thay đổi chuyến hoặc xóa chứng từ.');
  const [allocation] = await tx.select({ id: s.expenseCashAllocations.id }).from(s.expenseCashAllocations)
    .innerJoin(s.expenseCashVouchers, eq(s.expenseCashVouchers.id, s.expenseCashAllocations.voucherId))
    .where(and(eq(s.expenseCashAllocations.expenseAccountingSourceId, before.id), eq(s.expenseCashVouchers.status, 'RECORDED'))).limit(1);
  if (allocation) throw new ApiError(409, 'Hoàn tác phiếu thu/chi đã phân bổ trước khi điều chỉnh khoản chi.');
  if (before.linkedTripExpenseId) {
    await tx.execute(sql`select pg_advisory_xact_lock(6102, ${before.linkedTripExpenseId})`);
    const [settlement] = await tx.select({ id: s.advanceSettlements.id }).from(s.settlementExpenses)
      .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.settlementExpenses.settlementId))
      .where(and(eq(s.settlementExpenses.tripExpenseId, before.linkedTripExpenseId), notInArray(s.advanceSettlements.status, ['VOIDED', 'REVERSED']))).limit(1);
    if (settlement) throw new ApiError(409, `Hoàn tác phiếu hoàn ứng ${settlement.id} trước khi điều chỉnh khoản chi.`);
    const [claim] = await tx.select({ id: s.billingDocumentRecoverableClaims.id }).from(s.billingDocumentRecoverableClaims)
      .where(and(eq(s.billingDocumentRecoverableClaims.expenseId, before.linkedTripExpenseId), isNull(s.billingDocumentRecoverableClaims.releasedAt))).limit(1);
    if (claim) throw new ApiError(409, 'Hoàn tác hoặc bỏ khoản phí khỏi chứng từ khách hàng trước khi điều chỉnh.');
  }
  let sourceId: number;
  if (kind === 'OPS') {
    const [native] = await tx.select().from(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, id)).for('update');
    if (native.opsSettlementId) throw new ApiError(409, 'Hoàn tác phiếu quyết toán cũ trước khi điều chỉnh.');
    const [replacement] = await tx.insert(s.opsExpenseEntries).values({ shipmentId: native.shipmentId, shipmentContainerId: native.shipmentContainerId,
      expenseTypeCode: native.expenseTypeCode, amount: native.amount, paidById: native.paidById, paidAt: native.paidAt, note: native.note, approvalStatus: 'RECORDED' }).returning();
    sourceId = replacement.id;
    const photos = await tx.select().from(s.opsExpensePhotos).where(eq(s.opsExpensePhotos.opsExpenseId, id));
    if (photos.length) await tx.insert(s.opsExpensePhotos).values(photos.map(photo => ({ opsExpenseId: sourceId, storageKey: photo.storageKey, uploadedById: photo.uploadedById })));
    await tx.update(s.opsExpenseEntries).set({ approvalStatus: 'VOIDED', updatedAt: new Date() }).where(eq(s.opsExpenseEntries.id, id));
  } else {
    const [native] = await tx.select().from(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, id)).for('update');
    const [replacement] = await tx.insert(s.driverIncidentalCosts).values({ tripId: native.tripId, driverId: native.driverId, costType: native.costType,
      amount: native.amount, occurredAt: native.occurredAt, note: native.note, receiptStorageKey: native.receiptStorageKey, recordedBy: actor.userId }).returning();
    sourceId = replacement.id;
  }
  const replacement = await upsertExpenseAccountingSource(tx, { ...before, sourceKind: kind, sourceId,
    amount: Number(before.amount), customerChargeAmount: before.customerChargeAmount == null ? null : Number(before.customerChargeAmount),
    linkedTripExpenseId: null, recordedById: actor.userId });
  // Keep the upload's unique provenance on the original source. Native receipt
  // references above carry evidence forward without duplicating attachment rows.
  await tx.update(s.expenseAccountingSources).set({ status: 'VOIDED', version: before.version + 1, updatedAt: new Date() }).where(eq(s.expenseAccountingSources.id, before.id));
  const ledger = await tx.select().from(s.ledger).where(eq(s.ledger.receiptId, `EXPENSE_SOURCE:${before.id}`));
  const balances = new Map<string, { row: typeof ledger[number]; net: number }>();
  for (const row of ledger) { const key = `${row.entityType}:${row.entityId}`; const existing = balances.get(key); balances.set(key, { row, net: (existing?.net ?? 0) + Number(row.debit) - Number(row.credit) }); }
  for (const { row, net } of balances.values()) if (net) {
    if (!['CUSTOMER', 'DRIVER', 'VENDOR', 'FORWARDER', 'CARRIER'].includes(row.entityType)) throw new ApiError(409, 'Đối tượng sổ tiền không hợp lệ.');
    await LedgerService.postEntry(tx, { txnType: TxnType.ADJUSTMENT, txnId: before.id,
    receiptId: `EXPENSE_SOURCE:${before.id}`, entityType: row.entityType as 'CUSTOMER' | 'DRIVER' | 'VENDOR' | 'FORWARDER' | 'CARRIER', entityId: row.entityId, debit: net < 0 ? -net : 0, credit: net > 0 ? net : 0, note: input.reason });
  }
  if (before.linkedTripExpenseId) {
    await tx.update(s.tripExpenses).set({ approvalStatus: 'VOIDED', updatedAt: new Date() }).where(eq(s.tripExpenses.id, before.linkedTripExpenseId));
    await propagateRecordedExpense(tx, { expenseId: before.linkedTripExpenseId });
  }
  const updated = await updateAccountingExpense(tx, actor, kind, sourceId, { ...input, expectedVersion: replacement.version });
  const [after] = await confirmAccountingExpenses(tx, actor, [{ sourceKind: kind, sourceId, expectedVersion: updated.version }]);
  await tx.insert(s.auditLogs).values({ userId: actor.userId, message: 'EXPENSE_ACCOUNTING_CORRECTED', entityType: 'expense_accounting_source', entityId: before.id,
    payload: { reason: input.reason, before, after, replacesSourceId: before.id, replacementSourceId: after.id } });
  await tx.insert(s.auditLogs).values({ userId: actor.userId, message: 'EXPENSE_ACCOUNTING_REPLACEMENT', entityType: 'expense_accounting_source', entityId: after.id,
    payload: { reason: input.reason, replacesSourceId: before.id, replacementSourceId: after.id } });
  return hydrateExpenseAccountingSource(tx, after);
}
