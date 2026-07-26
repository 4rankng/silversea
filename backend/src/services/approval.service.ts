import * as s from '../db/schema';
import { eq } from 'drizzle-orm';
import { FINANCIAL_ROLES } from '@tingting/shared';
import { db } from '../db';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import { assertFuelReconClear } from './fuel-recon-guard.service';

export type ApprovableTable = 'trip_expenses' | 'debt_offsets';
export type ApprovalTransition = 'APPROVED' | 'REJECTED';

const APPROVABLE_TABLES = {
  trip_expenses: s.tripExpenses,
  debt_offsets:  s.debtOffsets,
} as const;

/**
 * Transitions an approvable record from PENDING → APPROVED or REJECTED.
 * Must be called inside a db.transaction().
 * ADMIN, MANAGER, and ACCOUNTANT may approve.
 *
 * M6.1 slice 2: APPROVED transitions on trip_expenses are first vetted by
 * the fuel-recon guard, which rejects with 409 when the expense is a fuel
 * purchase whose supplier has an unexplained variance for the invoice
 * month. Rejections are never blocked.
 */
export async function transitionApproval(
  tx: Tx,
  opts: {
    table: ApprovableTable;
    id: number;
    toStatus: ApprovalTransition;
    actorId: number;
    actorRole: string;
  },
): Promise<void> {
  if (!(FINANCIAL_ROLES as readonly string[]).includes(opts.actorRole)) {
    throw new ApiError(403, 'Bạn không có quyền phê duyệt hoặc từ chối');
  }

  const table = APPROVABLE_TABLES[opts.table];

  const [record] = await tx
    .select({ id: table.id, approvalStatus: table.approvalStatus })
    .from(table)
    .where(eq(table.id, opts.id))
    .limit(1);

  if (!record) {
    throw new ApiError(404, 'Không tìm thấy bản ghi');
  }
  if (record.approvalStatus !== 'PENDING') {
    throw new ApiError(400, `Không thể chuyển trạng thái: bản ghi đang ở ${record.approvalStatus}`);
  }

  // Fuel-recon guard: only fuel-typed trip_expenses going TO APPROVED are
  // checked. Rejections, debt_offsets, and non-fuel expenses bypass it.
  if (opts.table === 'trip_expenses' && opts.toStatus === 'APPROVED') {
    await assertFuelReconClear(opts.id, tx);
  }

  // trip_expenses has updatedAt; debt_offsets does not
  const patch: Record<string, unknown> = { approvalStatus: opts.toStatus };
  if (opts.table === 'trip_expenses') patch.updatedAt = new Date();

  await tx.update(table).set(patch).where(eq(table.id, opts.id));
}

/** Shared result type for guarded business operations inside a transaction. */
export type GuardedResult = { ok: true } | { error: string; status: number };

/**
 * Process an expense approval or rejection within a transaction.
 * Verifies the expense belongs to the specified trip, then transitions approval status.
 */
export async function processExpenseApproval(
  tripId: number,
  expenseId: number,
  actorId: number,
  actorRole: string,
  action: 'APPROVED' | 'REJECTED',
): Promise<GuardedResult> {
  return db.transaction(async (tx) => {
    // Verify expense belongs to the specified trip
    const [expense] = await tx.select({ tripId: s.tripExpenses.tripId, forwarderId: s.tripExpenses.forwarderId })
      .from(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId)).limit(1);
    if (!expense) return { error: 'Không tìm thấy chi phí', status: 404 };
    if (expense.tripId !== tripId) return { error: 'Chi phí không thuộc chuyến xe này', status: 400 };
    if (expense.forwarderId != null) {
      return { error: 'Chi phí giao nhận được duyệt cùng phiếu hoàn ứng', status: 409 };
    }

    await transitionApproval(tx, {
      table: 'trip_expenses',
      id: expenseId,
      toStatus: action,
      actorId,
      actorRole,
    });
    return { ok: true as const };
  });
}
