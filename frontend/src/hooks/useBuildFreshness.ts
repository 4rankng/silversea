import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

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
 * Polling runs only while the tab is visible (background setInterval is
 * throttled anyway) and re-checks immediately when the tab becomes visible
 * again — that is the overnight-cut case this exists for.
 */
export function useBuildFreshness(intervalMs: number = BUILD_FRESHNESS_POLL_MS): boolean {
  const [stale, setStale] = useState(false);
  const bootHashRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || intervalMs <= 0 || stale) return;
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const check = async () => {
      if (disposed) return;
      try {
        const { buildHash } = await api.get<{ buildHash: string }>('/health');
        if (disposed) return;
        if (bootHashRef.current === null) {
          bootHashRef.current = buildHash;
        } else if (buildHash && buildHash !== bootHashRef.current) {
          setStale(true);
          stop();
        }
      } catch {
        // Health unreadable (network blip, proxy hiccup): keep the last-known
        // comparison state — a failed poll must never fabricate a mismatch.
      }
    };

    const start = () => {
      if (timer != null) return;
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') void check();
      }, intervalMs);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void check();
        start();
      } else {
        stop();
      }
    };

    void check();
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, stale]);

  return stale;
}
