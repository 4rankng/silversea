/**
 * SIL-892 — the sidebar collapse preference's persistence.
 *
 * The shell already collapsed to a 48px icon rail (topbar ≡ / Cmd-B), but the
 * choice lived in a ref and died with the tab. A collapse preference is a
 * per-workstation display choice, not shareable query state — so it lives in
 * `localStorage`, following the exact contract `hooks/useHiddenColumns.ts`
 * documented (try/catch reads, fail-silent writes, removeItem to reset).
 *
 * Values: '1' = pinned/kept open, '0' = kept collapsed, absent = the shell's
 * viewport default (≥1440 open, 1024–1439 rail). The Pin control writes '1';
 * the ≡ toggle writes the resulting state either way.
 */

const STORAGE_KEY = 'app-sidebar-open';

export type SidebarOpenPref = '1' | '0';

export function readSidebarOpenPref(): SidebarOpenPref | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === '1' || raw === '0' ? raw : null;
  } catch {
    // Private mode / locked-down context: the viewport default applies.
    return null;
  }
}

export function writeSidebarOpenPref(open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, open ? '1' : '0');
  } catch {
    // A workstation that cannot persist still works for the session.
  }
}

/** Un-pin: drop the stored choice so the viewport default governs again. */
export function clearSidebarOpenPref(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same tolerance as the write.
  }
}

export const SIDEBAR_OPEN_PREF_KEY = STORAGE_KEY;
