import { FINANCIAL_ROLES } from '@tingting/shared';
import { eq } from 'drizzle-orm';


import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import {
  approveGovernanceActionWithAdapter,
  checkGovernanceAction,
} from './governance-action-core.service';
import { assertCanMakeGovernanceAction } from './governance-policy';
import {
  issueSalaryPeriodPayslips,
  markSalaryPeriodOfficialPosting,
} from './salary-period-close.service';
import type { Tx } from './trip-shared';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const ACTION_KIND = 'SALARY_PERIOD_CLOSE' as const;
const SUBJECT_TYPE = 'SALARY_PERIOD' as const;

export type SalaryPeriodFinalizationOperation = 'ISSUE_PAYSLIPS' | 'POST_OFFICIAL';

function validatePeriod(period: string): void {
  if (!PERIOD_PATTERN.test(period)) {
    throw new ApiError(400, `Kỳ lương không hợp lệ (nhận "${period}", phải dạng YYYY-MM)`);
  }
}

function validateExpectedVersion(expectedVersion: number): void {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }
}

function operationLabel(operation: SalaryPeriodFinalizationOperation): string {
  return operation === 'ISSUE_PAYSLIPS'
    ? 'phát hành phiếu lương'
    : 'hạch toán chính thức kỳ lương';
}

async function loadBoundAction(
  tx: Tx,
  actionId: number,
  period: string,
  operation: SalaryPeriodFinalizationOperation,
) {
  const [action] = await tx.select()
    .from(s.governanceActions)
    .where(eq(s.governanceActions.id, actionId))
    .limit(1)
    .for('update');
  const after = action?.afterSnapshot as Record<string, unknown> | null | undefined;
  if (
    !action
    || action.subjectType !== SUBJECT_TYPE
    || action.subjectKey !== period
    || action.actionKind !== ACTION_KIND
    || after?.operation !== operation
    || after?.period !== period
  ) {
    throw new ApiError(
      404,
      `Không tìm thấy yêu cầu ${operationLabel(operation)} của kỳ ${period}`,
    );
  }
  return action;
}

export async function requestSalaryPeriodFinalization(input: {
  period: string;
  operation: SalaryPeriodFinalizationOperation;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
  note?: string | null;
  transaction?: Tx;
}) {
  assertCanMakeGovernanceAction(ACTION_KIND, input.actorRole);
  validatePeriod(input.period);
  validateExpectedVersion(input.expectedVersion);
  const reason = input.note?.trim() || (
    input.operation === 'ISSUE_PAYSLIPS'
      ? `Đề nghị phát hành phiếu lương kỳ ${input.period}`
      : `Đề nghị hạch toán chính thức kỳ lương ${input.period}`
  );

  const execute = async (tx: Tx) => {
    const [closeRow] = await tx.select()
      .from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, input.period))
      .limit(1)
      .for('update');
    if (!closeRow || closeRow.status !== 'CLOSED') {
      throw new ApiError(409, `Kỳ lương ${input.period} chưa ở trạng thái đã chốt`);
    }
    if (closeRow.version !== input.expectedVersion) {
      throw new ApiError(409, 'Kỳ lương đã thay đổi. Vui lòng tải lại.');
    }
    if (input.operation === 'ISSUE_PAYSLIPS' && closeRow.payslipIssuedAt) {
      throw new ApiError(409, `Kỳ lương ${input.period} đã phát hành phiếu lương`);
    }
    if (input.operation === 'POST_OFFICIAL') {
      if (!closeRow.payslipIssuedAt) {
        throw new ApiError(
          409,
          `Kỳ lương ${input.period} chưa phát hành phiếu lương, chưa thể hạch toán chính thức`,
        );
      }
      if (closeRow.officialPostedAt) {
        throw new ApiError(409, `Kỳ lương ${input.period} đã hạch toán chính thức`);
      }
    }

    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: SUBJECT_TYPE,
      subjectKey: input.period,
      actionKind: ACTION_KIND,
      reason,
      originalVersion: closeRow.version,
      beforeSnapshot: {
        period: input.period,
        payslipIssuedAt: closeRow.payslipIssuedAt,
        officialPostedAt: closeRow.officialPostedAt,
      },
      afterSnapshot: {
        operation: input.operation,
        period: input.period,
        note: input.note?.trim() || null,
      },
      deltaSnapshot: null,
      makerId: input.actorId,
      makerRole: input.actorRole,
    }).returning();
    return action;
  };
  return runInTx(input.transaction, execute);
}

export async function checkSalaryPeriodFinalization(input: {
  period: string;
  operation: SalaryPeriodFinalizationOperation;
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
  transaction?: Tx;
}) {
  validatePeriod(input.period);
  validateExpectedVersion(input.expectedVersion);
  const execute = async (tx: Tx) => {
    await loadBoundAction(tx, input.actionId, input.period, input.operation);
    return checkGovernanceAction({
      actionId: input.actionId,
      checkerId: input.actorId,
      checkerRole: input.actorRole,
      expectedVersion: input.expectedVersion,
      transaction: tx,
    });
  };
  return runInTx(input.transaction, execute);
}

export async function approveSalaryPeriodFinalization(input: {
  period: string;
  operation: SalaryPeriodFinalizationOperation;
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
  transaction?: Tx;
}) {
  if (!(FINANCIAL_ROLES as readonly string[]).includes(input.actorRole)) {
    throw new ApiError(403, `Bạn không có quyền phê duyệt ${operationLabel(input.operation)}`);
  }
  validatePeriod(input.period);
  validateExpectedVersion(input.expectedVersion);

  const execute = async (tx: Tx) => {
    await loadBoundAction(tx, input.actionId, input.period, input.operation);
    return approveGovernanceActionWithAdapter({
      actionId: input.actionId,
      approverId: input.actorId,
      approverRole: input.actorRole,
      expectedVersion: input.expectedVersion,
      transaction: tx,
      apply: async (applyTx, action) => {
        const bounded = await loadBoundAction(
          applyTx,
          action.id,
          input.period,
          input.operation,
        );
        const after = bounded.afterSnapshot as Record<string, unknown>;
        const result = input.operation === 'ISSUE_PAYSLIPS'
          ? await issueSalaryPeriodPayslips({
              period: input.period,
              actorId: input.actorId,
              actorRole: input.actorRole,
              expectedVersion: bounded.originalVersion,
              note: typeof after.note === 'string' ? after.note : null,
              transaction: applyTx,
            })
          : await markSalaryPeriodOfficialPosting({
              period: input.period,
              actorId: input.actorId,
              actorRole: input.actorRole,
              expectedVersion: bounded.originalVersion,
              note: typeof after.note === 'string' ? after.note : null,
              transaction: applyTx,
            });
        return {
          ledgerEntryId: null,
          applicationResult: {
            operation: input.operation,
            period: input.period,
            closeId: result.closeId,
            resultingVersion: result.version,
          },
        };
      },
    });
  };
  return runInTx(input.transaction, execute);
}
