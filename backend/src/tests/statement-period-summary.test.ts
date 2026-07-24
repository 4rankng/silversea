import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computePeriodSummary, normalizeDateParam } from '../services/statement.service';

/**
 * Unit tests for the AR/AP period summary helper.
 *
 * The helper backs the "Số dư đầu kỳ / Phát sinh trong kỳ / Số dư cuối kỳ"
 * cards on the debt/payable detail pages. It is accounting-adjacent logic, so
 * opening balances are derived from dated activity rather than stored running
 * balances, so backdated entries remain in the correct accounting period.
 */

type Row = { id: number; timestamp: Date; debit: string | null; credit: string | null; balance: string };
const iso = (s: string) => new Date(s);
const row = (id: number, ts: string, debit: number, credit: number, balance: number): Row => ({
  id,
  timestamp: iso(ts),
  debit: String(debit),
  credit: String(credit),
  balance: String(balance),
});

describe('computePeriodSummary', () => {
  test('returns null when no date bounds are provided', () => {
    assert.equal(computePeriodSummary([], undefined, undefined, 'CUSTOMER'), null);
    assert.equal(computePeriodSummary([row(1, '2025-01-01', 100, 0, 100)], undefined, undefined, 'VENDOR'), null);
  });

  test('opening balance = 0 when no rows precede dateFrom', () => {
    // AR (CUSTOMER): one debit of 100 in-period → activity = +100, opening = 0.
    const rows = [row(1, '2025-06-15', 100, 0, 100)];
    const summary = computePeriodSummary(rows, '2025-06-01', '2025-06-30', 'CUSTOMER');
    assert.ok(summary);
    assert.equal(summary!.openingBalance, 0);
    assert.equal(summary!.debitTotal, 100);
    assert.equal(summary!.creditTotal, 0);
    assert.equal(summary!.periodActivity, 100);
    assert.equal(summary!.closingBalance, 100);
  });

  test('opening balance is the net activity of all pre-period rows', () => {
    // 5 rows (Jan→May), dateFrom = 2025-03-01. Pre-period rows: Jan (id 1),
    // Feb (id 2). The latest pre-period balance is Feb's (250), not Jan's (100).
    // The DB may return these newest-first; order must not affect the result.
    const rows = [
      row(5, '2025-05-20', 0, 50, 350),
      row(4, '2025-04-20', 100, 0, 400),
      row(3, '2025-03-15', 100, 0, 300),
      row(2, '2025-02-20', 150, 0, 250),
      row(1, '2025-01-20', 100, 0, 100),
    ];
    const summary = computePeriodSummary(rows, '2025-03-01', '2025-05-31', 'CUSTOMER');
    assert.ok(summary);
    assert.equal(summary!.openingBalance, 250, 'opening must be Feb (250), not Jan (100)');
    assert.equal(summary!.debitTotal, 200); // Mar + Apr debits
    assert.equal(summary!.creditTotal, 50); // May credit
    assert.equal(summary!.periodActivity, 150); // AR: 200 - 50
    assert.equal(summary!.closingBalance, 400); // 250 + 150
  });

  test('backdated AP payment contributes to opening by business date, not insertion balance', () => {
    const rows = [
      row(1, '2025-07-25T00:00:00.000Z', 0, 100, 100),
      row(2, '2025-07-24T00:00:00.000Z', 40, 0, 60),
    ];
    const summary = computePeriodSummary(rows, '2025-07-25', '2025-07-25', 'VENDOR');
    assert.ok(summary);
    assert.equal(summary!.openingBalance, -40);
    assert.equal(summary!.periodActivity, 100);
    assert.equal(summary!.closingBalance, 60);
  });

  test('AR sign convention: periodActivity = debitTotal − creditTotal', () => {
    const rows = [
      row(1, '2025-06-10', 500, 0, 500),   // revenue (debit)
      row(2, '2025-06-20', 0, 200, 300),   // payment received (credit)
    ];
    const summary = computePeriodSummary(rows, '2025-06-01', '2025-06-30', 'CUSTOMER');
    assert.ok(summary);
    assert.equal(summary!.debitTotal, 500);
    assert.equal(summary!.creditTotal, 200);
    assert.equal(summary!.periodActivity, 300); // outstanding grew
    assert.equal(summary!.closingBalance, 300);
  });

  test('AP sign convention: periodActivity = creditTotal − debitTotal', () => {
    // VENDOR: credit grows payable, debit shrinks it (payment).
    const rows = [
      row(1, '2025-06-10', 0, 500, 500),   // expense recorded (credit)
      row(2, '2025-06-20', 200, 0, 300),   // vendor payment (debit)
    ];
    const summary = computePeriodSummary(rows, '2025-06-01', '2025-06-30', 'VENDOR');
    assert.ok(summary);
    assert.equal(summary!.debitTotal, 200);
    assert.equal(summary!.creditTotal, 500);
    assert.equal(summary!.periodActivity, 300); // payable grew
    assert.equal(summary!.closingBalance, 300);
  });

  test('range with only dateFrom filters lower bound, opening computed normally', () => {
    const rows = [
      row(2, '2025-04-10', 0, 100, 400),   // in-period
      row(1, '2025-02-10', 500, 0, 500),   // pre-period (opening = 500)
    ];
    const summary = computePeriodSummary(rows, '2025-03-01', undefined, 'CUSTOMER');
    assert.ok(summary);
    assert.equal(summary!.openingBalance, 500);
    assert.equal(summary!.creditTotal, 100); // only Apr row is in-period
    assert.equal(summary!.periodActivity, -100);
    assert.equal(summary!.closingBalance, 400);
  });

  test('range with only dateTo filters upper bound, opening = 0 (no lower bound)', () => {
    const rows = [
      row(1, '2025-01-10', 100, 0, 100),
      row(2, '2025-02-10', 100, 0, 200),
      row(3, '2025-04-10', 100, 0, 300),  // after dateTo, excluded
    ];
    const summary = computePeriodSummary(rows, undefined, '2025-03-31', 'CUSTOMER');
    assert.ok(summary);
    // No dateFrom → no pre-period window → opening stays 0.
    assert.equal(summary!.openingBalance, 0);
    assert.equal(summary!.debitTotal, 200); // Jan + Feb
    assert.equal(summary!.periodActivity, 200);
    assert.equal(summary!.closingBalance, 200);
  });

  test('empty in-period range yields zero activity and opening === closing', () => {
    const rows = [row(1, '2025-01-10', 500, 0, 500)]; // pre-period only
    const summary = computePeriodSummary(rows, '2025-06-01', '2025-06-30', 'CUSTOMER');
    assert.ok(summary);
    assert.equal(summary!.openingBalance, 500);
    assert.equal(summary!.debitTotal, 0);
    assert.equal(summary!.creditTotal, 0);
    assert.equal(summary!.periodActivity, 0);
    assert.equal(summary!.closingBalance, 500);
  });

  test('preserves dateFrom/dateTo verbatim (or null when absent)', () => {
    const rows: Row[] = [];
    const a = computePeriodSummary(rows, '2025-06-01', '2025-06-30', 'CUSTOMER');
    assert.equal(a!.dateFrom, '2025-06-01');
    assert.equal(a!.dateTo, '2025-06-30');

    const b = computePeriodSummary(rows, '2025-06-01', undefined, 'CUSTOMER');
    assert.equal(b!.dateFrom, '2025-06-01');
    assert.equal(b!.dateTo, null);
  });
});

describe('normalizeDateParam', () => {
  test('accepts well-formed YYYY-MM-DD', () => {
    assert.equal(normalizeDateParam('2025-06-15'), '2025-06-15');
    assert.equal(normalizeDateParam(undefined), undefined);
  });

  test('rejects malformed input (degrades to "no filter" instead of NaN comparisons)', () => {
    assert.equal(normalizeDateParam('abc'), undefined);
    assert.equal(normalizeDateParam('2025/06/15'), undefined);
    assert.equal(normalizeDateParam('15-06-2025'), undefined);
    assert.equal(normalizeDateParam('2025-13-40'), undefined); // invalid month/day
    assert.equal(normalizeDateParam(''), undefined);
  });
});
