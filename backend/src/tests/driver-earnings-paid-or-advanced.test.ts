/**
 * paidOrAdvanced allow-list regression test.
 *
 * getDriverEarnings() (driver.service.ts) computes "Đã thanh toán / đã tạm
 * ứng" as the sum of cash-out debits on the DRIVER ledger for the period. The
 * filter must be an ALLOW-LIST of true cash types, because several DRIVER-ledger
 * debits are NOT cash and must not inflate this figure:
 *
 *   • PENALTY     — posts a debit, but it is a non-cash deduction already shown
 *                   separately on DriverEarningsPage as "Khấu trừ kỷ luật".
 *                   Counting it here double-counted and overstated cash paid.
 *   • ADJUSTMENT  — on the DRIVER ledger it is a reconciliation credit (penalty
 *                   cancellation), never a cash debit.
 *   • UNLOCK_REVERSAL — reverses a DRIVER_SALARY credit; excluded.
 *
 * Only DRIVER_PAYOUT is a true cash-out debit. (No separate driver-advance txn
 * type exists; advances are recorded as DRIVER_PAYOUT with method=CASH.)
 *
 * The full getDriverEarnings() path needs live Postgres:5440 (advisory lock +
 * append-only ledger), which is integration-tier. This test pins the DB-free
 * contract — the exported allow-list — so a regression that re-broadens the
 * filter fails here before it ships.
 *
 * Mirrors the pure-function style of b1-driver-payout.test.ts (node:test, no DB).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { TxnType } from '@tingting/shared';
import { PAID_OR_ADVANCED_TXN_TYPES } from '../services/driver.service';

describe('PAID_OR_ADVANCED_TXN_TYPES — cash-out allow-list', () => {
  test('includes DRIVER_PAYOUT (true cash payout)', () => {
    assert.ok(
      PAID_OR_ADVANCED_TXN_TYPES.includes(TxnType.DRIVER_PAYOUT),
      'DRIVER_PAYOUT is a cash debit on the DRIVER ledger and must count as paid/advanced',
    );
  });

  test('excludes PENALTY (non-cash deduction, shown separately as "Khấu trừ kỷ luật")', () => {
    assert.ok(
      !PAID_OR_ADVANCED_TXN_TYPES.includes(TxnType.PENALTY),
      'PENALTY posts a DRIVER-ledger debit but is a deduction, not cash paid — including it double-counts',
    );
  });

  test('excludes ADJUSTMENT (reconciliation, not cash)', () => {
    assert.ok(
      !PAID_OR_ADVANCED_TXN_TYPES.includes(TxnType.ADJUSTMENT),
      'ADJUSTMENT is reconciliation, not a cash payout',
    );
  });

  test('excludes UNLOCK_REVERSAL (reverses a DRIVER_SALARY credit)', () => {
    assert.ok(
      !PAID_OR_ADVANCED_TXN_TYPES.includes(TxnType.UNLOCK_REVERSAL),
      'UNLOCK_REVERSAL reverses accrued salary, not a cash payout',
    );
  });

  test('excludes DRIVER_SALARY (it is a credit, not a debit)', () => {
    assert.ok(
      !PAID_OR_ADVANCED_TXN_TYPES.includes(TxnType.DRIVER_SALARY),
      'DRIVER_SALARY accrues payable as a credit; it is never a cash-out debit',
    );
  });
});

/**
 * Predicate contract — mirrors the SQL CASE in getDriverEarnings:
 *   sum(debit) where txnType IN PAID_OR_ADVANCED_TXN_TYPES
 * This re-implements the filter over a synthetic ledger row set so the
 * "penalty must NOT count" invariant is asserted end-to-end at the query-shape
 * level without a DB.
 */
describe('paidOrAdvanced sum — penalty must NOT count, payout MUST count', () => {
  const countsAsPaid = (txnType: TxnType) =>
    (PAID_OR_ADVANCED_TXN_TYPES as readonly string[]).includes(txnType);

  const sumPaid = (rows: { txnType: TxnType; debit: number }[]) =>
    rows
      .filter((r) => countsAsPaid(r.txnType))
      .reduce((acc, r) => acc + r.debit, 0);

  test('a DRIVER_PAYOUT debit increases paidOrAdvanced', () => {
    const rows = [{ txnType: TxnType.DRIVER_PAYOUT, debit: 10_000_000 }];
    assert.strictEqual(sumPaid(rows), 10_000_000);
  });

  test('a PENALTY debit does NOT increase paidOrAdvanced', () => {
    const rows = [{ txnType: TxnType.PENALTY, debit: 2_000_000 }];
    assert.strictEqual(sumPaid(rows), 0);
  });

  test('payout + penalty mix: only the payout counts (no double-count)', () => {
    const rows = [
      { txnType: TxnType.DRIVER_SALARY, debit: 0 },   // credit row, debit 0
      { txnType: TxnType.DRIVER_PAYOUT, debit: 8_000_000 },
      { txnType: TxnType.PENALTY, debit: 2_000_000 },
      { txnType: TxnType.UNLOCK_REVERSAL, debit: 1_000_000 },
      { txnType: TxnType.ADJUSTMENT, debit: 0 },
    ];
    // Before the fix this would have been 8M + 2M + 1M = 11M (penalty + reversal
    // leaked in). After the fix it is exactly the cash payout.
    assert.strictEqual(sumPaid(rows), 8_000_000);
  });
});
