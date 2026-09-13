// Self-heal stale-chunk load failures.
//
// After a deploy, an open tab may still hold an old app shell whose hashed JS
// chunks no longer exist on the server — or the service worker may serve a
// stale shell whose chunks fail to load. Two paths recover:
//
// 1. ErrorBoundary: React.lazy route chunks reject inside React's tree, so the
//    boundary is the FIRST to see them. It calls recoverFromChunkFailure()
//    and, while the reload is pending, renders a "nạp phiên bản mới" panel
//    instead of the dead-end "Đã xảy ra lỗi" screen.
// 2. Global listeners (this module): the safety net for eager imports, leaked
//    rejections, vite:preloadError, and any chunk failure outside React's
//    tree — purge service-worker caches and reload.
//
// Loop safety: at most one self-heal reload per cooldown window. A genuinely
// broken deploy still fails after the reload, the window blocks a second
// reload, and the user sees a "vui lòng tải lại trang" message instead of
// looping forever. The window (not a one-shot flag) lets the NEXT deploy,
// hours later, self-heal this same long-lived tab again.

const RELOAD_AT_KEY = 'tt-chunk-reload-at';
// Long enough to cover a broken-deploy retry loop, short enough that a tab
// open across the next deploy still self-heals.
const RELOAD_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const CHUNK_FAIL_RE =
  /(Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|error loading dynamically imported module)/i;

export function isChunkFailureMessage(message: string): boolean {
  return message.length > 0 && CHUNK_FAIL_RE.test(message);
}

function messageFromErrorEvent(event: ErrorEvent): string {
  return event.message || '';
}

function messageFromRejectionEvent(event: PromiseRejectionEvent): string {
  const reason = event.reason;
  if (reason instanceof Error) return reason.message;
  return typeof reason === 'string' ? reason : '';
}

function renderFallback(): void {
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:center;height:100dvh;font-family:var(--font-body);text-align:center;padding:1.5rem;color:#1f2937">' +
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

/**
 * Attempt the stale-chunk self-heal: purge caches and reload once, unless the
 * cooldown from a recent self-heal is still running. Callers decide how to
 * render while reloading / after exhaustion.
 */
export function recoverFromChunkFailure(): 'reloading' | 'exhausted' {
  const last = Number(sessionStorage.getItem(RELOAD_AT_KEY) || '0');
  if (last && Date.now() - last < RELOAD_COOLDOWN_MS) return 'exhausted';
  sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()));
  void purgeCaches().finally(() => window.location.reload());
  return 'reloading';
}

function handleChunkFailure(): void {
  if (recoverFromChunkFailure() === 'exhausted') renderFallback();
}

/**
 * Install global listeners for failed dynamic imports / chunk loads. Safe to
 * call once at app boot (before React mounts). Idempotent in effect — repeated
 * installs only add listeners that short-circuit on the cooldown.
 */
export function installChunkErrorHandler(): void {
  window.addEventListener('vite:preloadError', (event) => {
    handleChunkFailure();
    event.preventDefault();
  });
  window.addEventListener('error', (event) => {
    if (isChunkFailureMessage(messageFromErrorEvent(event))) {
      handleChunkFailure();
      event.preventDefault();
    }
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (isChunkFailureMessage(messageFromRejectionEvent(event))) {
      handleChunkFailure();
      event.preventDefault();
    }
  });
}
