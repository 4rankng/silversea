import { computeTripDriverSalary } from '@tingting/shared';
import { computeStandardWorkDays } from './attendance.service';

export interface LegacyTripSalaryCandidateInput {
  status: string | null;
  carrierType: string | null;
  departureDate: string | Date | null;
  baseSalary: number;
  tripWageDays: number;
  storedDriverSalary: number;
}

export interface LegacyTripSalaryRepair {
  legacyDivisor: number;
  legacyDriverSalary: number;
  correctedDriverSalary: number;
  salaryDelta: number;
}

/**
 * Recognize only salaries that exactly match the retired calendar-workday
 * formula. This deliberately leaves manual overrides and locked trips alone.
 */
export function identifyLegacyTripSalary(
  input: LegacyTripSalaryCandidateInput,
): LegacyTripSalaryRepair | null {
  if (input.carrierType !== 'OWN') return null;
  if (input.status === 'LOCKED' || input.status === 'CANCELED') return null;
  if (!input.departureDate || input.baseSalary <= 0 || input.tripWageDays <= 0) return null;

  const departure = input.departureDate instanceof Date
    ? input.departureDate
    : new Date(`${input.departureDate}T00:00:00`);
  if (Number.isNaN(departure.getTime())) return null;

  const legacyDivisor = computeStandardWorkDays(
    departure.getFullYear(),
    departure.getMonth() + 1,
  );
  const legacyDriverSalary = Math.round(
    (input.baseSalary / legacyDivisor) * input.tripWageDays,
  );
  const correctedDriverSalary = computeTripDriverSalary(
    input.baseSalary,
    input.tripWageDays,
  );

  if (
    correctedDriverSalary === legacyDriverSalary
    || input.storedDriverSalary !== legacyDriverSalary
  ) {
    return null;
  }

  return {
    legacyDivisor,
    legacyDriverSalary,
    correctedDriverSalary,
    salaryDelta: correctedDriverSalary - input.storedDriverSalary,
  };
}
