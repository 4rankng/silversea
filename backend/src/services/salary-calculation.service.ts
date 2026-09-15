import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, gte, lte, sql, isNull, ne } from 'drizzle-orm';
import { ApiError } from '../errors';
import { computeAttendanceSummary, type ConfirmationMap } from './attendance.service';

type DbLike = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

export async function computeLiveSalary(
  driverId: number,
  year: number,
  month: number,
  confirmationMap?: ConfirmationMap,
  executor: DbLike = db,
) {
  const attendance = await computeAttendanceSummary(driverId, year, month, executor);
  const { periodStart: start, periodEnd: end, standardWorkDays, tripDays, standbyDays, paidDays } = attendance;

  // Get driver base salary
  const [driver] = await executor.select({
    baseSalary: s.drivers.baseSalary,
    socialInsurance: s.drivers.socialInsurance,
  }).from(s.drivers)
    .where(eq(s.drivers.id, driverId)).limit(1);

  if (!driver) {
    throw new ApiError(404, 'Không tìm thấy lái xe');
  }
  const baseSalary = parseFloat(driver.baseSalary || '0');
  // Social insurance from drivers.social_insurance column (was hardcoded to 0)
  const socialInsurance = parseFloat(driver.socialInsurance || '0');

  // Per customer (Pete): dailyRate = baseSalary / standardWorkDays
  // This is a cost-allocation rate to distribute monthly salary across trips, NOT actual pay.
  const dailyRate = Math.round(baseSalary / standardWorkDays);

  // Cost allocation: trip salary = trip days × daily rate
  const totalTripSalary = tripDays * dailyRate;

  // Standby cost: standby days × daily rate (idle days → allocated cost)
  const supplementPay = standbyDays * dailyRate;

  // Leave deduction: Removed because adjustment handles it natively.
  const leaveDeduction = 0;

  // Adjustment: (paidDays - standardWorkDays) * dailyRate
  const adjustment = (paidDays - standardWorkDays) * dailyRate;

  // Penalties in period
  const [penaltyRow] = await executor.select({
    total: sql<string>`coalesce(sum(${s.penalties.amount}::numeric), 0)`,
  }).from(s.penalties)
    .where(and(
      eq(s.penalties.driverId, driverId),
      isNull(s.penalties.deletedAt),
      ne(s.penalties.status, 'CANCELED'),
      gte(s.penalties.date, start),
      lte(s.penalties.date, end),
    ));

  const totalPenalties = parseFloat(penaltyRow?.total || '0');

  // Net salary is just base salary + adjustment - penalties
  const netSalary = baseSalary + adjustment - totalPenalties;

  // Get salary confirmation status — use pre-fetched map if available
  let confirmationRow: { status: string | null; confirmedBy: number | null; confirmedAt: Date | null } | undefined;
  if (confirmationMap) {
    confirmationRow = confirmationMap.get(driverId);
  } else {
    [confirmationRow] = await executor.select({
      status: s.salaryConfirmations.status,
      confirmedBy: s.salaryConfirmations.confirmedBy,
      confirmedAt: s.salaryConfirmations.confirmedAt,
    }).from(s.salaryConfirmations)
      .where(and(
        eq(s.salaryConfirmations.driverId, driverId),
        eq(s.salaryConfirmations.year, year),
        eq(s.salaryConfirmations.month, month),
      )).limit(1);
  }

  return {
    ...attendance,
    baseSalary,
    socialInsurance,
    dailyRate,
    totalTripSalary,
    adjustment,
    supplementPay,
    leaveDeduction,
    totalPenalties,
    netSalary,
    confirmationStatus: confirmationRow?.status ?? 'DRAFT',
    confirmedBy: confirmationRow?.confirmedBy ?? null,
    confirmedAt: confirmationRow?.confirmedAt ?? null,
  };
}
