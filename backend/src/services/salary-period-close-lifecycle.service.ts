// Salary-period close/reopen lifecycle: the direct close + reopen transactions
// and their maker-checker-approver governance flows. Extracted from
// salary-period-close.service.ts verbatim (pure code movement). The
// locked-entity manifest pins requestSalaryPeriodReopen to THIS file.
import { db } from '../db';
import * as s from '../db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { Role, TxnType, FINANCIAL_ROLES } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import { resolveSalaryPeriodDateRange } from './salary-period.service';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import {
  closePeriodLock,
  reopenPeriodLock,
  resolveSalaryPeriodAuthority,
} from './period-lock.service';
import { assertCanMakeGovernanceAction } from './governance-policy';
import {
  buildGovernanceAction,
  type GovernanceApplyAdapter,
} from './governance-action-core.service';
import {
  CLOSE_ENTITY_TYPE,
  COMPANY_DRIVER_ENTITY_ID,
  SALARY_PERIOD_SUBJECT_TYPE,
  SALARY_PERIOD_CLOSE_ACTION_KIND,
  SALARY_PERIOD_REOPEN_ACTION_KIND,
  type SalaryPeriodCloseResult,
  type SalaryPeriodLifecycleState,
  periodLockKey,
  parsePeriod,
  sumDriverSalaryInPeriod,
  buildSalaryPeriodReadinessSummary,
  throwSalaryReadinessBlocked,
  mapReopenBlockers,
  hasSalaryPeriodDriverPayout,
  assertSalaryPeriodCanReopen,
  readSummaryAmount,
  buildCloseResult,
  requireGovernanceReason,
  assertSalaryPeriodGovernanceAction,
} from './salary-period-close-shared.service';

/**
 * Close a salary period. Idempotent: re-closing the same period returns
 * the existing row and posts zero new ledger entries.
 */
export async function closeSalaryPeriod(input: {
  period: string;
  actorId: number;
  actorRole: string;
  note?: string | null;
  expectedVersion?: number | null;
  transaction?: Tx;
}): Promise<SalaryPeriodCloseResult> {
  if (!(FINANCIAL_ROLES as readonly string[]).includes(input.actorRole)) {
    throw new ApiError(403, 'Bạn không có quyền chốt kỳ lương');
  }
  if (input.expectedVersion != null && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0)) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }
  const { year, month } = parsePeriod(input.period);
  const authority = await resolveSalaryPeriodAuthority(input.period);

  const execute = async (tx: Tx) => {
    // Per-period advisory lock — concurrent closes serialize here.
    await LedgerService.lockEntity(tx, CLOSE_ENTITY_TYPE, periodLockKey(input.period));

    // Idempotent: existing CLOSED row → return it unchanged.
    const [existing] = await tx.select()
      .from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, input.period))
      .limit(1);
    if (input.expectedVersion != null) {
      if (!existing) {
        if (input.expectedVersion !== 0) {
          throw new ApiError(409, 'Kỳ lương đã thay đổi. Vui lòng tải lại trước khi chốt.');
        }
      } else if (existing.version !== input.expectedVersion) {
        throw new ApiError(409, 'Kỳ lương đã thay đổi. Vui lòng tải lại trước khi chốt.');
      }
    }
    if (existing && existing.status === 'CLOSED') {
      await closePeriodLock(tx, authority, input.actorId, existing.note);
      // Pull the summary amount from the original ledger entry.
      const summaryAmt = await readSummaryAmount(tx, existing.ledgerEntryId);
      return buildCloseResult(existing, summaryAmt, true);
    }

    // Resolve the date range for this period (override → default → calendar).
    const range = await resolveSalaryPeriodDateRange(month, year);
    const readiness = await buildSalaryPeriodReadinessSummary(tx, input.period);
    if (!readiness.canClose) {
      throwSalaryReadinessBlocked(input.period, readiness);
    }
    const periodTotalSalary = await sumDriverSalaryInPeriod(
      tx,
      range.start,
      range.end,
      readiness.drivers.map((driver) => driver.driverId),
    );

    // Post ONE consolidated summary entry. ADJUSTMENT txnType (NOT
    // DRIVER_SALARY) so per-driver payable aggregates don't double-count.
    // entityId=0 = company-aggregate sentinel.
    const note = input.note?.trim() || `Chốt kỳ lương T${month}/${year}`;
    const entry = await LedgerService.postEntry(tx, {
      txnType: TxnType.ADJUSTMENT,
      entityType: 'DRIVER',
      entityId: COMPANY_DRIVER_ENTITY_ID,
      debit: 0,
      credit: periodTotalSalary,
      note,
    });

    // Insert the close row (or revive a REOPENED row back to CLOSED).
    let closeRow: typeof s.salaryPeriodCloses.$inferSelect;
    if (existing && existing.status === 'REOPENED') {
      const [updated] = await tx.update(s.salaryPeriodCloses)
        .set({
          status: 'CLOSED',
          ledgerEntryId: entry.id,
          closedBy: input.actorId,
          closedAt: new Date(),
          note,
          payrollScope: readiness.scope,
          payrollBusinessUnitId: readiness.businessUnitId,
          payrollBusinessUnitName: readiness.businessUnitName,
          includedDriverIds: readiness.drivers.map((driver) => driver.driverId),
          excludedDriverIds: readiness.drivers
            .filter((driver) => driver.exclusion != null)
            .map((driver) => driver.driverId),
          payrollProvenanceCapturedAt: new Date(),
          version: sql`${s.salaryPeriodCloses.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(s.salaryPeriodCloses.id, existing.id))
        .returning();
      closeRow = updated!;
    } else {
      const [inserted] = await tx.insert(s.salaryPeriodCloses).values({
        period: input.period,
        status: 'CLOSED',
        ledgerEntryId: entry.id,
        closedBy: input.actorId,
        note,
        payrollScope: readiness.scope,
        payrollBusinessUnitId: readiness.businessUnitId,
        payrollBusinessUnitName: readiness.businessUnitName,
        includedDriverIds: readiness.drivers.map((driver) => driver.driverId),
        excludedDriverIds: readiness.drivers
          .filter((driver) => driver.exclusion != null)
          .map((driver) => driver.driverId),
        payrollProvenanceCapturedAt: new Date(),
      }).returning();
      closeRow = inserted!;
    }
    await closePeriodLock(tx, authority, input.actorId, note);

    return buildCloseResult(closeRow, periodTotalSalary, false);
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

/**
 * Reopen a salary period (allows further edits). Posts a reversing
 * entry against the original summary so the company-aggregate total
 * reflects the open state. Idempotent on an already-REOPENED period.
 */
export async function reopenSalaryPeriod(input: {
  period: string;
  actorId: number;
  actorRole: string;
  note?: string | null;
  expectedVersion?: number | null;
  transaction?: Tx;
}): Promise<SalaryPeriodCloseResult> {
  if (input.actorRole !== Role.ADMIN && input.actorRole !== Role.MANAGER) {
    throw new ApiError(403, 'Bạn không có quyền mở lại kỳ lương');
  }
  if (input.expectedVersion != null && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }
  parsePeriod(input.period); // validate format
  const authority = await resolveSalaryPeriodAuthority(input.period);

  const execute = async (tx: Tx) => {
    await LedgerService.lockEntity(tx, CLOSE_ENTITY_TYPE, periodLockKey(input.period));

    const [existing] = await tx.select()
      .from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, input.period))
      .limit(1);
    if (!existing) {
      throw new ApiError(404, `Kỳ lương ${input.period} chưa được chốt, không thể mở lại`);
    }
    if (input.expectedVersion != null && existing.version !== input.expectedVersion) {
      throw new ApiError(409, 'Kỳ lương đã thay đổi. Vui lòng tải lại trước khi mở lại.');
    }
    if (existing.status === 'REOPENED') {
      const summaryAmt = await readSummaryAmount(tx, existing.ledgerEntryId);
      return buildCloseResult(existing, summaryAmt, true);
    }

    const reopenBlockers = mapReopenBlockers({
      period: input.period,
      payslipIssuedAt: existing.payslipIssuedAt,
      officialPostedAt: existing.officialPostedAt,
      hasDriverPayout: await hasSalaryPeriodDriverPayout(tx, input.period),
    });
    if (reopenBlockers.length > 0) {
      throw new ApiError(409, `${reopenBlockers[0]}, phải xử lý bằng điều chỉnh bổ sung.`);
    }
    await assertSalaryPeriodCanReopen(tx, input.period);

    // Post reversing entry mirroring the original summary.
    const originalAmount = await readSummaryAmount(tx, existing.ledgerEntryId);
    const reopenNote = input.note?.trim() || `Mở lại kỳ lương ${input.period}`;
    const entry = await LedgerService.postEntry(tx, {
      txnType: TxnType.ADJUSTMENT,
      entityType: 'DRIVER',
      entityId: COMPANY_DRIVER_ENTITY_ID,
      debit: originalAmount,
      credit: 0,
      note: reopenNote,
    });
    // Stamp the new reversal on the close row.
    const [updated] = await tx.update(s.salaryPeriodCloses)
      .set({
        status: 'REOPENED',
        ledgerEntryId: entry.id, // now points at the latest entry (reversal)
        note: reopenNote,
        version: sql`${s.salaryPeriodCloses.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(s.salaryPeriodCloses.id, existing.id))
      .returning();
    await reopenPeriodLock(tx, authority, input.actorId, reopenNote);
    return buildCloseResult(updated!, originalAmount, false);
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}
/** Get one close row by period (or null). */
export async function getSalaryPeriodClose(period: string) {
  const [row] = await db.select()
    .from(s.salaryPeriodCloses)
    .where(eq(s.salaryPeriodCloses.period, period))
    .limit(1);
  return row ?? null;
}

export async function getSalaryPeriodLifecycle(period: string): Promise<SalaryPeriodLifecycleState> {
  parsePeriod(period);
  const closeRow = await getSalaryPeriodClose(period);
  const hasDriverPayout = await hasSalaryPeriodDriverPayout(db, period);

  if (!closeRow) {
    return {
      period,
      status: 'OPEN',
      closeId: null,
      version: null,
      ledgerEntryId: null,
      closedBy: null,
      closedAt: null,
      note: null,
      payslipIssuedBy: null,
      payslipIssuedAt: null,
      payslipIssuedNote: null,
      officialPostedBy: null,
      officialPostedAt: null,
      officialPostingNote: null,
      hasDriverPayout,
      canReopen: false,
      reopenBlockers: ['Kỳ lương chưa được chốt'],
    };
  }

  const reopenBlockers = closeRow.status === 'REOPENED'
    ? ['Kỳ lương đang ở trạng thái mở lại']
    : mapReopenBlockers({
        period,
        payslipIssuedAt: closeRow.payslipIssuedAt,
        officialPostedAt: closeRow.officialPostedAt,
        hasDriverPayout,
      });

  return {
    period,
    status: closeRow.status as 'CLOSED' | 'REOPENED',
    closeId: closeRow.id,
    version: closeRow.version,
    ledgerEntryId: closeRow.ledgerEntryId,
    closedBy: closeRow.closedBy,
    closedAt: closeRow.closedAt.toISOString(),
    note: closeRow.note,
    payslipIssuedBy: closeRow.payslipIssuedBy,
    payslipIssuedAt: closeRow.payslipIssuedAt?.toISOString() ?? null,
    payslipIssuedNote: closeRow.payslipIssuedNote,
    officialPostedBy: closeRow.officialPostedBy,
    officialPostedAt: closeRow.officialPostedAt?.toISOString() ?? null,
    officialPostingNote: closeRow.officialPostingNote,
    hasDriverPayout,
    canReopen: closeRow.status === 'CLOSED' && reopenBlockers.length === 0,
    reopenBlockers,
  };
}

/** List all close rows, newest first. */
export async function listSalaryPeriodCloses() {
  return db.select()
    .from(s.salaryPeriodCloses)
    .orderBy(desc(s.salaryPeriodCloses.period));
}
export async function requestSalaryPeriodClose(input: {
  period: string;
  actorId: number;
  actorRole: string;
  reason?: string | null;
  note?: string | null;
  transaction?: Tx;
}) {
  assertCanMakeGovernanceAction(SALARY_PERIOD_CLOSE_ACTION_KIND, input.actorRole);
  parsePeriod(input.period);
  const reason = requireGovernanceReason(
    input.reason,
    `Đề nghị chốt kỳ lương ${input.period}`,
  );
  const note = input.note?.trim() || null;

  const execute = async (tx: Tx) => {
    await LedgerService.lockEntity(tx, CLOSE_ENTITY_TYPE, periodLockKey(input.period));
    const [existingClose] = await tx.select()
      .from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, input.period))
      .limit(1)
      .for('update');
    if (existingClose?.status === 'CLOSED') {
      throw new ApiError(409, `Kỳ lương ${input.period} đã được chốt.`);
    }

    const readiness = await buildSalaryPeriodReadinessSummary(tx, input.period);
    if (!readiness.canClose) {
      throwSalaryReadinessBlocked(input.period, readiness);
    }

    return buildGovernanceAction({
      subjectType: SALARY_PERIOD_SUBJECT_TYPE,
      subjectKey: input.period,
      actionKind: SALARY_PERIOD_CLOSE_ACTION_KIND,
      reason,
      originalVersion: existingClose?.version ?? 0,
      beforeSnapshot: {
        lifecycle: existingClose
          ? {
              status: existingClose.status,
              version: existingClose.version,
              closeId: existingClose.id,
            }
          : {
              status: 'OPEN',
              version: 0,
              closeId: null,
            },
        readiness,
      },
      afterSnapshot: {
        period: input.period,
        requestedNote: note,
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

function assertTransientPeriodAction(
  action: Parameters<GovernanceApplyAdapter>[1],
  actionKind: typeof SALARY_PERIOD_CLOSE_ACTION_KIND | typeof SALARY_PERIOD_REOPEN_ACTION_KIND,
): string {
  const { subjectKey: period } = action;
  assertSalaryPeriodGovernanceAction(action, period ?? '', actionKind);
  return period ?? '';
}

/**
 * Direct-apply adapter for SALARY_PERIOD_CLOSE: runs the same close the old
 * approve stage ran, re-validated against the transient request record.
 */
export const applySalaryPeriodCloseAction: GovernanceApplyAdapter = async (tx, action) => {
  const period = assertTransientPeriodAction(action, SALARY_PERIOD_CLOSE_ACTION_KIND);
  const afterSnapshot = action.afterSnapshot as Record<string, unknown> | null;
  const result = await closeSalaryPeriod({
    period,
    actorId: action.approverId ?? action.makerId,
    actorRole: action.approverRole ?? action.makerRole,
    note: typeof afterSnapshot?.requestedNote === 'string' ? afterSnapshot.requestedNote : null,
    expectedVersion: action.originalVersion,
    transaction: tx,
  });
  return {
    ledgerEntryId: result.ledgerEntryId,
    applicationResult: {
      closeId: result.closeId,
      status: result.status,
      version: result.version,
      periodTotalSalary: result.periodTotalSalary,
    },
  };
};

export async function requestSalaryPeriodReopen(input: {
  period: string;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
  reason?: string | null;
  note?: string | null;
  transaction?: Tx;
}) {
  assertCanMakeGovernanceAction(SALARY_PERIOD_REOPEN_ACTION_KIND, input.actorRole);
  parsePeriod(input.period);
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }
  const reason = input.reason?.trim() || input.note?.trim() || '';
  if (!reason) {
    throw new ApiError(400, 'Cần nhập lý do mở lại kỳ lương');
  }
  const note = input.note?.trim() || reason;

  const execute = async (tx: Tx) => {
    await LedgerService.lockEntity(tx, CLOSE_ENTITY_TYPE, periodLockKey(input.period));
    const [existingClose] = await tx.select()
      .from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, input.period))
      .limit(1)
      .for('update');
    if (!existingClose) {
      throw new ApiError(404, `Kỳ lương ${input.period} chưa được chốt, không thể mở lại`);
    }
    if (existingClose.status !== 'CLOSED') {
      throw new ApiError(409, `Kỳ lương ${input.period} đang ở trạng thái ${existingClose.status}, không thể đề nghị mở lại`);
    }
    if (existingClose.version !== input.expectedVersion) {
      throw new ApiError(409, 'Kỳ lương đã thay đổi. Vui lòng tải lại trước khi mở lại.');
    }

    const reopenBlockers = mapReopenBlockers({
      period: input.period,
      payslipIssuedAt: existingClose.payslipIssuedAt,
      officialPostedAt: existingClose.officialPostedAt,
      hasDriverPayout: await hasSalaryPeriodDriverPayout(tx, input.period),
    });
    if (reopenBlockers.length > 0) {
      throw new ApiError(409, `${reopenBlockers[0]}, phải xử lý bằng điều chỉnh bổ sung.`);
    }

    return buildGovernanceAction({
      subjectType: SALARY_PERIOD_SUBJECT_TYPE,
      subjectKey: input.period,
      actionKind: SALARY_PERIOD_REOPEN_ACTION_KIND,
      reason,
      originalVersion: existingClose.version,
      beforeSnapshot: {
        lifecycle: {
          status: existingClose.status,
          version: existingClose.version,
          closeId: existingClose.id,
          closedAt: existingClose.closedAt.toISOString(),
          note: existingClose.note,
        },
      },
      afterSnapshot: {
        period: input.period,
        requestedNote: note,
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
 * Direct-apply adapter for SALARY_PERIOD_REOPEN: runs the same reopen the old
 * approve stage ran, re-validated against the transient request record.
 */
export const applySalaryPeriodReopenAction: GovernanceApplyAdapter = async (tx, action) => {
  const period = assertTransientPeriodAction(action, SALARY_PERIOD_REOPEN_ACTION_KIND);
  const afterSnapshot = action.afterSnapshot as Record<string, unknown> | null;
  const result = await reopenSalaryPeriod({
    period,
    actorId: action.approverId ?? action.makerId,
    actorRole: action.approverRole ?? action.makerRole,
    note: typeof afterSnapshot?.requestedNote === 'string' ? afterSnapshot.requestedNote : null,
    expectedVersion: action.originalVersion,
    transaction: tx,
  });
  return {
    ledgerEntryId: result.ledgerEntryId,
    applicationResult: {
      closeId: result.closeId,
      status: result.status,
      version: result.version,
    },
  };
};
