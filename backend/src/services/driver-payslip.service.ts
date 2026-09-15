/**
 * Driver payslip periods (M8.6) — extracted from driver.service.ts to keep
 * that file under the architecture LOC budget. Behavior is unchanged;
 * driver.service.ts re-exports the public surface so existing import sites
 * (routes + tests) are untouched.
 */
import { desc, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { getDriverEarnings } from './driver.service';

// ─── M8.6: driver payslip periods ───────────────────────────────────────────
//
// PRD M08-06-03: a driver sees their own issued salary periods (CLOSED or
// REOPENED) with per-period earnings + close/adjustment metadata. Ownership
// is enforced by resolving driverId from the authenticated user (the route
// does this). The list reuses getDriverEarnings for the per-period summary.

export interface DriverPayslipPeriod {
  period: string;
  status: string;
  closedAt: string | null;
  closedByName: string | null;
  note: string | null;
  earnings: {
    salarySnapshotState: 'LIVE' | 'CONFIRMED' | 'UNAVAILABLE';
    salaryReconciliationRequired: boolean;
    netIncome: string;
    productionSalary: string;
    roadAllowance: string;
    penalties: string;
    paidOrAdvanced: string;
    payableBalance: string;
    periodStart: string;
    periodEnd: string;
  };
}

/**
 * List the driver's issued salary periods (CLOSED or REOPENED), newest-first,
 * with per-period earnings summary. Reuses getDriverEarnings for the numbers.
 */
export async function getDriverPayslipPeriods(driverId: number): Promise<DriverPayslipPeriod[]> {
  // Fetch all salary_period_closes rows (any driver — the period is global),
  // then join the closer's name. The earnings are per-driver (getDriverEarnings
  // filters by driverId), so the same period yields different numbers for
  // different drivers; the period-close row itself is shared.
  const closes = await db.select({
    period: s.salaryPeriodCloses.period,
    status: s.salaryPeriodCloses.status,
    closedAt: s.salaryPeriodCloses.closedAt,
    closedBy: s.salaryPeriodCloses.closedBy,
    note: s.salaryPeriodCloses.note,
  }).from(s.salaryPeriodCloses)
    .where(sql`${s.salaryPeriodCloses.payslipIssuedAt} is not null`)
    .orderBy(desc(s.salaryPeriodCloses.period));

  if (closes.length === 0) return [];

  // Batch-resolve closer names.
  const closerIds = [...new Set(closes.map(c => c.closedBy).filter((id): id is number => id != null))];
  const closers = closerIds.length > 0
    ? await db.select({ id: s.users.id, name: s.users.fullName }).from(s.users).where(inArray(s.users.id, closerIds))
    : [];
  const closerMap = new Map(closers.map(c => [c.id, c.name]));

  // Compute earnings per period for this driver.
  const result: DriverPayslipPeriod[] = [];
  for (const c of closes) {
    const [yearStr, monthStr] = c.period.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) continue;

    const earnings = await getDriverEarnings(driverId, month, year);
    result.push({
      period: c.period,
      status: c.status,
      closedAt: c.closedAt?.toISOString() ?? null,
      closedByName: c.closedBy ? closerMap.get(c.closedBy) ?? null : null,
      note: c.note,
      earnings: {
        salarySnapshotState: earnings.salarySnapshotState,
        salaryReconciliationRequired: earnings.salaryReconciliationRequired,
        netIncome: earnings.netIncome,
        productionSalary: earnings.productionSalary,
        roadAllowance: earnings.roadAllowance,
        penalties: earnings.penalties,
        paidOrAdvanced: earnings.paidOrAdvanced,
        payableBalance: earnings.payableBalance,
        periodStart: earnings.periodStart ?? '',
        periodEnd: earnings.periodEnd ?? '',
      },
    });
  }

  return result;
}
