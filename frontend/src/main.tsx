import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { installChunkErrorHandler } from './lib/chunk-error';
import './index.css';
import { retireOfflineStorage } from './lib/retire-offline-storage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'always',
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 5 * 60 * 1000, // 5 minutes default staleTime
    },
    mutations: { networkMode: 'always', retry: false },
  },
});

// Recover only after verifying that a newer entry asset is available.
// Connection failures keep their manual recovery state without deleting caches.
installChunkErrorHandler();

void retireOfflineStorage().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>
  );
  // Legacy offline-queue cleanup stays silent: the user ruled the visible
  // migration warning out of the product once the queues themselves retired.
});

// Register the service worker for PWA installability (Android) + push notifications.
// Production-only: a SW in Vite dev would break HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('SW registration failed:', err);
    });

  });
}
