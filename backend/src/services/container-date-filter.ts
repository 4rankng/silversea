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
 * never contradict the rows they summarize. Without a fallback resolver they
 * are excluded when a range is active. When no range is active the full set
 * passes through unchanged.
 */

import { localDateInBusinessZone } from '@tingting/shared';

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
 *                    appointment is null; a null/undefined result still drops
 *                    the container.
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
    if (localDate == null) return false;
    if (dateFrom && localDate < dateFrom) return false;
    if (dateTo && localDate > dateTo) return false;
    return true;
  });
}
