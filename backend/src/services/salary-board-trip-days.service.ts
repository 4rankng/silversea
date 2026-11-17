/**
 * SIL-849 — /salary trip-day authority = the chấm công board.
 *
 * The /salary month calendar and the 'Lương chuyến (N ngày)' cost split used
 * to read the legacy `driver_work_days` rows that `syncTripWorkDays` stamps
 * from a trip's departure→arrival range. That source disagrees with the
 * chấm công board (`driver_timesheet_days`) that /timesheet and Đối chiếu pay
 * from, which is the SIL-849 defect class:
 *   • a multi-day run painted one trip across 15 calendar days;
 *   • a Sunday trip (Đ on 1/11) carried its money but no trip day;
 *   • a reassigned trip left orphan TRIP_DAY rows on the previous driver, so
 *     the same lot (R3K-J2) bled across two drivers' calendars and cells
 *     flipped between loads as the best-effort resyncs raced.
 *
 * From now on the board decides WHICH days are trip days (same source as
 * `computeTimesheetSalary`); this module only shapes that decision. Pure and
 * db-free (the `completion-business-date-sql` seam) so the merge rules stay
 * unit-testable without a pool. Manual leave/standby rows remain the
 * accountant's attendance model — nothing here writes.
 */
import { countDayTrips, isSundayUtc, type TimesheetSymbol } from '@tingting/shared';

/** A `driver_timesheet_days` row the caller already read. */
export interface BoardDayRow {
  symbol: string | null;
  workDate: string;
  tripAdjustment?: number | null;
}

/** The (year, month) calendar buckets a YYYY-MM-DD range touches. */
export function monthBucketsInRange(start: string, end: string): Array<{ year: number; month: number }> {
  const [startYear, startMonth] = start.split('-').map(Number);
  const [endYear, endMonth] = end.split('-').map(Number);
  if (!startYear || !startMonth || !endYear || !endMonth) return [];
  const buckets: Array<{ year: number; month: number }> = [];
  for (let y = startYear, m = startMonth; y < endYear || (y === endYear && m <= endMonth);) {
    buckets.push({ year: y, month: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return buckets;
}

/**
 * Board cells that carry trips (Đ/K/Q, the accountant's `tripAdjustment`
 * included) — one entry per date. Same `countDayTrips` weighting the salary
 * and Đối chiếu use, so the calendar, the split and the money agree by
 * construction.
 */
export function boardTripDayMapFromRows(rows: BoardDayRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!row.symbol) continue;
    const trips = countDayTrips({
      symbol: row.symbol as TimesheetSymbol,
      workDate: row.workDate,
      tripAdjustment: row.tripAdjustment ?? 0,
    });
    if (trips > 0) map.set(row.workDate, trips);
  }
  return map;
}

/** The trip representing a board day's run(s), for the calendar cell label. */
export interface CompletedTripLabel {
  tripId: number;
  tripCode: string | null;
  routeName: string | null;
}

/** A `driver_work_days` row the caller already read. */
export interface LegacyWorkDayRow {
  id: number;
  driverId: number;
  date: string;
  status: string;
  tripId: number | null;
  note: string | null;
}

export type WorkDayStatus = 'TRIP_DAY' | 'STANDBY' | 'PERSONAL_LEAVE' | 'WEEKLY_OFF';

export interface MergedWorkDay {
  id: number;
  driverId: number;
  date: string;
  status: WorkDayStatus;
  tripId: number | null;
  note: string | null;
}

/**
 * The /salary calendar rows: board trip days over the accountant's manual
 * attendance rows.
 *
 *   • A board trip day WINS over any manual row — the legacy trip sync
 *     already overrode manual rows, and the board is the money source.
 *     id/note carry over so an accountant's note on the day survives.
 *   • A legacy sync TRIP_DAY the board does NOT confirm demotes to its
 *     attendance default (weekday STANDBY / Sunday WEEKLY_OFF), keeping
 *     id + note — the orphan/reassigned/never-completed rows stop painting
 *     trip days, which kills the cross-driver bleed and the load-to-load
 *     cell flips.
 *   • Manual STANDBY / PERSONAL_LEAVE / WEEKLY_OFF rows pass through
 *     untouched: the board decides trip days only, not leave.
 */
export function mergeBoardTripDaysIntoWorkDays(
  workDays: LegacyWorkDayRow[],
  boardTripDays: Map<string, number>,
  labelByDay: Map<string, CompletedTripLabel>,
  driverId: number,
): MergedWorkDay[] {
  const byDate = new Map(workDays.map(row => [row.date, row]));
  const merged: MergedWorkDay[] = [];

  for (const row of workDays) {
    if (boardTripDays.has(row.date)) continue; // rebuilt below from the board
    if (row.status === 'TRIP_DAY') {
      merged.push({
        id: row.id,
        driverId: row.driverId,
        date: row.date,
        status: isSundayUtc(row.date) ? 'WEEKLY_OFF' : 'STANDBY',
        tripId: null,
        note: row.note,
      });
      continue;
    }
    merged.push({
      id: row.id,
      driverId: row.driverId,
      date: row.date,
      status: row.status as WorkDayStatus,
      tripId: null,
      note: row.note,
    });
  }

  for (const [date] of boardTripDays) {
    const existing = byDate.get(date);
    const label = labelByDay.get(date);
    merged.push({
      id: existing?.id ?? 0,
      driverId,
      date,
      status: 'TRIP_DAY',
      tripId: label?.tripId ?? null,
      note: existing?.note ?? null,
    });
  }

  merged.sort((a, b) => a.date.localeCompare(b.date));
  return merged;
}

/** SIL-849 round 2 — day counts read straight off the merged calendar. */
export interface BoardMergedDayCounts {
  tripDays: number;
  standbyDays: number;
  weeklyOffDays: number;
}

/**
 * SIL-849 round 2 — the /salary day-count fields count the SAME merged
 * calendar the month calendar renders: every period date takes its merged row
 * status, a date with no row takes the attendance default (Sunday
 * WEEKLY_OFF / weekday STANDBY) exactly like the calendar's default-filled
 * cells. PERSONAL_LEAVE stays on the legacy attendance basis (pay math), so
 * it is not counted here. Pure — same merge rules as round 1.
 */
export function countBoardMergedDayStatuses(
  periodStart: string,
  periodEnd: string,
  merged: MergedWorkDay[],
): BoardMergedDayCounts {
  const counts: BoardMergedDayCounts = { tripDays: 0, standbyDays: 0, weeklyOffDays: 0 };
  const statusByDate = new Map(merged.map(row => [row.date, row.status]));
  const [startYear, startMonth, startDay] = periodStart.split('-').map(Number);
  const [endYear, endMonth, endDay] = periodEnd.split('-').map(Number);
  if (!startYear || !startMonth || !startDay || !endYear || !endMonth || !endDay) return counts;
  const cur = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  const stop = new Date(Date.UTC(endYear, endMonth - 1, endDay));
  while (cur <= stop) {
    const date = cur.toISOString().split('T')[0];
    const status = statusByDate.get(date) ?? (isSundayUtc(date) ? 'WEEKLY_OFF' : 'STANDBY');
    if (status === 'TRIP_DAY') counts.tripDays++;
    else if (status === 'STANDBY') counts.standbyDays++;
    else if (status === 'WEEKLY_OFF') counts.weeklyOffDays++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return counts;
}
