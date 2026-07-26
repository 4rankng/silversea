// useOnline — M8.1 global network-status hook (PRD M08-01-05 slow-network).
//
// Tracks `navigator.onLine` + the `online`/`offline` window events. Returns
// `true` when the browser reports a connection. The hook is intentionally
// simple — it does NOT measure bandwidth or latency (the Web Network API is
// not widely shipped). Consumers surface a banner/toast on `false` so the
// driver/clerk knows writes are being queued offline.

import { useEffect, useState } from 'react';

export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}
