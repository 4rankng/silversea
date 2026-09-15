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

void retireOfflineStorage().then((retirement) => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>
  );
  if (retirement.found || retirement.cleanupIncomplete) {
    const notice = document.createElement('div');
    notice.className = 'retired-offline-notice';
    notice.setAttribute('role', 'status');
    notice.textContent = 'Lệnh chờ cũ đã ngừng gửi tự động. Kiểm tra trạng thái trên máy chủ trước khi nhập lại thao tác chưa gửi hoặc chưa rõ kết quả.';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Đã hiểu';
    close.onclick = () => notice.remove();
    notice.append(close);
    document.body.append(notice);
  }
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
