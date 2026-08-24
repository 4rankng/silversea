// Debit-note receivables delta posting: the single ledger adjustment entry a
// save/update/delete reconciles through. Extracted from billing-document.service.ts
// verbatim (pure code movement).
import { TxnType } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import type {
  PaymentDatePolicy,
} from './business-calendar.service';
import type { Tx } from './trip-shared';

// ─── Persistence + receivables reconciliation ────────────────────────────────

export async function postDebitNoteDelta(
  tx: Tx,
  input: {
    documentId: number;
    customerId: number;
    delta: number;
    originalDueDate?: string | null;
    processingDueDate?: string | null;
    paymentTermDaysApplied?: number | null;
    paymentDatePolicyApplied?: PaymentDatePolicy | null;
  },
): Promise<void> {
  const delta = Math.round(input.delta);
  if (delta === 0) return;
  await LedgerService.postEntry(tx, {
    txnType: TxnType.ADJUSTMENT,
    txnId: input.documentId,
    receiptId: `GBN:${input.documentId}`,
    entityType: 'CUSTOMER',
    entityId: input.customerId,
    debit: delta > 0 ? delta : 0,
    credit: delta < 0 ? Math.abs(delta) : 0,
    note: 'Điều chỉnh công nợ theo giấy báo nợ',
    originalDueDate: input.originalDueDate,
    processingDueDate: input.processingDueDate,
    paymentTermDaysApplied: input.paymentTermDaysApplied,
    paymentDatePolicyApplied: input.paymentDatePolicyApplied,
  });
}
