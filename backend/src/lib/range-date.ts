/**
 * Shared strict query-range date parsing (cards 20261001_256 + 20261003_306):
 * a plain `new Date('2026-09-31')` silently ROLLS impossible days into the
 * next month, so parse-and-compare can never reject them — the UTC round-trip
 * is the test. An impossible day answers a business 400 naming the bad value
 * instead of a Postgres date-cast 500 (both instances: the invoice-tracking
 * accounting route and the expense list's filter block).
 */
import { ApiError } from '../errors';

/** Required-fallback overload: the caller always answers a concrete bound. */
export function parseRangeDate(value: unknown, fallback: string): string;
/** Optional-bound overload: the filter is off when the query omits the param. */
export function parseRangeDate(value: unknown, fallback?: string): string | undefined;
export function parseRangeDate(value: unknown, fallback?: string): string | undefined {
  if (value === undefined || value === null || value === '') return fallback;
  const raw = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new ApiError(400, `Khoảng ngày không hợp lệ: ${raw}`);
  const [y, m, d] = raw.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d) {
    throw new ApiError(400, `Khoảng ngày không hợp lệ: ${raw}`);
  }
  return raw;
}
