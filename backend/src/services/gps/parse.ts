import type { LiveFleetStatus } from '@tingting/shared';

/** Minutes after which a vehicle report is considered stale (lost/offline). */
export const GPS_STALE_THRESHOLD_MINUTES = 10;

/**
 * Normalize a Vietnamese license plate for matching. Absorbs separator/casing
 * variance so "15C-160.55", "15C.160.55" and "15c 160 55" all → "15C16055".
 */
export function normalizePlate(plate: string | null | undefined): string {
  return (plate ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Parse Bách Khoa's documented "HH:mm:ss - dd/MM/yyyy" timestamp. The device
 * reports Vietnam local time (UTC+7) with no zone, so shift back 7h. The
 * public API uses this format.
 */
export function parseBachKhoaDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{1,2}):(\d{2}):(\d{2})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, hh, mm, ss, dd, mo, yyyy] = m;
  const utcMs = Date.UTC(+yyyy, +mo - 1, +dd, +hh, +mm, +ss) - 7 * 60 * 60 * 1000;
  return new Date(utcMs);
}

/**
 * Parse an ASP.NET JSON date "/Date(1782217250000)/" (epoch ms) → Date. The
 * portal endpoint returns RealDate in this format. Bách Khoa's server emits the
 * epoch with the device's Vietnam wall-clock (UTC+7) baked in as if it were UTC,
 * so subtract 7h to recover the true UTC instant — matching parseBachKhoaDate.
 * This also keeps the staleness check (vs real `new Date()`) honest: without the
 * shift, freshly-reported vehicles appear 7h in the future and never go stale.
 */
export function parseAspDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m = raw.match(/\/Date\((-?\d+)\)\//);
  if (!m) return null;
  const d = new Date(Number(m[1]) - 7 * 60 * 60 * 1000);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Coerce a value back into a Date after a JSON round-trip (Redis cache), which
 * flattens `Date` to an ISO string. Accepts Date | string | number | null and
 * returns the typed `Date | null`, so the NormalizedGpsVehicle model holds even
 * on a cache hit. Idempotent for a real Date; null for empty/unparseable input.
 */
export function reviveDate(value: Date | string | number | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

export function isStale(
  date: Date | null,
  now: Date = new Date(),
  thresholdMin = GPS_STALE_THRESHOLD_MINUTES,
): boolean {
  if (!date) return true;
  return now.getTime() - date.getTime() > thresholdMin * 60 * 1000;
}

/**
 * Unified status bucket from primitives each provider supplies. Keeps the
 * status decision in one place regardless of whether the source encodes it as
 * free-text (public API) or a numeric flag (portal).
 */
export function deriveStatus(stale: boolean, lostSignal: boolean, speed: number): LiveFleetStatus {
  if (stale || lostSignal) return 'offline';
  return speed > 0 ? 'moving' : 'stopped';
}
