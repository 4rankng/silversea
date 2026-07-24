import { useQuery, type UseQueryOptions, type QueryFunctionContext } from '@tanstack/react-query';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';

/**
 * Drop-in replacement for `useQuery` that centralises the response to
 * 401 / 403 errors. When the backend reports that the current session is no
 * longer valid, the auth context's `logout()` is invoked, which clears the
 * token and flips `isAuthenticated` to false — the App's role-guard then
 * redirects to the login page.
 *
 * Usage: identical to `useQuery`:
 *
 *   const { data } = useAuthedQuery({
 *     queryKey: qk.trips.detail(id),
 *     queryFn: () => tripClient.getTrip(Number(id)),
 *   });
 *
 * No more scattered `if (err instanceof ApiError && err.status === 401)`
 * blocks in pages and hooks.
 */
export function useAuthedQuery<TQueryFnData = unknown, TError = Error, TData = TQueryFnData>(
  opts: UseQueryOptions<TQueryFnData, TError, TData>,
) {
  const { logout } = useAuth();
  return useQuery<TQueryFnData, TError, TData>({
    ...opts,
    queryFn: opts.queryFn
      ? async (ctx: QueryFunctionContext) => {
          try {
            return await (opts.queryFn as (c: QueryFunctionContext) => TQueryFnData | Promise<TQueryFnData>)(ctx);
          } catch (err) {
            if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
              logout();
            }
            throw err;
          }
        }
      : opts.queryFn,
  });
}
