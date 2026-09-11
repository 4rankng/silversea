// Driver salary-confirmation / reopen governance. MC-4: the governance_actions
// table is dropped; the make stage returns a TRANSIENT action record
// (buildGovernanceAction) and the check + approve stages run in-request via
// applyGovernanceActionDirect with these adapters. Nothing is persisted.
import { db } from '../db';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import {
  computeSalary,
  confirmSalary,
  getSalaryConfirmationRecord,
  getWorkDays,
  unconfirmSalary,
} from './attendance.service';
import { assertCanMakeGovernanceAction } from './governance-policy';
import {
  buildGovernanceAction,
  type GovernanceActionRow,
  type GovernanceApplyAdapter,
  type GovernanceApplyResult,
} from './governance-action-core.service';
import {
  getClosedPeriodLock,
  resolveSalaryPeriodAuthority,
} from './period-lock.service';
import { resolveSalaryPeriodDateRange } from './salary-period.service';

const SALARY_CONFIRMATION_SUBJECT_TYPE = 'SALARY_CONFIRMATION';
const SALARY_CONFIRM_ACTION_KIND = 'SALARY_CONFIRMATION';
const SALARY_REOPEN_ACTION_KIND = 'SALARY_REOPEN';

type SalaryConfirmationActionKind =
  | typeof SALARY_CONFIRM_ACTION_KIND
  | typeof SALARY_REOPEN_ACTION_KIND;

function toPeriodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function toSubjectKey(driverId: number, year: number, month: number): string {
  return `${driverId}:${toPeriodKey(year, month)}`;
}

function toIsoString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function hashSnapshot(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash * 31) + value.charCodeAt(index)) >>> 0;
  }
  return hash & 0x7fffffff;
}

function assertSalaryConfirmationAction(
  action: GovernanceActionRow,
  driverId: number,
  year: number,
  month: number,
  actionKind: SalaryConfirmationActionKind,
): void {
  if (
    action.subjectType !== SALARY_CONFIRMATION_SUBJECT_TYPE
    || action.subjectKey !== toSubjectKey(driverId, year, month)
    || action.actionKind !== actionKind
  ) {
    throw new ApiError(404, 'Không tìm thấy yêu cầu quản trị xác nhận lương phù hợp');
  }
}

function requireReopenReason(reason: string | null | undefined): string {
  const normalized = reason?.trim() ?? '';
  if (!normalized) {
    throw new ApiError(400, 'Cần nhập lý do mở lại bảng công và lương');
  }
  return normalized;
}

async function assertPeriodStillEditable(
  tx: Tx,
  year: number,
  month: number,
): Promise<void> {
  const closedLock = await getClosedPeriodLock(
    tx,
    await resolveSalaryPeriodAuthority(toPeriodKey(year, month)),
  );
  if (closedLock) {
    throw new ApiError(
      409,
      `Kỳ lương ${closedLock.periodKey} đã khóa. Sau khi chốt chỉ được xử lý bằng điều chỉnh bổ sung hoặc mở lại toàn kỳ theo thẩm quyền.`,
    );
  }
}

async function buildSnapshot(
  tx: Tx,
  driverId: number,
  year: number,
  month: number,
): Promise<{
  confirmation: Awaited<ReturnType<typeof getSalaryConfirmationRecord>>;
  salary: Awaited<ReturnType<typeof computeSalary>>;
  period: Awaited<ReturnType<typeof resolveSalaryPeriodDateRange>>;
  snapshot: Record<string, unknown>;
  sourceStamp: string;
  sourceVersion: number;
}> {
  const period = await resolveSalaryPeriodDateRange(month, year);
  const [confirmation, salary, workDays] = await Promise.all([
    getSalaryConfirmationRecord(driverId, year, month, tx),
    computeSalary(driverId, year, month, undefined, tx),
    getWorkDays(driverId, period.start, period.end, tx),
  ]);

  const snapshot = {
    driverId, year, month,
    period: {
      start: period.start,
      end: period.end,
      label: period.label,
    },
    confirmation: confirmation
      ? {
          id: confirmation.id,
          status: confirmation.status,
          confirmedBy: confirmation.confirmedBy,
          confirmedAt: toIsoString(confirmation.confirmedAt),
          createdAt: confirmation.createdAt.toISOString(),
          updatedAt: confirmation.updatedAt.toISOString(),
        }
      : null,
    salary: {
      periodStart: salary.periodStart,
      periodEnd: salary.periodEnd,
      tripDays: salary.tripDays,
      standbyDays: salary.standbyDays,
      personalLeaveDays: salary.personalLeaveDays,
      weeklyOffDays: salary.weeklyOffDays,
      paidDays: salary.paidDays,
      baseSalary: salary.baseSalary,
      adjustment: salary.adjustment,
      totalPenalties: salary.totalPenalties,
      netSalary: salary.netSalary,
      confirmationStatus: salary.confirmationStatus,
    },
    workDays: workDays.map((workDay) => ({
      id: workDay.id,
      date: workDay.date,
      status: workDay.status,
      note: workDay.note,
      tripId: workDay.tripId,
      createdAt: workDay.createdAt.toISOString(),
      updatedAt: workDay.updatedAt.toISOString(),
    })),
  } satisfies Record<string, unknown>;

  const sourceStamp = JSON.stringify(snapshot);
  return {
    confirmation,
    salary,
    period,
    snapshot,
    sourceStamp,
    sourceVersion: hashSnapshot(sourceStamp),
  };
}

async function assertSnapshotUnchanged(
  tx: Tx,
  action: GovernanceActionRow,
  driverId: number,
  year: number,
  month: number,
): Promise<void> {
  const beforeSnapshot = action.beforeSnapshot as Record<string, unknown> | null;
  const expectedStamp = typeof beforeSnapshot?.sourceStamp === 'string'
    ? beforeSnapshot.sourceStamp
    : null;
  if (!expectedStamp) {
    throw new ApiError(409, 'Yêu cầu xác nhận thiếu snapshot nguồn hợp lệ');
  }

  const current = await buildSnapshot(tx, driverId, year, month);
  if (current.sourceStamp !== expectedStamp) {
    throw new ApiError(
      409,
      'Ngày công hoặc trạng thái xác nhận đã thay đổi sau khi gửi yêu cầu. Vui lòng tải lại và gửi lại snapshot mới.',
    );
  }
}

export async function requestSalaryConfirmation(input: {
  driverId: number;
  year: number;
  month: number;
  actorId: number;
  actorRole: string;
  reason?: string | null;
  transaction?: Tx;
}) {
  assertCanMakeGovernanceAction(SALARY_CONFIRM_ACTION_KIND, input.actorRole);
  const periodKey = toPeriodKey(input.year, input.month);
  const reason = input.reason?.trim() || `Đề nghị xác nhận bảng công và lương kỳ ${periodKey}`;

  const execute = async (tx: Tx) => {
    await assertPeriodStillEditable(tx, input.year, input.month);

    const snapshot = await buildSnapshot(tx, input.driverId, input.year, input.month);
    if (snapshot.confirmation?.status === 'CONFIRMED') {
      throw new ApiError(409, 'Bảng công và lương này đã được xác nhận');
    }

    return buildGovernanceAction({
      subjectType: SALARY_CONFIRMATION_SUBJECT_TYPE,
      subjectKey: toSubjectKey(input.driverId, input.year, input.month),
      actionKind: SALARY_CONFIRM_ACTION_KIND,
      reason,
      originalVersion: snapshot.sourceVersion,
      beforeSnapshot: {
        sourceStamp: snapshot.sourceStamp,
        snapshot: snapshot.snapshot,
      },
      afterSnapshot: {
        driverId: input.driverId,
        year: input.year,
        month: input.month,
        period: periodKey,
      },
      deltaSnapshot: null,
      makerId: input.actorId,
      makerRole: input.actorRole,
    });
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

/**
 * Direct-apply adapter for SALARY_CONFIRMATION. Re-runs the period-lock and
 * snapshot-integrity guards (READ COMMITTED can surface a committed
 * workday change between the make and apply stages) before confirming.
 */
export const applySalaryConfirmationAction: GovernanceApplyAdapter = async (
  tx,
  governanceAction,
): Promise<GovernanceApplyResult> => {
  const afterSnapshot = governanceAction.afterSnapshot as Record<string, unknown>;
  const driverId = Number(afterSnapshot.driverId);
  const year = Number(afterSnapshot.year);
  const month = Number(afterSnapshot.month);
  assertSalaryConfirmationAction(
    governanceAction,
    driverId,
    year,
    month,
    SALARY_CONFIRM_ACTION_KIND,
  );
  await assertPeriodStillEditable(tx, year, month);
  await assertSnapshotUnchanged(tx, governanceAction, driverId, year, month);
  const result = await confirmSalary(
    driverId,
    year,
    month,
    governanceAction.approverId ?? governanceAction.makerId,
    tx,
  );
  return {
    applicationResult: {
      confirmationId: result.confirmation.id,
      status: result.confirmation.status,
      confirmedBy: result.confirmation.confirmedBy,
      confirmedAt: toIsoString(result.confirmation.confirmedAt),
    },
  };
};

export async function requestSalaryReopen(input: {
  driverId: number;
  year: number;
  month: number;
  actorId: number;
  actorRole: string;
  reason: string;
  transaction?: Tx;
}) {
  assertCanMakeGovernanceAction(SALARY_REOPEN_ACTION_KIND, input.actorRole);
  const reason = requireReopenReason(input.reason);

  const execute = async (tx: Tx) => {
    await assertPeriodStillEditable(tx, input.year, input.month);

    const snapshot = await buildSnapshot(tx, input.driverId, input.year, input.month);
    if (snapshot.confirmation?.status !== 'CONFIRMED') {
      throw new ApiError(409, 'Bảng công và lương này chưa được xác nhận để mở lại');
    }

    return buildGovernanceAction({
      subjectType: SALARY_CONFIRMATION_SUBJECT_TYPE,
      subjectKey: toSubjectKey(input.driverId, input.year, input.month),
      actionKind: SALARY_REOPEN_ACTION_KIND,
      reason,
      originalVersion: snapshot.sourceVersion,
      beforeSnapshot: {
        sourceStamp: snapshot.sourceStamp,
        snapshot: snapshot.snapshot,
      },
      afterSnapshot: {
        driverId: input.driverId,
        year: input.year,
        month: input.month,
        period: toPeriodKey(input.year, input.month),
        requestedReason: reason,
      },
      deltaSnapshot: null,
      makerId: input.actorId,
      makerRole: input.actorRole,
    });
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

/**
 * Direct-apply adapter for SALARY_REOPEN.
 */
export const applySalaryReopenAction: GovernanceApplyAdapter = async (
  tx,
  governanceAction,
): Promise<GovernanceApplyResult> => {
  const afterSnapshot = governanceAction.afterSnapshot as Record<string, unknown>;
  const driverId = Number(afterSnapshot.driverId);
  const year = Number(afterSnapshot.year);
  const month = Number(afterSnapshot.month);
  assertSalaryConfirmationAction(
    governanceAction,
    driverId,
    year,
    month,
    SALARY_REOPEN_ACTION_KIND,
  );
  await assertPeriodStillEditable(tx, year, month);
  await assertSnapshotUnchanged(tx, governanceAction, driverId, year, month);
  const result = await unconfirmSalary(
    driverId,
    year,
    month,
    tx,
  );
  return {
    applicationResult: {
      status: result.salary.confirmationStatus,
      confirmedBy: result.salary.confirmedBy,
      confirmedAt: result.salary.confirmedAt,
    },
  };
};
