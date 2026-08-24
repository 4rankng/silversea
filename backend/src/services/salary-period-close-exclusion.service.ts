// Driver exclusions from a salary period: the maker-checker-approver flow plus
// the explicit follow-up completion. Extracted from salary-period-close.service.ts
// verbatim (pure code movement).
import { db } from '../db';
import * as s from '../db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { Role, FINANCIAL_ROLES } from '@tingting/shared';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import {
  SALARY_EXCLUSION_SUBJECT_TYPE,
  SALARY_EXCLUSION_ACTION_KIND,
  type SalaryPeriodApprovedExclusion,
  type SalaryPeriodExclusionResult,
  type SalaryExclusionHandlingMode,
  parsePeriod,
  exclusionSubjectKey,
  parseExclusion,
  normalizeExclusionHandling,
  loadApprovedExclusionMap,
  buildSalaryPeriodReadinessSummary,
} from './salary-period-close-shared.service';

export async function listSalaryPeriodExclusions(period: string): Promise<SalaryPeriodApprovedExclusion[]> {
  parsePeriod(period);
  const exclusions = await loadApprovedExclusionMap(db, period);
  return [...exclusions.values()].sort((left, right) => left.driverId - right.driverId);
}

export async function createSalaryPeriodExclusion(input: {
  period: string;
  driverId: number;
  actorId: number;
  actorRole: string;
  reason: string;
  handlingMode: SalaryExclusionHandlingMode;
  targetPeriod?: string | null;
  note?: string | null;
  transaction?: Tx;
}): Promise<SalaryPeriodExclusionResult> {
  if (!(FINANCIAL_ROLES as readonly string[]).includes(input.actorRole)) {
    throw new ApiError(403, 'Bạn không có quyền đề nghị loại trừ kỳ lương');
  }
  parsePeriod(input.period);
  const handling = normalizeExclusionHandling(input);

  const execute = async (tx: Tx): Promise<SalaryPeriodExclusionResult> => {
    const readiness = await buildSalaryPeriodReadinessSummary(tx, input.period);
    const driver = readiness.drivers.find((item) => item.driverId === input.driverId);
    if (!driver) {
      throw new ApiError(404, `Không tìm thấy lái xe đã chọn trong phạm vi kỳ lương ${input.period}`);
    }
    if (driver.issues.length === 0) {
      throw new ApiError(409, `Lái xe ${driver.driverName} đã sẵn sàng, không cần loại trừ khỏi kỳ ${input.period}`);
    }

    const [created] = await tx.insert(s.governanceActions).values({
      subjectType: SALARY_EXCLUSION_SUBJECT_TYPE,
      subjectKey: exclusionSubjectKey(input.period, input.driverId),
      actionKind: SALARY_EXCLUSION_ACTION_KIND,
      status: 'PENDING_CHECK',
      reason: input.reason.trim(),
      originalVersion: 1,
      beforeSnapshot: {
        period: input.period,
        driverId: input.driverId,
        driverName: driver.driverName,
        readinessStatus: driver.status,
        issues: driver.issues,
      },
      afterSnapshot: {
        handlingMode: handling.handlingMode,
        targetPeriod: handling.targetPeriod,
        note: handling.note,
      },
      makerId: input.actorId,
      makerRole: input.actorRole,
    }).returning();

    return {
      actionId: created.id,
      version: created.version,
      period: input.period,
      driverId: input.driverId,
      status: 'PENDING_CHECK',
      handlingMode: handling.handlingMode,
      targetPeriod: handling.targetPeriod,
      reason: created.reason,
      note: handling.note,
      makerId: created.makerId,
      checkerId: null,
      approverId: null,
      followupStatus: null,
      followupCompletedAt: null,
    };
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

export async function checkSalaryPeriodExclusion(input: {
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion?: number | null;
  note?: string | null;
  transaction?: Tx;
}): Promise<SalaryPeriodExclusionResult> {
  if (!(FINANCIAL_ROLES as readonly string[]).includes(input.actorRole)) {
    throw new ApiError(403, 'Bạn không có quyền kiểm tra loại trừ kỳ lương');
  }
  if (input.expectedVersion != null && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }

  const execute = async (tx: Tx): Promise<SalaryPeriodExclusionResult> => {
    const [existing] = await tx.select().from(s.governanceActions)
      .where(eq(s.governanceActions.id, input.actionId))
      .limit(1);
    if (!existing ||
      existing.subjectType !== SALARY_EXCLUSION_SUBJECT_TYPE ||
      existing.actionKind !== SALARY_EXCLUSION_ACTION_KIND) {
      throw new ApiError(404, 'Không tìm thấy đề nghị loại trừ đã chọn');
    }
    if (input.expectedVersion != null && existing.version !== input.expectedVersion) {
      throw new ApiError(409, 'Đề nghị loại trừ đã được cập nhật. Vui lòng tải lại.');
    }
    if (existing.makerId === input.actorId) {
      throw new ApiError(409, 'Người đề nghị không được tự kiểm tra loại trừ kỳ lương của mình');
    }
    if (existing.status !== 'PENDING_CHECK') {
      throw new ApiError(409, `Đề nghị loại trừ đang ở trạng thái ${existing.status}, không thể kiểm tra tiếp`);
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
        input.expectedVersion != null
          ? eq(s.governanceActions.version, input.expectedVersion)
          : undefined,
      ))
      .returning();
    if (!updated) {
      throw new ApiError(409, 'Đề nghị loại trừ đã được người khác xử lý. Vui lòng tải lại.');
    }

    const afterSnapshot = updated!.afterSnapshot as Record<string, unknown> | null;
    const parsed = parseExclusion(afterSnapshot);
    const [period, driverIdRaw] = (updated!.subjectKey ?? '').split(':');

    return {
      actionId: updated!.id,
      version: updated!.version,
      period,
      driverId: Number(driverIdRaw),
      status: 'PENDING_APPROVAL',
      handlingMode: parsed.handlingMode,
      targetPeriod: parsed.targetPeriod,
      reason: updated!.reason,
      note: parsed.note,
      makerId: updated!.makerId,
      checkerId: updated!.checkerId,
      approverId: updated!.approverId,
      followupStatus: null,
      followupCompletedAt: null,
    };
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

export async function approveSalaryPeriodExclusion(input: {
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion?: number | null;
  transaction?: Tx;
}): Promise<SalaryPeriodExclusionResult> {
  if (input.actorRole !== Role.ADMIN && input.actorRole !== Role.MANAGER) {
    throw new ApiError(403, 'Bạn không có quyền phê duyệt loại trừ kỳ lương');
  }
  if (input.expectedVersion != null && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }

  const execute = async (tx: Tx): Promise<SalaryPeriodExclusionResult> => {
    const [existing] = await tx.select().from(s.governanceActions)
      .where(eq(s.governanceActions.id, input.actionId))
      .limit(1);
    if (!existing ||
      existing.subjectType !== SALARY_EXCLUSION_SUBJECT_TYPE ||
      existing.actionKind !== SALARY_EXCLUSION_ACTION_KIND) {
      throw new ApiError(404, 'Không tìm thấy đề nghị loại trừ đã chọn');
    }
    if (input.expectedVersion != null && existing.version !== input.expectedVersion) {
      throw new ApiError(409, 'Đề nghị loại trừ đã được cập nhật. Vui lòng tải lại.');
    }
    if (existing.makerId === input.actorId || existing.checkerId === input.actorId) {
      throw new ApiError(409, 'Loại trừ kỳ lương phải được phê duyệt bởi người khác với người đề nghị và người kiểm tra');
    }
    if (existing.status !== 'PENDING_APPROVAL') {
      throw new ApiError(409, `Đề nghị loại trừ đang ở trạng thái ${existing.status}, không thể phê duyệt tiếp`);
    }

    const [updated] = await tx.update(s.governanceActions)
      .set({
        status: 'APPROVED',
        approverId: input.actorId,
        approverRole: input.actorRole,
        approvedAt: new Date(),
        applicationResult: {
          followupStatus: 'PENDING',
          handlingMode: parseExclusion(existing.afterSnapshot as Record<string, unknown> | null).handlingMode,
          targetPeriod: parseExclusion(existing.afterSnapshot as Record<string, unknown> | null).targetPeriod,
        },
        version: sql`${s.governanceActions.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(s.governanceActions.id, existing.id),
        eq(s.governanceActions.status, 'PENDING_APPROVAL'),
        input.expectedVersion != null
          ? eq(s.governanceActions.version, input.expectedVersion)
          : undefined,
      ))
      .returning();
    if (!updated) {
      throw new ApiError(409, 'Đề nghị loại trừ đã được người khác xử lý. Vui lòng tải lại.');
    }

    const afterSnapshot = updated!.afterSnapshot as Record<string, unknown> | null;
    const parsed = parseExclusion(afterSnapshot);
    const [period, driverIdRaw] = (updated!.subjectKey ?? '').split(':');

    return {
      actionId: updated!.id,
      version: updated!.version,
      period,
      driverId: Number(driverIdRaw),
      status: 'APPROVED',
      handlingMode: parsed.handlingMode,
      targetPeriod: parsed.targetPeriod,
      reason: updated!.reason,
      note: parsed.note,
      makerId: updated!.makerId,
      checkerId: updated!.checkerId,
      approverId: updated!.approverId,
      followupStatus: 'PENDING',
      followupCompletedAt: null,
    };
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

/**
 * Complete the explicit follow-up created by an approved exclusion.
 *
 * Supplementary handling is complete only when that driver is READY in the
 * declared target period. Adjustment handling is complete only after an
 * approved salary adjustment exists for the same source period and driver.
 * This keeps an excluded driver visible as pending instead of silently
 * disappearing after the main period closes.
 */
export async function completeSalaryPeriodExclusionFollowup(input: {
  actionId: number;
  actorId: number;
  actorRole: string;
  transaction?: Tx;
}): Promise<SalaryPeriodExclusionResult> {
  if (input.actorRole !== Role.ADMIN && input.actorRole !== Role.MANAGER) {
    throw new ApiError(403, 'Bạn không có quyền hoàn tất xử lý lương bổ sung');
  }

  const execute = async (tx: Tx): Promise<SalaryPeriodExclusionResult> => {
    const [existing] = await tx.select().from(s.governanceActions)
      .where(eq(s.governanceActions.id, input.actionId))
      .limit(1)
      .for('update');
    if (
      !existing
      || existing.subjectType !== SALARY_EXCLUSION_SUBJECT_TYPE
      || existing.actionKind !== SALARY_EXCLUSION_ACTION_KIND
    ) {
      throw new ApiError(404, 'Không tìm thấy đề nghị loại trừ đã chọn');
    }
    if (existing.status !== 'APPROVED') {
      throw new ApiError(409, 'Chỉ có thể hoàn tất xử lý cho loại trừ đã được phê duyệt');
    }

    const [sourcePeriod, driverIdRaw] = (existing.subjectKey ?? '').split(':');
    const driverId = Number(driverIdRaw);
    const parsed = parseExclusion(existing.afterSnapshot as Record<string, unknown> | null);
    const existingResult = existing.applicationResult as Record<string, unknown> | null;
    if (!sourcePeriod || !Number.isInteger(driverId) || driverId < 1) {
      throw new ApiError(409, 'Đề nghị loại trừ không có định danh kỳ và lái xe hợp lệ');
    }
    // First completion is authoritative. A replay returns the persisted result
    // without rewriting its actor or timestamp.
    if (existingResult?.followupStatus === 'COMPLETED') {
        return {
          actionId: existing.id,
          version: existing.version,
          period: sourcePeriod,
        driverId,
        status: 'APPROVED',
        handlingMode: parsed.handlingMode,
        targetPeriod: parsed.targetPeriod,
        reason: existing.reason,
        note: parsed.note,
        makerId: existing.makerId,
        checkerId: existing.checkerId,
        approverId: existing.approverId,
        followupStatus: 'COMPLETED',
        followupCompletedAt: typeof existingResult.followupCompletedAt === 'string'
          ? existingResult.followupCompletedAt
          : null,
      };
    }

    if (parsed.handlingMode === 'SUPPLEMENTARY_PERIOD') {
      if (!parsed.targetPeriod || parsed.targetPeriod === sourcePeriod) {
        throw new ApiError(409, 'Kỳ bổ sung phải là một kỳ khác kỳ lương gốc');
      }
      const targetReadiness = await buildSalaryPeriodReadinessSummary(tx, parsed.targetPeriod);
      const targetDriver = targetReadiness.drivers.find((driver) => driver.driverId === driverId);
      if (!targetDriver || targetDriver.status !== 'READY' || targetDriver.exclusion != null) {
        throw new ApiError(409, 'Lái xe chưa sẵn sàng trong kỳ lương bổ sung đã khai báo');
      }
    } else {
      const [adjustment] = await tx.select({ id: s.salaryPeriodAdjustments.id })
        .from(s.salaryPeriodAdjustments)
        .where(and(
          eq(s.salaryPeriodAdjustments.sourcePeriod, sourcePeriod),
          eq(s.salaryPeriodAdjustments.driverId, driverId),
        ))
        .limit(1);
      if (!adjustment) {
        throw new ApiError(409, 'Chưa có khoản điều chỉnh đã duyệt cho lái xe và kỳ lương gốc');
      }
    }

    const completedAt = new Date().toISOString();
    const [updated] = await tx.update(s.governanceActions)
      .set({
        applicationResult: {
          followupStatus: 'COMPLETED',
          followupCompletedAt: completedAt,
          followupCompletedBy: input.actorId,
          handlingMode: parsed.handlingMode,
          targetPeriod: parsed.targetPeriod,
        },
        version: sql`${s.governanceActions.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(s.governanceActions.id, existing.id),
        eq(s.governanceActions.version, existing.version),
      ))
      .returning();
    if (!updated) {
      throw new ApiError(409, 'Xử lý bổ sung đã được cập nhật bởi người khác');
    }

    return {
      actionId: updated.id,
      version: updated.version,
      period: sourcePeriod,
      driverId,
      status: 'APPROVED',
      handlingMode: parsed.handlingMode,
      targetPeriod: parsed.targetPeriod,
      reason: updated.reason,
      note: parsed.note,
      makerId: updated.makerId,
      checkerId: updated.checkerId,
      approverId: updated.approverId,
      followupStatus: 'COMPLETED',
      followupCompletedAt: completedAt,
    };
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}
