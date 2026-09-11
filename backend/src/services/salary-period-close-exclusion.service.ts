// Driver exclusions from a salary period: direct-apply creation into
// salary_period_exclusions plus the explicit follow-up completion.
import { db } from '../db';
import * as s from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { Role, FINANCIAL_ROLES } from '@tingting/shared';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import {
  type SalaryPeriodApprovedExclusion,
  type SalaryPeriodExclusionResult,
  type SalaryExclusionHandlingMode,
  parsePeriod,
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

    const [created] = await tx.insert(s.salaryPeriodExclusions).values({
      period: input.period,
      driverId: input.driverId,
      reason: input.reason.trim(),
      handlingMode: handling.handlingMode,
      targetPeriod: handling.targetPeriod,
      note: handling.note,
      requestedBy: input.actorId,
      followupStatus: 'PENDING',
    }).returning();

    return {
      actionId: created.id,
      period: input.period,
      driverId: input.driverId,
      handlingMode: handling.handlingMode,
      targetPeriod: handling.targetPeriod,
      reason: created.reason,
      note: handling.note,
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
    const [existing] = await tx.select()
      .from(s.salaryPeriodExclusions)
      .where(eq(s.salaryPeriodExclusions.id, input.actionId))
      .limit(1)
      .for('update');
    if (!existing) {
      throw new ApiError(404, 'Không tìm thấy đề nghị loại trừ đã chọn');
    }

    // First completion is authoritative. A replay returns the persisted
    // result without rewriting its actor or timestamp.
    if (existing.followupStatus === 'COMPLETED') {
      return {
        actionId: existing.id,
        period: existing.period,
        driverId: existing.driverId,
        handlingMode: existing.handlingMode as SalaryExclusionHandlingMode,
        targetPeriod: existing.targetPeriod,
        reason: existing.reason,
        note: existing.note,
        followupStatus: 'COMPLETED',
        followupCompletedAt: existing.followupCompletedAt?.toISOString() ?? null,
      };
    }

    if (existing.handlingMode === 'SUPPLEMENTARY_PERIOD') {
      if (!existing.targetPeriod || existing.targetPeriod === existing.period) {
        throw new ApiError(409, 'Kỳ bổ sung phải là một kỳ khác kỳ lương gốc');
      }
      const targetReadiness = await buildSalaryPeriodReadinessSummary(tx, existing.targetPeriod);
      const targetDriver = targetReadiness.drivers.find((driver) => driver.driverId === existing.driverId);
      if (!targetDriver || targetDriver.status !== 'READY' || targetDriver.exclusion != null) {
        throw new ApiError(409, 'Lái xe chưa sẵn sàng trong kỳ lương bổ sung đã khai báo');
      }
    } else {
      const [adjustment] = await tx.select({ id: s.salaryPeriodAdjustments.id })
        .from(s.salaryPeriodAdjustments)
        .where(and(
          eq(s.salaryPeriodAdjustments.sourcePeriod, existing.period),
          eq(s.salaryPeriodAdjustments.driverId, existing.driverId),
        ))
        .limit(1);
      if (!adjustment) {
        throw new ApiError(409, 'Chưa có khoản điều chỉnh đã duyệt cho lái xe và kỳ lương gốc');
      }
    }

    const completedAt = new Date();
    const [updated] = await tx.update(s.salaryPeriodExclusions)
      .set({
        followupStatus: 'COMPLETED',
        followupCompletedAt: completedAt,
        followupCompletedBy: input.actorId,
        updatedAt: new Date(),
      })
      .where(and(
        eq(s.salaryPeriodExclusions.id, existing.id),
        eq(s.salaryPeriodExclusions.followupStatus, 'PENDING'),
      ))
      .returning();
    if (!updated) {
      throw new ApiError(409, 'Xử lý bổ sung đã được cập nhật bởi người khác');
    }

    return {
      actionId: updated.id,
      period: updated.period,
      driverId: updated.driverId,
      handlingMode: updated.handlingMode as SalaryExclusionHandlingMode,
      targetPeriod: updated.targetPeriod,
      reason: updated.reason,
      note: updated.note,
      followupStatus: 'COMPLETED',
      followupCompletedAt: updated.followupCompletedAt?.toISOString() ?? null,
    };
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}
