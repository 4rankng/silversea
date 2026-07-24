import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { LedgerService } from './ledger.service';
import { ApiError } from '../errors';
import { TxnType, round2dp } from '@tingting/shared';
import type { CommissionInput } from '@tingting/shared';

/** Result of recording a commission — exposes the ledger row for audit. */
export interface CommissionResult {
  ok: true;
  ledgerId: number;
  newBalance: number;
}

/**
 * Record a manual commission payable owed to a supplier.
 *
 * Posts a single COMMISSION ledger row on the supplier's VENDOR ledger:
 * credit = amount (increases the supplier's payable balance per the
 * VENDOR sign convention in LedgerService.postEntry).
 *
 * Verifies the supplier exists (and isn't soft-deleted) inside the tx — a
 * typo'd id would otherwise create a phantom payable invisible in aging
 * (the supplier join `continue`s on miss). Returns the ledger row id +
 * resulting balance for audit traceability.
 *
 * Not trip-scoped — `tripId` is passed through as optional `txnId` context.
 */
export async function recordCommission(input: CommissionInput): Promise<CommissionResult> {
  return db.transaction(async (tx) => {
    const [supplier] = await tx.select({ id: s.suppliers.id })
      .from(s.suppliers)
      .where(and(eq(s.suppliers.id, input.supplierId), isNull(s.suppliers.deletedAt)))
      .limit(1);
    if (!supplier) {
      throw new ApiError(404, 'Không tìm thấy nhà cung cấp — có thể đã bị xóa');
    }

    const inserted = await LedgerService.postEntry(tx, {
      txnType: TxnType.COMMISSION,
      txnId: input.tripId,
      entityType: 'VENDOR',
      entityId: input.supplierId,
      debit: 0,
      credit: round2dp(Number(input.amount)),
      note: input.note?.trim() || 'Hoa hồng',
    });
    return { ok: true as const, ledgerId: inserted.id, newBalance: Number(inserted.balance) };
  });
}
