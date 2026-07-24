import { useQuery, type QueryKey } from '@tanstack/react-query';
import { configClient } from '../../api/configClient';
import { qk } from '../../api/keys';

/**
 * Generic hook for any "fetch this month/year's slice" query. Owns:
 *  - the salary-period resolution (start/end of the month)
 *  - the enabled gate (only fires when the period is known)
 *  - the `2-minute` staleTime shared by all month-bucketed data
 *
 * Replaces the duplicated pattern in:
 *   useTripQueries.useTripCosts
 *   useTripQueries.useMonthlyTrips
 *   any future "this month's X" query
 *
 * Usage:
 *
 *   const { data, isLoading } = useMonthlyQuery<MyType>({
 *     month, year, queryKey: qk.trips.costs(month, year, undefined),
 *     fetcher: (range) => tripClient.listTrips({ dateFrom: range.start, dateTo: range.end }),
 *     select: (res) => res.items,
 *   });
 */

export interface SalaryPeriodRange {
  start: string;
  end: string;
}

export interface UseMonthlyQueryOpts<TData> {
  month: number;
  year: number;
  queryKey: QueryKey;
  fetcher: (range: SalaryPeriodRange) => Promise<TData>;
  /** Optional select to transform the response shape (e.g. `.items`). */
  select?: (data: TData) => unknown;
  /** Optional additional staleTime override (default: 2 minutes). */
  staleTimeMs?: number;
}

export interface UseMonthlyQueryResult<TData> {
  data: TData | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  salaryPeriod: SalaryPeriodRange | undefined;
}

export function useMonthlyQuery<TData>(opts: UseMonthlyQueryOpts<TData>): UseMonthlyQueryResult<TData> {
  const { month, year, queryKey, fetcher, select, staleTimeMs = 2 * 60 * 1000 } = opts;

  const salaryQuery = useQuery<SalaryPeriodRange>({
    queryKey: qk.catalogs.salaryPeriod(month, year),
    queryFn: () => configClient.getSalaryPeriodResolve(month, year),
    staleTime: 30 * 60 * 1000,
    enabled: month >= 1 && month <= 12 && year >= 2000,
  });

  const dataQuery = useQuery({
    // queryKey is caller-provided (arbitrary domain key); appending the salary
    // period start keeps it scoped per month.
    // eslint-disable-next-line @tingting/no-bare-query-key
    queryKey: [...queryKey, salaryQuery.data?.start],
    enabled: !!salaryQuery.data,
    queryFn: () => fetcher(salaryQuery.data as SalaryPeriodRange),
    staleTime: staleTimeMs,
    select: select as (data: unknown) => unknown,
  });

  return {
    data: dataQuery.data as TData | undefined,
    isLoading: dataQuery.isLoading,
    isFetching: dataQuery.isFetching,
    error: dataQuery.error,
    salaryPeriod: salaryQuery.data,
  };
}
