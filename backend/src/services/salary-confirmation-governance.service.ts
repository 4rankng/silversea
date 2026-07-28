import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
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
  approveGovernanceActionWithAdapter,
  checkGovernanceAction,
  type GovernanceActionRow,
  type GovernanceApplyResult,
} from './governance-transition.service';
import {
  getClosedPeriodLock,
  resolveSalaryPeriodAuthority,
} from './period-lock.service';
import { resolveSalaryPeriodDateRange } from './salary-period.service';

const SALARY_CONFIRMATION_SUBJECT_TYPE = 'SALARY_CONFIRMATION';
const SALARY_CONFIRM_ACTION_KIND = 'SALARY_CONFIRMATION';
const SALARY_REOPEN_ACTION_KIND = 'SALARY_REOPEN';
const ACTIVE_STATUSES = ['PENDING_CHECK', 'PENDING_APPROVAL', 'RETURNED_FOR_EVIDENCE'] as const;

type SalaryConfirmationActionKind =
  | typeof SALARY_CONFIRM_ACTION_KIND
  | typeof SALARY_REOPEN_ACTION_KIND;

type SalaryConfirmationGovernanceView = {
  id: number;
  subjectType: string;
  subjectId: number | null;
  subjectKey: string | null;
  actionKind: string;
  status: string;
  version: number;
  reason: string;
  makerId: number;
  makerRole: string | null;
  checkerId: number | null;
  checkerRole: string | null;
  approverId: number | null;
  approverRole: string | null;
  createdAt: string;
  checkedAt: string | null;
  approvedAt: string | null;
  beforeSnapshot: unknown;
  afterSnapshot: unknown;
  deltaSnapshot: unknown;
};

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

function toGovernanceActionView(action: GovernanceActionRow): SalaryConfirmationGovernanceView {
  return {
    id: action.id,
    subjectType: action.subjectType,
    subjectId: action.subjectId,
    subjectKey: action.subjectKey,
    actionKind: action.actionKind,
    status: action.status,
    version: action.version,
    reason: action.reason,
    makerId: action.makerId,
    makerRole: action.makerRole,
    checkerId: action.checkerId,
    checkerRole: action.checkerRole,
    approverId: action.approverId,
    approverRole: action.approverRole,
    createdAt: action.createdAt.toISOString(),
    checkedAt: toIsoString(action.checkedAt),
    approvedAt: toIsoString(action.approvedAt),
    beforeSnapshot: action.beforeSnapshot,
    afterSnapshot: action.afterSnapshot,
    deltaSnapshot: action.deltaSnapshot,
  };
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

async function assertNoActiveAction(
  tx: Tx,
  subjectKey: string,
  actionKind: SalaryConfirmationActionKind,
): Promise<void> {
  const [existing] = await tx.select({ id: s.governanceActions.id })
    .from(s.governanceActions)
    .where(and(
      eq(s.governanceActions.subjectType, SALARY_CONFIRMATION_SUBJECT_TYPE),
      eq(s.governanceActions.subjectKey, subjectKey),
      eq(s.governanceActions.actionKind, actionKind),
      inArray(s.governanceActions.status, ACTIVE_STATUSES),
    ))
    .orderBy(desc(s.governanceActions.id))
    .limit(1);

  if (existing) {
    throw new ApiError(409, 'Đang có yêu cầu cùng loại chờ xử lý cho bảng công và lương này');
  }
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
    driverId,
    year,
    month,
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
}) {
  assertCanMakeGovernanceAction(SALARY_CONFIRM_ACTION_KIND, input.actorRole);
  const subjectKey = toSubjectKey(input.driverId, input.year, input.month);
  const periodKey = toPeriodKey(input.year, input.month);
  const reason = input.reason?.trim() || `Đề nghị xác nhận bảng công và lương kỳ ${periodKey}`;

  return db.transaction(async (tx) => {
    await assertPeriodStillEditable(tx, input.year, input.month);
    await assertNoActiveAction(tx, subjectKey, SALARY_CONFIRM_ACTION_KIND);

    const snapshot = await buildSnapshot(tx, input.driverId, input.year, input.month);
    if (snapshot.confirmation?.status === 'CONFIRMED') {
      throw new ApiError(409, 'Bảng công và lương này đã được xác nhận');
    }

    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: SALARY_CONFIRMATION_SUBJECT_TYPE,
      subjectKey,
      actionKind: SALARY_CONFIRM_ACTION_KIND,
      status: 'PENDING_CHECK',
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
    }).returning();

    return toGovernanceActionView(action);
  });
}

export async function checkSalaryConfirmation(input: {
  driverId: number;
  year: number;
  month: number;
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
}) {
  const action = await checkGovernanceAction({
    actionId: input.actionId,
    checkerId: input.actorId,
    checkerRole: input.actorRole,
    expectedVersion: input.expectedVersion,
  });
  assertSalaryConfirmationAction(
    action,
    input.driverId,
    input.year,
    input.month,
    SALARY_CONFIRM_ACTION_KIND,
  );
  return toGovernanceActionView(action);
}

export async function approveSalaryConfirmation(input: {
  driverId: number;
  year: number;
  month: number;
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
}) {
  const action = await approveGovernanceActionWithAdapter({
    actionId: input.actionId,
    approverId: input.actorId,
    approverRole: input.actorRole,
    expectedVersion: input.expectedVersion,
    apply: async (tx, governanceAction): Promise<GovernanceApplyResult> => {
      assertSalaryConfirmationAction(
        governanceAction,
        input.driverId,
        input.year,
        input.month,
        SALARY_CONFIRM_ACTION_KIND,
      );
      await assertPeriodStillEditable(tx, input.year, input.month);
      await assertSnapshotUnchanged(tx, governanceAction, input.driverId, input.year, input.month);
      const result = await confirmSalary(
        input.driverId,
        input.year,
        input.month,
        input.actorId,
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
    },
  });
  assertSalaryConfirmationAction(
    action,
    input.driverId,
    input.year,
    input.month,
    SALARY_CONFIRM_ACTION_KIND,
  );
  return toGovernanceActionView(action);
}

export async function requestSalaryReopen(input: {
  driverId: number;
  year: number;
  month: number;
  actorId: number;
  actorRole: string;
  reason: string;
}) {
  assertCanMakeGovernanceAction(SALARY_REOPEN_ACTION_KIND, input.actorRole);
  const subjectKey = toSubjectKey(input.driverId, input.year, input.month);
  const reason = requireReopenReason(input.reason);

  return db.transaction(async (tx) => {
    await assertPeriodStillEditable(tx, input.year, input.month);
    await assertNoActiveAction(tx, subjectKey, SALARY_REOPEN_ACTION_KIND);

    const snapshot = await buildSnapshot(tx, input.driverId, input.year, input.month);
    if (snapshot.confirmation?.status !== 'CONFIRMED') {
      throw new ApiError(409, 'Bảng công và lương này chưa được xác nhận để mở lại');
    }

    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: SALARY_CONFIRMATION_SUBJECT_TYPE,
      subjectKey,
      actionKind: SALARY_REOPEN_ACTION_KIND,
      status: 'PENDING_CHECK',
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
    }).returning();

    return toGovernanceActionView(action);
  });
}

export async function checkSalaryReopen(input: {
  driverId: number;
  year: number;
  month: number;
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
}) {
  const action = await checkGovernanceAction({
    actionId: input.actionId,
    checkerId: input.actorId,
    checkerRole: input.actorRole,
    expectedVersion: input.expectedVersion,
  });
  assertSalaryConfirmationAction(
    action,
    input.driverId,
    input.year,
    input.month,
    SALARY_REOPEN_ACTION_KIND,
  );
  return toGovernanceActionView(action);
}

export async function approveSalaryReopen(input: {
  driverId: number;
  year: number;
  month: number;
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
}) {
  const action = await approveGovernanceActionWithAdapter({
    actionId: input.actionId,
    approverId: input.actorId,
    approverRole: input.actorRole,
    expectedVersion: input.expectedVersion,
    apply: async (tx, governanceAction): Promise<GovernanceApplyResult> => {
      assertSalaryConfirmationAction(
        governanceAction,
        input.driverId,
        input.year,
        input.month,
        SALARY_REOPEN_ACTION_KIND,
      );
      await assertPeriodStillEditable(tx, input.year, input.month);
      await assertSnapshotUnchanged(tx, governanceAction, input.driverId, input.year, input.month);
      const result = await unconfirmSalary(
        input.driverId,
        input.year,
        input.month,
        tx,
      );
      return {
        applicationResult: {
          status: result.salary.confirmationStatus,
          confirmedBy: result.salary.confirmedBy,
          confirmedAt: result.salary.confirmedAt,
        },
      };
    },
  });
  assertSalaryConfirmationAction(
    action,
    input.driverId,
    input.year,
    input.month,
    SALARY_REOPEN_ACTION_KIND,
  );
  return toGovernanceActionView(action);
}
