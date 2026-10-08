import { useQuery } from '@tanstack/react-query';
import { configClient } from '../../api/configClient';
import { qk } from '../../api/keys';

/** Salary period window resolved for a (month, year). */
export interface SalaryPeriod {
  start: string;
  end: string;
}

/** Returns the salary period for a given (month, year). */
export function useSalaryPeriod(month: number, year: number) {
  return useQuery<SalaryPeriod>({
    queryKey: qk.catalogs.salaryPeriod(month, year),
    queryFn: () => configClient.getSalaryPeriodResolve(month, year),
    staleTime: 30 * 60 * 1000,
    enabled: month >= 1 && month <= 12 && year >= 2000,
  });
}
