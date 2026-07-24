import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { LedgerService } from './ledger.service';
import { ApiError } from '../errors';
import { TxnType } from '@tingting/shared';
import { transitionApproval } from './approval.service';

/**
 * List all customers that have a linked_supplier_id,
 * with current AR and AP balances and computed net/offset amounts.
 */
export async function getDualEntities() {
  const linked = await db
    .select({
      customerId: s.customers.id,
      customerName: s.customers.name,
      supplierId: s.customers.linkedSupplierId,
    })
    .from(s.customers)
    .where(and(isNull(s.customers.deletedAt)));

  // Filter to only those with a linkedSupplierId
  const withLink = linked.filter(r => r.supplierId != null);

  // Single batch query instead of N individual getBalance() calls
  const balanceEntries = withLink.flatMap(row => [
    { entityType: 'CUSTOMER' as const, entityId: row.customerId },
    { entityType: 'VENDOR' as const, entityId: row.supplierId! },
  ]);
  const balances = await LedgerService.getBalancesBatch(balanceEntries);

  return withLink.map(row => {
    const arBalance = balances.get(`CUSTOMER:${row.customerId}`) ?? 0;
    const apBalance = balances.get(`VENDOR:${row.supplierId}`) ?? 0;
    return {
      customerId: row.customerId,
      customerName: row.customerName,
      supplierId: row.supplierId,
      arBalance,
      apBalance,
      netBalance: arBalance - apBalance,
      offsetAmount: Math.min(arBalance, apBalance),
    };
  });
}

/**
 * Create a PENDING debt offset. Amount is server-computed as min(AR, AP).
 * Returns 400 if offset amount <= 0.
 */
export async function createDebtOffset(input: {
  customerId: number;
  supplierId: number;
  offsetDate: string;
  note?: string;
  createdBy: number;
}) {
  return db.transaction(async (tx) => {
    // Lock both entities to prevent TOCTOU race
    await LedgerService.lockEntities(tx, [
      { entityType: 'CUSTOMER', entityId: input.customerId },
      { entityType: 'VENDOR',   entityId: input.supplierId },
    ]);

    const arBalance = await LedgerService.getBalanceTx(tx, 'CUSTOMER', input.customerId);
    const apBalance = await LedgerService.getBalanceTx(tx, 'VENDOR', input.supplierId);
    const amount = Math.min(arBalance, apBalance);

    if (amount <= 0) {
      throw new ApiError(400, 'Không có số dư để đối trừ (số tiền đối trừ phải > 0)');
    }

    const [row] = await tx
      .insert(s.debtOffsets)
      .values({
        customerId: input.customerId,
        supplierId: input.supplierId,
        amount: String(amount),
        offsetDate: input.offsetDate,
        note: input.note ?? null,
        approvalStatus: 'PENDING',
        createdBy: input.createdBy,
      })
      .returning();
    return row;
  });
}

/**
 * Approve a debt offset:
 * 1. Transitions status from PENDING → APPROVED (via ApprovalService)
 * 2. Posts compensating ADJUSTMENT ledger entries:
 *    - CREDIT on customer ledger (reduces AR)
 *    - DEBIT on supplier ledger (reduces AP)
 * Only ADMIN/MANAGER can approve (delegated to transitionApproval).
 */
export async function approveDebtOffset(
  id: number,
  actorId: number,
  actorRole: string,
) {
  return db.transaction(async (tx) => {
    // Transition status (guards role + PENDING check)
    await transitionApproval(tx, {
      table: 'debt_offsets',
      id,
      toStatus: 'APPROVED',
      actorId,
      actorRole,
    });

    // Reload to get amount and entity IDs
    const [offset] = await tx
      .select()
      .from(s.debtOffsets)
      .where(eq(s.debtOffsets.id, id))
      .limit(1);

    const amount = Number(offset.amount);

    // Lock both entities (sorted to prevent deadlock)
    await LedgerService.lockEntities(tx, [
      { entityType: 'CUSTOMER', entityId: offset.customerId },
      { entityType: 'VENDOR',   entityId: offset.supplierId },
    ]);

    // Re-validate amount against current balances (may have changed since creation)
    const currentAr = await LedgerService.getBalanceTx(tx, 'CUSTOMER', offset.customerId);
    const currentAp = await LedgerService.getBalanceTx(tx, 'VENDOR', offset.supplierId);
    if (amount > currentAr || amount > currentAp) {
      throw new ApiError(400, `Số dư hiện tại không đủ để đối trừ ${amount} (AR=${currentAr}, AP=${currentAp})`);
    }

    // CREDIT on customer: reduces AR (CUSTOMER balance += debit − credit)
    await LedgerService.postEntry(tx, {
      txnType: TxnType.ADJUSTMENT,
      txnId: id,
      entityType: 'CUSTOMER',
      entityId: offset.customerId,
      debit: 0,
      credit: amount,
      note: `Đối trừ công nợ #${id}`,
    });

    // DEBIT on vendor: reduces AP (VENDOR balance += credit − debit)
    await LedgerService.postEntry(tx, {
      txnType: TxnType.ADJUSTMENT,
      txnId: id,
      entityType: 'VENDOR',
      entityId: offset.supplierId,
      debit: amount,
      credit: 0,
      note: `Đối trừ công nợ #${id}`,
    });

    // Stamp approvedBy and approvedAt
    await tx
      .update(s.debtOffsets)
      .set({ approvedBy: actorId, approvedAt: new Date() })
      .where(eq(s.debtOffsets.id, id));

    return offset;
  });
}

/**
 * List debt offsets, optionally filtered by customer/supplier.
 */
export async function listDebtOffsets(filters?: {
  customerId?: number;
  supplierId?: number;
  approvalStatus?: string;
}) {
  const conditions = [];
  if (filters?.customerId) conditions.push(eq(s.debtOffsets.customerId, filters.customerId));
  if (filters?.supplierId) conditions.push(eq(s.debtOffsets.supplierId, filters.supplierId));
  if (filters?.approvalStatus) conditions.push(eq(s.debtOffsets.approvalStatus, filters.approvalStatus));

  return db
    .select()
    .from(s.debtOffsets)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(s.debtOffsets.createdAt));
}
