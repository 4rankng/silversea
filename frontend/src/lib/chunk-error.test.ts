import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChunkErrorHandler, isChunkFailureMessage, recoverFromChunkFailure } from './chunk-error';

const RELOAD_AT_KEY = 'tt-chunk-reload-at';
const STALE_CHUNK_ERR =
  'TypeError: Failed to fetch dynamically imported module: http://vantai.tingting.vip/assets/DriverTripDetailPage-BspMDth9.js';

function stubReload(): ReturnType<typeof vi.fn> {
  const reload = vi.fn();
  // jsdom marks location.reload as an own non-configurable property, so the
  // whole location object has to be swapped out to observe reload calls.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: 'http://localhost/', reload },
  });
  return reload;
}

function dispatchUnhandledRejection(reason: unknown): void {
  const event = new Event('unhandledrejection') as PromiseRejectionEvent;
  Object.defineProperty(event, 'reason', { value: reason });
  window.dispatchEvent(event);
}

describe('isChunkFailureMessage', () => {
  it('matches the stale-chunk failure shapes thrown after a deploy', () => {
    expect(isChunkFailureMessage(STALE_CHUNK_ERR)).toBe(true);
    expect(isChunkFailureMessage('Loading chunk 5 failed.\nerror: http://x/assets/index-abc.js')).toBe(true);
    expect(isChunkFailureMessage('Importing a module script failed.')).toBe(true);
    expect(isChunkFailureMessage('ChunkLoadError: Loading chunk 3 failed')).toBe(true);
    expect(isChunkFailureMessage('error loading dynamically imported module')).toBe(true);
  });

  it('rejects unrelated runtime errors and empty messages', () => {
    expect(isChunkFailureMessage('')).toBe(false);
    expect(isChunkFailureMessage('Cannot read properties of undefined (reading map)')).toBe(false);
    expect(isChunkFailureMessage('NetworkError when attempting to fetch resource.')).toBe(false);
  });
});

describe('recoverFromChunkFailure', () => {
  beforeEach(() => {
    sessionStorage.clear();
    stubReload();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reloads exactly once, then blocks the second attempt inside the cooldown', async () => {
    const reload = stubReload();

    expect(recoverFromChunkFailure()).toBe('reloading');
    expect(recoverFromChunkFailure()).toBe('exhausted');

    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(Number(sessionStorage.getItem(RELOAD_AT_KEY))).toBeGreaterThan(0);
  });

  it('self-heals again once the cooldown window has passed', () => {
    sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now() - 5 * 60 * 60 * 1000));
    expect(recoverFromChunkFailure()).toBe('reloading');
  });

  it('stays exhausted while the cooldown window is running', () => {
    sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()));
    expect(recoverFromChunkFailure()).toBe('exhausted');
  });
});

describe('installChunkErrorHandler', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('purges and reloads on a failed dynamic-import error event', async () => {
    const reload = stubReload();
    installChunkErrorHandler();

    window.dispatchEvent(new ErrorEvent('error', { message: STALE_CHUNK_ERR }));

    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('reloads on vite:preloadError without needing a message match', async () => {
    const reload = stubReload();
    installChunkErrorHandler();

    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);

    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(event.defaultPrevented).toBe(true);
  });

  it('reloads on a leaked chunk-load rejection and suppresses its default', async () => {
    const reload = stubReload();
    installChunkErrorHandler();

    const event = new Event('unhandledrejection', { cancelable: true }) as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: new TypeError(STALE_CHUNK_ERR) });
    window.dispatchEvent(event);

    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores non-chunk errors and leaves the page alone', async () => {
    const reload = stubReload();
    installChunkErrorHandler();

    window.dispatchEvent(new ErrorEvent('error', { message: 'boom: undefined is not a function' }));
    dispatchUnhandledRejection(new Error('boom'));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reload).not.toHaveBeenCalled();
  });
});
