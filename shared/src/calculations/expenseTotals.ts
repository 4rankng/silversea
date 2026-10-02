import { round2dp } from './round';

/**
 * Card 20260928_181 — signed expense entry (PM rule).
 *
 * An expense row may carry a NEGATIVE amount, and a negative row must make
 * every TOTAL behave exactly as if that row did not exist: it is dropped from
 * the sum, never netted against the positive rows. `sum([100, -50])` is 50;
 * the rule wants 100.
 *
 * This is the ONE place that rule lives, so a new aggregate cannot silently
 * re-introduce the plain "add everything up" behaviour, and a correction to
 * the rule has a single edit site. A row whose amount is 0 is neutral and is
 * kept (it changes nothing either way); only strictly negative amounts are
 * excluded. The total is rounded with `round2dp` so integer and decimal
 * callers inherit the same financial-precision contract as every other money
 * helper in `shared/src/calculations`.
 *
 * SQL aggregates cannot call this — at the query they take the equivalent
 * `sum(x) filter (where x > 0)` form.
 */
export function sumExcludingNegative<T>(
  rows: readonly T[],
  amountOf: (row: T) => number | string | null | undefined,
): number {
  let total = 0;
  for (const row of rows) {
    const amount = Number(amountOf(row));
    // Non-finite inputs are dropped rather than poisoning the total with NaN.
    if (!Number.isFinite(amount) || amount < 0) continue;
    total += amount;
  }
  return round2dp(total);
}
