// SIL-892 — the sidebar collapse preference's localStorage contract:
// strict '1'/'0' reads, tolerant failures, clear-to-reset, stable key.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SIDEBAR_OPEN_PREF_KEY,
  clearSidebarOpenPref,
  readSidebarOpenPref,
  writeSidebarOpenPref,
} from './sidebar-prefs';

describe('sidebar-prefs — the persisted open choice (SIL-892)', () => {
  beforeEach(() => localStorage.clear());

  it('reads back the written choice for both values', () => {
    writeSidebarOpenPref(true);
    expect(readSidebarOpenPref()).toBe('1');
    writeSidebarOpenPref(false);
    expect(readSidebarOpenPref()).toBe('0');
  });

  it('treats junk payloads as "no choice" — the viewport default applies', () => {
    localStorage.setItem(SIDEBAR_OPEN_PREF_KEY, 'pinned-now');
    expect(readSidebarOpenPref()).toBeNull();
    localStorage.setItem(SIDEBAR_OPEN_PREF_KEY, '0');
    expect(readSidebarOpenPref()).toBe('0');
  });

  it('clear removes the key so the shell re-derives from the viewport width', () => {
    writeSidebarOpenPref(true);
    clearSidebarOpenPref();
    expect(readSidebarOpenPref()).toBeNull();
    expect(localStorage.getItem(SIDEBAR_OPEN_PREF_KEY)).toBeNull();
  });
});
