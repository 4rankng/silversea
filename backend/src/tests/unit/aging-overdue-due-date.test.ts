/**
 * Aging semantics after owner ruling 29/10 (SIL-580): the aging BANDS count
 * from the RECORDING DATE (entry timestamp — ngày phát sinh phải thu/trả trên
 * chứng từ) to the as-of date, cut at 30/60/90. This supersedes card
 * 061026221213 for the bands only: `overdueDays` / `maxOverdueDays` stay the
 * CONTRACTUAL overdue span (days past the effective due date
 * processingDueDate ?? originalDueDate ?? issue date — M5.1/Q19, counted at
 * > 0) and keep driving the KPI "Quá hạn". A frozen dueDate never moves a
 * bucket; a not-yet-due debt can still age into a past-due band.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFifoAging } from '@tingting/shared';
import { summarizeAgingTotals } from '../../services/aging.service';

// Fixed as-of so overdue spans are exact: 2026-10-06 (UTC day math).
const AS_OF = new Date('2026-10-06T00:00:00Z');

const aging = (current: number, d30: number, d60: number, over90: number) => ({ current, d30, d60, over90 });

describe('computeFifoAging — bands count from the recording date; overdueDays stays contractual', () => {
  test('bands follow the recording date while overdueDays stays contractual', () => {
    const { aging: bands, openInvoices } = computeFifoAging([
      // Recorded 2026-09-16 → 20 days before the as-of date → current band,
      // though contractually 13 days overdue (due at issue+7).
      { timestamp: '2026-09-16T00:00:00Z', debit: 5_000_000, credit: 0, dueDate: '2026-09-23' },
      // Recorded 2026-08-27 → 40 days before the as-of date → 30–60 band,
      // though NOT due yet (due at issue+60).
      { timestamp: '2026-08-27T00:00:00Z', debit: 7_000_000, credit: 0, dueDate: '2026-10-26' },
      // Recorded 2026-10-01 → 5 days before the as-of date → current band.
      { timestamp: '2026-10-01T00:00:00Z', debit: 3_000_000, credit: 0 },
    ], AS_OF);

    assert.deepEqual(bands, { current: 8_000_000, d30: 7_000_000, d60: 0, over90: 0 });

    const byTs = [...openInvoices].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    assert.equal(byTs[0].overdueDays, 0, 'old-but-in-term debt is not contractually overdue');
    assert.equal(byTs[1].overdueDays, 13, 'young-but-overdue debt counts its contractual overdue days');
    // Fallback = issue date → the 5-day-old legacy debit is 5 days past due.
    assert.equal(byTs[2].overdueDays, 5, 'un-dated debt is due at issue (house fallback)');
    assert.equal(Math.max(...openInvoices.map((inv) => inv.overdueDays)), 13);
  });

  test('the 90-day cut keys the over90 band by age from the recording date, whatever the due date', () => {
    const { aging: bands } = computeFifoAging([
      // Recorded 100 days ago, due at issue+120 → still in term, yet its AGE
      // puts it beyond the 90-day cut.
      { timestamp: '2026-06-28T00:00:00Z', debit: 1_000_000, credit: 0, dueDate: '2026-10-26' },
      // Recorded 100 days ago with no frozen due date → same age cut.
      { timestamp: '2026-06-28T00:00:00Z', debit: 2_000_000, credit: 0 },
    ], AS_OF);

    assert.deepEqual(bands, { current: 0, d30: 0, d60: 0, over90: 3_000_000 });
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
