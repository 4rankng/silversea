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

/**
 * Excel ROUND(x; -n) semantics — HALF AWAY FROM ZERO (card 20260922_60).
 * digits < 0 rounds to tens/hundreds/thousands... (e.g. -3 → thousands,
 * -4 → ten-thousands); digits >= 0 mirrors Excel's decimal rounding.
 * The customer's "3 số" = digits -3 (thousands), "4 số" = digits -4
 * (ten-thousands). Verified probes: 823250 → 823000/-3, 820000/-4;
 * 825000 → 830000 at -4 (half-point goes AWAY from zero).
 */
export function roundHalfAwayFromZero(value: number, digits: number): number {
  const factor = 10 ** -digits;
  return Math.sign(value) * Math.round(Math.abs(value) / factor) * factor;
}

export {
  FUEL_PRICE_PER_LITER_FALLBACK,
  FUEL_LOADED_NORM_FALLBACK,
  FUEL_EMPTY_NORM_FALLBACK,
  ROAD_ALLOWANCE_PER_KM_FALLBACK,
} from './tripFormDefaults';
