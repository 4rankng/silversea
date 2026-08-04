/**
 * Vitest setup — runs once before every test file in the jsdom environment.
 *
 * jsdom historically does not implement `window.localStorage` (the spec leaves
 * it to the embedder), so any component that persists UI state across reloads
 * — e.g. ShipmentsPage column visibility — throws `setItem is not a function`
 * under Vitest. Install a spec-compliant in-memory Storage on `window` and
 * reset it between tests so state never leaks across cases.
 */

import { beforeEach } from 'vitest';

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
