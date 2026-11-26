import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

const STORE_PREFIX = 'app-body-scroll:';
/** Frame cap for the ready-retry: rows paint synchronously from the query
 *  cache, so the scrollport normally holds the saved depth on the first
 *  layout pass; the retry only covers a slow first paint. */
const RESTORE_RETRY_FRAMES = 10;

/** Per-URL memory of the MAIN.app-body scrollport. The SPA Back flow never
 *  reloads the document, so the in-memory table alone restores the position;
 *  the sessionStorage mirror covers a full reload landing on the same list
 *  URL. Keyed by pathname+search — the URL already IS the filter signature
 *  (page, tab, searchSuffix… all ride it), so a Back to a different filter
 *  state never sees a foreign depth. */
const scrollMemory: Record<string, number> = {};

/**
 * K1.32 (SIL-1078) — /shipments Back keeps URL + filters + page but the
 * MAIN.app-body scroll position reset to 0: the shell main persists across
 * routes, and nothing ever saved or restored its scrollTop. Save the depth
 * when the list leaves (unmount cleanup — the closure still holds the list
 * URL the page was serving), restore it once the list has data (query cache
 * paints rows on the first render, so the restore never lands before the
 * rows can hold the depth).
 */
export function useAppBodyScrollRestore(ready: boolean): void {
  const location = useLocation();
  const key = `${location.pathname}${location.search}`;
  const keyRef = useRef(key);
  keyRef.current = key;

  // Save on leave. A URL change while mounted (pagination, filters) runs the
  // cleanup for the PREVIOUS key with the depth still on screen, so each
  // visited filter state remembers its own depth.
  useLayoutEffect(() => () => {
    const el = document.getElementById('main-content');
    const top = el?.scrollTop ?? 0;
    if (top <= 0) return;
    scrollMemory[keyRef.current] = top;
    try { sessionStorage.setItem(STORE_PREFIX + keyRef.current, String(top)); } catch { /* storage unavailable */ }
  }, [key]);

  // Restore once the list has data. The entry is consumed even when the
  // depth can no longer be held (data changed between visits): a stale depth
  // must never yank a later visit to the top of an unrelated list.
  useEffect(() => {
    let saved: number | null = null;
    if (scrollMemory[key] != null) saved = scrollMemory[key];
    else {
      try {
        const raw = sessionStorage.getItem(STORE_PREFIX + key);
        if (raw != null) saved = Number(raw);
      } catch { /* storage unavailable */ }
    }
    if (!ready || saved == null || !Number.isFinite(saved) || saved <= 0) return;
    const savedDepth: number = saved;
    delete scrollMemory[key];
    try { sessionStorage.removeItem(STORE_PREFIX + key); } catch { /* storage unavailable */ }
    const el = document.getElementById('main-content');
    if (!el) return;
    let frames = 0;
    const apply = () => {
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0 && savedDepth > 0 && frames < RESTORE_RETRY_FRAMES) {
        frames += 1;
        requestAnimationFrame(apply);
        return;
      }
      // Direct assignment — .app-body declares scroll-behavior: smooth, and a
      // restore must not animate from 0.
      el.scrollTop = Math.max(0, Math.min(savedDepth, Math.max(0, max)));
    };
    apply();
  }, [key, ready]);
}
