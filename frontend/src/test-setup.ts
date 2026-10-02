/**
 * Vitest setup — runs once before every test file in the jsdom environment.
 *
 * jsdom historically does not implement `window.localStorage` (the spec leaves
 * it to the embedder), so any component that persists UI state across reloads
 * — e.g. ShipmentsPage column visibility — throws `setItem is not a function`
 * under Vitest. Install a spec-compliant in-memory Storage on `window` and
 * reset it between tests so state never leaks across cases.
 */

import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
// Register @testing-library/jest-dom matchers (toBeInTheDocument,
// toContainElement, toHaveAccessibleName, …) so component tests can use the
// recommended DOM-aware assertions instead of writing manual DOM plumbing.
import '@testing-library/jest-dom/vitest';

type Store = Map<string, string>;

function createStorage(): Storage {
  let store: Store = new Map();
  const api: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store = new Map();
    },
    getItem(key: string): string | null {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  return api;
}

Object.defineProperty(window, 'localStorage', {
  value: createStorage(),
  configurable: true,
  writable: true,
});

// Reset persisted state before each test so a previous case's column
// visibility / token never bleeds into the next one.
beforeEach(() => {
  window.localStorage.clear();
});

// jsdom does not expose `window.CSS`, but react-aria's selection code
// (ListBox/ComboBox in untitled-ui) calls `CSS.escape(id)` when a listbox
// mounts. Without this shim the passive mount effect throws
// "Cannot read properties of undefined (reading 'escape')".
if (typeof window !== 'undefined') {
  if (!window.CSS) {
    Object.defineProperty(window, 'CSS', { configurable: true, value: {} });
  }
  if (!window.CSS.escape) {
    Object.defineProperty(window.CSS, 'escape', {
      configurable: true,
      value: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`),
    });
  }
}

// jsdom has no media-query API. Default to its desktop viewport; responsive
// interaction tests override this function with their explicit breakpoint.
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  }) });
}

/**
 * Global test teardown (card 20260928_196).
 *
 * Cross-test interference, proven rather than assumed. `vitest.config.ts` sets
 * `globals: true`, so Testing Library registers its own auto-cleanup — but
 * auto-cleanup only unmounts. It does not touch timers, and a component that
 * keeps a polling interval (ShipmentsPage builds its QueryClient with
 * `retry: false` but leaves the default 30s refetch window) leaves that interval
 * running into the NEXT test once the tree is gone.
 *
 * The symptom looked like flakiness and was not. In fixed order
 * `ShipmentsPage.test.tsx` failed 1–3 tests with a DIFFERENT set each run; with
 * `--sequence.shuffle` it failed 7, and those 7 included tests from describe
 * blocks that never fail in the normal order — a Kế hoạch combobox test and a
 * hotkeys/drawer test, neither of which is in the dialog block that was
 * failing. Order was the variable, so state was crossing between tests.
 *
 * Measured: adding this block took the shuffled run from 7 failures to 1.
 * Teardown is explicit rather than relying on a library's registration
 * heuristic — RTL's auto-cleanup is still on, and calling `cleanup()` twice is
 * a no-op, so this only adds the guarantee the heuristic does not provide.
 *
 * `useRealTimers()` last, so a test that installs fake timers cannot leave them
 * installed for its successor.
 */
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});
