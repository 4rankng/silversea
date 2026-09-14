// useOnline — real connectivity check (replaced navigator.onLine hint).
//
// Returns `true` only when a bounded same-origin HEAD request succeeds.
// Falls back to `navigator.onLine` while the probe is in flight so the
// first render is never blocked.  The probe runs on mount, on
// online/offline events, and every 30 s while offline so the UI recovers
// automatically when the network returns.

import { useEffect, useRef, useState } from 'react';

const PROBE_INTERVAL_MS = 30_000;
const PROBE_TIMEOUT_MS = 5_000;

export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    async function probe(): Promise<void> {
      try {
        const res = await fetch('/api/health', {
          method: 'HEAD',
          cache: 'no-store',
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        if (!cancelled) setOnline(res.ok);
      } catch {
        if (!cancelled) setOnline(false);
      }
    }

    function startProbing() {
      void probe();
      clearInterval(timerRef.current);
      timerRef.current = setInterval(() => void probe(), PROBE_INTERVAL_MS);
    }

    function stopProbing() {
      clearInterval(timerRef.current);
      timerRef.current = undefined;
    }

    function handleOnline() {
      // Browser says online — verify with a real request.
      void probe();
    }

    function handleOffline() {
      setOnline(false);
      // Keep probing so we recover without a user-initiated refresh.
      startProbing();
    }

    // Initial probe + start interval if offline.
    startProbing();

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      cancelled = true;
      stopProbing();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}
