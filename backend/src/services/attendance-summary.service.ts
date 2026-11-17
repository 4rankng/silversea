/**
 * Attendance summary + work-day read primitives. Extracted from
 * attendance.service into a leaf so salary-calculation can consume them
 * without importing attendance.service (which in turn imports
 * salary-calculation's computeLiveSalary — that pair closed a runtime cycle).
 */
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db, type Executor } from '../db';
import * as s from '../db/schema';
import { resolveSalaryPeriodDateRange } from './salary-period.service';
import {
  boardTripDayMapFromRows,
  monthBucketsInRange,
  type CompletedTripLabel,
} from './salary-board-trip-days.service';
import { billBookingTitle } from '../lib/business-keys';
import {
  tripCompletionBusinessDateSql,
  tripCompletionBusinessDateTextSql,
} from './completion-business-date-sql.service';

/** How many Sundays are in a given month/year */
function countSundays(year: number, month: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(year, month - 1, d).getDay() === 0) count++;
  }
  return count;
}

/** Standard work days in a month = total days - sundays */
export function computeStandardWorkDays(year: number, month: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  return daysInMonth - countSundays(year, month);
}

/**
 * Get work days for a driver in a given date range.
 */
export async function getWorkDays(
  driverId: number,
  startDate: string,
  endDate: string,
  executor: Executor = db,
) {
  return executor.select().from(s.driverWorkDays)
    .where(and(
      eq(s.driverWorkDays.driverId, driverId),
      gte(s.driverWorkDays.date, startDate),
      lte(s.driverWorkDays.date, endDate),
    ))
    .orderBy(s.driverWorkDays.date);
}

/**
 * SIL-849 — the driver's trip-carrying chấm công board days within a salary
 * period: date → trips, same `countDayTrips` weighting /timesheet and Đối
 * chiếu pay from. A (possibly custom) period crossing calendar months reads
 * every board it touches.
 */
export async function getBoardTripDays(
  driverId: number,
  startDate: string,
  endDate: string,
  executor: Executor = db,
): Promise<Map<string, number>> {
  const buckets = monthBucketsInRange(startDate, endDate);
  if (buckets.length === 0) return new Map();
  const monthRows = await executor.select({ id: s.driverTimesheetMonths.id })
    .from(s.driverTimesheetMonths)
    .where(and(
      eq(s.driverTimesheetMonths.driverId, driverId),
      or(...buckets.map(bucket => and(
        eq(s.driverTimesheetMonths.year, bucket.year),
        eq(s.driverTimesheetMonths.month, bucket.month),
      ))),
    ));
  if (monthRows.length === 0) return new Map();
  const rows = await executor.select({
    symbol: s.driverTimesheetDays.symbol,
    workDate: s.driverTimesheetDays.workDate,
    tripAdjustment: s.driverTimesheetDays.tripAdjustment,
  }).from(s.driverTimesheetDays)
    .where(and(
      inArray(s.driverTimesheetDays.monthId, monthRows.map(row => row.id)),
      gte(s.driverTimesheetDays.workDate, startDate),
      lte(s.driverTimesheetDays.workDate, endDate),
    ));
  return boardTripDayMapFromRows(rows);
}

/**
 * SIL-849 — the trip labelling each board trip day: the driver's COMPLETED
 * internal-fleet trips whose SIL-683 business completion date is that day —
 * the same day-rule the board's auto symbols use (SIL-737). First completion
 * of the day wins the label.
 */
export async function getCompletedTripLabelByDay(
  driverId: number,
  dates: string[],
  executor: Executor = db,
): Promise<Map<string, CompletedTripLabel>> {
  const map = new Map<string, CompletedTripLabel>();
  if (dates.length === 0) return map;
  const rows = await executor.select({
    id: s.trips.id,
    completionDay: tripCompletionBusinessDateTextSql,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
    routeName: s.routes.name,
  }).from(s.trips)
    .innerJoin(s.trucks, eq(s.trucks.id, s.trips.truckId))
    .leftJoin(s.shipments, eq(s.shipments.id, s.trips.shipmentId))
    .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
    .where(and(
      eq(s.trips.driverId, driverId),
      eq(s.trips.status, 'COMPLETED'),
      isNull(s.trips.deletedAt),
      // Xe nội bộ: xe SilverSea, không thuộc nhà xe ngoài (SIL-737 rule).
      isNull(s.trucks.carrierId),
      isNull(s.trucks.deletedAt),
      or(...dates.map(date => sql`${tripCompletionBusinessDateSql()} = ${date}`)),
    ))
    .orderBy(asc(s.trips.completedAt));
  for (const row of rows) {
    if (!row.completionDay || map.has(row.completionDay)) continue;
    map.set(row.completionDay, {
      tripId: row.id,
      tripCode: billBookingTitle(row.blNumber, row.bookingRef),
      routeName: row.routeName,
    });
  }
  return map;
}

/**
 * Compute attendance summary for a driver in a month/year.
 */
export async function computeAttendanceSummary(
  driverId: number,
  year: number,
  month: number,
  executor: Executor = db,
) {
  // Resolve the salary period date range
  const period = await resolveSalaryPeriodDateRange(month, year);
  const { start, end } = period;

  const workDays = await getWorkDays(driverId, start, end, executor);
  const workDayMap = new Map(workDays.map(w => [w.date, w.status]));

  const startParts = start.split('-').map(Number);
  const endParts = end.split('-').map(Number);
  const cur = new Date(Date.UTC(startParts[0], startParts[1] - 1, startParts[2]));
  const stop = new Date(Date.UTC(endParts[0], endParts[1] - 1, endParts[2]));

  const dates: string[] = [];
  while (cur <= stop) {
    dates.push(cur.toISOString().split('T')[0]);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  let tripDays = 0;
  let standbyDays = 0;
  let personalLeaveDays = 0;
  let weeklyOffDays = 0;
  // SIL-841 (khách chốt 15/11) — miễn trừ 1 ngày phép có lương/tháng: ngày
  // PERSONAL_LEAVE T2–T7 đầu tiên vẫn được trả lương, các ngày sau trừ công
  // (chấm công ký hiệu: ngày công lương = ngày chuẩn − max(0, N − 1)).
  let personalLeaveDaysOnWorkday = 0;

  for (const dateStr of dates) {
    const status = workDayMap.get(dateStr);
    if (status) {
      if (status === 'TRIP_DAY') tripDays++;
      else if (status === 'STANDBY') standbyDays++;
      else if (status === 'PERSONAL_LEAVE') {
        personalLeaveDays++;
        const [y, m, d] = dateStr.split('-').map(Number);
        if (new Date(y, m - 1, d).getDay() !== 0) personalLeaveDaysOnWorkday++;
      }
      else if (status === 'WEEKLY_OFF') weeklyOffDays++;
    } else {
      // Default: Sunday is WEEKLY_OFF, non-Sunday is STANDBY
      const [y, m, d] = dateStr.split('-').map(Number);
      const isSunday = new Date(y, m - 1, d).getDay() === 0;
      if (isSunday) {
        weeklyOffDays++;
      } else {
        standbyDays++;
      }
    }
  }

  // Standard work days: calendar days - sundays in the calendar month
  const standardWorkDays = computeStandardWorkDays(year, month);

  return {
    driverId,
    year,
    month,
    periodStart: start,
    periodEnd: end,
    standardWorkDays,
    tripDays,
    standbyDays,
    personalLeaveDays,
    weeklyOffDays,
    // SIL-841 — ngày N (PERSONAL_LEAVE) T2–T7 đầu tiên của tháng miễn trừ:
    // trả tối đa 1 ngày phép trong paidDays.
    paidDays: tripDays + standbyDays + Math.min(1, personalLeaveDaysOnWorkday),
    workDays, // raw day records
  };
}

export type ConfirmationMap = Map<number, { status: string | null; confirmedBy: number | null; confirmedAt: Date | null; salarySnapshot?: Record<string, unknown> | null }>;
