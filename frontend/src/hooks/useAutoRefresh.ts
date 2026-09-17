import { useEffect, useRef } from 'react';

/**
 * useAutoRefresh — keep an operational workspace (CUS, dispatch, ops, ops
 * workboard) honest when a remote mutation (driver close, OPS handover,
 * accountant reconciliation) flips the underlying state while the user is still
 * parked on the page.
 *
 * The bug this prevents (reported 2026-08-29 from the 27.8 trial):
 * the driver app shows "Hoàn thành chuyến" but the CUS workspace and
 * dispatch detail plan keep reading "Đang chạy" for up to 5 minutes —
 * the default `staleTime: 5 * 60 * 1000` in `main.tsx` plus
 * `refetchOnWindowFocus: false` make TanStack-based screens stale, and
 * the `useState` + `useEffect` workspaces (`ShipmentsPage`,
 * `useDispatchMasterPlan`, `useDispatchDetailPlan`) refetch **only** on
 * filter change or manual reload. The driver doesn't reload the office
 * tab — the office user has to know to.
 *
 * This hook:
 *   1. Polls the loader on a fixed cadence while the tab is visible.
 *   2. Pauses polling when the tab is hidden (`document.visibilityState`).
 *   3. Triggers an immediate refetch when the tab regains visibility
 *      (covers the user switching back from the driver app on another
 *      tab or another device).
 *
 * The `intervalMs` defaults to 30 s; the CUS workspace, dispatch master
 * plan, and dispatch detail plan all use the default. Pages that need
 * tighter freshness (real-time monitor, dashboard KPIs) can pass a
 * shorter value.
 *
 * The hook is deliberately no-op when the page is hidden — the browser
 * throttles setInterval heavily in the background, and we don't want
 * to wake the office workspace on a closed tab.
 */
export function useAutoRefresh(loader: () => void | Promise<void>, intervalMs: number = 30_000): void {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (typeof window === 'undefined' || intervalMs <= 0) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer != null) return;
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') {
          void loaderRef.current();
        }
      }, intervalMs);
    };

    const stop = () => {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Refresh immediately on regain — covers cross-device / cross-tab
        // workflows (driver closes on a phone, office user has the desktop
        // tab open in another window).
        void loaderRef.current();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);
}
