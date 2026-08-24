/**
 * Shared helper for date-range filtering of containers.
 *
 * Both the CUS workspace overview and the dispatch master-plan need to scope
 * container counts / weight to the active date-range filter. This module
 * provides the single source of truth so the two surfaces never drift apart.
 *
 * Containers whose `customerAppointmentAt` is null are excluded when a date
 * range is active (they have no date to compare). When no range is active the
 * full set passes through unchanged.
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
 *
 * When both bounds are absent the original array is returned unchanged so
 * callers pay zero cost in the no-filter path.
 */
export function filterContainersByDateRange<T extends { customerAppointmentAt: Date | null }>(
  containers: T[],
  dateFrom: string | undefined | null,
  dateTo: string | undefined | null,
): T[] {
  if (!dateFrom && !dateTo) return containers;

  return containers.filter((container) => {
    if (container.customerAppointmentAt == null) return false;
    const localDate = localDateInBusinessZone(container.customerAppointmentAt);
    if (localDate == null) return false;
    if (dateFrom && localDate < dateFrom) return false;
    if (dateTo && localDate > dateTo) return false;
    return true;
  });
}
