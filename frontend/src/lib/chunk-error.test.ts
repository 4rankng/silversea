import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChunkErrorHandler, isChunkFailureMessage, recoverFromChunkFailure } from './chunk-error';
const key = 'tt-chunk-reload-at';
let reload: ReturnType<typeof vi.fn>;
let uninstall: (() => void) | undefined;
const html = (asset: string) => new Response(`<html><script type="module" src="/assets/${asset}.js"></script></html>`, { headers: { 'content-type': 'text/html' } });
function newBuild() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(html('new')).mockResolvedValueOnce(new Response(null, { headers: { 'content-type': 'text/javascript' } })));
}
beforeEach(() => {
  sessionStorage.clear();
  document.body.innerHTML = '';
  document.head.innerHTML = '<script type="module" src="/assets/old.js"></script>';
  reload = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { href: 'http://localhost/', reload } });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => { uninstall?.(); uninstall = undefined; document.querySelector('[data-chunk-error-panel]')?.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('chunk recovery evidence', () => {
  it('recognizes browser asset failure variants without treating them as a deployment', () => {
    for (const message of ['Loading chunk 5 failed', 'Failed to fetch dynamically imported module', 'Importing a module script failed', 'ChunkLoadError', 'error loading dynamically imported module']) expect(isChunkFailureMessage(message)).toBe(true);
    expect(isChunkFailureMessage('Cannot read properties of null')).toBe(false);
  });
  it('unchanged-build failures do not reload, purge caches or spend the allowance', async () => {
    const remove = vi.fn();
    vi.stubGlobal('caches', { keys: vi.fn().mockResolvedValue(['unrelated']), delete: remove });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(html('old')));
    expect(await recoverFromChunkFailure()).toBe('unavailable');
    expect(reload).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(key)).toBeNull();
  });
  it('a different entry and reachable new asset permit one refresh', async () => {
    newBuild();
    expect(await recoverFromChunkFailure()).toBe('reloading');
    expect(reload).toHaveBeenCalledTimes(1);
    newBuild();
    expect(await recoverFromChunkFailure()).toBe('exhausted');
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('a different entry with missing assets remains unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(html('new')).mockResolvedValueOnce(new Response(null, { status: 404 })));
    expect(await recoverFromChunkFailure()).toBe('unavailable');
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(key)).toBeNull();
  });
  it('offline and blocked storage do not cause a reload loop', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    expect(await recoverFromChunkFailure()).toBe('unavailable');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    newBuild();
    // Simulate blocked storage on the global the module actually reads:
    // sessionStorage is not guaranteed to sit on Storage.prototype in every
    // vitest environment, so a prototype spy cannot reliably intercept it.
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('blocked'); },
    });
    expect(await recoverFromChunkFailure()).toBe('unavailable');
    expect(reload).not.toHaveBeenCalled();
  });
  it.each(['vite:preloadError', 'error', 'unhandledrejection'])('global %s uses the same evidence checks and provides manual retry', async (type) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(html('old')));
    uninstall = installChunkErrorHandler();
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, { message: { value: 'Loading chunk 5 failed' }, reason: { value: new Error('Loading chunk 5 failed') } });
    window.dispatchEvent(event);
    await vi.waitFor(() => expect(document.querySelector('[data-chunk-error-panel]')?.textContent).toContain('Không thể tải nội dung'));
    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });
  it('isolates background controls and late portals, traps focus, and restores state on cleanup', async () => {
    document.body.innerHTML = '<main><button id="save">Save</button></main><aside inert="">Already inactive</aside>';
    const save = document.querySelector<HTMLButtonElement>('#save')!;
    save.focus();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(html('old')));
    uninstall = installChunkErrorHandler();
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    await vi.waitFor(() => expect(document.querySelector('[data-chunk-error-panel] button')).not.toBeNull());
    const retry = document.querySelector<HTMLButtonElement>('[data-chunk-error-panel] button')!;
    expect(retry.parentElement?.className).toBe('connection-gate__actions');
    expect(document.activeElement).toBe(retry);
    expect(document.querySelector('main')?.hasAttribute('inert')).toBe(true);
    const portal = document.createElement('div');
    document.body.append(portal);
    await vi.waitFor(() => expect(portal.hasAttribute('inert')).toBe(true));
    for (const shiftKey of [false, true]) {
      const tab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true, bubbles: true });
      retry.dispatchEvent(tab);
      expect(tab.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(retry);
    }
    save.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(document.activeElement).toBe(retry);
    uninstall();
    uninstall = undefined;
    expect(document.querySelector('[data-chunk-error-panel]')).toBeNull();
    expect(document.querySelector('main')?.hasAttribute('inert')).toBe(false);
    expect(portal.hasAttribute('inert')).toBe(false);
    expect(document.querySelector('aside')?.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(save);
    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true, bubbles: true });
    save.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
  });
  it('does not insert a stale fallback after its handler was uninstalled', async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>((resolve) => { finish = resolve; })));
    uninstall = installChunkErrorHandler();
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    uninstall();
    uninstall = undefined;
    finish(html('old'));
    await recoverFromChunkFailure();
    expect(document.querySelector('[data-chunk-error-panel]')).toBeNull();
    expect(document.querySelector('[inert]')).toBeNull();
  });
});
