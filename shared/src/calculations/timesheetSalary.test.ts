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
  timesheetSymbolForDay,
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

describe('per-trip salary — SIL-841 (15/11): 100.000đ/chuyến + KPI vượt chuyến', () => {
  const perTrip = (days: TimesheetDayInput[], dailyBase = 0) =>
    computeTimesheetSalary({ days, mode: 'PER_TRIP', dailyBase });

  it('pays 100.000đ per trip below the threshold', () => {
    // 20 single trips: 20 × 100.000
    const days = Array.from({ length: 20 }, (_, i) => day('Đ', `2026-10-${String(i + 1).padStart(2, '0')}`));
    const result = perTrip(days);
    assert.equal(result.trips, 20);
    assert.equal(result.bonusTrips, 0);
    assert.equal(result.perTripPay, 20 * PER_TRIP_RATE);
    assert.equal(result.extraTripBonus, 0);
    assert.equal(result.salaryTotal, 2_000_000);
  });

  it('pays exactly one KPI trip at the 21st trip (boundary)', () => {
    const days = Array.from({ length: 21 }, (_, i) => day('Đ', `2026-10-${String(i + 1).padStart(2, '0')}`));
    const result = perTrip(days);
    assert.equal(result.trips, 21);
    assert.equal(result.bonusTrips, 1);
    assert.equal(EXTRA_TRIP_THRESHOLD, 21);
    assert.equal(result.extraTripBonus, EXTRA_TRIP_RATE);
    assert.equal(result.salaryTotal, 21 * PER_TRIP_RATE + EXTRA_TRIP_RATE);
    assert.equal(result.salaryTotal, 2_200_000);
  });

  it('pays the KPI on every trip past the threshold', () => {
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

  it('lương cứng trả theo NGÀY CÔNG LƯƠNG (ngày chuẩn − max(0, N−1)), không phải ngày đi làm', () => {
    // Đ T2 + N T4 + N T5 + L T6: đi làm thực tế 2 ngày nhưng ngày công lương
    // là 3 — ngày N đầu tiên của tháng được miễn trừ.
    const days = [day('Đ', MONDAY), day('N', '2026-10-13'), day('N', '2026-10-14'), day('L', '2026-10-15')];
    const result = perTrip(days, 200_000);
    assert.equal(result.workdays, 2, 'attended days: Đ + L; N is not an attended day');
    assert.equal(result.standardDays, 4, 'ngày chuẩn T2–T7 of the passed days');
    assert.equal(result.paidSalaryDays, 3);
    assert.equal(result.dailyBasePay, 600_000);
    assert.equal(result.salaryTotal, PER_TRIP_RATE + 600_000);
  });
});

describe('flat monthly salary — SIL-841 (15/11): lương cứng theo ngày công', () => {
  /** Full October 2026 grid (31 days; Sundays 4/11/18/25 → 27 ngày chuẩn). */
  const fullMonth = (symbolAt: (date: string) => TimesheetDayInput['symbol']) =>
    daysOfMonth(2026, 10).map(date => day(symbolAt(date), date));

  it('trốn vé: lương cứng = mức tháng / ngày chuẩn × ngày công lương', () => {
    // 10.800.000đ / 27 ngày chuẩn = 400.000đ/ngày; 2 ngày N → 26 ngày công lương.
    const days = fullMonth(date => (date === '2026-10-13' || date === '2026-10-14' ? 'N' : 'Đ'));
    const result = computeTimesheetSalary({ mode: 'FLAT_MONTHLY', flatAmount: 10_800_000, days });
    assert.equal(result.standardDays, 27);
    assert.equal(result.paidSalaryDays, 26);
    assert.equal(result.dailyBasePay, 10_400_000);
    assert.equal(result.salaryTotal, 10_400_000);
    assert.equal(result.perTripPay, 0);
    assert.equal(result.extraTripBonus, 0);
    assert.equal(result.trips, 29, 'trips are still reported for the efficiency metrics');
  });

  it('miễn trừ 1 ngày phép: N = 1 vẫn trả đủ ngày chuẩn', () => {
    const days = fullMonth(date => (date === '2026-10-13' ? 'N' : 'Đ'));
    const result = computeTimesheetSalary({ mode: 'FLAT_MONTHLY', flatAmount: 10_800_000, days });
    assert.equal(result.paidSalaryDays, 27);
    assert.equal(result.salaryTotal, 10_800_000);
  });

  it('ngày chuẩn truyền tường minh khi lưới thưa (rollup chỉ có dòng đã ghi)', () => {
    const result = computeTimesheetSalary({
      mode: 'FLAT_MONTHLY',
      flatAmount: 10_800_000,
      standardDays: 27,
      days: [day('N', '2026-10-13'), day('N', '2026-10-14')],
    });
    assert.equal(result.standardDays, 27);
    assert.equal(result.workdays, 0);
    assert.equal(result.paidSalaryDays, 26, '27 ngày chuẩn − max(0, 2−1)');
    assert.equal(result.salaryTotal, 400_000 * 26);
  });

  it('rounds the daily rate, then multiplies the salary days', () => {
    // 10.000.000 / 27 = 370.370,37 → 370.370đ/ngày × 26 ngày.
    const days = fullMonth(date => (date === '2026-10-13' || date === '2026-10-14' ? 'N' : 'Đ'));
    const result = computeTimesheetSalary({ mode: 'FLAT_MONTHLY', flatAmount: 10_000_000, days });
    assert.equal(result.dailyBasePay, 9_629_620);
  });

  it('pays zero when the flat amount is not configured', () => {
    assert.equal(computeTimesheetSalary({ mode: 'FLAT_MONTHLY', flatAmount: null, days: fullMonth(() => 'Đ') }).salaryTotal, 0);
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
    assert.equal(result.standardDays, 4, 'K/Q/Q/N all fall T2–T6 in Oct 2026');
    assert.equal(result.paidSalaryDays, 4, 'the single N day is the exempt one');
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

describe('day → symbol (SIL-737, chuyến hoàn thành tự ghi ký hiệu)', () => {
  it('writes no symbol for a day without a completed trip', () => {
    assert.equal(timesheetSymbolForDay([]), null);
  });

  it('writes Đ for a single ordinary run', () => {
    assert.equal(timesheetSymbolForDay(['DON']), 'Đ');
  });

  it('writes Đ for a single lẻ run — a lẻ run is one trip, one attended day', () => {
    assert.equal(timesheetSymbolForDay(['LAY_LE']), 'Đ');
  });

  it('writes K for a single kẹp run (two containers, ONE trip)', () => {
    assert.equal(timesheetSymbolForDay(['KEP']), 'K');
  });

  it('writes Q for a day with two trips (quay đầu)', () => {
    assert.equal(timesheetSymbolForDay(['DON', 'DON']), 'Q');
    assert.equal(timesheetSymbolForDay(['KET_HOP', 'KET_HOP']), 'Q');
  });

  it('keeps the trip count honest for a kết hợp pair split over two days', () => {
    // Each leg on its own day = one trip that day ⇒ two days of Đ = two trips.
    assert.equal(timesheetSymbolForDay(['KET_HOP']), 'Đ');
    assert.equal(timesheetSymbolForDay(['KET_HOP']), 'Đ');
  });

  it('counts a busier day as Q — the grid has no symbol for 3+ trips', () => {
    assert.equal(timesheetSymbolForDay(['DON', 'DON', 'DON']), 'Q');
  });
});
describe('TIMESHEET_SYMBOL_RULES — SIL-774 (khách chốt 09/11/2026, Bảng 4)', () => {
  it('N = nghỉ tai nạn / nghỉ việc gia đình có phép; P = nghỉ sửa xe / bảo dưỡng định kỳ', () => {
    assert.equal(TIMESHEET_SYMBOL_RULES.N.label, 'Nghỉ tai nạn / nghỉ việc gia đình có phép');
    assert.equal(TIMESHEET_SYMBOL_RULES.P.label, 'Nghỉ sửa xe / bảo dưỡng định kỳ');
  });

  it('trọng số tiền lương không đổi: N không phải ngày công, P vẫn tính ngày công', () => {
    assert.equal(TIMESHEET_SYMBOL_RULES.N.trips, 0);
    assert.equal(TIMESHEET_SYMBOL_RULES.N.workday, false);
    assert.equal(TIMESHEET_SYMBOL_RULES.P.trips, 0);
    assert.equal(TIMESHEET_SYMBOL_RULES.P.workday, true);
  });
});
describe('TIMESHEET_SYMBOL_RULES — SIL-841 đếm cột tổng (summaryTrips, 15/11)', () => {
  it('Q = 2 chuyến ở CẢ trọng số lương và cột tổng (thay SIL-810)', () => {
    assert.equal(TIMESHEET_SYMBOL_RULES.Q.trips, 2, 'lương theo chuyến giữ Q = 2');
    assert.equal(TIMESHEET_SYMBOL_RULES.Q.summaryTrips, 2, 'cột tổng: mỗi ngày Q = 2 chuyến');
  });

  it('Tổng số chuyến = Đ + K + 2·Q: summaryTrips của K/Đ là 1, L/N/P là 0', () => {
    assert.equal(TIMESHEET_SYMBOL_RULES.K.summaryTrips, 1);
    assert.equal(TIMESHEET_SYMBOL_RULES['Đ'].summaryTrips, 1);
    assert.equal(TIMESHEET_SYMBOL_RULES.L.summaryTrips, 0);
    assert.equal(TIMESHEET_SYMBOL_RULES.N.summaryTrips, 0);
    assert.equal(TIMESHEET_SYMBOL_RULES.P.summaryTrips, 0);
  });
});
