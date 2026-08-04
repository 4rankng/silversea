import { useEffect, useRef } from 'react';
import { isOverlayOpen } from '../lib/overlayState';

export interface BackShortcutOptions {
  /** Set false for embedded workspaces that must not own the page-level Escape key. */
  enabled?: boolean;
  /** Returns true when the current page has unsaved data that would be lost. */
  isDirty?: () => boolean;
  /**
   * Called when the page is dirty. Resolve `true` to proceed with back, or
   * `false`/reject to stay. Typically wired to the shared `useConfirm()` so the
   * user sees a "discard changes?" dialog.
   */
  confirmDiscard?: () => Promise<boolean>;
}

/**
 * ESC originating from inside an editable control keeps its native meaning
 * (close an `<input type="date">` / `<select>` picker, clear/blur the field)
 * instead of triggering back-navigation. Checked before preventDefault() so the
 * native action still runs.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

/**
 * Binds Escape (at the window level) to the page's "Quay lại" action.
 *
 * Layering (peel one layer per ESC):
 *  - If any overlay/dropdown is open, ESC closes *that* (this hook yields via
 *    isOverlayOpen) and never navigates.
 *  - Else, if the page is dirty, ESC opens the discard-confirm; navigating only
 *    happens if the user confirms.
 *  - Otherwise ESC navigates back immediately.
 *
 * `onBack` and `opts` are captured in refs so the listener subscribes once and
 * always reads the freshest callbacks (mirrors useConfirmShortcuts in UI.tsx).
 */
export function useBackShortcut(onBack: () => void, opts?: BackShortcutOptions): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (optsRef.current?.enabled === false) return;
      // Let the open overlay/dropdown consume this ESC instead of navigating.
      if (isOverlayOpen()) return;
      // ESC inside a field/date-picker keeps its native meaning — don't navigate.
      if (isEditableTarget(e.target)) return;
      e.preventDefault();

      const o = optsRef.current;
      if (o?.isDirty?.()) {
        const proceed = o.confirmDiscard ? await o.confirmDiscard() : true;
        if (!proceed) return;
      }

      onBackRef.current();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
