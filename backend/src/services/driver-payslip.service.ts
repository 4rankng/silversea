/**
 * Driver payslip periods (M8.6) — extracted from driver.service.ts to keep
 * that file under the architecture LOC budget. Behavior is unchanged;
 * driver.service.ts re-exports the public surface so existing import sites
 * (routes + tests) are untouched.
 */
import { desc, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { getDriverEarningsForPeriods } from './driver-earnings.service';

// ─── M8.6: driver payslip periods ───────────────────────────────────────────
//
// PRD M08-06-03: a driver sees their own issued salary periods (CLOSED or
// REOPENED) with per-period earnings + close/adjustment metadata. Ownership
// is enforced by resolving driverId from the authenticated user (the route
// does this). The list reuses getDriverEarningsForPeriods for the per-period
// summary — the batched form, so the whole list costs one earnings call.

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
 * Parse a `salary_period_closes.period` into the earnings key.
 *
 * A period that does not parse, or whose month falls outside 1-12, is not a
 * salary period at all and is skipped by the caller — unchanged behaviour.
 * Returns the same `${year}-${MM}` key the earnings service builds internally.
 */
function parsePeriod(period: string): { key: string; year: number; month: number } | null {
  const [yearStr, monthStr] = period.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return { key: `${year}-${String(month).padStart(2, '0')}`, year, month };
}

/**
 * List the driver's issued salary periods (CLOSED or REOPENED), newest-first,
 * with per-period earnings summary.
 *
 * Card 20260928_199 — the earnings are one batched read for the whole list
 * (getDriverEarningsForPeriods), not one `getDriverEarnings` await per period.
 * The unparsable-period guard is unchanged; the only difference is that the
 * periods are resolved before the call instead of inside the loop.
 */
export async function getDriverPayslipPeriods(driverId: number): Promise<DriverPayslipPeriod[]> {
  // Fetch all salary_period_closes rows (any driver — the period is global),
  // then join the closer's name. The earnings are per-driver, so the same
  // period yields different numbers for different drivers; the period-close row
  // itself is shared.
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

  // Collect and de-duplicate every earnings key BEFORE asking for any number,
  // so the periods are resolved by one batched read instead of one await per
  // period. Unparsable periods are dropped here, exactly as the loop used to.
  const entries = closes.map(close => ({ close, period: parsePeriod(close.period) }));
  const requested = new Map<string, { year: number; month: number }>();
  for (const { period } of entries) {
    if (!period) continue;
    requested.set(period.key, { year: period.year, month: period.month });
  }
  const earningsByPeriod = await getDriverEarningsForPeriods(driverId, [...requested.values()]);

  const result: DriverPayslipPeriod[] = [];
  for (const { close, period } of entries) {
    if (!period) continue;
    const earnings = earningsByPeriod.get(period.key);
    if (!earnings) {
      // Unreachable: the batch returns one entry per requested key.
      throw new Error(`getDriverPayslipPeriods: no earnings computed for ${close.period}`);
    }
    result.push({
      period: close.period,
      status: close.status,
      closedAt: close.closedAt?.toISOString() ?? null,
      closedByName: close.closedBy ? closerMap.get(close.closedBy) ?? null : null,
      note: close.note,
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
