import { test, describe } from 'node:test';
import assert from 'node:assert';
import { computeFifoAging, maxOverdueDaysOf } from './fifoAging.ts';
import type { FifoAgingInput } from './fifoAging.ts';

// Contract (owner ruling 29/10, SIL-580): the aging buckets are AGE bands
// counted from the RECORDING DATE (entry timestamp — ngày phát sinh phải thu /
// phải trả trên chứng từ) to the reference date, cut at 30/60/90 —
// `current` = 0–30 days recorded, `d30` = 31–60, `d60` = 61–90, `over90` =
// beyond 90. A frozen dueDate never moves a bucket; it only feeds the
// contractual `overdueDays` KPI (card 061026221213), asserted separately.

// Helper: create a date N days before the reference date
function daysAgo(days: number, ref: Date): string {
  return new Date(ref.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

// Helper: a frozen due date (YYYY-MM-DD — the FifoAgingInput.dueDate wire
// format) N days before the reference date; negative N = N days in the future.
function dueDaysAgo(days: number, ref: Date): string {
  return daysAgo(days, ref).slice(0, 10);
}

describe('computeFifoAging', () => {
  const ref = new Date('2026-06-01T00:00:00Z');

  test('simple single debit aging into correct bucket', () => {
    // One unpaid invoice recorded 15 days ago → age 15 ≤ 30 → current bucket
    const entries: FifoAgingInput[] = [
      { timestamp: daysAgo(15, ref), debit: '1000000', credit: '0' },
    ];
    const { aging, openInvoices } = computeFifoAging(entries, ref);

    assert.strictEqual(aging.current, 1000000);
    assert.strictEqual(aging.d30, 0);
    assert.strictEqual(aging.d60, 0);
    assert.strictEqual(aging.over90, 0);
    assert.strictEqual(openInvoices.length, 1);
    assert.strictEqual(openInvoices[0].open, 1000000);
    // Without a frozen dueDate the entry is due at issue, so the contractual
    // KPI reads 15 days past due even though the bucket is age-driven.
    assert.strictEqual(openInvoices[0].overdueDays, 15);
  });

  test('multiple debits with credits applied FIFO', () => {
    // Two invoices: 500k at 45 days, 300k at 10 days
    // One payment of 400k → applied to oldest first (45-day invoice reduced to 100k)
    const entries: FifoAgingInput[] = [
      { timestamp: daysAgo(45, ref), debit: '500000', credit: '0' },
      { timestamp: daysAgo(10, ref), debit: '300000', credit: '0' },
      { timestamp: daysAgo(5, ref), debit: '0', credit: '400000' },
    ];
    const { aging } = computeFifoAging(entries, ref);

    // 45-day invoice: 500k - 400k (FIFO applied) = 100k remaining → 31–60 band
    assert.strictEqual(aging.d30, 100000);
    // 10-day invoice: 300k untouched → current bucket
    assert.strictEqual(aging.current, 300000);
    assert.strictEqual(aging.d60, 0);
    assert.strictEqual(aging.over90, 0);
  });

  test('unapplied credit carry-forward', () => {
    // Credit comes before any debit → should carry forward
    const entries: FifoAgingInput[] = [
      { timestamp: daysAgo(5, ref), debit: '0', credit: '200000' },
      { timestamp: daysAgo(3, ref), debit: '500000', credit: '0' },
    ];
    const { aging, openInvoices } = computeFifoAging(entries, ref);

    // 200k credit applied to 500k debit → 300k remaining, recorded 3 days ago
    // → current bucket
    assert.strictEqual(aging.current, 300000);
    assert.strictEqual(openInvoices.length, 1);
    assert.strictEqual(openInvoices[0].open, 300000);
  });

  test('edge case: zero amounts', () => {
    const entries: FifoAgingInput[] = [
      { timestamp: daysAgo(10, ref), debit: '0', credit: '0' },
    ];
    const { aging, openInvoices } = computeFifoAging(entries, ref);

    assert.strictEqual(aging.current, 0);
    assert.strictEqual(aging.d30, 0);
    assert.strictEqual(aging.d60, 0);
    assert.strictEqual(aging.over90, 0);
    assert.strictEqual(openInvoices.length, 0);
  });

  test('edge case: all debits fully paid (zero balances)', () => {
    const entries: FifoAgingInput[] = [
      { timestamp: daysAgo(20, ref), debit: '500000', credit: '0' },
      { timestamp: daysAgo(10, ref), debit: '0', credit: '500000' },
    ];
    const { aging, openInvoices } = computeFifoAging(entries, ref);

    assert.strictEqual(aging.current, 0);
    assert.strictEqual(aging.d30, 0);
    assert.strictEqual(aging.d60, 0);
    assert.strictEqual(aging.over90, 0);
    // Invoice exists but open is 0, so filtered from aging
    assert.strictEqual(openInvoices.length, 1);
    assert.strictEqual(openInvoices[0].open, 0);
  });

  test('edge case: credit exceeds debits (negative balance clamped)', () => {
    // 300k debit, 500k credit → remaining credit carries forward, no open invoices
    const entries: FifoAgingInput[] = [
      { timestamp: daysAgo(20, ref), debit: '300000', credit: '0' },
      { timestamp: daysAgo(5, ref), debit: '0', credit: '500000' },
    ];
    const { aging, openInvoices } = computeFifoAging(entries, ref);

    // The 300k invoice is fully paid by the 500k credit
    assert.strictEqual(aging.current, 0);
    assert.strictEqual(openInvoices.length, 1);
    assert.strictEqual(openInvoices[0].open, 0);
  });

  test('bucket boundaries: age bands cut at 30/60/90 days since the recording date', () => {
    const entries: FifoAgingInput[] = [
      { timestamp: daysAgo(15, ref), debit: '100000', credit: '0' },   // current (≤30)
      { timestamp: daysAgo(45, ref), debit: '200000', credit: '0' },   // d30 (>30, ≤60) — the 30–60 band
      { timestamp: daysAgo(75, ref), debit: '300000', credit: '0' },   // d60 (>60, ≤90) — the 60–90 band
      { timestamp: daysAgo(120, ref), debit: '400000', credit: '0' },  // over90 (>90)
    ];
    const { aging } = computeFifoAging(entries, ref);

    assert.strictEqual(aging.current, 100000);
    assert.strictEqual(aging.d30, 200000);
    assert.strictEqual(aging.d60, 300000);
    assert.strictEqual(aging.over90, 400000);
  });

  // Owner ruling 29/10: aging measures from the recording date, so a debt
  // recorded 31 days ago ages into the 30–60 bucket (d30) — whether or not it
  // is contractually due yet.
  test('a debt recorded 31 days ago ages into the 30–60 bucket', () => {
    const entries: FifoAgingInput[] = [
      { timestamp: daysAgo(31, ref), debit: '100000', credit: '0' },
    ];
    const { aging } = computeFifoAging(entries, ref);
    assert.strictEqual(aging.d30, 100000);
    assert.strictEqual(aging.current, 0);
  });

  test('a frozen dueDate never moves the aging bucket — bands follow the recording date', () => {
    const entries: FifoAgingInput[] = [
      // Recorded 45 days ago, due 75 days OUT (not contractually due): the
      // bucket still follows the recording date → 30–60 band.
      { timestamp: daysAgo(45, ref), debit: '100000', credit: '0', dueDate: dueDaysAgo(-75, ref) },
      // Recorded 95 days ago, due 30 days out: contractually in term, but
      // aging counts from the recording date → over90.
      { timestamp: daysAgo(95, ref), debit: '200000', credit: '0', dueDate: dueDaysAgo(-30, ref) },
    ];
    const { aging, openInvoices } = computeFifoAging(entries, ref);

    assert.strictEqual(aging.d30, 100000);
    assert.strictEqual(aging.over90, 200000);
    assert.strictEqual(aging.current, 0);
    // The contractual KPI is untouched: nobody is past their due date.
    assert.strictEqual(Math.max(...openInvoices.map((inv) => inv.overdueDays)), 0);
  });

  test('bucket boundary exactly 30 days recorded → current bucket', () => {
    const entries: FifoAgingInput[] = [
      { timestamp: daysAgo(30, ref), debit: '100000', credit: '0' },
    ];
    const { aging } = computeFifoAging(entries, ref);
    assert.strictEqual(aging.current, 100000);
    assert.strictEqual(aging.d30, 0);
  });

  test('bucket boundary exactly 60 days recorded → 30–60 (d30) bucket', () => {
    const entries: FifoAgingInput[] = [
      { timestamp: daysAgo(60, ref), debit: '100000', credit: '0' },
    ];
    const { aging } = computeFifoAging(entries, ref);
    assert.strictEqual(aging.d30, 100000);
    assert.strictEqual(aging.d60, 0);
  });

  test('bucket boundary exactly 90 days → d60 bucket', () => {
    const entries: FifoAgingInput[] = [
      { timestamp: daysAgo(90, ref), debit: '100000', credit: '0' },
    ];
    const { aging } = computeFifoAging(entries, ref);
    assert.strictEqual(aging.d60, 100000);
    assert.strictEqual(aging.over90, 0);
  });

  test('bucket boundary 91 days → over90 bucket', () => {
    const entries: FifoAgingInput[] = [
      { timestamp: daysAgo(91, ref), debit: '100000', credit: '0' },
    ];
    const { aging } = computeFifoAging(entries, ref);
    assert.strictEqual(aging.over90, 100000);
  });

  test('missing timestamps fall back to reference date', () => {
    // Entry with null timestamp should land in current bucket (age = 0 days)
    const entries: FifoAgingInput[] = [
      { timestamp: null, debit: '500000', credit: '0' },
    ];
    const { aging, openInvoices } = computeFifoAging(entries, ref);

    assert.strictEqual(aging.current, 500000);
    assert.strictEqual(openInvoices.length, 1);
    // The ts should be the reference date's ISO string
    assert.strictEqual(openInvoices[0].ts, ref.toISOString());
  });

  test('entries sorted chronologically regardless of input order', () => {
    // Input order: out of chronological order, function should sort by timestamp
    const entries: FifoAgingInput[] = [
      { timestamp: daysAgo(10, ref), debit: '0', credit: '200000' },
      { timestamp: daysAgo(45, ref), debit: '500000', credit: '0' },
      { timestamp: daysAgo(5, ref), debit: '300000', credit: '0' },
    ];
    const { aging } = computeFifoAging(entries, ref);

    // Sorted: day 45 debit 500k, day 10 credit 200k, day 5 debit 300k
    // 500k debit (45 days ago) → 200k credit (10 days ago) applied → 300k open at age 45 → 30–60 band
    // 300k debit (5 days ago) → untouched → current bucket
    assert.strictEqual(aging.d30, 300000);
    assert.strictEqual(aging.current, 300000);
  });

  test('numeric debit/credit values (not strings)', () => {
    const entries: FifoAgingInput[] = [
      { timestamp: daysAgo(15, ref), debit: 1000000, credit: 0 },
    ];
    const { aging } = computeFifoAging(entries, ref);
    assert.strictEqual(aging.current, 1000000);
  });

  test('empty entries array returns zero aging', () => {
    const { aging, openInvoices } = computeFifoAging([], ref);
    assert.strictEqual(aging.current, 0);
    assert.strictEqual(aging.d30, 0);
    assert.strictEqual(aging.d60, 0);
    assert.strictEqual(aging.over90, 0);
    assert.strictEqual(openInvoices.length, 0);
  });

  test('partial payment splits single invoice correctly', () => {
    // Single 1M invoice recorded 45 days ago, 400k payment, 600k remaining
    const entries: FifoAgingInput[] = [
      { timestamp: daysAgo(45, ref), debit: '1000000', credit: '0' },
      { timestamp: daysAgo(5, ref), debit: '0', credit: '400000' },
    ];
    const { aging, openInvoices } = computeFifoAging(entries, ref);

    // 600k remaining at age 45 → 30–60 band
    assert.strictEqual(aging.d30, 600000);
    assert.strictEqual(openInvoices.length, 1);
    assert.strictEqual(openInvoices[0].open, 600000);
  });

  test('unapplied credit applied to later debits', () => {
    // 200k credit first (no debits to apply to), then 500k debit
    // 200k credit carries forward and is applied to the 500k debit
    const entries: FifoAgingInput[] = [
      { timestamp: daysAgo(20, ref), debit: '0', credit: '200000' },
      { timestamp: daysAgo(10, ref), debit: '500000', credit: '0' },
      { timestamp: daysAgo(5, ref), debit: '0', credit: '100000' },
    ];
    const { aging } = computeFifoAging(entries, ref);

    // 200k unapplied credit + 500k debit → 300k remaining, then 100k credit applied → 200k
    // recorded 10 days ago → current bucket
    assert.strictEqual(aging.current, 200000);
  });

  // SIL-580 invariant pin: "quá hạn" stays the CONTRACTUAL overdue span
  // (card 061026221213) — whole calendar days past the effective due date at
  // the reference date, 0 while not yet due — even though the aging buckets
  // above count from the recording date (owner ruling 29/10). These pins
  // exercise calendarDaysPastDue/maxOverdueDaysOf through computeFifoAging;
  // the buckets are deliberately not asserted here.
  describe('contractual overdueDays KPI — days past the effective due date', () => {
    test('boundary ladder: frozen dueDate 0/1/30/31/60/90/91 days past due', () => {
      const entries: FifoAgingInput[] = [
        { timestamp: daysAgo(5, ref), debit: '100000', credit: '0', dueDate: dueDaysAgo(0, ref) },   // due today
        { timestamp: daysAgo(5, ref), debit: '200000', credit: '0', dueDate: dueDaysAgo(1, ref) },   // 1 past due
        { timestamp: daysAgo(5, ref), debit: '300000', credit: '0', dueDate: dueDaysAgo(30, ref) },  // 30 past due
        { timestamp: daysAgo(5, ref), debit: '400000', credit: '0', dueDate: dueDaysAgo(31, ref) },  // 31 past due
        { timestamp: daysAgo(5, ref), debit: '500000', credit: '0', dueDate: dueDaysAgo(60, ref) },  // 60 past due
        { timestamp: daysAgo(5, ref), debit: '600000', credit: '0', dueDate: dueDaysAgo(90, ref) },  // 90 past due
        { timestamp: daysAgo(5, ref), debit: '700000', credit: '0', dueDate: dueDaysAgo(91, ref) },  // 91 past due
      ];
      const { openInvoices } = computeFifoAging(entries, ref);
      assert.deepStrictEqual(openInvoices.map((inv) => inv.overdueDays), [0, 1, 30, 31, 60, 90, 91]);
    });

    test('a dueDate in the future never reads past due, regardless of recording age', () => {
      // Recorded 120 days ago but due tomorrow: the contractual span clamps
      // to 0 even though the aging bucket would already sit in over90.
      const entries: FifoAgingInput[] = [
        { timestamp: daysAgo(120, ref), debit: '100000', credit: '0', dueDate: dueDaysAgo(-1, ref) },
      ];
      const { openInvoices } = computeFifoAging(entries, ref);
      assert.strictEqual(openInvoices[0].overdueDays, 0);
    });

    test('legacy row without a frozen dueDate is due at issue — overdueDays equals recording age', () => {
      const entries: FifoAgingInput[] = [
        { timestamp: daysAgo(30, ref), debit: '100000', credit: '0' },  // exactly 30
        { timestamp: daysAgo(31, ref), debit: '200000', credit: '0' },  // 31
      ];
      const { openInvoices } = computeFifoAging(entries, ref);
      // Output is in chronological order, so the older (31-day) invoice leads.
      assert.deepStrictEqual(openInvoices.map((inv) => inv.overdueDays), [31, 30]);
    });

    test('maxOverdueDaysOf: largest contractual span among OPEN invoices only', () => {
      // The 91-day-past-due invoice is fully settled by the FIFO credit, so
      // its span drops out of the KPI even though the row is still returned.
      const entries: FifoAgingInput[] = [
        { timestamp: daysAgo(96, ref), debit: '100000', credit: '0', dueDate: dueDaysAgo(91, ref) },  // 91 past due
        { timestamp: daysAgo(95, ref), debit: '200000', credit: '0', dueDate: dueDaysAgo(45, ref) },  // 45 past due
        { timestamp: daysAgo(5, ref), debit: '0', credit: '100000' },                                  // closes the oldest
      ];
      const { openInvoices } = computeFifoAging(entries, ref);
      assert.strictEqual(openInvoices[0].open, 0);
      assert.strictEqual(maxOverdueDaysOf(openInvoices), 45);
    });
  });
});
