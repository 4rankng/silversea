import { and, eq } from 'drizzle-orm';
import { TxnType } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';
import { ApiError } from '../errors';

/** An expense voucher only attributes canonical cash; it does not store another money book. */
export async function hydrateExpenseCashVoucher(executor: Tx | typeof db, voucher: typeof s.expenseCashVouchers.$inferSelect) {
  const [movement] = await executor.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.id, voucher.treasuryMovementId));
  if (!movement || !['IN', 'OUT'].includes(movement.direction)) throw new ApiError(409, 'Phiếu thiếu giao dịch quỹ chuẩn; cần đối soát.');
  let ledgerEntryId = movement.ledgerEntryId;
  if (!ledgerEntryId && voucher.paymentReceiptId) {
    const [receipt] = await executor.select().from(s.paymentReceipts).where(eq(s.paymentReceipts.id, voucher.paymentReceiptId));
    const [ledger] = receipt ? await executor.select().from(s.ledger).where(and(eq(s.ledger.entityType, 'CUSTOMER'),
      eq(s.ledger.entityId, receipt.customerId), eq(s.ledger.receiptId, receipt.receiptId), eq(s.ledger.txnType, TxnType.PAYMENT_RECEIVED), eq(s.ledger.txnId, 0))) : [];
    ledgerEntryId = ledger?.id ?? null;
  }
  if (!ledgerEntryId) throw new ApiError(409, 'Phiếu thiếu bút toán nguồn; cần đối soát.');
  return { ...voucher, ledgerEntryId, direction: movement.direction as 'IN' | 'OUT', amount: movement.amount,
    treasuryAccountId: movement.treasuryAccountId, valueDate: movement.valueDate, physicalReference: movement.physicalReference };
}
