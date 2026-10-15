import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  countDayTrips,
  countDayWorkday,
  computeTimesheetSalary,
  daysOfMonth,
  EXTRA_TRIP_RATE,
  EXTRA_TRIP_THRESHOLD,
  isSundayUtc,
  PER_TRIP_RATE,
  TIMESHEET_SYMBOL_RULES,
  type TimesheetDayInput,
} from './timesheetSalary';

/** 2026-10: a Sunday falls on the 4th, 11th, 18th, 25th. */
const SUNDAY = '2026-10-11';
const SATURDAY = '2026-10-10';
const MONDAY = '2026-10-12';

function day(symbol: TimesheetDayInput['symbol'], workDate: string, tripAdjustment?: number): TimesheetDayInput {
  return { symbol, workDate, tripAdjustment };
}

describe('symbol → trips', () => {
  it('counts K as ONE trip even though it carries two containers', () => {
    assert.equal(countDayTrips(day('K', SATURDAY)), 1);
  });

  it('counts Q (quay đầu) as two trips', () => {
    assert.equal(countDayTrips(day('Q', SATURDAY)), 2);
  });

  it('counts Đ (chạy đơn) as one trip', () => {
    assert.equal(countDayTrips(day('Đ', SATURDAY)), 1);
  });

  it('counts L, N and P as zero trips', () => {
    assert.equal(countDayTrips(day('L', SATURDAY)), 0);
    assert.equal(countDayTrips(day('N', SATURDAY)), 0);
    assert.equal(countDayTrips(day('P', SATURDAY)), 0);
  });

  it('an empty cell contributes nothing', () => {
    assert.equal(countDayTrips(day(null, SATURDAY)), 0);
  });
});

describe('symbol → attended days', () => {
  it('counts K, Q, Đ, L and P as an attended day', () => {
    assert.equal(countDayWorkday(day('K', SATURDAY)), 1);
    assert.equal(countDayWorkday(day('Q', SATURDAY)), 1);
    assert.equal(countDayWorkday(day('Đ', SATURDAY)), 1);
    assert.equal(countDayWorkday(day('L', SATURDAY)), 1);
    assert.equal(countDayWorkday(day('P', SATURDAY)), 1);
  });

  it('counts N (nghỉ) as no attended day', () => {
    assert.equal(countDayWorkday(day('N', SATURDAY)), 0);
  });

  it('never counts a Sunday as an attended day, whatever the symbol', () => {
    assert.equal(countDayWorkday(day('Đ', SUNDAY)), 0);
    assert.equal(countDayWorkday(day('K', SUNDAY)), 0);
    assert.equal(countDayWorkday(day('Q', SUNDAY)), 0);
    assert.equal(countDayWorkday(day('L', SUNDAY)), 0);
    assert.equal(countDayWorkday(day('P', SUNDAY)), 0);
    assert.equal(countDayWorkday(day('N', SUNDAY)), 0);
  });

  it('still records the trips run on a Sunday', () => {
    assert.equal(countDayTrips(day('Đ', SUNDAY)), 1);
    assert.equal(countDayTrips(day('Q', SUNDAY)), 2);
  });

  it('identifies Sundays from an ISO day', () => {
    assert.equal(isSundayUtc('2026-10-11'), true);
    assert.equal(isSundayUtc('2026-10-12'), false);
    assert.equal(isSundayUtc('not-a-date'), false);
  });
});

describe('per-trip salary — 300.000đ/trip and the +100.000đ from trip 21', () => {
  const perTrip = (days: TimesheetDayInput[], dailyBase = 0) =>
    computeTimesheetSalary({ days, mode: 'PER_TRIP', dailyBase });

  it('pays 300.000đ per trip below the threshold', () => {
    // 20 single trips: 20 × 300.000
    const days = Array.from({ length: 20 }, (_, i) => day('Đ', `2026-10-${String(i + 1).padStart(2, '0')}`));
    const result = perTrip(days);
    assert.equal(result.trips, 20);
    assert.equal(result.bonusTrips, 0);
    assert.equal(result.perTripPay, 20 * PER_TRIP_RATE);
    assert.equal(result.extraTripBonus, 0);
    assert.equal(result.salaryTotal, 6_000_000);
  });

  it('pays exactly one extra trip at the 21st trip (boundary)', () => {
    const days = Array.from({ length: 21 }, (_, i) => day('Đ', `2026-10-${String(i + 1).padStart(2, '0')}`));
    const result = perTrip(days);
    assert.equal(result.trips, 21);
    assert.equal(result.bonusTrips, 1);
    assert.equal(EXTRA_TRIP_THRESHOLD, 21);
    assert.equal(result.extraTripBonus, EXTRA_TRIP_RATE);
    assert.equal(result.salaryTotal, 21 * PER_TRIP_RATE + EXTRA_TRIP_RATE);
    assert.equal(result.salaryTotal, 6_400_000);
  });

  it('pays the extra on every trip past the threshold', () => {
    const days = Array.from({ length: 25 }, (_, i) => day('Đ', `2026-10-${String(i + 1).padStart(2, '0')}`));
    const result = perTrip(days);
    assert.equal(result.trips, 25);
    assert.equal(result.bonusTrips, 5);
    assert.equal(result.salaryTotal, 25 * PER_TRIP_RATE + 5 * EXTRA_TRIP_RATE);
  });

  it('a Q (quay đầu) cell counts as two trips toward the threshold', () => {
    // 10 Q cells = 20 trips, still below the bonus.
    const below = Array.from({ length: 10 }, (_, i) => day('Q', `2026-10-${String(i + 1).padStart(2, '0')}`));
    assert.equal(perTrip(below).trips, 20);
    assert.equal(perTrip(below).bonusTrips, 0);
    // An 11th Q cell takes it to 22 trips → 2 bonus trips.
    const above = [...below, day('Q', '2026-10-11')];
    assert.equal(perTrip(above).trips, 22);
    assert.equal(perTrip(above).bonusTrips, 2);
  });

  it('adds the daily base per attended day and never for a Sunday', () => {
    const result = perTrip(
      [day('Đ', MONDAY), day('Đ', SUNDAY), day('L', '2026-10-13')],
      200_000,
    );
    assert.equal(result.trips, 2);
    assert.equal(result.workdays, 2, 'Monday + lưu ca; the Sunday is not an attended day');
    assert.equal(result.dailyBasePay, 400_000);
    assert.equal(result.salaryTotal, 2 * PER_TRIP_RATE + 400_000);
  });
});

describe('flat monthly salary', () => {
  it('pays the flat figure and ignores trips and workdays', () => {
    const result = computeTimesheetSalary({
      mode: 'FLAT_MONTHLY',
      flatAmount: 10_000_000,
      days: Array.from({ length: 20 }, (_, i) => day('Đ', `2026-10-${String(i + 1).padStart(2, '0')}`)),
    });
    assert.equal(result.salaryTotal, 10_000_000);
    assert.equal(result.perTripPay, 0);
    assert.equal(result.extraTripBonus, 0);
    assert.equal(result.dailyBasePay, 0);
    assert.equal(result.trips, 20, 'trips are still reported for the efficiency metrics');
  });

  it('pays zero when the flat amount is not configured', () => {
    assert.equal(computeTimesheetSalary({ mode: 'FLAT_MONTHLY', flatAmount: null, days: [] }).salaryTotal, 0);
  });
});

describe('accountant trip adjustments', () => {
  it('reduces trips by a negative adjustment', () => {
    const result = computeTimesheetSalary({
      mode: 'PER_TRIP',
      dailyBase: 0,
      days: [day('Q', MONDAY, -1)],
    });
    assert.equal(result.trips, 1);
    assert.equal(result.salaryTotal, PER_TRIP_RATE);
  });

  it('can remove a whole trip, taking the total to zero', () => {
    const result = computeTimesheetSalary({
      mode: 'PER_TRIP',
      days: [day('Đ', MONDAY, -1)],
    });
    assert.equal(result.trips, 0);
    assert.equal(result.salaryTotal, 0);
    assert.equal(result.bonusTrips, 0);
  });

  it('a large negative adjustment cannot drive the total below zero from a base of zero', () => {
    const result = computeTimesheetSalary({
      mode: 'PER_TRIP',
      days: [day('L', MONDAY, -5)],
    });
    assert.equal(result.salaryTotal, 0);
    assert.equal(result.trips, -5, 'the correction is reported verbatim; money never goes negative');
  });
});

describe('symbol counts and the month helper', () => {
  it('reports one entry per symbol cell and trips per symbol', () => {
    const result = computeTimesheetSalary({
      mode: 'PER_TRIP',
      days: [day('K', MONDAY), day('Q', '2026-10-13'), day('Q', '2026-10-14'), day('N', '2026-10-15')],
    });
    assert.equal(result.symbolDays.K, 1);
    assert.equal(result.symbolDays.Q, 2);
    assert.equal(result.symbolDays.N, 1);
    assert.equal(result.symbolCounts.K, 1);
    assert.equal(result.symbolCounts.Q, 4, 'two Q cells = four trips');
    assert.equal(result.trips, 5);
    assert.equal(result.workdays, 3, 'N is not an attended day');
  });

  it('exposes one rule per grid symbol', () => {
    assert.deepEqual(Object.keys(TIMESHEET_SYMBOL_RULES), ['K', 'Q', 'Đ', 'L', 'N', 'P']);
  });

  it('lists every calendar day of a month', () => {
    assert.equal(daysOfMonth(2026, 10).length, 31);
    assert.equal(daysOfMonth(2026, 2).length, 28);
    assert.equal(daysOfMonth(2026, 10)[0], '2026-10-01');
    assert.equal(daysOfMonth(2026, 10)[30], '2026-10-31');
  });
});