import * as s from '../db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { FINANCIAL_ROLES } from '@tingting/shared';
import { db } from '../db';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import { assertFuelReconClear } from './fuel-recon-guard.service';
import { assertInvoiceRequiredForExpense } from './invoice-required.service';
import { reviewNoInvoiceDisbursementApproval, toNoInvoicePolicySnapshotValue } from './no-invoice-disbursement.service';
import { propagateExpenseApproval } from './source-change.service';
import { assertCanMakeGovernanceAction } from './governance-policy';
import type {
  GovernanceActionRow,
  GovernanceApplyResult,
} from './governance-transition.service';

export type ApprovableTable = 'trip_expenses' | 'debt_offsets';
export type ApprovalTransition = 'APPROVED' | 'REJECTED';

export interface TripExpenseDecisionEvidence {
  reviewNote: string;
  attachmentRefs: string[];
}

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
    expectedVersion?: number;
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
        version: s.tripExpenses.version,
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
    opts.table === 'trip_expenses'
    && opts.expectedVersion !== undefined
    && 'version' in record
    && record.version !== opts.expectedVersion
  ) {
    throw new ApiError(409, 'Chi phí đã được thay đổi. Vui lòng tải lại trước khi xử lý.');
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
        version: sql`${s.tripExpenses.version} + 1`,
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
  if (opts.table === 'trip_expenses') {
    patch.updatedAt = new Date();
    patch.version = sql`${s.tripExpenses.version} + 1`;
  }

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
  transaction?: Tx,
  expectedExpenseVersion?: number,
): Promise<GuardedResult | { ok: true; outcome: 'APPROVED' | 'REJECTED' | 'RETURN_FOR_EVIDENCE' }> {
  const execute = async (tx: Tx) => {
    // Verify expense belongs to the specified trip
    const [expense] = await tx.select({
      tripId: s.tripExpenses.tripId,
      forwarderId: s.tripExpenses.forwarderId,
    })
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
      expectedVersion: expectedExpenseVersion,
    });
    return { ok: true as const, outcome: result.outcome };
  };
  if (transaction) {
    return execute(transaction);
  }
  return db.transaction(execute);
}

export async function requestTripExpenseDecision(input: {
  tripId: number;
  expenseId: number;
  decision: ApprovalTransition;
  reason: string;
  evidence: TripExpenseDecisionEvidence;
  expectedExpenseVersion: number;
  makerId: number;
  makerRole: string;
  transaction?: Tx;
}): Promise<GovernanceActionRow> {
  assertCanMakeGovernanceAction('TRIP_EXPENSE_APPROVAL', input.makerRole);
  const reason = input.reason.trim();
  const reviewNote = input.evidence.reviewNote.trim();
  const attachmentRefs = input.evidence.attachmentRefs
    .map((reference) => reference.trim())
    .filter(Boolean);
  if (!reason) throw new ApiError(400, 'Lý do xử lý chi phí là bắt buộc');
  if (!reviewNote) throw new ApiError(400, 'Căn cứ kiểm tra chi phí là bắt buộc');
  if (!Number.isInteger(input.expectedExpenseVersion) || input.expectedExpenseVersion <= 0) {
    throw new ApiError(400, 'Phiên bản chi phí không hợp lệ');
  }

  const execute = async (tx: Tx) => {
    const [expense] = await tx.select().from(s.tripExpenses)
      .where(eq(s.tripExpenses.id, input.expenseId))
      .limit(1)
      .for('update');
    if (!expense) throw new ApiError(404, 'Không tìm thấy chi phí');
    if (expense.tripId !== input.tripId) {
      throw new ApiError(400, 'Chi phí không thuộc chuyến xe này');
    }
    if (expense.forwarderId != null) {
      throw new ApiError(409, 'Chi phí giao nhận được duyệt cùng phiếu hoàn ứng');
    }
    if (expense.approvalStatus !== 'PENDING') {
      throw new ApiError(409, `Chi phí đang ở trạng thái ${expense.approvalStatus}`);
    }
    if (expense.version !== input.expectedExpenseVersion) {
      throw new ApiError(409, 'Chi phí đã được thay đổi. Vui lòng tải lại trước khi xử lý.');
    }
    const [active] = await tx.select({ id: s.governanceActions.id })
      .from(s.governanceActions)
      .where(and(
        eq(s.governanceActions.subjectType, 'TRIP_EXPENSE'),
        eq(s.governanceActions.subjectId, expense.id),
        eq(s.governanceActions.actionKind, 'TRIP_EXPENSE_APPROVAL'),
        eq(s.governanceActions.originalVersion, expense.version),
        inArray(s.governanceActions.status, [
          'PENDING_CHECK',
          'PENDING_APPROVAL',
          'RETURNED_FOR_EVIDENCE',
        ]),
      ))
      .limit(1);
    if (active) {
      throw new ApiError(409, 'Chi phí đã có yêu cầu xử lý đang chờ');
    }

    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: 'TRIP_EXPENSE',
      subjectId: expense.id,
      subjectKey: `trip-expense:${expense.id}:decision`,
      actionKind: 'TRIP_EXPENSE_APPROVAL',
      reason,
      originalVersion: expense.version,
      beforeSnapshot: {
        tripId: expense.tripId,
        approvalStatus: expense.approvalStatus,
        buyAmount: expense.buyAmount,
        expenseType: expense.expenseType,
        settlementMethod: expense.settlementMethod,
      },
      afterSnapshot: {
        tripId: expense.tripId,
        decision: input.decision,
      },
      deltaSnapshot: {
        evidence: {
          reviewNote,
          attachmentRefs,
        },
      },
      makerId: input.makerId,
      makerRole: input.makerRole,
    }).returning();
    return action;
  };
  return input.transaction ? execute(input.transaction) : db.transaction(execute);
}

export async function applyTripExpenseGovernanceAction(
  tx: Tx,
  action: GovernanceActionRow,
): Promise<GovernanceApplyResult> {
  if (
    action.actionKind !== 'TRIP_EXPENSE_APPROVAL'
    || action.subjectType !== 'TRIP_EXPENSE'
    || action.subjectId == null
  ) {
    throw new ApiError(409, 'Yêu cầu không thuộc xử lý chi phí chuyến');
  }
  const after = action.afterSnapshot as Record<string, unknown> | null;
  const decision = after?.decision;
  const tripId = Number(after?.tripId);
  if (
    (decision !== 'APPROVED' && decision !== 'REJECTED')
    || !Number.isInteger(tripId)
    || tripId <= 0
  ) {
    throw new ApiError(409, 'Yêu cầu xử lý chi phí thiếu quyết định hợp lệ');
  }
  const result = await processExpenseApproval(
    tripId,
    action.subjectId,
    action.approverId!,
    action.approverRole!,
    decision,
    tx,
    action.originalVersion,
  );
  if ('error' in result) {
    throw new ApiError(result.status, result.error);
  }
  const [expense] = await tx.select({
    version: s.tripExpenses.version,
    approvalStatus: s.tripExpenses.approvalStatus,
  }).from(s.tripExpenses).where(eq(s.tripExpenses.id, action.subjectId)).limit(1);
  return {
    ledgerEntryId: null,
    applicationResult: {
      subjectType: 'TRIP_EXPENSE',
      subjectId: action.subjectId,
      tripId,
      requestedDecision: decision,
      outcome: 'outcome' in result ? result.outcome : decision,
      resultingStatus: expense?.approvalStatus,
      resultingVersion: expense?.version,
    },
  };
}
