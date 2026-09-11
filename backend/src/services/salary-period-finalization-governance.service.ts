import { eq } from 'drizzle-orm';


import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import {
  buildGovernanceAction,
  type GovernanceActionRow,
  type GovernanceApplyAdapter,
  type GovernanceApplyResult,
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

function assertFinalizationActionBinding(
  action: GovernanceActionRow,
  operation: SalaryPeriodFinalizationOperation,
): string {
  const after = action.afterSnapshot as Record<string, unknown> | null;
  const period = typeof after?.period === 'string' ? after.period : null;
  if (
    action.subjectType !== SUBJECT_TYPE
    || action.subjectKey !== period
    || action.actionKind !== ACTION_KIND
    || after?.operation !== operation
    || period == null
  ) {
    throw new ApiError(
      404,
      `Không tìm thấy yêu cầu ${operationLabel(operation)} của kỳ ${period ?? 'không xác định'}`,
    );
  }
  return period;
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

    return buildGovernanceAction({
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
    });
  };
  return runInTx(input.transaction, execute);
}

/**
 * Direct-apply adapter for the SALARY_PERIOD_CLOSE finalization operations
 * (payslip issue / official posting), dispatched on afterSnapshot.operation.
 * The approve capability (PERIOD_CLOSE_APPROVE) is enforced by the check +
 * approve policy stage.
 */
export const applySalaryPeriodFinalizationAction: GovernanceApplyAdapter = async (
  applyTx,
  action,
): Promise<GovernanceApplyResult> => {
  const after = action.afterSnapshot as Record<string, unknown> | null;
  const operation: SalaryPeriodFinalizationOperation | null =
    after?.operation === 'ISSUE_PAYSLIPS' || after?.operation === 'POST_OFFICIAL'
      ? after.operation
      : null;
  const period = operation == null ? null : assertFinalizationActionBinding(action, operation);
  if (operation == null || period == null) {
    throw new ApiError(404, 'Không tìm thấy yêu cầu phát hành phiếu lương hoặc hạch toán chính thức');
  }
  const result = operation === 'ISSUE_PAYSLIPS'
    ? await issueSalaryPeriodPayslips({
        period,
        actorId: action.approverId ?? action.makerId,
        actorRole: action.approverRole ?? action.makerRole,
        expectedVersion: action.originalVersion,
        note: typeof after?.note === 'string' ? after.note : null,
        transaction: applyTx,
      })
    : await markSalaryPeriodOfficialPosting({
        period,
        actorId: action.approverId ?? action.makerId,
        actorRole: action.approverRole ?? action.makerRole,
        expectedVersion: action.originalVersion,
        note: typeof after?.note === 'string' ? after.note : null,
        transaction: applyTx,
      });
  return {
    ledgerEntryId: null,
    applicationResult: {
      operation,
      period,
      closeId: result.closeId,
      resultingVersion: result.version,
    },
  };
};
