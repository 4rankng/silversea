/**
 * Shared helper for date-range filtering of containers.
 *
 * Both the CUS workspace overview and the dispatch master-plan need to scope
 * container counts / weight to the active date-range filter. This module
 * provides the single source of truth so the two surfaces never drift apart.
 *
 * Containers whose `customerAppointmentAt` is null inherit a caller-supplied
 * fallback date (the shipment's expected delivery date) — the same fallback
 * the row filters and the "Lịch cont sớm nhất" label use, so scoped counts can
 * never contradict the rows they summarize. A container that resolves to no
 * day at all (no appointment, no fallback) has no day the range names and
 * DROPS under an active range: SIL-588 (id 688, khách 29/10) supersedes card
 * 231026000252's "undated = luôn hiện" lane everywhere the lot date filter
 * reaches — the row law `shipmentTransportDateCondition` already drops undated
 * lots (mirroring SIL-506's Chi tiết day triage) — so the scoped counts agree
 * row-for-row with the rows they summarize. When no range is active the full
 * set passes through unchanged, undated rows included.
 */

import { localDateInBusinessZone } from '@tingting/shared';

// Asia/Ho_Chi_Minh has been a fixed +07:00 offset since 1975 (no DST) — the
// same anchor `containerTransportDateSql` embeds as the SQL zone literal and
// `resolveVietnamAsOfCutoff` (customer-receivable-authority.service.ts) uses
// for the aging/statements VN-day law. Keep the three aligned.
const BUSINESS_ZONE_OFFSET_MS = 7 * 60 * 60 * 1000;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TZ_QUALIFIED_INSTANT_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/i;

/**
 * Strict filter-value grammar (card 261022201006b + review finding 1): a
 * canonical YYYY-MM-DD business day, or a TZ-QUALIFIED instant (Z / ±HH:MM —
 * the same rule `toNullableTimestamp` enforces on write). Everything else —
 * '2026-1-2', '1/2/2026', '2026-10-22T12:00' (tz-less), rollovers like
 * '2026-02-30' — parses with the SERVER's local timezone under `new Date()`
 * and re-opens the very UTC-window leak this module exists to prevent, so it
 * yields null and callers reject with 400. Mirrors the
 * `resolveVietnamAsOfCutoff` grammar but stays import-pure for unit tests.
 */
function dateOnlyDayBounds(value: string): { start: Date; endExclusive: Date } | null {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const start = new Date(Date.UTC(year, month - 1, day) - BUSINESS_ZONE_OFFSET_MS);
  const wall = new Date(start.getTime() + BUSINESS_ZONE_OFFSET_MS);
  if (wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day) {
    return null; // rolled-over calendar input ('2026-02-30') — never a real day
  }
  return { start, endExclusive: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/**
 * Inclusive lower instant of a date-only filter value: midnight
 * Asia/Ho_Chi_Minh of that business day. A TZ-qualified instant passes
 * through as the instant it names (legacy datetime callers keep their
 * meaning). Anything else yields null — never a server-timezone parse.
 */
export function businessZoneDayStartInstant(value: string): Date | null {
  const day = dateOnlyDayBounds(value);
  if (day) return day.start;
  const instant = TZ_QUALIFIED_INSTANT_PATTERN.test(value) ? new Date(value) : null;
  return instant != null && Number.isNaN(instant.getTime()) ? null : instant;
}

/**
 * EXCLUSIVE upper instant of a date-only filter value: midnight
 * Asia/Ho_Chi_Minh of the NEXT business day — the `lt()` companion to
 * `businessZoneDayStartInstant`, so the window covers 00:00:00.000–
 * 23:59:59.999… VN without the sub-millisecond gap an inclusive
 * "last millisecond" bound would leave (the repo's VN-day law is
 * end-exclusive — `resolveVietnamAsOfCutoff().endExclusive` + `lt`).
 * A TZ-qualified instant returns itself + 1ms: at the wire's millisecond
 * precision `lt(x + 1ms)` is exactly the legacy `lte(x)` meaning, while a
 * finer stamp still lands inside its own bound. Anything else yields null.
 */
export function businessZoneDayEndExclusiveInstant(value: string): Date | null {
  const day = dateOnlyDayBounds(value);
  if (day) return day.endExclusive;
  const instant = businessZoneDayStartInstant(value);
  return instant == null ? null : new Date(instant.getTime() + 1);
}

/**
 * Return only those containers whose appointment date (in the business
 * timezone) falls within [dateFrom, dateTo] inclusive.
 *
 * @param containers  Any array of objects carrying `customerAppointmentAt`.
 * @param dateFrom    Inclusive lower bound as YYYY-MM-DD, or undefined/null to
 *                    leave the lower end open.
 * @param dateTo      Inclusive upper bound as YYYY-MM-DD, or undefined/null to
 *                    leave the upper end open.
 * @param fallbackDateFor  Optional resolver returning a shipment-level
 *                    fallback date (YYYY-MM-DD) for containers whose
 *                    appointment is null. A null/undefined result leaves the
 *                    container with no day at all: it DROPS under an active
 *                    range (SIL-588 — the row law `shipmentTransportDateCondition`
 *                    drops undated lots, so scoped counts match the rows they
 *                    summarize). Undated rows ride only the no-filter path.
 *
 * When both bounds are absent the original array is returned unchanged so
 * callers pay zero cost in the no-filter path.
 */
export function filterContainersByDateRange<T extends { customerAppointmentAt: Date | null }>(
  containers: T[],
  dateFrom: string | undefined | null,
  dateTo: string | undefined | null,
  fallbackDateFor?: (container: T) => string | null | undefined,
): T[] {
  if (!dateFrom && !dateTo) return containers;

  return containers.filter((container) => {
    const localDate = container.customerAppointmentAt != null
      ? localDateInBusinessZone(container.customerAppointmentAt)
      : (fallbackDateFor?.(container) ?? null);
    // SIL-588: an undated row (no appointment, no fallback) matches no range
    // — `NULL between x and y` is NULL on the SQL twin — so under an active
    // range it drops, and returns the moment the range is cleared.
    if (localDate == null) return false;
    if (dateFrom && localDate < dateFrom) return false;
    if (dateTo && localDate > dateTo) return false;
    return true;
  });
}

/**
 * Returns true if today (business timezone) is on or after the given local
 * run/appointment date (YYYY-MM-DD, or an instant to be projected to its
 * local date). Null/undefined never counts as past cutoff — no run date
 * means nothing to cut off against. Shared by the shipment-delete and
 * container-edit CUS-approval gates so both use one date comparison.
 */
export function isPastRunCutoff(runDate: string | Date | null | undefined): boolean {
  if (!runDate) return false;
  const localRunDate = runDate instanceof Date || typeof runDate !== 'string' || runDate.length > 10
    ? localDateInBusinessZone(runDate)
    : runDate;
  if (localRunDate == null) return false;
  const today = localDateInBusinessZone(new Date());
  return today != null && today >= localRunDate;
}
