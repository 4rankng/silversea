import { isolateInteractionGate } from './interaction-gate';

/** Asset failure is not deployment evidence. Compare the served entry before refreshing. */
const RELOAD_AT_KEY = 'tt-chunk-reload-at';
const RELOAD_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const ANY_CHUNK_RE = /(Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|error loading dynamically imported module)/i;
export type ChunkRecovery = 'reloading' | 'exhausted' | 'unavailable';
let pending: Promise<ChunkRecovery> | undefined;

export function isChunkFailureMessage(message: string): boolean {
  return message.length > 0 && ANY_CHUNK_RE.test(message);
}

function entryAsset(doc: Document): string | null {
  const src = doc.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute('src');
  if (!src) return null;
  const url = new URL(src, window.location.href);
  const origin = new URL(window.location.href).origin;
  return url.origin === origin && /^\/assets\/.+\.js$/.test(url.pathname) ? url.href : null;
}

async function recover(): Promise<ChunkRecovery> {
  if (!navigator.onLine) return 'unavailable';
  const currentEntry = entryAsset(document);
  if (!currentEntry) return 'unavailable';
  try {
    const response = await fetch(new URL('/?app-version-check=1', window.location.href), {
      cache: 'no-store', signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return 'unavailable';
    const fresh = new DOMParser().parseFromString(await response.text(), 'text/html');
    const nextEntry = entryAsset(fresh);
    if (!nextEntry || nextEntry === currentEntry) return 'unavailable';
    const asset = await fetch(nextEntry, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(5_000) });
    if (!asset.ok || !/javascript|ecmascript/.test(asset.headers.get('content-type') || '')) return 'unavailable';
    // Only verified deployment changes spend the allowance. If storage is
    // blocked, manual retry is safer than an unbounded automatic reload.
    const last = Number(sessionStorage.getItem(RELOAD_AT_KEY) || '0');
    if (last && Date.now() - last < RELOAD_COOLDOWN_MS) return 'exhausted';
    sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()));
    window.location.reload();
    return 'reloading';
  } catch { return 'unavailable'; }
}

export function recoverFromChunkFailure(): Promise<ChunkRecovery> {
  if (!pending) pending = recover().finally(() => { pending = undefined; });
  return pending;
}

function renderFallback(result: ChunkRecovery): (() => void) | undefined {
  if (result === 'reloading' || document.querySelector('[data-chunk-error-panel]')) return;
  const panel = document.createElement('section');
  panel.dataset.chunkErrorPanel = 'true';
  panel.className = 'connection-gate';
  panel.setAttribute('role', 'alertdialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Không thể tải trang');
  const content = document.createElement('div');
  content.className = 'connection-gate__content';
  const message = document.createElement('p');
  message.textContent = result === 'exhausted'
    ? 'Ứng dụng đã được cập nhật nhưng chưa tải được nội dung. Vui lòng thử tải lại.'
    : 'Không thể tải nội dung. Kiểm tra kết nối internet và thử lại.';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Tải lại trang';
  button.onclick = () => window.location.reload();
  const actions = document.createElement('div');
  actions.className = 'connection-gate__actions';
  actions.append(button);
  content.append(message, actions);
  panel.append(content);
  document.body.append(panel);
  const release = isolateInteractionGate(panel, 20, button);
  return () => { release(); panel.remove(); };

}

export function installChunkErrorHandler(): () => void {
  let active = true;
  let removeFallback: (() => void) | undefined;
  const handle = (event: Event, message: string) => {
    if (!isChunkFailureMessage(message)) return;
    event.preventDefault();
    void recoverFromChunkFailure().then((result) => {
      if (active && !removeFallback) removeFallback = renderFallback(result);
    });
  };
  const preload = (event: Event) => handle(event, 'Loading chunk failed');
  const error = (event: ErrorEvent) => handle(event, event.message || '');
  const rejection = (event: PromiseRejectionEvent) => handle(event,
    event.reason instanceof Error ? event.reason.message : typeof event.reason === 'string' ? event.reason : '');
  window.addEventListener('vite:preloadError', preload);
  window.addEventListener('error', error);
  window.addEventListener('unhandledrejection', rejection);
  return () => {
    active = false;
    removeFallback?.();
    window.removeEventListener('vite:preloadError', preload);
    window.removeEventListener('error', error);
    window.removeEventListener('unhandledrejection', rejection);
  };
}
