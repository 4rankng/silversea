/**
 * Driver timesheet (chấm công lái xe) — the grid symbol vocabulary and the two
 * salary modes the customer fixed. Pure, dependency-free, shared by the API,
 * the rollup and the frontend grid so no surface can invent its own counting.
 *
 * Rules (accountant doc + owner ruling 2026-10-14):
 *   K = kẹp 2 cont 20  → 1 trip,  1 attended day (TWO containers, ONE trip)
 *   Q = quay đầu       → 2 trips, 1 attended day
 *   Đ = chạy đơn        → 1 trip,  1 attended day
 *   L = lưu ca          → 0 trips, 1 attended day (on standby)
 *   N = nghỉ           → 0 trips, 0 attended days
 *   P = nghỉ phép (xe hư) → 0 trips, 1 WORKDAY (paid, vehicle off the road)
 *
 * Sundays are NOT workdays (drivers are paid for Sunday separately), but the
 * trips a driver ran on a Sunday are still recorded. So every Sunday counts
 * 0 attended days regardless of its symbol.
 *
 * Salary modes per driver:
 *   PER_TRIP       — 300.000đ per trip + daily base, and from trip 21 onward
 *                    each trip adds another 100.000đ.
 *   FLAT_MONTHLY   — one monthly figure (e.g. 10.000.000đ).
 */

/** The five grid symbols plus the single-container symbol, in display order. */
export const TIMESHEET_SYMBOLS = ['K', 'Q', 'Đ', 'L', 'N', 'P'] as const;
export type TimesheetSymbol = typeof TIMESHEET_SYMBOLS[number];

export const TIMESHEET_SYMBOL_RULES: Record<
  TimesheetSymbol,
  { label: string; trips: number; workday: boolean }
> = {
  K: { label: 'Kẹp 2 cont', trips: 1, workday: true },
  Q: { label: 'Quay đầu', trips: 2, workday: true },
  'Đ': { label: 'Chạy đơn', trips: 1, workday: true },
  L: { label: 'Lưu ca', trips: 0, workday: true },
  N: { label: 'Nghỉ', trips: 0, workday: false },
  P: { label: 'Nghỉ phép (xe hư)', trips: 0, workday: true },
};

/** "không trốn vé" — paid per trip. */
export const PER_TRIP_RATE = 300_000;
/** From the 21st trip of the month onward each trip carries this extra amount. */
export const EXTRA_TRIP_THRESHOLD = 21;
export const EXTRA_TRIP_RATE = 100_000;

export const TIMESHEET_SALARY_MODES = ['PER_TRIP', 'FLAT_MONTHLY'] as const;
export type TimesheetSalaryMode = typeof TIMESHEET_SALARY_MODES[number];

export interface TimesheetSymbolCounts {
  K: number; Q: number; 'Đ': number; L: number; N: number; P: number;
}

export interface TimesheetDayInput {
  symbol: TimesheetSymbol | null;
  /** VN calendar day as YYYY-MM-DD. */
  workDate: string;
  /** Accountant correction in TRIPS; may be negative. */
  tripAdjustment?: number;
}

export interface TimesheetSalaryInput {
  days: TimesheetDayInput[];
  mode: TimesheetSalaryMode;
  /** Daily base pay — PER_TRIP only. */
  dailyBase?: number | null;
  /** Monthly flat figure — FLAT_MONTHLY only. */
  flatAmount?: number | null;
}

export interface TimesheetSalaryResult {
  mode: TimesheetSalaryMode;
  symbolCounts: TimesheetSymbolCounts;
  /** Trip-days carrying each symbol (Q counts once — the cell, not the trips). */
  symbolDays: TimesheetSymbolCounts;
  trips: number;
  /** Attended days: L/N/P plus K/Q/Đ, Sundays excluded. */
  workdays: number;
  /** Trips at or above the threshold, i.e. max(0, trips − 20). */
  bonusTrips: number;
  perTripPay: number;
  extraTripBonus: number;
  dailyBasePay: number;
  salaryTotal: number;
}

/** YYYY-MM-DD is a Sunday. Parsed in UTC so no local timezone can shift a day. */
export function isSundayUtc(isoDate: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return false;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay() === 0;
}

function nonNegative(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

function emptyCounts(): TimesheetSymbolCounts {
  return { K: 0, Q: 0, 'Đ': 0, L: 0, N: 0, P: 0 };
}

/**
 * Trips one grid cell contributes. A Sunday still records the trips the driver
 * ran; the adjustment is the accountant's signed correction on top.
 */
export function countDayTrips(day: TimesheetDayInput): number {
  if (!day.symbol) return 0;
  const base = TIMESHEET_SYMBOL_RULES[day.symbol].trips;
  const adjustment = Number.isFinite(day.tripAdjustment ?? 0) ? Math.trunc(day.tripAdjustment ?? 0) : 0;
  return base + adjustment;
}

/** Attended days one cell contributes. A Sunday is never an attended day. */
export function countDayWorkday(day: TimesheetDayInput): number {
  if (!day.symbol) return 0;
  if (!TIMESHEET_SYMBOL_RULES[day.symbol].workday) return 0;
  if (isSundayUtc(day.workDate)) return 0;
  return 1;
}

/** Sum the grid into per-symbol counts, trips, workdays and the salary. */
export function computeTimesheetSalary(input: TimesheetSalaryInput): TimesheetSalaryResult {
  const symbolCounts = emptyCounts();
  const symbolDays = emptyCounts();
  let trips = 0;
  let workdays = 0;

  for (const day of input.days) {
    const tripsToday = countDayTrips(day);
    if (day.symbol) {
      symbolDays[day.symbol] += 1;
      if (tripsToday > 0) symbolCounts[day.symbol] += tripsToday;
    }
    trips += tripsToday;
    workdays += countDayWorkday(day);
  }

  const bonusTrips = Math.max(0, trips - (EXTRA_TRIP_THRESHOLD - 1));

  if (input.mode === 'FLAT_MONTHLY') {
    return {
      mode: 'FLAT_MONTHLY',
      symbolCounts,
      symbolDays,
      trips,
      workdays,
      bonusTrips,
      perTripPay: 0,
      extraTripBonus: 0,
      dailyBasePay: 0,
      salaryTotal: nonNegative(input.flatAmount),
    };
  }

  const perTripPay = Math.max(0, trips) * PER_TRIP_RATE;
  const extraTripBonus = bonusTrips * EXTRA_TRIP_RATE;
  const dailyBasePay = workdays * nonNegative(input.dailyBase);

  return {
    mode: 'PER_TRIP',
    symbolCounts,
    symbolDays,
    trips,
    workdays,
    bonusTrips,
    perTripPay,
    extraTripBonus,
    dailyBasePay,
    // An accountant correction larger than the trips recorded would otherwise
    // hand the driver a negative payslip. The correction stays visible in
    // `trips`; only the money floors at zero.
    salaryTotal: Math.max(0, perTripPay + extraTripBonus + dailyBasePay),
  };
}

/** The month a YYYY-MM day belongs to, as `{ year, month }`. */
export function monthOfDay(workDate: string): { year: number; month: number } {
  const [year, month] = workDate.slice(0, 7).split('-').map(Number);
  return { year, month };
}

/** YYYY-MM-01 … YYYY-MM-last: every calendar day of the month, in order. */
export function daysOfMonth(year: number, month: number): string[] {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days: string[] = [];
  for (let day = 1; day <= last; day += 1) {
    days.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return days;
}