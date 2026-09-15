import { useQuery, type UseQueryOptions } from '@tanstack/react-query';

/**
 * Compatibility wrapper for authenticated queries. The API transport owns
 * token-bound session expiry; a query error cannot identify which session
 * sent the request and must never log out a newer session.
 */
export function useAuthedQuery<TQueryFnData = unknown, TError = Error, TData = TQueryFnData>(
  opts: UseQueryOptions<TQueryFnData, TError, TData>,
) {
  return useQuery<TQueryFnData, TError, TData>(opts);
}
