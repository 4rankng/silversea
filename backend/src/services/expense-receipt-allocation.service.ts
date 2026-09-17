import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { TxnType } from '@tingting/shared';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import type { ExpenseAccountingSource } from './expense-accounting-source.service';
import { getTripReceivableState } from './payment-allocation.service';
import { LedgerService } from './ledger.service';
import { appendTreasuryReversal } from './treasury.service';

type ReceiptExpenseSource = Pick<ExpenseAccountingSource, 'id' | 'customerId' | 'tripId' | 'linkedTripExpenseId'>;
type SourceAllocation = { source: ReceiptExpenseSource; amount: number };
interface ReceiptTarget { targetType: 'TRIP' | 'BILLING_DOCUMENT'; targetId: number; sourceTripId: number | null; }

async function resolveExpenseTarget(tx: Tx, source: ReceiptExpenseSource): Promise<ReceiptTarget | null> {
  if (source.linkedTripExpenseId) {
    const rows = await tx.select({ id: s.billingDocuments.id }).from(s.billingDocumentLines)
      .innerJoin(s.billingDocuments, eq(s.billingDocuments.id, s.billingDocumentLines.documentId))
      .where(and(eq(s.billingDocumentLines.sourceType, 'EXPENSE'), eq(s.billingDocumentLines.sourceId, source.linkedTripExpenseId),
        eq(s.billingDocumentLines.excluded, false), eq(s.billingDocuments.entityType, 'CUSTOMER'), eq(s.billingDocuments.entityId, source.customerId),
        eq(s.billingDocuments.type, 'DEBIT_NOTE'), isNull(s.billingDocuments.deletedAt),
        sql`coalesce(${s.billingDocuments.debitNoteStatus}, 'DRAFT') not in ('DRAFT', 'CANCELED')`));
    const ids = [...new Set(rows.map(row => row.id))];
    if (ids.length > 1) throw new ApiError(409, 'Khoản chi đang thuộc nhiều chứng từ; cần đối soát trước khi phân bổ tiền.');
    if (ids.length) return { targetType: 'BILLING_DOCUMENT', targetId: ids[0], sourceTripId: source.tripId };
  }
  if (!source.tripId) return null;
  const state = await getTripReceivableState(tx, source.customerId, [source.tripId]);
  const authority = state.authorityByTripId.get(source.tripId);
  return authority ? { targetType: authority.targetType, targetId: authority.targetId, sourceTripId: source.tripId } : null;
}

async function targetRemaining(tx: Tx, customerId: number, target: ReceiptTarget): Promise<number> {
  if (target.targetType === 'TRIP') {
    const state = await getTripReceivableState(tx, customerId, [target.targetId]);
    return state.outstandingByTargetKey.get(`TRIP:${target.targetId}`) ?? 0;
  }
  const [document] = await tx.select().from(s.billingDocuments).where(and(eq(s.billingDocuments.id, target.targetId),
    eq(s.billingDocuments.entityId, customerId), eq(s.billingDocuments.entityType, 'CUSTOMER'), isNull(s.billingDocuments.deletedAt))).for('update');
  if (!document) throw new ApiError(409, 'Chứng từ phải thu không còn hợp lệ.');
  const allocations = await tx.select({ amount: s.paymentAllocations.amount }).from(s.paymentAllocations)
    .where(and(eq(s.paymentAllocations.targetType, 'BILLING_DOCUMENT'), eq(s.paymentAllocations.targetId, target.targetId), eq(s.paymentAllocations.customerId, customerId)));
  const adjustments = await tx.select({ debit: s.ledger.debit, credit: s.ledger.credit }).from(s.ledger)
    .where(and(eq(s.ledger.entityType, 'CUSTOMER'), eq(s.ledger.entityId, customerId), eq(s.ledger.txnType, TxnType.ADJUSTMENT),
      eq(s.ledger.txnId, target.targetId), sql`${s.ledger.receiptId} like 'GBN-ADJ:%'`));
  return Math.max(0, Number(document.totalInclVat) + adjustments.reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0)
    - allocations.reduce((sum, row) => sum + Number(row.amount), 0));
}

/** Explicit attribution of a receipt to sources; this never creates or moves physical cash. */
export async function allocateExpenseReceipt(tx: Tx, receiptId: number, items: SourceAllocation[], actorId: number) {
  const [receipt] = await tx.select().from(s.paymentReceipts).where(eq(s.paymentReceipts.id, receiptId)).for('update');
  if (!receipt) throw new ApiError(404, 'Không tìm thấy phiếu thu.');
  await LedgerService.lockEntity(tx, 'CUSTOMER', receipt.customerId);
  const assignments = new Map<number, number>();
  const targets = new Map<string, { target: ReceiptTarget; items: SourceAllocation[]; amount: number }>();
  for (const item of items) {
    if (item.source.customerId !== receipt.customerId) throw new ApiError(409, 'Không phân bổ tiền giữa các khách hàng.');
    const target = await resolveExpenseTarget(tx, item.source);
    if (!target) continue; // Pre-trip money stays unapplied, with explicit source attribution only.
    const key = `${target.targetType}:${target.targetId}:${target.sourceTripId ?? 0}`;
    const group = targets.get(key) ?? { target, items: [], amount: 0 };
    group.items.push(item); group.amount += item.amount; targets.set(key, group);
  }
  const total = [...targets.values()].reduce((sum, group) => sum + group.amount, 0);
  if (total > Number(receipt.unappliedAmount)) throw new ApiError(409, 'Số tiền chưa phân bổ không đủ.');
  const existing = await tx.select().from(s.paymentAllocations).where(eq(s.paymentAllocations.paymentReceiptId, receipt.id)).orderBy(asc(s.paymentAllocations.id));
  let order = existing.reduce((max, row) => Math.max(max, row.allocationOrder ?? 0), 0);
  for (const group of targets.values()) {
    if (group.amount > await targetRemaining(tx, receipt.customerId, group.target)) throw new ApiError(409, 'Phân bổ vượt số dư còn lại của chứng từ.');
    const previous = existing.find(row => row.targetType === group.target.targetType && row.targetId === group.target.targetId && row.sourceTripId === group.target.sourceTripId);
    const [allocation] = previous ? await tx.update(s.paymentAllocations).set({ amount: String(Number(previous.amount) + group.amount) })
      .where(eq(s.paymentAllocations.id, previous.id)).returning()
      : await tx.insert(s.paymentAllocations).values({ receiptId: receipt.receiptId, paymentReceiptId: receipt.id,
      customerId: receipt.customerId, allocationOrder: ++order, targetType: group.target.targetType, targetId: group.target.targetId,
      billingDocumentId: group.target.targetType === 'BILLING_DOCUMENT' ? group.target.targetId : null, sourceTripId: group.target.sourceTripId,
      amount: String(group.amount), allocationMethod: 'EXPLICIT', allocatedBy: actorId }).returning();
    await tx.insert(s.auditLogs).values({ userId: actorId, message: 'PAYMENT_ALLOCATION_RECORDED', entityType: 'payment_allocation', entityId: allocation.id,
      payload: { before: previous ?? null, after: allocation, receiptId: receipt.id, cashMovement: false } });
    for (const item of group.items) assignments.set(item.source.id, allocation.id);
    // Move only the ledger attribution from unapplied to its canonical target.
    await LedgerService.postEntry(tx, { txnType: TxnType.ADJUSTMENT, txnId: 0, receiptId: receipt.receiptId,
      entityType: 'CUSTOMER', entityId: receipt.customerId, debit: group.amount, credit: 0, note: 'Phân bổ tiền đã nhận — không phát sinh thu mới' });
    await LedgerService.postEntry(tx, { txnType: TxnType.PAYMENT_RECEIVED, txnId: group.target.sourceTripId ?? 0, receiptId: receipt.receiptId,
      entityType: 'CUSTOMER', entityId: receipt.customerId, debit: 0, credit: group.amount, note: 'Phân bổ tiền đã nhận cho khoản chi hộ' });
  }
  if (total) await tx.update(s.paymentReceipts).set({ allocatedTotal: String(Number(receipt.allocatedTotal) + total),
    unappliedAmount: String(Number(receipt.unappliedAmount) - total), version: receipt.version + 1 }).where(eq(s.paymentReceipts.id, receipt.id));
  return assignments;
}

/** Full correction of an expense receipt, retaining receipt/allocation history. */
export async function reverseExpenseReceipt(tx: Tx, paymentReceiptId: number, actorId: number, input: { reason: string; valueDate: string; physicalReference: string }) {
  const [receipt] = await tx.select().from(s.paymentReceipts).where(eq(s.paymentReceipts.id, paymentReceiptId)).for('update');
  if (!receipt || Number(receipt.refundedAmount) > 0) throw new ApiError(409, 'Phiếu thu đã được hoàn hoặc điều chỉnh; cần đối soát trước khi đảo.');
  await LedgerService.lockEntity(tx, 'CUSTOMER', receipt.customerId);
  const allocations = await tx.select().from(s.paymentAllocations).where(eq(s.paymentAllocations.paymentReceiptId, receipt.id));
  const [movement] = await tx.select().from(s.treasuryMovements).where(and(eq(s.treasuryMovements.paymentReceiptId, receipt.id),
    eq(s.treasuryMovements.status, 'POSTED'), isNull(s.treasuryMovements.reversalOfId))).for('update');
  if (!movement) throw new ApiError(409, 'Phiếu thu thiếu giao dịch quỹ gốc.');
  let order = allocations.reduce((max, row) => Math.max(max, row.allocationOrder ?? 0), 0);
  for (const allocation of allocations) {
    // Reversals have no paymentReceiptId so the immutable original target identity stays unique.
    await tx.insert(s.paymentAllocations).values({ receiptId: `REV-${receipt.receiptId}`.slice(0, 100), allocationOrder: ++order,
      customerId: receipt.customerId, targetType: allocation.targetType, targetId: allocation.targetId,
      billingDocumentId: allocation.billingDocumentId, sourceTripId: allocation.sourceTripId,
      amount: String(-Number(allocation.amount)), allocationMethod: 'REVERSAL', allocatedBy: actorId });
    await LedgerService.postEntry(tx, { txnType: TxnType.ADJUSTMENT, txnId: allocation.sourceTripId ?? 0,
      receiptId: `REV-${receipt.receiptId}`.slice(0, 100), entityType: 'CUSTOMER', entityId: receipt.customerId,
      debit: Number(allocation.amount), credit: 0, note: input.reason });
  }
  const reversal = await LedgerService.postEntry(tx, { txnType: TxnType.ADJUSTMENT, txnId: 0,
    receiptId: `REFUND-${receipt.receiptId}`.slice(0, 100), entityType: 'CUSTOMER', entityId: receipt.customerId,
    debit: Number(receipt.unappliedAmount), credit: 0, note: input.reason });
  await tx.insert(s.paymentRefunds).values({ paymentReceiptId: receipt.id, amount: receipt.receivedAmount, reason: input.reason,
    createdBy: actorId, approvedBy: actorId, ledgerEntryId: reversal.id });
  await tx.update(s.paymentReceipts).set({ allocatedTotal: '0', unappliedAmount: '0', refundedAmount: receipt.receivedAmount,
    version: receipt.version + 1 }).where(eq(s.paymentReceipts.id, receipt.id));
  return appendTreasuryReversal(tx, { originalMovementId: movement.id, amount: Number(receipt.receivedAmount), valueDate: input.valueDate,
    sourceVersion: receipt.version + 1, physicalReference: input.physicalReference, createdBy: actorId, ledgerEntryId: reversal.id });
}
