/** Shared reachability state. Reconnection never submits a business command. */
export type ConnectionState = 'checking' | 'online' | 'offline' | 'unavailable';
const API_BASE = import.meta.env.VITE_API_BASE || '/api';
let state: ConnectionState = 'checking';
let started = false;
let generation = 0;
let pending: Promise<ConnectionState> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function publish(next: ConnectionState) {
  if (state === next) return;
  state = next;
  listeners.forEach((listener) => listener());
}

export const getConnectionState = () => state;

export function checkConnection(): Promise<ConnectionState> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    generation += 1;
    pending = undefined;
    publish('offline');
    return Promise.resolve('offline');
  }
  if (pending) return pending;
  const current = ++generation;
  const request = (async () => {
    // Assign `pending` before invoking even a synchronously failing transport.
    await Promise.resolve();
    try {
      const response = await fetch(`${API_BASE}/health`, {
        method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(5_000),
      });
      if (current === generation) publish(response.ok ? 'online' : 'unavailable');
    } catch {
      if (current === generation) publish(navigator.onLine ? 'unavailable' : 'offline');
    } finally {
      if (current === generation) pending = undefined;
    }
    return state;
  })();
  pending = request;
  return request;
}

function handleOffline() {
  generation += 1;
  pending = undefined;
  publish('offline');
}

function handleOnline() {
  publish('checking');
  void checkConnection();
}

export function subscribeConnection(listener: () => void) {
  listeners.add(listener);
  if (!started) {
    started = true;
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    timer = setInterval(() => void checkConnection(), 30_000);
    void checkConnection();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(timer);
      started = false;
      generation += 1;
      pending = undefined;
      state = 'checking';
    }
  };
}

export function assertConnectionForMutation(): void {
  if ((typeof navigator !== 'undefined' && !navigator.onLine)
    || state === 'offline' || state === 'unavailable' || (started && state === 'checking')) {
    throw new Error('Chưa gửi thay đổi. Cần kết nối máy chủ để lưu; hãy kiểm tra kết nối và thử lại.');
  }
}
