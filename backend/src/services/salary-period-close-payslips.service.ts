// Payslip issuance + official-posting marks for a closed salary period, and
// the readiness read. Extracted from salary-period-close.service.ts verbatim
// (pure code movement).
import { db } from '../db';
import * as s from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { FINANCIAL_ROLES } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import {
  CLOSE_ENTITY_TYPE,
  type SalaryPeriodCloseResult,
  type SalaryPeriodReadinessSummary,
  periodLockKey,
  parsePeriod,
  readSummaryAmount,
  buildCloseResult,
  buildSalaryPeriodReadinessSummary,
} from './salary-period-close-shared.service';

export async function issueSalaryPeriodPayslips(input: {
  period: string;
  actorId: number;
  actorRole: string;
  note?: string | null;
  expectedVersion?: number | null;
  transaction?: Tx;
}): Promise<SalaryPeriodCloseResult> {
  if (!(FINANCIAL_ROLES as readonly string[]).includes(input.actorRole)) {
    throw new ApiError(403, 'Bạn không có quyền phát hành phiếu lương');
  }
  if (input.expectedVersion != null && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }
  parsePeriod(input.period);

  const execute = async (tx: Tx) => {
    await LedgerService.lockEntity(tx, CLOSE_ENTITY_TYPE, periodLockKey(input.period));
    const [closeRow] = await tx.select()
      .from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, input.period))
      .limit(1);
    if (!closeRow || closeRow.status !== 'CLOSED') {
      throw new ApiError(409, `Kỳ lương ${input.period} chưa ở trạng thái đã chốt để phát hành phiếu lương`);
    }
    if (input.expectedVersion != null && closeRow.version !== input.expectedVersion) {
      throw new ApiError(409, 'Kỳ lương đã thay đổi. Vui lòng tải lại trước khi phát hành phiếu lương.');
    }
    if (closeRow.payslipIssuedAt) {
      const summaryAmt = await readSummaryAmount(tx, closeRow.ledgerEntryId);
      return buildCloseResult(closeRow, summaryAmt, true);
    }

    const [updated] = await tx.update(s.salaryPeriodCloses)
      .set({
        payslipIssuedBy: input.actorId,
        payslipIssuedAt: new Date(),
        payslipIssuedNote: input.note?.trim() || null,
        version: sql`${s.salaryPeriodCloses.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(s.salaryPeriodCloses.id, closeRow.id))
      .returning();

    const summaryAmt = await readSummaryAmount(tx, updated!.ledgerEntryId);
    return buildCloseResult(updated!, summaryAmt, false);
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

export async function markSalaryPeriodOfficialPosting(input: {
  period: string;
  actorId: number;
  actorRole: string;
  note?: string | null;
  expectedVersion?: number | null;
  transaction?: Tx;
}): Promise<SalaryPeriodCloseResult> {
  if (!(FINANCIAL_ROLES as readonly string[]).includes(input.actorRole)) {
    throw new ApiError(403, 'Bạn không có quyền đánh dấu hạch toán chính thức');
  }
  if (input.expectedVersion != null && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }
  parsePeriod(input.period);

  const execute = async (tx: Tx) => {
    await LedgerService.lockEntity(tx, CLOSE_ENTITY_TYPE, periodLockKey(input.period));
    const [closeRow] = await tx.select()
      .from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, input.period))
      .limit(1);
    if (!closeRow || closeRow.status !== 'CLOSED') {
      throw new ApiError(409, `Kỳ lương ${input.period} chưa ở trạng thái đã chốt để hạch toán chính thức`);
    }
    if (!closeRow.payslipIssuedAt) {
      throw new ApiError(409, `Kỳ lương ${input.period} chưa phát hành phiếu lương, chưa thể đánh dấu hạch toán chính thức`);
    }
    if (input.expectedVersion != null && closeRow.version !== input.expectedVersion) {
      throw new ApiError(409, 'Kỳ lương đã thay đổi. Vui lòng tải lại trước khi hạch toán chính thức.');
    }
    if (closeRow.officialPostedAt) {
      const summaryAmt = await readSummaryAmount(tx, closeRow.ledgerEntryId);
      return buildCloseResult(closeRow, summaryAmt, true);
    }

    const [updated] = await tx.update(s.salaryPeriodCloses)
      .set({
        officialPostedBy: input.actorId,
        officialPostedAt: new Date(),
        officialPostingNote: input.note?.trim() || null,
        version: sql`${s.salaryPeriodCloses.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(s.salaryPeriodCloses.id, closeRow.id))
      .returning();

    const summaryAmt = await readSummaryAmount(tx, updated!.ledgerEntryId);
    return buildCloseResult(updated!, summaryAmt, false);
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}
export async function getSalaryPeriodReadiness(period: string): Promise<SalaryPeriodReadinessSummary> {
  parsePeriod(period);
  return buildSalaryPeriodReadinessSummary(db, period);
}
