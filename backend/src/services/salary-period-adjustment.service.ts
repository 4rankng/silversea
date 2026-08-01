import { FINANCIAL_ROLES } from '@tingting/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { LedgerService } from './ledger.service';
import {
  getClosedPeriodLock,
  resolveSalaryPeriodAuthority,
} from './period-lock.service';
import type { Tx } from './trip-shared';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const CLOSE_ENTITY_TYPE = 'SALARY_PERIOD_CLOSE';
const ADJUSTMENT_SUBJECT_TYPE = 'SALARY_PERIOD';
const ADJUSTMENT_ACTION_KIND = 'SALARY_PERIOD_ADJUSTMENT';

type SalaryAdjustmentStatus = 'PENDING_CHECK' | 'PENDING_APPROVAL' | 'APPROVED';

export interface SalaryPeriodAdjustmentItem {
  actionId: number;
  adjustmentId: number | null;
  version: number;
  sourcePeriod: string;
  targetPeriod: string;
  driverId: number;
  driverName: string;
  amount: number;
  reason: string;
  status: SalaryAdjustmentStatus;
  makerId: number;
  makerName: string | null;
  checkerId: number | null;
  checkerName: string | null;
  approverId: number | null;
  approverName: string | null;
  createdAt: string;
  approvedAt: string | null;
  relationship: 'SOURCE' | 'TARGET';
}

export interface SalaryPeriodAdjustmentResult {
  actionId: number;
  adjustmentId: number | null;
  version: number;
  sourcePeriod: string;
  targetPeriod: string;
  driverId: number;
  amount: number;
  reason: string;
  status: SalaryAdjustmentStatus;
  makerId: number;
  checkerId: number | null;
  approverId: number | null;
}

interface ParsedAdjustmentSnapshot {
  sourcePeriod: string;
  targetPeriod: string;
  driverId: number;
  amount: number;
}

function parsePeriod(period: string): void {
  if (!PERIOD_PATTERN.test(period)) {
    throw new ApiError(400, `Kỳ lương không hợp lệ (nhận "${period}", phải dạng YYYY-MM)`);
  }
}

function periodLockKey(period: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < period.length; i += 1) {
    h ^= period.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 0x7fffffff;
}

function requireReason(reason: string): string {
  const normalized = reason.trim();
  if (!normalized) {
    throw new ApiError(400, 'Lý do điều chỉnh là bắt buộc');
  }
  return normalized;
}

function requireExpectedVersion(expectedVersion: number): void {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }
}

function requireAmount(amount: number): number {
  if (!Number.isFinite(amount) || amount === 0) {
    throw new ApiError(400, 'Số tiền điều chỉnh phải khác 0');
  }
  if (!Number.isInteger(amount)) {
    throw new ApiError(400, 'Số tiền điều chỉnh phải là số nguyên VND');
  }
  return amount;
}

function parseAdjustmentSubject(
  subjectKey: string | null,
  afterSnapshot: Record<string, unknown> | null | undefined,
): ParsedAdjustmentSnapshot {
  const [sourcePeriodFromKey, targetPeriodFromKey, driverIdRaw] = (subjectKey ?? '').split(':');
  const sourcePeriod = typeof afterSnapshot?.sourcePeriod === 'string'
    ? afterSnapshot.sourcePeriod
    : sourcePeriodFromKey;
  const targetPeriod = typeof afterSnapshot?.targetPeriod === 'string'
    ? afterSnapshot.targetPeriod
    : targetPeriodFromKey;
  const driverId = Number(afterSnapshot?.driverId ?? driverIdRaw);
  const amount = Number(afterSnapshot?.amount ?? 0);

  parsePeriod(sourcePeriod);
  parsePeriod(targetPeriod);
  if (!Number.isInteger(driverId) || driverId < 1) {
    throw new ApiError(409, 'Yêu cầu điều chỉnh kỳ lương thiếu lái xe hợp lệ');
  }
  if (!Number.isFinite(amount) || amount === 0) {
    throw new ApiError(409, 'Yêu cầu điều chỉnh kỳ lương thiếu số tiền hợp lệ');
  }

  return { sourcePeriod, targetPeriod, driverId, amount };
}

function toAdjustmentSubjectKey(sourcePeriod: string, targetPeriod: string, driverId: number): string {
  return `${sourcePeriod}:${targetPeriod}:${driverId}`;
}

async function lockPeriods(tx: Tx, periods: string[]): Promise<void> {
  for (const period of [...new Set(periods)].sort()) {
    await LedgerService.lockEntity(tx, CLOSE_ENTITY_TYPE, periodLockKey(period));
  }
}

async function assertTargetPeriodOpen(tx: Tx, targetPeriod: string): Promise<void> {
  const authority = await resolveSalaryPeriodAuthority(targetPeriod);
  const closedLock = await getClosedPeriodLock(tx, authority);
  if (closedLock) {
    throw new ApiError(
      409,
      `Kỳ đích ${targetPeriod} đã khóa. Chỉ được nhận điều chỉnh vào kỳ lương đang mở.`,
    );
  }

  const [targetClose] = await tx.select({
    status: s.salaryPeriodCloses.status,
  }).from(s.salaryPeriodCloses)
    .where(eq(s.salaryPeriodCloses.period, targetPeriod))
    .limit(1);

  if (targetClose?.status === 'CLOSED') {
    throw new ApiError(
      409,
      `Kỳ đích ${targetPeriod} đã chốt. Chỉ được nhận điều chỉnh vào kỳ lương đang mở.`,
    );
  }
}

async function getSourceCloseForWrite(tx: Tx, period: string) {
  const [closeRow] = await tx.select()
    .from(s.salaryPeriodCloses)
    .where(eq(s.salaryPeriodCloses.period, period))
    .limit(1)
    .for('update');

  if (!closeRow || closeRow.status !== 'CLOSED') {
    throw new ApiError(
      409,
      `Kỳ nguồn ${period} chưa ở trạng thái đã chốt cố định, không thể tạo điều chỉnh hậu chốt.`,
    );
  }

  return closeRow;
}

async function getDriverNameMap(driverIds: number[]): Promise<Map<number, string>> {
  if (driverIds.length === 0) {
    return new Map();
  }
  const rows = await db.select({
    id: s.drivers.id,
    name: s.drivers.name,
  }).from(s.drivers)
    .where(inArray(s.drivers.id, driverIds));
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function getUserNameMap(userIds: number[]): Promise<Map<number, string | null>> {
  if (userIds.length === 0) {
    return new Map();
  }
  const rows = await db.select({
    id: s.users.id,
    name: s.users.fullName,
  }).from(s.users)
    .where(inArray(s.users.id, userIds));
  return new Map(rows.map((row) => [row.id, row.name ?? null]));
}

function buildResult(
  action: typeof s.governanceActions.$inferSelect,
): SalaryPeriodAdjustmentResult {
  const parsed = parseAdjustmentSubject(
    action.subjectKey,
    action.afterSnapshot as Record<string, unknown> | null,
  );
  const applicationResult = action.applicationResult as Record<string, unknown> | null;
  const adjustmentId = Number(applicationResult?.adjustmentId ?? 0);
  return {
    actionId: action.id,
    adjustmentId: Number.isInteger(adjustmentId) && adjustmentId > 0 ? adjustmentId : null,
    version: action.version,
    sourcePeriod: parsed.sourcePeriod,
    targetPeriod: parsed.targetPeriod,
    driverId: parsed.driverId,
    amount: parsed.amount,
    reason: action.reason,
    status: action.status as SalaryAdjustmentStatus,
    makerId: action.makerId,
    checkerId: action.checkerId,
    approverId: action.approverId,
  };
}

export async function requestSalaryPeriodAdjustment(input: {
  sourcePeriod: string;
  targetPeriod: string;
  driverId: number;
  amount: number;
  reason: string;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
  transaction?: Tx;
}): Promise<SalaryPeriodAdjustmentResult> {
  if (!(FINANCIAL_ROLES as readonly string[]).includes(input.actorRole)) {
    throw new ApiError(403, 'Bạn không có quyền tạo điều chỉnh hậu chốt');
  }

  parsePeriod(input.sourcePeriod);
  parsePeriod(input.targetPeriod);
  if (input.sourcePeriod === input.targetPeriod) {
    throw new ApiError(400, 'Kỳ nguồn và kỳ đích không được trùng nhau');
  }
  if (!Number.isInteger(input.driverId) || input.driverId < 1) {
    throw new ApiError(400, 'driverId không hợp lệ');
  }

  const reason = requireReason(input.reason);
  const amount = requireAmount(input.amount);
  requireExpectedVersion(input.expectedVersion);

  const execute = async (tx: Tx) => {
    await lockPeriods(tx, [input.sourcePeriod, input.targetPeriod]);
    const sourceClose = await getSourceCloseForWrite(tx, input.sourcePeriod);
    if (sourceClose.version !== input.expectedVersion) {
      throw new ApiError(409, 'Kỳ nguồn đã thay đổi. Vui lòng tải lại trước khi tạo điều chỉnh.');
    }

    await assertTargetPeriodOpen(tx, input.targetPeriod);

    const [driver] = await tx.select({
      id: s.drivers.id,
      name: s.drivers.name,
    }).from(s.drivers)
      .where(eq(s.drivers.id, input.driverId))
      .limit(1);
    if (!driver) {
      throw new ApiError(404, 'Không tìm thấy lái xe đã chọn');
    }

    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: ADJUSTMENT_SUBJECT_TYPE,
      subjectKey: toAdjustmentSubjectKey(input.sourcePeriod, input.targetPeriod, input.driverId),
      actionKind: ADJUSTMENT_ACTION_KIND,
      status: 'PENDING_CHECK',
      reason,
      originalVersion: sourceClose.version,
      beforeSnapshot: {
        sourcePeriod: input.sourcePeriod,
        sourceStatus: sourceClose.status,
        sourceVersion: sourceClose.version,
        sourcePayslipIssuedAt: sourceClose.payslipIssuedAt?.toISOString() ?? null,
        sourceOfficialPostedAt: sourceClose.officialPostedAt?.toISOString() ?? null,
      },
      afterSnapshot: {
        sourcePeriod: input.sourcePeriod,
        targetPeriod: input.targetPeriod,
        driverId: input.driverId,
        driverName: driver.name,
        amount,
      },
      deltaSnapshot: {
        amount,
      },
      makerId: input.actorId,
      makerRole: input.actorRole,
    }).returning();

    return buildResult(action);
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

export async function checkSalaryPeriodAdjustment(input: {
  period: string;
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
  transaction?: Tx;
}): Promise<SalaryPeriodAdjustmentResult> {
  if (!(FINANCIAL_ROLES as readonly string[]).includes(input.actorRole)) {
    throw new ApiError(403, 'Bạn không có quyền kiểm tra điều chỉnh hậu chốt');
  }
  parsePeriod(input.period);
  requireExpectedVersion(input.expectedVersion);

  const execute = async (tx: Tx) => {
    const [existing] = await tx.select()
      .from(s.governanceActions)
      .where(eq(s.governanceActions.id, input.actionId))
      .limit(1)
      .for('update');

    if (
      !existing ||
      existing.subjectType !== ADJUSTMENT_SUBJECT_TYPE ||
      existing.actionKind !== ADJUSTMENT_ACTION_KIND
    ) {
      throw new ApiError(404, 'Không tìm thấy điều chỉnh hậu chốt đã chọn');
    }
    const parsed = parseAdjustmentSubject(
      existing.subjectKey,
      existing.afterSnapshot as Record<string, unknown> | null,
    );
    if (parsed.sourcePeriod !== input.period) {
      throw new ApiError(
        404,
        `Không tìm thấy điều chỉnh hậu chốt của kỳ ${input.period}`,
      );
    }
    if (existing.version !== input.expectedVersion) {
      throw new ApiError(409, 'Điều chỉnh hậu chốt đã được cập nhật. Vui lòng tải lại.');
    }
    if (existing.makerId === input.actorId) {
      throw new ApiError(409, 'Người tạo điều chỉnh không được tự kiểm tra yêu cầu của mình');
    }
    if (existing.status !== 'PENDING_CHECK') {
      throw new ApiError(
        409,
        `Điều chỉnh hậu chốt đang ở trạng thái ${existing.status}, không thể kiểm tra tiếp`,
      );
    }

    const [updated] = await tx.update(s.governanceActions)
      .set({
        status: 'PENDING_APPROVAL',
        checkerId: input.actorId,
        checkerRole: input.actorRole,
        checkedAt: new Date(),
        version: sql`${s.governanceActions.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(s.governanceActions.id, existing.id),
        eq(s.governanceActions.status, 'PENDING_CHECK'),
        eq(s.governanceActions.version, input.expectedVersion),
      ))
      .returning();
    if (!updated) {
      throw new ApiError(409, 'Điều chỉnh hậu chốt đã được người khác xử lý. Vui lòng tải lại.');
    }

    return buildResult(updated);
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

export async function approveSalaryPeriodAdjustment(input: {
  period: string;
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
  transaction?: Tx;
}): Promise<SalaryPeriodAdjustmentResult> {
  if (input.actorRole !== 'ADMIN' && input.actorRole !== 'MANAGER') {
    throw new ApiError(403, 'Bạn không có quyền phê duyệt điều chỉnh hậu chốt');
  }
  parsePeriod(input.period);
  requireExpectedVersion(input.expectedVersion);

  const execute = async (tx: Tx) => {
    const [existing] = await tx.select()
      .from(s.governanceActions)
      .where(eq(s.governanceActions.id, input.actionId))
      .limit(1)
      .for('update');

    if (
      !existing ||
      existing.subjectType !== ADJUSTMENT_SUBJECT_TYPE ||
      existing.actionKind !== ADJUSTMENT_ACTION_KIND
    ) {
      throw new ApiError(404, 'Không tìm thấy điều chỉnh hậu chốt đã chọn');
    }
    const parsed = parseAdjustmentSubject(
      existing.subjectKey,
      existing.afterSnapshot as Record<string, unknown> | null,
    );
    if (parsed.sourcePeriod !== input.period) {
      throw new ApiError(
        404,
        `Không tìm thấy điều chỉnh hậu chốt của kỳ ${input.period}`,
      );
    }
    if (existing.version !== input.expectedVersion) {
      throw new ApiError(409, 'Điều chỉnh hậu chốt đã được cập nhật. Vui lòng tải lại.');
    }
    if (existing.makerId === input.actorId || existing.checkerId === input.actorId) {
      throw new ApiError(409, 'Người tạo hoặc người kiểm tra không được tự phê duyệt điều chỉnh hậu chốt');
    }
    if (existing.status !== 'PENDING_APPROVAL') {
      throw new ApiError(
        409,
        `Điều chỉnh hậu chốt đang ở trạng thái ${existing.status}, không thể phê duyệt tiếp`,
      );
    }

    await lockPeriods(tx, [parsed.sourcePeriod, parsed.targetPeriod]);
    await getSourceCloseForWrite(tx, parsed.sourcePeriod);
    await assertTargetPeriodOpen(tx, parsed.targetPeriod);

    const approvedAt = new Date();
    const [adjustment] = await tx.insert(s.salaryPeriodAdjustments).values({
      governanceActionId: existing.id,
      sourcePeriod: parsed.sourcePeriod,
      targetPeriod: parsed.targetPeriod,
      driverId: parsed.driverId,
      amount: String(parsed.amount),
      reason: existing.reason,
      approvedBy: input.actorId,
      approvedAt,
    }).returning();

    const [updated] = await tx.update(s.governanceActions)
      .set({
        status: 'APPROVED',
        approverId: input.actorId,
        approverRole: input.actorRole,
        approvedAt,
        appliedAt: approvedAt,
        applicationResult: {
          adjustmentId: adjustment.id,
          sourcePeriod: parsed.sourcePeriod,
          targetPeriod: parsed.targetPeriod,
          driverId: parsed.driverId,
          amount: parsed.amount,
        },
        version: sql`${s.governanceActions.version} + 1`,
        updatedAt: approvedAt,
      })
      .where(and(
        eq(s.governanceActions.id, existing.id),
        eq(s.governanceActions.status, 'PENDING_APPROVAL'),
        eq(s.governanceActions.version, input.expectedVersion),
      ))
      .returning();
    if (!updated) {
      throw new ApiError(409, 'Điều chỉnh hậu chốt đã được người khác xử lý. Vui lòng tải lại.');
    }

    return buildResult(updated);
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

export async function listSalaryPeriodAdjustments(input: {
  period: string;
  driverId?: number | null;
}): Promise<SalaryPeriodAdjustmentItem[]> {
  parsePeriod(input.period);

  const rows = await db.select({
    id: s.governanceActions.id,
    version: s.governanceActions.version,
    subjectKey: s.governanceActions.subjectKey,
    reason: s.governanceActions.reason,
    status: s.governanceActions.status,
    makerId: s.governanceActions.makerId,
    checkerId: s.governanceActions.checkerId,
    approverId: s.governanceActions.approverId,
    createdAt: s.governanceActions.createdAt,
    approvedAt: s.governanceActions.approvedAt,
    afterSnapshot: s.governanceActions.afterSnapshot,
    applicationResult: s.governanceActions.applicationResult,
  }).from(s.governanceActions)
    .where(and(
      eq(s.governanceActions.subjectType, ADJUSTMENT_SUBJECT_TYPE),
      eq(s.governanceActions.actionKind, ADJUSTMENT_ACTION_KIND),
      inArray(s.governanceActions.status, ['PENDING_CHECK', 'PENDING_APPROVAL', 'APPROVED']),
    ))
    .orderBy(desc(s.governanceActions.createdAt), desc(s.governanceActions.id));

  const parsedRows = rows
    .map((row) => {
      try {
        const parsed = parseAdjustmentSubject(
          row.subjectKey,
          row.afterSnapshot as Record<string, unknown> | null,
        );
        if (parsed.sourcePeriod !== input.period && parsed.targetPeriod !== input.period) {
          return null;
        }
        if (input.driverId != null && parsed.driverId !== input.driverId) {
          return null;
        }
        const applicationResult = row.applicationResult as Record<string, unknown> | null;
        const adjustmentId = Number(applicationResult?.adjustmentId ?? 0);
        return {
          ...row,
          parsed,
          adjustmentId: Number.isInteger(adjustmentId) && adjustmentId > 0 ? adjustmentId : null,
          relationship: parsed.sourcePeriod === input.period ? 'SOURCE' as const : 'TARGET' as const,
        };
      } catch {
        return null;
      }
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  const driverIds = [...new Set(parsedRows.map((row) => row.parsed.driverId))];
  const userIds = [...new Set(parsedRows.flatMap((row) => [
    row.makerId,
    row.checkerId ?? null,
    row.approverId ?? null,
  ].filter((value): value is number => value != null)))];
  const [driverNames, userNames] = await Promise.all([
    getDriverNameMap(driverIds),
    getUserNameMap(userIds),
  ]);

  return parsedRows.map((row) => ({
    actionId: row.id,
    adjustmentId: row.adjustmentId,
    version: row.version,
    sourcePeriod: row.parsed.sourcePeriod,
    targetPeriod: row.parsed.targetPeriod,
    driverId: row.parsed.driverId,
    driverName: driverNames.get(row.parsed.driverId) ?? 'Lái xe chưa xác định',
    amount: row.parsed.amount,
    reason: row.reason,
    status: row.status as SalaryAdjustmentStatus,
    makerId: row.makerId,
    makerName: userNames.get(row.makerId) ?? null,
    checkerId: row.checkerId,
    checkerName: row.checkerId ? userNames.get(row.checkerId) ?? null : null,
    approverId: row.approverId,
    approverName: row.approverId ? userNames.get(row.approverId) ?? null : null,
    createdAt: row.createdAt.toISOString(),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    relationship: row.relationship,
  }));
}

export async function getSalaryPeriodAdjustmentTotals(
  period: string,
  driverIds: number[],
): Promise<Map<number, number>> {
  parsePeriod(period);
  if (driverIds.length === 0) {
    return new Map();
  }

  const rows = await db.select({
    driverId: s.salaryPeriodAdjustments.driverId,
    total: sql<string>`coalesce(sum(${s.salaryPeriodAdjustments.amount}::numeric), 0)`,
  }).from(s.salaryPeriodAdjustments)
    .where(and(
      eq(s.salaryPeriodAdjustments.targetPeriod, period),
      inArray(s.salaryPeriodAdjustments.driverId, driverIds),
    ))
    .groupBy(s.salaryPeriodAdjustments.driverId);

  return new Map(rows.map((row) => [row.driverId, Number(row.total)]));
}
