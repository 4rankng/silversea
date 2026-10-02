import { TripStatus } from '../constants';
import type { ComputeTripTotalsOutput } from './tripTotals';

// ─── B3 / D4: committed-legacy fuel freeze ──────────────────────────────────

export interface CommittedLegacyFuelInput {
  status: TripStatus;
  fuelPriceApplied: number;
  fuelLoadedNormApplied: number;
  fuelEmptyNormApplied: number;
  storedFuelCost: number;
  storedFuelLiters: number;
}

type FuelTotals = Pick<ComputeTripTotalsOutput, 'totalFuelCost' | 'totalCost' | 'grossProfit' | 'totalFuelLiters'>;

/**
 * Pin the fuel component of a committed legacy trip's totals to its stored
 * values (B3 / D4).
 *
 * Legacy trips created before fuel snapshots have `fuel_price_applied` /
 * `fuel_loaded_norm_applied` / `fuel_empty_norm_applied` all at 0. Their rows
 * predate `fuel_price_history`, so the effective price they were costed at
 * CANNOT be reconstructed (qa/feedback-repro-log.md §3/§7). The old behaviour
 * read LIVE fuel config on update, which recosts stored totals against today's
 * price the moment the price moves — a silent retroactive P&L rewrite.
 *
 * For committed trips (IN_TRANSIT / COMPLETED) with missing fuel
 * snapshots, `updateTripFigures` now skips the live fallback, so
 * `computeTripTotals` runs with the 0 sentinel price and its fuel outputs are
 * ~0. This helper restores the stored cost, propagates the delta to totalCost
 * / grossProfit, and holds litres at the stored value — guaranteeing the
 * stored `totalFuelCost` is preserved exactly (tolerance 0 VND) regardless of
 * the recomputed litres (which round to integers and can diverge from a stored
 * decimal value). Revenue, tolls and salary still flow through
 * `computeTripTotals` normally; only the unreconstructable fuel cost is frozen.
 *
 * Pure (no DB / req) so it is exercised by a data-driven unit test. Returns a
 * fresh object rather than mutating, so the caller stays explicit.
 *
 * (The road / allowance live-fallbacks share this latent shape but are outside
 * D4's fuel scope — see repro log §8.)
 */
export function applyCommittedLegacyFuelFreeze(
  trip: CommittedLegacyFuelInput,
  computed: FuelTotals,
): FuelTotals {
  const isCommitted = trip.status === TripStatus.IN_TRANSIT
    || trip.status === TripStatus.COMPLETED;
  const snapshotMissing = trip.fuelPriceApplied === 0
    && trip.fuelLoadedNormApplied === 0
    && trip.fuelEmptyNormApplied === 0;
  if (!isCommitted || !snapshotMissing) {
    return { ...computed };
  }

  const storedLiters = Math.round(trip.storedFuelLiters);
  const storedCost = Math.round(trip.storedFuelCost);
  const delta = storedCost - computed.totalFuelCost;
  return {
    totalFuelCost: storedCost,
    totalCost: computed.totalCost + delta,
    grossProfit: computed.grossProfit - delta,
    totalFuelLiters: storedLiters,
  };
}
