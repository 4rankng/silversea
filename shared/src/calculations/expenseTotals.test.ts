import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sumExcludingNegative } from './expenseTotals.ts';

/**
 * Card 20260928_181 — the PM rule in one place: a negative expense row makes a
 * TOTAL behave exactly as if that row did not exist (it is dropped, never
 * netted against the positive rows).
 */
describe('sumExcludingNegative (card 20260928_181)', () => {
  test('the rule: [100, -50] totals 100, not 50 — the negative row does not exist', () => {
    assert.equal(sumExcludingNegative([100, -50], (n) => n), 100);
  });

  test('all-positive rows are summed unchanged', () => {
    assert.equal(sumExcludingNegative([100, 250, 1], (n) => n), 351);
  });

  test('adding a negative row leaves the total EXACTLY identical', () => {
    const before = sumExcludingNegative([1000, 250_000, 7_000], (n) => n);
    const after = sumExcludingNegative([1000, 250_000, 7_000, -9_999_999], (n) => n);
    assert.equal(after, before);
  });

  test('a zero row is neutral and stays in the set', () => {
    assert.equal(sumExcludingNegative([100, 0], (n) => n), 100);
    assert.equal(sumExcludingNegative([0, 0], (n) => n), 0);
  });

  test('reads a decimal string amount (numeric columns arrive as strings)', () => {
    assert.equal(sumExcludingNegative([{ buyAmount: '1000.25' }, { buyAmount: '-4000' }, { buyAmount: '0.75' }], (row) => row.buyAmount), 1001);
  });

  test('honours round2dp for fractional amounts', () => {
    assert.equal(sumExcludingNegative([1.005, 2.345], (n) => n), 3.35);
  });

  test('an empty set totals 0', () => {
    assert.equal(sumExcludingNegative([], (n: number) => n), 0);
  });

  test('a non-finite amount is dropped instead of poisoning the total with NaN', () => {
    assert.equal(sumExcludingNegative([100, Number.NaN, 50], (n) => n), 150);
  });

  test('an all-negative set totals 0 (never a negative total)', () => {
    assert.equal(sumExcludingNegative([-1, -250], (n) => n), 0);
  });
});
