/**
 * Card 061026221213 — "quá hạn" is the CONTRACTUAL overdue metric, not debt age.
 *
 * An obligation is overdue when the as-of date is past its effective due date
 * (processingDueDate ?? originalDueDate ?? issue date — the payment-term
 * authority's rule, M5.1/Q19). The aging bands are due-status bands (cut at 30
 * and 90 days past due) and `maxOverdueDays` is the largest overdue span
 * (0 = nobody past due). The reported defect: debt AGE drove both, so a 22-day
 * overdue row read "Trong hạn" while its "Quá hạn" cell said "22 ngày" and
 * every summary tile counted 0.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFifoAging } from '@tingting/shared';
import { summarizeAgingTotals } from '../../services/aging.service';

// Fixed as-of so overdue spans are exact: 2026-10-06 (UTC day math).
const AS_OF = new Date('2026-10-06T00:00:00Z');

const aging = (current: number, d30: number, d60: number, over90: number) => ({ current, d30, d60, over90 });

describe('computeFifoAging — bands are contractual due-status, not age', () => {
  test('young-but-overdue lands in the past-due band; old-but-in-term stays "Trong hạn"', () => {
    const { aging: bands, openInvoices } = computeFifoAging([
      // Young debt, short terms: 20 days old, due at issue+7 → 13 days overdue.
      { timestamp: '2026-09-16T00:00:00Z', debit: 5_000_000, credit: 0, dueDate: '2026-09-23' },
      // Old debt, long terms: 40 days old, due at issue+60 → NOT due yet.
      { timestamp: '2026-08-27T00:00:00Z', debit: 7_000_000, credit: 0, dueDate: '2026-10-26' },
      // Legacy row without a frozen due date falls back to the issue date.
      { timestamp: '2026-10-01T00:00:00Z', debit: 3_000_000, credit: 0 },
    ], AS_OF);

    assert.deepEqual(bands, { current: 7_000_000, d30: 8_000_000, d60: 0, over90: 0 });

    const byTs = [...openInvoices].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    assert.equal(byTs[0].overdueDays, 0, 'old-but-in-term debt is not overdue');
    assert.equal(byTs[1].overdueDays, 13, 'young-but-overdue debt counts its contractual overdue days');
    // Fallback = issue date → the 5-day-old legacy debit is 5 days past due.
    assert.equal(byTs[2].overdueDays, 5, 'un-dated debt is due at issue (house fallback)');
    assert.equal(Math.max(...openInvoices.map((inv) => inv.overdueDays)), 13);
  });

  test('the 90-day cut keys the over90 band by days past due, not age', () => {
    const { aging: bands } = computeFifoAging([
      // Issued 100 days ago, due at issue+120 → still in term.
      { timestamp: '2026-06-28T00:00:00Z', debit: 1_000_000, credit: 0, dueDate: '2026-10-26' },
      // Issued 100 days ago with no frozen due date → 100 days past due.
      { timestamp: '2026-06-28T00:00:00Z', debit: 2_000_000, credit: 0 },
    ], AS_OF);

    assert.deepEqual(bands, { current: 1_000_000, d30: 0, d60: 0, over90: 2_000_000 });
  });
});

describe('summarizeAgingTotals — the KPI "Quá hạn" counts contractual overdue rows', () => {
  test('a young-but-overdue customer is counted', () => {
    const totals = summarizeAgingTotals([
      { totalOutstanding: 5_000_000, maxOverdueDays: 13, aging: aging(5_000_000, 0, 0, 0) },
      { totalOutstanding: 3_000_000, maxOverdueDays: 5, aging: aging(3_000_000, 0, 0, 0) },
    ]);
    assert.equal(totals.overdueCount, 2);
  });

  test('an old-but-in-term customer is never counted, whatever its debt age', () => {
    const totals = summarizeAgingTotals([
      { totalOutstanding: 7_000_000, maxOverdueDays: 0, aging: aging(7_000_000, 0, 0, 0) },
    ]);
    assert.equal(totals.overdueCount, 0);
  });
});
