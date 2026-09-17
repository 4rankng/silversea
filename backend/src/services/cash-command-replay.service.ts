import { and, eq, isNull } from 'drizzle-orm';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import { buildGovernanceAction, type GovernanceActionRow } from './governance-action-core.service';
import type { ExpenseActor } from './expense-accounting-write.service';

/** Adapt durable command results without executing a second financial command. */
export async function replayCashAction(tx: Tx, snapshot: unknown, actor: ExpenseActor, actionKind: string): Promise<GovernanceActionRow> {
  if (!snapshot || typeof snapshot !== 'object') throw new ApiError(409, 'Không đọc được kết quả giao dịch đã ghi nhận.');
  const saved = snapshot as Record<string, unknown>;
  if (typeof saved.actionKind === 'string' && saved.applicationResult && typeof saved.applicationResult === 'object') {
    if (saved.makerId !== actor.userId || saved.actionKind !== actionKind) throw new ApiError(409, 'Kết quả giao dịch không thuộc thao tác hiện tại.');
    return snapshot as GovernanceActionRow;
  }
  const id = Number(saved.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(409, 'Kết quả giao dịch thiếu nguồn tiền.');
  let ledgerEntryId: number;
  let applicationResult: Record<string, unknown>;
  let createdAt: Date;
  if (actionKind === 'PAYMENT_RECEIPT') {
    const [receipt] = await tx.select().from(s.paymentReceipts).where(eq(s.paymentReceipts.id, id));
    if (!receipt || receipt.createdBy !== actor.userId) throw new ApiError(409, 'Phiếu thu không thuộc người ghi nhận hiện tại.');
    const [entry] = await tx.select().from(s.ledger).where(and(eq(s.ledger.entityType, 'CUSTOMER'), eq(s.ledger.entityId, receipt.customerId), eq(s.ledger.receiptId, receipt.receiptId)));
    const [movement] = await tx.select().from(s.treasuryMovements).where(and(eq(s.treasuryMovements.paymentReceiptId, receipt.id), isNull(s.treasuryMovements.reversalOfId)));
    if (!entry) throw new ApiError(409, 'Phiếu thu thiếu bút toán gốc.');
    ledgerEntryId = entry.id; createdAt = receipt.createdAt;
    applicationResult = { paymentReceiptId: receipt.id, receiptId: receipt.receiptId, customerId: receipt.customerId,
      allocatedTotal: Number(receipt.allocatedTotal), unappliedAmount: Number(receipt.unappliedAmount), treasuryMovementId: movement?.id ?? null,
      paymentContractVersion: receipt.paymentContractVersion };
  } else {
    const [entry] = await tx.select().from(s.ledger).where(eq(s.ledger.id, id));
    if (!entry) throw new ApiError(409, 'Không tìm thấy bút toán tiền đã ghi nhận.');
    const [movement] = await tx.select().from(s.treasuryMovements).where(and(eq(s.treasuryMovements.ledgerEntryId, entry.id), isNull(s.treasuryMovements.reversalOfId)));
    ledgerEntryId = entry.id; createdAt = entry.timestamp;
    applicationResult = { ledgerId: entry.id, receiptId: entry.receiptId, treasuryMovementId: movement?.id ?? null };
  }
  return buildGovernanceAction({ id, subjectType: actionKind, actionKind, makerId: actor.userId, makerRole: actor.role,
    status: 'APPROVED', createdAt, updatedAt: createdAt, appliedAt: createdAt, approverId: actor.userId,
    ledgerEntryId, applicationResult });
}
