import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, gte, lte, sql, isNull, ne } from 'drizzle-orm';
import { ApiError } from '../errors';
import { computeAttendanceSummary, getBoardTripDays, type ConfirmationMap } from './attendance-summary.service';
import {
  computeTimesheetSalary,
  daysOfMonth,
  isSundayUtc,
  type TimesheetSalaryMode,
  type TimesheetSymbol,
} from '@tingting/shared';

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
    salaryMode: s.drivers.salaryMode,
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

  // SIL-849 — the trip-day split and the /salary calendar now read the chấm
  // công board (the SAME source /timesheet + Đối chiếu pay from) instead of
  // the legacy departure→arrival driver_work_days rows, so 'Lương chuyến
  // (N ngày)', the green cells and the money can never disagree again. The
  // paid-days basis below stays on the attendance rows — pay figures are
  // untouched; the board only re-splits the INTERNAL cost allocation between
  // chuyến and chờ việc (the two rows still sum to paidDays × dailyRate).
  const boardTripDays = (await getBoardTripDays(driverId, start, end, executor)).size;
  const leaveCap = paidDays - tripDays - standbyDays;
  const splitStandbyDays = Math.max(0, paidDays - boardTripDays - leaveCap);

  // Cost allocation: trip salary = trip days × daily rate
  const totalTripSalary = boardTripDays * dailyRate;

  // Standby cost: standby days × daily rate (idle days → allocated cost)
  const supplementPay = splitStandbyDays * dailyRate;

  // Leave deduction: Removed because adjustment handles it natively.
  const leaveDeduction = 0;

  // Adjustment: (paidDays - standardWorkDays) * dailyRate
  const adjustment = (paidDays - standardWorkDays) * dailyRate;

  // SIL-841 (QA fail fd0f7f14) — 'không trốn vé' (PER_TRIP) drivers also earn
  // the month's trip money. Source of truth = the chấm công board
  // (driver_timesheet_months/days) through the SAME shared
  // computeTimesheetSalary the Đối chiếu screen pays from, so /salary and
  // Đối chiếu cannot disagree (QA: Bùi Ngọc Long 0 ₫ here vs 100.000 ₫
  // there). A month never opened by Điều vận has no board → no trip money.
  // The board's per-month mode wins (it is what Đối chiếu pays); the driver's
  // catalog mode is the fallback for a mode chosen without opening the board.
  const [board] = await executor.select({
    id: s.driverTimesheetMonths.id,
    salaryMode: s.driverTimesheetMonths.salaryMode,
    dailyBase: s.driverTimesheetMonths.dailyBase,
    flatAmount: s.driverTimesheetMonths.flatAmount,
  }).from(s.driverTimesheetMonths)
    .where(and(
      eq(s.driverTimesheetMonths.driverId, driverId),
      eq(s.driverTimesheetMonths.year, year),
      eq(s.driverTimesheetMonths.month, month),
    )).limit(1);
  const boardDays = board
    ? await executor.select({
      symbol: s.driverTimesheetDays.symbol,
      workDate: s.driverTimesheetDays.workDate,
      tripAdjustment: s.driverTimesheetDays.tripAdjustment,
    }).from(s.driverTimesheetDays)
      .where(eq(s.driverTimesheetDays.monthId, board.id))
    : [];
  const effectiveSalaryMode = (board?.salaryMode ?? driver.salaryMode ?? 'PER_TRIP') as TimesheetSalaryMode;
  const timesheet = computeTimesheetSalary({
    mode: effectiveSalaryMode,
    dailyBase: board?.dailyBase != null ? Number(board.dailyBase) : null,
    flatAmount: board?.flatAmount != null ? Number(board.flatAmount) : null,
    // Raw board day rows are sparse — the ngày chuẩn must come from the
    // calendar (timesheet.service rollup precedent).
    standardDays: daysOfMonth(year, month).filter((date) => !isSundayUtc(date)).length,
    days: boardDays.map((row) => ({
      symbol: row.symbol as TimesheetSymbol,
      workDate: row.workDate,
      tripAdjustment: row.tripAdjustment,
    })),
  });
  const perTripPay = effectiveSalaryMode === 'PER_TRIP' ? timesheet.perTripPay : 0;
  const extraTripBonus = effectiveSalaryMode === 'PER_TRIP' ? timesheet.extraTripBonus : 0;

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

  // Net salary: lương cứng + điều chỉnh công − phạt, cộng TIỀN CHUYẾN + KPI
  // vượt chuyến for 'không trốn vé' (SIL-841); 'trốn vé' keeps the
  // lương-cứng-theo-ngày-công math untouched.
  const netSalary = baseSalary + adjustment - totalPenalties + perTripPay + extraTripBonus;

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
    // SIL-849 — board-based trip-day split (see above); paidDays stay on the
    // attendance basis so every pay figure is unchanged.
    tripDays: boardTripDays,
    standbyDays: splitStandbyDays,
    baseSalary,
    socialInsurance,
    dailyRate,
    totalTripSalary,
    adjustment,
    supplementPay,
    leaveDeduction,
    totalPenalties,
    // SIL-841 (15/11) — the trip-money lines /salary renders beside lương
    // cứng; `timesheetTrips` names the count they were computed from.
    perTripPay,
    extraTripBonus,
    timesheetTrips: timesheet.trips,
    timesheetSalaryMode: effectiveSalaryMode,
    netSalary,
    confirmationStatus: confirmationRow?.status ?? 'DRAFT',
    confirmedBy: confirmationRow?.confirmedBy ?? null,
    confirmedAt: confirmationRow?.confirmedAt ?? null,
  };
}
