/**
 * B3 / D4 — committed-legacy fuel freeze.
 *
 * Legacy trips (created before fuel snapshots; `fuel_price_applied` /
 * `fuel_loaded_norm_applied` / `fuel_empty_norm_applied` all 0) cannot have
 * their original fuel price reconstructed — `fuel_price_history` predates them
 * (qa/feedback-repro-log.md §3/§7). On update, `updateTripFigures` therefore
 * skips the live fuel fallback for committed trips and pins the fuel component
 * to stored totals via `applyCommittedLegacyFuelFreeze`.
 *
 * These are pure data-driven tests of that helper (no DB), documenting:
 *   - committed + zero-snapshot ⇒ stored totalFuelCost preserved exactly
 *     (tolerance 0 VND) even when computeTripTotals was driven by a moved
 *     live price (the §8 acceptance criterion);
 *   - CREATED trips are never frozen (they take the live fallback);
 *   - committed trips WITH a real fuel snapshot are never frozen;
 *   - the delta propagates correctly to totalCost / grossProfit;
 *   - the input `computed` object is not mutated.
 *
 * Numbers mirror the live dry-run (TRP-202605-0001: 243 L @ 27650 = 6,718,950).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { TripStatus } from '@tingting/shared';
import { applyCommittedLegacyFuelFreeze } from '../services/trip-mutations.service';

describe('applyCommittedLegacyFuelFreeze', () => {
  // Stored totals for TRP-202605-0001 (COMPLETED, all-zero fuel snapshots).
  const STORED_COST = 6_718_950;   // 243 L × 27650
  const STORED_LITERS = 243;

  const legacyTrip = (status: TripStatus) => ({
    status,
    fuelPriceApplied: 0,
    fuelLoadedNormApplied: 0,
    fuelEmptyNormApplied: 0,
    storedFuelCost: STORED_COST,
    storedFuelLiters: STORED_LITERS,
  });

  test('COMPLETED legacy trip: stored totalFuelCost preserved exactly (tolerance 0)', () => {
    // computeTripTotals ran with the 0 sentinel price ⇒ fuel cost 0.
    const out = applyCommittedLegacyFuelFreeze(legacyTrip(TripStatus.COMPLETED), {
      totalFuelCost: 0,
      totalCost: 1_000_000,   // fuel-less total (road + toll + salary + …)
      grossProfit: 5_000_000,
      totalFuelLiters: 0,     // norms were 0 ⇒ recomputed litres collapsed to 0
    });
    assert.strictEqual(out.totalFuelCost, STORED_COST);
    assert.strictEqual(out.totalFuelLiters, STORED_LITERS);
    // totalCost gains the restored fuel; grossProfit loses it.
    assert.strictEqual(out.totalCost, 1_000_000 + STORED_COST);
    assert.strictEqual(out.grossProfit, 5_000_000 - STORED_COST);
  });

  test('§8 acceptance: live price moves to 28000 ⇒ re-save still preserves stored cost', () => {
    // Had the live fallback fired, computeTripTotals would cost 243 × 28000.
    const poisoned = 243 * 28000;   // 6_804_000 — the drift B3 prevents.
    const out = applyCommittedLegacyFuelFreeze(legacyTrip(TripStatus.COMPLETED), {
      totalFuelCost: poisoned,
      totalCost: 1_000_000 + poisoned,
      grossProfit: 5_000_000 - poisoned,
      totalFuelLiters: 243,
    });
    assert.strictEqual(out.totalFuelCost, STORED_COST);            // tolerance 0
    // The over-computed fuel is backed out of cost/profit.
    assert.strictEqual(out.totalCost, 1_000_000 + STORED_COST);
    assert.strictEqual(out.grossProfit, 5_000_000 - STORED_COST);
  });

  test('IN_TRANSIT and LOCKED legacy trips are also frozen', () => {
    for (const status of [TripStatus.IN_TRANSIT, TripStatus.LOCKED]) {
      const out = applyCommittedLegacyFuelFreeze(legacyTrip(status), {
        totalFuelCost: 0, totalCost: 100, grossProfit: 200, totalFuelLiters: 0,
      });
      assert.strictEqual(out.totalFuelCost, STORED_COST, `${status}: fuel frozen`);
    }
  });

  test('CREATED trips are NEVER frozen (they take the live fallback)', () => {
    const computed = { totalFuelCost: 6_804_000, totalCost: 9_000_000, grossProfit: 1_000_000, totalFuelLiters: 243 };
    const out = applyCommittedLegacyFuelFreeze(legacyTrip(TripStatus.CREATED), computed);
    assert.deepEqual(out, computed);
  });

  test('CANCELED trips are never frozen', () => {
    const computed = { totalFuelCost: 123, totalCost: 456, grossProfit: 789, totalFuelLiters: 10 };
    const out = applyCommittedLegacyFuelFreeze(legacyTrip(TripStatus.CANCELED), computed);
    assert.deepEqual(out, computed);
  });

  test('committed trip WITH a real fuel snapshot is never frozen', () => {
    // fuelPriceApplied=27650 ⇒ this is a modern trip whose snapshot is valid;
    // computeTripTotals' output must stand.
    const computed = { totalFuelCost: 6_718_950, totalCost: 8_000_000, grossProfit: 2_000_000, totalFuelLiters: 243 };
    const out = applyCommittedLegacyFuelFreeze(
      { ...legacyTrip(TripStatus.COMPLETED), fuelPriceApplied: 27650 },
      computed,
    );
    assert.deepEqual(out, computed);
  });

  test('partial snapshot (loaded norm set) is NOT treated as legacy', () => {
    // Only all-three-zero is the legacy sentinel; a lone zero is real data.
    const computed = { totalFuelCost: 5_000_000, totalCost: 7_000_000, grossProfit: 3_000_000, totalFuelLiters: 180 };
    const out = applyCommittedLegacyFuelFreeze(
      { ...legacyTrip(TripStatus.COMPLETED), fuelLoadedNormApplied: 28 },
      computed,
    );
    assert.deepEqual(out, computed);
  });

  test('zero-litres legacy trip: guard does not NaN, cost still pinned', () => {
    const out = applyCommittedLegacyFuelFreeze(
      { ...legacyTrip(TripStatus.COMPLETED), storedFuelLiters: 0, storedFuelCost: 0 },
      { totalFuelCost: 0, totalCost: 500_000, grossProfit: 1_500_000, totalFuelLiters: 0 },
    );
    assert.strictEqual(out.totalFuelCost, 0);
    assert.strictEqual(out.totalFuelLiters, 0);
    assert.ok(Number.isFinite(out.totalCost));
    assert.ok(Number.isFinite(out.grossProfit));
  });

  test('does not mutate the input computed object', () => {
    const computed = { totalFuelCost: 0, totalCost: 1_000_000, grossProfit: 5_000_000, totalFuelLiters: 0 };
    applyCommittedLegacyFuelFreeze(legacyTrip(TripStatus.COMPLETED), computed);
    assert.strictEqual(computed.totalFuelCost, 0, 'input fuel cost untouched');
    assert.strictEqual(computed.totalCost, 1_000_000, 'input totalCost untouched');
    assert.strictEqual(computed.grossProfit, 5_000_000, 'input grossProfit untouched');
  });
});
