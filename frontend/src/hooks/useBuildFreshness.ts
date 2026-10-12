import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { qk } from '../api/keys';

/**
 * Poll cadence for the stale-build check. Long enough to stay invisible,
 * short enough that a cut is flagged within about a minute (card T1).
 */
export const BUILD_FRESHNESS_POLL_MS = 60_000;

/**
 * useBuildFreshness — detect a deploy that happened under a long-lived tab.
 *
 * Staging serves index.html no-cache but hashed assets with Expires +1y, so a
 * tab kept open across a cut keeps running the old chunk graph indefinitely
 * (2026-09-20: a stale /shipments-detail tab rendered a retired native date
 * input and the user reported it as an overlap bug). The chunk-error handler
 * only recovers reactively after a lazy chunk already 404s; this hook flags
 * the condition proactively instead.
 *
 * The first successful /health read becomes the boot baseline (the build this
 * tab actually loaded). Every later poll compares against it:
 *   - equal            → nothing happens
 *   - different        → `stale` flips true and polling stops (terminal until
 *                        the user reloads; the banner owns the next move)
 *   - fetch failure    → last-known state kept; a missing baseline simply
 *                        stays missing, so a health blip never banners
 *
 * Card QA1-002/004 (121026084553): the /health call rides the SAME query
 * entry the support dialog's BuildVersion uses (qk.support.serverBuild), so
 * the two consumers share one cache entry and one request instead of firing
 * independent fetches per mount. Polling pauses while the tab is hidden
 * (refetchIntervalInBackground) and re-checks on refocus when the entry is
 * older than the poll window — the overnight-cut case this exists for.
 */
export function useBuildFreshness(intervalMs: number = BUILD_FRESHNESS_POLL_MS): boolean {
  const [stale, setStale] = useState(false);
  const bootHashRef = useRef<string | null>(null);

  const query = useQuery({
    queryKey: qk.support.serverBuild,
    queryFn: () => api.get<{ buildHash: string }>('/health'),
    // Terminal once stale: `enabled` false stops the interval refetches.
    enabled: !stale && intervalMs > 0,
    refetchInterval: intervalMs,
    refetchIntervalInBackground: false,
    // A remount inside the poll window reads the cache instead of firing a
    // second /health (the dev StrictMode double-mount the QA card measured).
    staleTime: intervalMs,
    retry: false,
    networkMode: 'always',
  });

  useEffect(() => {
    const hash = query.data?.buildHash;
    if (!hash) return;
    if (bootHashRef.current === null) {
      bootHashRef.current = hash;
    } else if (hash !== bootHashRef.current) {
      setStale(true);
    }
  }, [query.data]);

  return stale;
}
