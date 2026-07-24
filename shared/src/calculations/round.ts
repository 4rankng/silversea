/**
 * Banker-safe rounding helper to 2 decimal places.
 * Employs scientific notation to bypass floats representation/tie boundaries issues.
 * Symmetric for negative numbers.
 */
export function round2dp(n: number): number {
  const sign = Math.sign(n);
  const absN = Math.abs(n);
  return sign * Number(Math.round(parseFloat(absN + 'e2')) + 'e-2');
}

/**
 * Round a number to the nearest integer.
 * Used for fuel-liter calculations where the dispatch system issues whole
 * liters only (e.g. 97.2 L -> 97 L, 68.96 L -> 69 L).
 * Math.max(0, ...) guards against negative inputs propagating through
 * caller code paths.
 */
export function roundInt(n: number): number {
  return Math.max(0, Math.round(n));
}

export {
  FUEL_PRICE_PER_LITER_FALLBACK,
  FUEL_LOADED_NORM_FALLBACK,
  FUEL_EMPTY_NORM_FALLBACK,
  ROAD_ALLOWANCE_PER_KM_FALLBACK,
} from './tripFormDefaults';
