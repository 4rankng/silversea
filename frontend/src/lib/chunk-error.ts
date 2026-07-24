// Self-heal stale-chunk load failures.
//
// After a deploy, an open tab may still hold an old app shell whose hashed JS
// chunks no longer exist on the server — or the service worker may serve a
// stale shell whose chunks fail to load. When a dynamic import() then fails,
// the app would otherwise hang on a loading spinner or render blank. This
// handler purges the service-worker caches and reloads ONCE so the browser
// fetches fresh assets.
//
// Coverage note: route-level lazy chunks (React.lazy + Suspense) are caught
// first by the ErrorBoundary that wraps <Routes> in App.tsx, which renders a
// retry UI. This global handler is the safety net for eager imports, leaked
// rejections, and any chunk failure outside React's tree — and the purge +
// reload is the recovery path when it does fire.
//
// Loop safety: capped at a single reload per browser session. If the freshly
// fetched assets are *also* missing (a genuinely broken deploy), we stop and
// show a Vietnamese message instead of looping forever.

const RELOAD_KEY = 'tt-chunk-reload-count';
const CHUNK_FAIL_RE =
  /(Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|error loading dynamically imported module)/i;

function messageFromErrorEvent(event: ErrorEvent): string {
  return event.message || '';
}

function messageFromRejectionEvent(event: PromiseRejectionEvent): string {
  const reason = event.reason;
  if (reason instanceof Error) return reason.message;
  return typeof reason === 'string' ? reason : '';
}

function isChunkFailure(message: string): boolean {
  return message.length > 0 && CHUNK_FAIL_RE.test(message);
}

function renderFallback(): void {
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:center;height:100dvh;font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:1.5rem;color:#1f2937">' +
    '<div>' +
    '<p style="font-size:1.05rem;font-weight:600;margin:0 0 .35rem">Phiên bản mới đã sẵn sàng.</p>' +
    '<p style="margin:0;color:#6b7280">Vui lòng tải lại trang để tiếp tục.</p>' +
    '</div></div>';
}

async function purgeCaches(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  } catch {
    // Best effort — proceed to reload regardless of purge outcome.
  }
}

function handleChunkFailure(): void {
  const count = Number(sessionStorage.getItem(RELOAD_KEY) || '0') + 1;
  sessionStorage.setItem(RELOAD_KEY, String(count));
  if (count > 1) {
    renderFallback();
    return;
  }
  void purgeCaches().finally(() => window.location.reload());
}

/**
 * Install global listeners for failed dynamic imports / chunk loads. Safe to
 * call once at app boot (before React mounts). Idempotent in effect — repeated
 * installs only add listeners that short-circuit on the per-session cap.
 */
export function installChunkErrorHandler(): void {
  window.addEventListener('error', (event: ErrorEvent) => {
    if (isChunkFailure(messageFromErrorEvent(event))) {
      handleChunkFailure();
      event.preventDefault();
    }
  });
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    if (isChunkFailure(messageFromRejectionEvent(event))) {
      handleChunkFailure();
      event.preventDefault();
    }
  });
}
