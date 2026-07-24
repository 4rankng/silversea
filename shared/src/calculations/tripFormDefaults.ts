/**
 * Domain constants for trip-form calculations.
 *
 * These previously lived inline in `useTripForm.ts` (front-end), where they
 * were easy to drift away from the canonical values used in the shared
 * calculations module. They are now part of the shared package so the
 * form's preview totals, the dispatcher's calculation, and the accountant's
 * P&L all use the same numbers.
 *
 * If a value needs to become user-configurable, migrate it to a config
 * table (fuel/road config) and have `useFuelConfig`/`useRoadConfig` supply
 * it to the form. Hard-coded constants here are the fallback.
 */

/** Fallback fuel price (VND/liter) when no fuel config is loaded. */
export const FUEL_PRICE_PER_LITER_FALLBACK = 25_000;

/** Default loaded-leg fuel norm (L/100km). Overridden by `useFuelConfig`. */
export const FUEL_LOADED_NORM_FALLBACK = 43;

/** Default empty-leg fuel norm (L/100km). Overridden by `useFuelConfig`. */
export const FUEL_EMPTY_NORM_FALLBACK = 25;

/** Default salary-period per-day deduction for empty legs (VND/km). */
export const ROAD_ALLOWANCE_PER_KM_FALLBACK = 2_500;
