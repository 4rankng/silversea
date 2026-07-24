/** Fixed workday divisor used to allocate a driver's monthly base salary to trips. */
export const TRIP_SALARY_WORK_DAYS = 26;

/**
 * Allocate configured monthly base salary to a trip.
 *
 * This is deliberately independent from monthly attendance's
 * `standardWorkDays`, which varies by calendar month.
 */
export function computeTripDriverSalary(baseSalary: number, tripWageDays: number): number {
  if (!Number.isFinite(baseSalary) || baseSalary <= 0) return 0;
  if (!Number.isFinite(tripWageDays) || tripWageDays <= 0) return 0;
  return Math.round((baseSalary / TRIP_SALARY_WORK_DAYS) * tripWageDays);
}

/** Use legacy route/default salary only when the driver has no configured base salary. */
export function resolveTripDriverSalary(
  baseSalary: number,
  tripWageDays: number,
  fallbackSalary: number,
): number {
  const allocatedSalary = computeTripDriverSalary(baseSalary, tripWageDays);
  if (allocatedSalary > 0) return allocatedSalary;
  return Number.isFinite(fallbackSalary) && fallbackSalary > 0 ? Math.round(fallbackSalary) : 0;
}
