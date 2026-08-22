import { useCallback, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, type QueryKey, type UseQueryResult } from '@tanstack/react-query';
import { useDebouncedValue } from './useDebouncedValue';

export interface TableQueryEndpoint<
  TItem,
  TParams extends Record<string, unknown>,
  TEnvelope extends { items: TItem[]; total: number } = { items: TItem[]; total: number },
> {
  (params: TParams & { search?: string; page?: number; limit?: number }): Promise<TEnvelope>;
}

export interface TableQueryState<
  TItem,
  TParams extends Record<string, unknown>,
  TEnvelope extends { items: TItem[]; total: number } = { items: TItem[]; total: number },
> {
  /** Current raw search input. */
  search: string;
  setSearch: (s: string) => void;
  /** Current filter bag (page is excluded; managed separately). */
  filters: TParams;
  setFilter: <K extends keyof TParams>(key: K, value: TParams[K] | undefined) => void;
  setFilters: (next: TParams) => void;
  page: number;
  setPage: (p: number) => void;
  pageSize: number;
  setPageSize: (n: number) => void;
  rows: TItem[];
  total: number;
  totalPages: number;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  query: UseQueryResult<TEnvelope>;
  /** Currently-applied params (filters + debounced search + page). */
  appliedParams: TParams & { search: string; page: number; limit: number };
  /** Reset everything back to the initial state. */
  reset: () => void;
}

export interface UseTableQueryStateOpts<
  TItem,
  TParams extends Record<string, unknown>,
  TEnvelope extends { items: TItem[]; total: number } = { items: TItem[]; total: number },
> {
  endpoint: TableQueryEndpoint<TItem, TParams, TEnvelope>;
  queryKey: QueryKey;
  defaultPageSize?: number;
  debounceMs?: number;
  initialFilters?: TParams;
  initialSearch?: string;
  enabled?: boolean;
}

/**
 * One-stop state manager for paginated list pages.
 *
 * Owns: search input, debounced search, filter bag, page, pageSize, and the
 * underlying `useQuery` (with the right queryKey for caching). Calls
 * `setPage(1)` automatically whenever the search or filters change.
 *
 * Replaces ~80 lines of duplicated state plumbing that previously lived at
 * the top of every list page (TripListPage, CustomersPage, SupplierListPage,
 * DebtListPage, PayableListPage, etc.).
 *
 * Usage:
 *
 *   const table = useTableQueryState<TripDetail, ListTripsParams>({
 *     endpoint: tripClient.listTrips,
 *     queryKey: qk.trips.list(),
 *     defaultPageSize: 25,
 *     debounceMs: 300,
 *   });
 *
 *   return <DataTable rows={table.rows} page={table.page} ... />;
 */
export function useTableQueryState<
  TItem,
  TParams extends Record<string, unknown> = Record<string, never>,
  TEnvelope extends { items: TItem[]; total: number } = { items: TItem[]; total: number },
>(opts: UseTableQueryStateOpts<TItem, TParams, TEnvelope>): TableQueryState<TItem, TParams, TEnvelope> {
  const [search, setSearch] = useState(opts.initialSearch ?? '');
  const [filters, setFiltersRaw] = useState<TParams>(opts.initialFilters ?? ({} as TParams));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(opts.defaultPageSize ?? 25);

  const debouncedSearch = useDebouncedValue(search, opts.debounceMs ?? 300);

  const setSearchAndResetPage = useCallback((next: string) => {
    setPage(1);
    setSearch(next);
  }, []);

  const setFilter = useCallback(
    <K extends keyof TParams>(key: K, value: TParams[K] | undefined) => {
      setPage(1);
      setFiltersRaw((prev) => {
        const next = { ...prev };
        if (value === undefined || value === '' || value === null) {
          delete next[key];
        } else {
          next[key] = value;
        }
        return next;
      });
    },
    [],
  );

  const setFilters = useCallback((next: TParams) => {
    setPage(1);
    setFiltersRaw(next);
  }, []);

  const appliedParams = useMemo(
    () => ({ ...filters, search: debouncedSearch, page, limit: pageSize }),
    [filters, debouncedSearch, page, pageSize],
  );

  // Reset to page 1 when search debounce or filters change. We use a layout
  // effect-style approach: re-derive whenever the inputs change and the
  // page is not already 1.
  // To avoid an extra effect pass, callers usually reset via setFilter / setSearch
  // which already call setPage(1). The hook consumer is therefore responsible
  // for ensuring that; this is intentional — manual control keeps things simple.

  const query = useQuery({
    // queryKey is caller-provided (arbitrary domain key); appending the applied
    // params keeps the cache scoped per filter/search/page combination.
    // eslint-disable-next-line @tingting/no-bare-query-key
    queryKey: [...opts.queryKey, appliedParams],
    queryFn: () => opts.endpoint(appliedParams),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled: opts.enabled ?? true,
  });

  const rows = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const reset = useCallback(() => {
    setSearch(opts.initialSearch ?? '');
    setFiltersRaw(opts.initialFilters ?? ({} as TParams));
    setPage(1);
    setPageSize(opts.defaultPageSize ?? 25);
  }, [opts.initialSearch, opts.initialFilters, opts.defaultPageSize]);

  return {
    search,
    setSearch: setSearchAndResetPage,
    filters,
    setFilter,
    setFilters,
    page,
    setPage,
    pageSize,
    setPageSize,
    rows,
    total,
    totalPages,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    query,
    appliedParams,
    reset,
  };
}
