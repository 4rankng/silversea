import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installStandaloneViewportHeight } from './ios-standalone-viewport';

// Unit coverage for the --app-height publisher (consult Gemini+DeepSeek
// 23/10): standalone-only, >4px divergence required, keyboard shrink ignored,
// re-measures on resize/pageshow, cleans up after itself.

interface FakeVV {
  height: number;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

function makeStyleStub() {
  const stored = new Map<string, string>();
  return {
    stored,
    setProperty: vi.fn((name: string, value: string) => { stored.set(name, value); }),
    removeProperty: vi.fn((name: string) => { stored.delete(name); }),
    getPropertyValue: vi.fn((name: string) => stored.get(name) ?? ''),
  };
}

function makeFakeWin(options: { standalone: boolean; innerHeight: number; vvHeight: number | null }) {
  const { standalone, innerHeight, vvHeight } = options;
  const vvListeners: Array<[string, () => void]> = [];
  const winListeners: Array<[string, () => void]> = [];
  const style = makeStyleStub();
  const vv: FakeVV | null = vvHeight === null
    ? null
    : {
        height: vvHeight,
        addEventListener: vi.fn((type: string, cb: () => void) => { vvListeners.push([type, cb]); }),
        removeEventListener: vi.fn((type: string, cb: () => void) => {
          const index = vvListeners.findIndex(([t, l]) => t === type && l === cb);
          if (index >= 0) vvListeners.splice(index, 1);
        }),
      };
  const win = {
    innerHeight,
    visualViewport: vv,
    navigator: { standalone },
    matchMedia: vi.fn().mockReturnValue({
      matches: standalone,
      media: '(display-mode: standalone)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
    document: { documentElement: { style } },
    addEventListener: vi.fn((type: string, cb: () => void) => { winListeners.push([type, cb]); }),
    removeEventListener: vi.fn((type: string, cb: () => void) => {
      const index = winListeners.findIndex(([t, l]) => t === type && l === cb);
      if (index >= 0) winListeners.splice(index, 1);
    }),
    setTimeout: (fn: () => void, delay?: number) => setTimeout(fn, delay),
    clearTimeout: (id: number) => clearTimeout(id),
  };
  const fireVv = (type: string) => vvListeners.filter(([t]) => t === type).forEach(([, cb]) => cb());
  const fireWin = (type: string) => winListeners.filter(([t]) => t === type).forEach(([, cb]) => cb());
  return { win: win as unknown as Window, style, vv: vv as FakeVV, fireVv, fireWin };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('installStandaloneViewportHeight (--app-height publisher)', () => {
  it('stays out of a plain browser even when the viewport diverges', () => {
    const { win, style } = makeFakeWin({ standalone: false, innerHeight: 874, vvHeight: 812 });
    installStandaloneViewportHeight(win);
    expect(style.getPropertyValue('--app-height')).toBe('');
    expect(style.setProperty).not.toHaveBeenCalled();
  });

  it('publishes the measured visual viewport when standalone diverges (the WebKit bug band)', () => {
    const { win, style } = makeFakeWin({ standalone: true, innerHeight: 874, vvHeight: 812 });
    installStandaloneViewportHeight(win);
    expect(style.stored.get('--app-height')).toBe('812px');
  });

  it('leaves the CSS units in charge within the 4px trust threshold', () => {
    const { win, style } = makeFakeWin({ standalone: true, innerHeight: 800, vvHeight: 797 });
    installStandaloneViewportHeight(win);
    expect(style.getPropertyValue('--app-height')).toBe('');
  });

  it('keeps the last good value while the keyboard is open (>120px shrink) and recovers on dismiss', () => {
    const { win, style, vv, fireVv } = makeFakeWin({ standalone: true, innerHeight: 874, vvHeight: 812 });
    installStandaloneViewportHeight(win);
    expect(style.stored.get('--app-height')).toBe('812px');

    // Keyboard opens: 874 - 700 = 174px shrink — the shell must not chase it.
    vv.height = 700;
    fireVv('resize');
    expect(style.stored.get('--app-height')).toBe('812px');

    // Keyboard dismissed back into the trust band: the variable clears.
    vv.height = 872;
    fireVv('resize');
    expect(style.getPropertyValue('--app-height')).toBe('');
  });

  it('re-measures on pageshow (stuck-viewport resume)', () => {
    const { win, style, vv, fireWin } = makeFakeWin({ standalone: true, innerHeight: 874, vvHeight: 812 });
    installStandaloneViewportHeight(win);

    vv.height = 840;
    fireWin('pageshow');
    expect(style.stored.get('--app-height')).toBe('840px');
  });

  it('retries until the iOS standalone flag populates after launch', () => {
    const { win, style } = makeFakeWin({ standalone: false, innerHeight: 874, vvHeight: 812 });
    installStandaloneViewportHeight(win);
    expect(style.getPropertyValue('--app-height')).toBe('');

    (win.navigator as Navigator & { standalone?: boolean }).standalone = true;
    vi.advanceTimersByTime(60);
    expect(style.stored.get('--app-height')).toBe('812px');
  });

  it('cleanup clears the variable and detaches every listener', () => {
    const { win, style, fireVv, fireWin } = makeFakeWin({ standalone: true, innerHeight: 874, vvHeight: 812 });
    const stop = installStandaloneViewportHeight(win);
    expect(style.stored.get('--app-height')).toBe('812px');

    stop();
    expect(style.getPropertyValue('--app-height')).toBe('');

    // Detached listeners must be inert after cleanup.
    fireVv('resize');
    fireWin('pageshow');
    expect(style.getPropertyValue('--app-height')).toBe('');
  });
});
