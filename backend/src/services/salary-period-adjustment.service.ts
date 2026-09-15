import { FINANCIAL_ROLES } from '@tingting/shared';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { LedgerService } from './ledger.service';
import {
  applyGovernanceActionDirect,
  buildGovernanceAction,
  type GovernanceApplyAdapter,
  type GovernanceApplyResult,
} from './governance-action-core.service';
import {
  getClosedPeriodLock,
  resolveSalaryPeriodAuthority,
} from './period-lock.service';
import type { Tx } from './trip-shared';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const CLOSE_ENTITY_TYPE = 'SALARY_PERIOD_CLOSE';
const ADJUSTMENT_SUBJECT_TYPE = 'SALARY_PERIOD';
const ADJUSTMENT_ACTION_KIND = 'SALARY_PERIOD_ADJUSTMENT';

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

interface ParsedAdjustmentSnapshot {
  sourcePeriod: string;
  targetPeriod: string;
  driverId: number;
  amount: number;
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

// Post-close adjustments persist directly in salary_period_adjustments.
export interface SalaryPeriodAdjustmentItem {
  adjustmentId: number;
  sourcePeriod: string;
  targetPeriod: string;
  driverId: number;
  driverName: string;
  amount: number;
  reason: string;
  approvedBy: number;
  approvedByName: string | null;
  createdAt: string;
  approvedAt: string;
  relationship: 'SOURCE' | 'TARGET';
}

export interface SalaryPeriodAdjustmentResult {
  adjustmentId: number;
  sourcePeriod: string;
  targetPeriod: string;
  driverId: number;
  amount: number;
  reason: string;
  approvedBy: number;
  approvedAt: string;
}

/**
 * Governed apply for the post-close adjustment: persists the durable row from
 * the transient evidence envelope (q18 locked-entity manifest contract).
 */
const applySalaryPeriodAdjustmentAction: GovernanceApplyAdapter = async (tx, action) => {
  const parsed = parseAdjustmentSubject(
    action.subjectKey,
    action.afterSnapshot as Record<string, unknown> | null,
  );
  const approvedAt = new Date();
  const [adjustment] = await tx.insert(s.salaryPeriodAdjustments).values({
    sourcePeriod: parsed.sourcePeriod,
    targetPeriod: parsed.targetPeriod,
    driverId: parsed.driverId,
    amount: String(parsed.amount),
    reason: action.reason ?? '',
    approvedBy: action.approverId ?? action.makerId,
    approvedAt,
  }).returning();
  return {
    ledgerEntryId: null,
    applicationResult: {
      adjustmentId: adjustment.id,
      approvedAt: approvedAt.toISOString(),
    },
  } satisfies GovernanceApplyResult;
};

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

    // q18 evidence contract: the governed request carries the full transient
    // envelope (reason + before/after snapshots + maker) and rides the
    // check + approve policy stages before the durable row is written.
    const requested = buildGovernanceAction({
      subjectType: ADJUSTMENT_SUBJECT_TYPE,
      subjectKey: toAdjustmentSubjectKey(input.sourcePeriod, input.targetPeriod, input.driverId),
      actionKind: ADJUSTMENT_ACTION_KIND,
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
    });
    const { action } = await applyGovernanceActionDirect({
      action: requested,
      actorId: input.actorId,
      actorRole: input.actorRole,
      apply: applySalaryPeriodAdjustmentAction,
      transaction: tx,
    });

    const applied = (action.applicationResult ?? {}) as Record<string, unknown>;
    return {
      adjustmentId: Number(applied.adjustmentId),
      sourcePeriod: input.sourcePeriod,
      targetPeriod: input.targetPeriod,
      driverId: input.driverId,
      amount,
      reason,
      approvedBy: input.actorId,
      approvedAt: String(applied.approvedAt ?? new Date().toISOString()),
    };
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

  const rows = await db.select().from(s.salaryPeriodAdjustments)
    .where(or(
      eq(s.salaryPeriodAdjustments.sourcePeriod, input.period),
      eq(s.salaryPeriodAdjustments.targetPeriod, input.period),
    ))
    .orderBy(desc(s.salaryPeriodAdjustments.createdAt), desc(s.salaryPeriodAdjustments.id));

  const driverIds = [...new Set(rows.map((row) => row.driverId))];
  const userIds = [...new Set(rows.map((row) => row.approvedBy))];
  const [driverNames, userNames] = await Promise.all([
    getDriverNameMap(driverIds),
    getUserNameMap(userIds),
  ]);

  return rows.map((row) => ({
    adjustmentId: row.id,
    sourcePeriod: row.sourcePeriod,
    targetPeriod: row.targetPeriod,
    driverId: row.driverId,
    driverName: driverNames.get(row.driverId) ?? 'Lái xe chưa xác định',
    amount: Number(row.amount),
    reason: row.reason,
    approvedBy: row.approvedBy,
    approvedByName: userNames.get(row.approvedBy) ?? null,
    createdAt: row.createdAt.toISOString(),
    approvedAt: row.approvedAt.toISOString(),
    relationship: row.sourcePeriod === input.period
      ? ('SOURCE' as const)
      : ('TARGET' as const),
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
