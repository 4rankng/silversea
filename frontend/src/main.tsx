import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { installChunkErrorHandler } from './lib/chunk-error';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 5 * 60 * 1000, // 5 minutes default staleTime
    },
  },
});

// Self-heal stale-chunk load failures before React mounts: if a dynamic
// import fails (e.g. after a deploy, when the running tab references a JS
// chunk the cached service worker no longer has), purge the SW cache and
// reload once instead of hanging on a "Đang tải…" spinner or going blank.
installChunkErrorHandler();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);

// Register the service worker for PWA installability (Android) + offline app shell.
// Production-only: a cache-first SW in Vite dev would break HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(async (reg) => {
      // Request periodic background sync for drivers — keeps the journey board
      // fresh even when the app is backgrounded (spec AC-DISPATCH-001).
      const periodicSync = (reg as unknown as { periodicSync?: PeriodicSyncManager }).periodicSync;
      if (periodicSync) {
        try {
          const status = await navigator.permissions.query({ name: 'periodic-background-sync' as PermissionName });
          if (status.state === 'granted') {
            await periodicSync.register('refresh-journey-board', { minInterval: 15 * 60 * 1000 });
          }
        } catch {
          // Periodic sync not available or denied — polling fallback covers this.
        }
      }
    }).catch((err) => {
      console.warn('SW registration failed:', err);
    });
    // sw.js calls skipWaiting() + clients.claim(), so a newly deployed SW takes
    // control of this tab immediately. Reload once on controllerchange so the
    // page picks up the fresh module graph instead of continuing to run the
    // stale JS it booted with.
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  });
}
