// SIL-860 — 'trốn vé' (FLAT_MONTHLY) sync law between Đối chiếu and /salary.
//
// QA fail ×2 (22/11): kế toán saves 'Lương tháng cố định' 12.000.000 on
// /timesheet/doi-chieu (board driver_timesheet_months.flat_amount) and Đối
// chiếu pays it, while /salary kept Lương cứng 0 ₫ — computeLiveSalary read
// the driver catalog baseSalary and never the board figure. The laws pinned
// here:
// - /salary's monthly hard base follows the same board-first law as the mode:
//   board flat_amount wins for FLAT_MONTHLY, the catalog baseSalary is the
//   fallback only (no board figure yet), and PER_TRIP ignores a board flat.
// - The /salary money algebra (monthlyHardBase + (paidDays − standardWorkDays)
//   × dailyRate) collapses to dailyRate × paidDays — EXACTLY the board's
//   dailyBasePay — so the two screens cannot disagree on a trốn-vé month.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { computeTimesheetSalary, daysOfMonth, isSundayUtc } from '@tingting/shared';

import { resolveMonthlyHardBase } from '../../services/salary-calculation.service';

describe('SIL-860 — resolveMonthlyHardBase (board-first trốn vé money)', () => {
  test('FLAT_MONTHLY: the board fixed-monthly figure wins over the catalog', () => {
    assert.equal(resolveMonthlyHardBase('FLAT_MONTHLY', 12_000_000, 0), 12_000_000);
  });

  test('FLAT_MONTHLY: a stale catalog figure loses to the board too', () => {
    assert.equal(resolveMonthlyHardBase('FLAT_MONTHLY', 12_000_000, 8_000_000), 12_000_000);
  });

  test('FLAT_MONTHLY without a board figure (null) falls back to the catalog', () => {
    assert.equal(resolveMonthlyHardBase('FLAT_MONTHLY', null, 8_000_000), 8_000_000);
  });

  test('FLAT_MONTHLY with no board row at all falls back to the catalog', () => {
    assert.equal(resolveMonthlyHardBase('FLAT_MONTHLY', undefined, 8_000_000), 8_000_000);
  });

  test('PER_TRIP never eats a board flat — catalog stays the basis', () => {
    assert.equal(resolveMonthlyHardBase('PER_TRIP', 12_000_000, 8_000_000), 8_000_000);
    assert.equal(resolveMonthlyHardBase('PER_TRIP', null, 8_000_000), 8_000_000);
  });
});

/** The QA repro as a full-month board: 11/2026 has 25 non-Sunday days. */
function boardDays11_2026(symbol: 'Đ' | 'L' | 'N') {
  return daysOfMonth(2026, 11)
    .filter((workDate) => !isSundayUtc(workDate))
    .map((workDate) => ({ symbol, workDate }));
}

describe('SIL-860 — Đối chiếu and /salary agree on a trốn-vé month', () => {
  const STANDARD_DAYS = 25; // NGÀY CHUẨN T2–T7 of 11/2026
  const FLAT = 12_000_000; // 'Lương tháng cố định' typed on Đối chiếu

  test('full attendance month: /salary pays the board 12.000.000 ₫', () => {
    const basis = resolveMonthlyHardBase('FLAT_MONTHLY', FLAT, 0);
    const dailyRate = Math.round(basis / STANDARD_DAYS);
    const paidDays = STANDARD_DAYS;
    const salaryNetHard = basis + (paidDays - STANDARD_DAYS) * dailyRate;
    const board = computeTimesheetSalary({
      mode: 'FLAT_MONTHLY', dailyBase: null, flatAmount: FLAT,
      standardDays: STANDARD_DAYS, days: boardDays11_2026('Đ'),
    });
    assert.equal(salaryNetHard, 12_000_000);
    assert.equal(salaryNetHard, board.salaryTotal);
    assert.equal(board.paidSalaryDays, 25);
  });

  test('one day beyond the paid-leave exemption (N=2 → 24 ngày công lương): still equal', () => {
    const basis = resolveMonthlyHardBase('FLAT_MONTHLY', FLAT, 0);
    const dailyRate = Math.round(basis / STANDARD_DAYS);
    const paidDays = 24;
    const salaryNetHard = basis + (paidDays - STANDARD_DAYS) * dailyRate;
    const board = computeTimesheetSalary({
      mode: 'FLAT_MONTHLY', dailyBase: null, flatAmount: FLAT,
      standardDays: STANDARD_DAYS,
      // 23 Đ days + 2 N days: ngày công lương = 25 − max(0, 2 − 1) = 24.
      days: [
        ...boardDays11_2026('Đ').slice(0, 23),
        { symbol: 'N' as const, workDate: '2026-11-27' },
        { symbol: 'N' as const, workDate: '2026-11-30' },
      ],
    });
    assert.equal(board.paidSalaryDays, 24);
    assert.equal(salaryNetHard, Math.round(FLAT / STANDARD_DAYS) * 24);
    assert.equal(salaryNetHard, board.salaryTotal);
  });
});
