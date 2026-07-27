import * as s from '../db/schema';
import { eq } from 'drizzle-orm';
import { FINANCIAL_ROLES } from '@tingting/shared';
import { db } from '../db';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import { assertFuelReconClear } from './fuel-recon-guard.service';
import { assertInvoiceRequiredForExpense } from './invoice-required.service';
import { reviewNoInvoiceDisbursementApproval, toNoInvoicePolicySnapshotValue } from './no-invoice-disbursement.service';
import { propagateExpenseApproval } from './source-change.service';

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
): Promise<{ outcome: 'APPROVED' | 'REJECTED' | 'RETURN_FOR_EVIDENCE' }> {
  if (!(FINANCIAL_ROLES as readonly string[]).includes(opts.actorRole)) {
    throw new ApiError(403, 'Bạn không có quyền phê duyệt hoặc từ chối');
  }

  // Pessimistic row lock so concurrent approvals serialize on this row.
  // Without `FOR UPDATE`, two parallel txns both read PENDING, both pass
  // the guard below, and both flip the row to APPROVED — letting guards
  // (`assertFuelReconClear`, `assertInvoiceRequiredForExpense`,
  // `assertNoInvoiceDisbursementAllowed`) fire twice and any future side
  // effect double-post. For `debt_offsets` the entity locks in
  // approveDebtOffset currently mask the race, but `trip_expenses`
  // (processExpenseApproval) has no such second lock. Locking here closes
  // the hole for both tables. See qa/2026-07-27_m12-02_session-report.md
  // defect D1 and qa/2026-07-27_m12-ht_session-report.md HT04-001.
  const table = APPROVABLE_TABLES[opts.table];
  const [record] = opts.table === 'debt_offsets'
    ? await tx
      .select({
        id: s.debtOffsets.id,
        approvalStatus: s.debtOffsets.approvalStatus,
        createdBy: s.debtOffsets.createdBy,
      })
      .from(s.debtOffsets)
      .where(eq(s.debtOffsets.id, opts.id))
      .limit(1)
      .for('update')
    : await tx
      .select({
        id: s.tripExpenses.id,
        approvalStatus: s.tripExpenses.approvalStatus,
        createdBy: s.tripExpenses.createdBy,
      })
      .from(s.tripExpenses)
      .where(eq(s.tripExpenses.id, opts.id))
      .limit(1)
      .for('update');

  if (!record) {
    throw new ApiError(404, 'Không tìm thấy bản ghi');
  }
  if (record.approvalStatus !== 'PENDING') {
    throw new ApiError(409, `Không thể chuyển trạng thái: bản ghi đang ở ${record.approvalStatus}`);
  }
  if (
    opts.toStatus === 'APPROVED'
    && 'createdBy' in record
    && opts.table === 'trip_expenses'
    && record.createdBy == null
  ) {
    throw new ApiError(
      409,
      'Không xác định được người tạo chi phí; cần đối soát thủ công trước khi duyệt',
    );
  }
  if (
    opts.toStatus === 'APPROVED'
    && 'createdBy' in record
    && record.createdBy === opts.actorId
  ) {
    const subject = opts.table === 'trip_expenses'
      ? 'chi phí'
      : 'phiếu đối trừ công nợ';
    throw new ApiError(403, `Không thể duyệt ${subject} do chính mình tạo`);
  }

  // Fuel-recon guard: only fuel-typed trip_expenses going TO APPROVED are
  // checked. Rejections, debt_offsets, and non-fuel expenses bypass it.
  if (opts.table === 'trip_expenses' && opts.toStatus === 'APPROVED') {
    await assertFuelReconClear(opts.id, tx);
    // M4.6: invoice-required enforcement. When the expense's
    // forwarderExpenseType has requiresInvoice=true, the expense must carry
    // both invoiceNumber and invoiceDate before approval. Rejections bypass.
    await assertInvoiceRequiredForExpense(opts.id, tx);
    // M4.7: no-invoice disbursement enforcement. For the requiresInvoice=
    // false branch, enforces substituteEvidenceAllowed + evidence note +
    // tiered approval by amount. Rejections bypass.
    const noInvoiceOutcome = await reviewNoInvoiceDisbursementApproval(opts.id, opts.actorRole, tx);
    if (noInvoiceOutcome.outcome === 'RETURN_FOR_EVIDENCE') {
      await tx.update(s.tripExpenses).set({
        approvalStatus: 'RETURN_FOR_EVIDENCE',
        noInvoicePolicySnapshot: toNoInvoicePolicySnapshotValue(noInvoiceOutcome.policySnapshot),
        returnForEvidenceReason: noInvoiceOutcome.returnReason,
        returnedForEvidenceAt: new Date(),
        returnedForEvidenceBy: opts.actorId,
        updatedAt: new Date(),
      }).where(eq(s.tripExpenses.id, opts.id));
      return { outcome: 'RETURN_FOR_EVIDENCE' };
    }
    await tx.update(s.tripExpenses).set({
      noInvoicePolicySnapshot: toNoInvoicePolicySnapshotValue(noInvoiceOutcome.policySnapshot),
      returnForEvidenceReason: null,
      returnedForEvidenceAt: null,
      returnedForEvidenceBy: null,
      updatedAt: new Date(),
    }).where(eq(s.tripExpenses.id, opts.id));
  }

  // trip_expenses has updatedAt; debt_offsets does not
  const patch: Record<string, unknown> = { approvalStatus: opts.toStatus };
  if (opts.table === 'trip_expenses') patch.updatedAt = new Date();

  await tx.update(table).set(patch).where(eq(table.id, opts.id));
  if (opts.table === 'trip_expenses') {
    await propagateExpenseApproval(tx, { expenseId: opts.id });
  }
  return { outcome: opts.toStatus };
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
): Promise<GuardedResult | { ok: true; outcome: 'APPROVED' | 'REJECTED' | 'RETURN_FOR_EVIDENCE' }> {
  return db.transaction(async (tx) => {
    // Verify expense belongs to the specified trip
    const [expense] = await tx.select({ tripId: s.tripExpenses.tripId, forwarderId: s.tripExpenses.forwarderId })
      .from(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId)).limit(1);
    if (!expense) return { error: 'Không tìm thấy chi phí', status: 404 };
    if (expense.tripId !== tripId) return { error: 'Chi phí không thuộc chuyến xe này', status: 400 };
    if (expense.forwarderId != null) {
      return { error: 'Chi phí giao nhận được duyệt cùng phiếu hoàn ứng', status: 409 };
    }

    const result = await transitionApproval(tx, {
      table: 'trip_expenses',
      id: expenseId,
      toStatus: action,
      actorId,
      actorRole,
    });
    return { ok: true as const, outcome: result.outcome };
  });
}
