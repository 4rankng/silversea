import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPwaStandalone, watchPwaStandalone } from './pwa-standalone';

// jsdom's navigator has no `standalone` (iOS-only legacy flag), so each case
// defines it as an own property and deletes it afterwards.
function setIosStandalone(value: boolean | undefined) {
  if (value === undefined) return;
  Object.defineProperty(window.navigator, 'standalone', {
    value,
    configurable: true,
    writable: true,
  });
}

function unsetIosStandalone() {
  delete (window.navigator as Navigator & { standalone?: boolean }).standalone;
}

function mockDisplayMode(matches: boolean) {
  const listeners: Array<() => void> = [];
  const mql = {
    matches,
    media: '(display-mode: standalone)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn((_type: string, cb: () => void) => listeners.push(cb)),
    removeEventListener: vi.fn(),
    dispatchEvent: () => true,
  };
  vi.spyOn(window, 'matchMedia').mockReturnValue(mql as unknown as MediaQueryList);
  return { mql, fireChange: () => listeners.forEach((cb) => cb()) };
}

afterEach(() => {
  unsetIosStandalone();
  vi.restoreAllMocks();
  document.documentElement.classList.remove('pwa-standalone');
});

describe('isPwaStandalone (hybrid iOS + display-mode check)', () => {
  it('trusts navigator.standalone even when the media query says false — the iOS WebKit case', () => {
    setIosStandalone(true);
    mockDisplayMode(false);
    expect(isPwaStandalone()).toBe(true);
  });

  it('trusts the display-mode media query when the iOS flag is absent — Android/desktop installed', () => {
    mockDisplayMode(true);
    expect(isPwaStandalone()).toBe(true);
  });

  it('reports plain browser when neither signal matches', () => {
    mockDisplayMode(false);
    expect(isPwaStandalone()).toBe(false);
  });

  it('survives an environment without matchMedia (falls back to false, no throw)', () => {
    const bare = { navigator: {} } as unknown as Window;
    expect(isPwaStandalone(bare)).toBe(false);
  });
});

describe('watchPwaStandalone (pwa-standalone class on <html>)', () => {
  it('applies the class immediately for an iOS standalone launch and removes it on cleanup', () => {
    setIosStandalone(true);
    mockDisplayMode(false);
    const stop = watchPwaStandalone();
    expect(document.documentElement).toHaveClass('pwa-standalone');
    stop();
    expect(document.documentElement).not.toHaveClass('pwa-standalone');
  });

  it('retries while navigator.standalone is still undefined in the first ms of an iOS launch', () => {
    vi.useFakeTimers();
    try {
      mockDisplayMode(false);
      const stop = watchPwaStandalone();
      expect(document.documentElement).not.toHaveClass('pwa-standalone');

      // The flag populates shortly after launch.
      setIosStandalone(true);
      vi.advanceTimersByTime(60);
      expect(document.documentElement).toHaveClass('pwa-standalone');
      stop();
      vi.advanceTimersByTime(2_000);
      expect(document.documentElement).not.toHaveClass('pwa-standalone');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the class current when the display-mode query flips at runtime', () => {
    const { fireChange } = mockDisplayMode(false);
    const stop = watchPwaStandalone();
    expect(document.documentElement).not.toHaveClass('pwa-standalone');

    // Desktop installed app moves to a standalone launch.
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '(display-mode: standalone)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: () => true,
    } as unknown as MediaQueryList);
    fireChange();
    expect(document.documentElement).toHaveClass('pwa-standalone');
    stop();
  });
});
