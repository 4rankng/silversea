import { useEffect, useRef } from 'react';
import { registerOverlay, unregisterOverlay } from '../lib/overlayState';

/**
 * Global dropdown dismissal layer.
 *
 * Any open dropdown that opts in with `useDropdownDismiss(open, close)` closes
 * when the user presses the mouse down outside every open dropdown root, or
 * presses Escape. One document-level listener (installed on first use) covers
 * every dropdown, so pages don't each roll their own click-away effect.
 *
 * Containment convention — a listener no-op region is declared by marking the
 * element that wraps BOTH the trigger and the open popup:
 *  - React-state dropdowns: `data-dropdown-root` on the wrapper, present only
 *    while that dropdown is open.
 *  - Native <details> menus: `data-dropdown` on the <details> element; open
 *    ones are found via `details[data-dropdown][open]`.
 *
 * The event fires on `mousedown` (not click) so the menu closes before the
 * click lands on whatever is underneath — matching the tire-table kebab menus.
 */

const DISMISS_EVENT = 'app:dismiss-dropdowns';

function isInsideOpenDropdown(target: Element): boolean {
  return !!(
    target.closest('[data-dropdown-root]')
    || target.closest('details[data-dropdown][open]')
  );
}

function dismissOpenDropdowns(): void {
  // Native <details> menus close directly; React dropdowns close through the
  // dismiss event below.
  document
    .querySelectorAll<HTMLElement>('details[data-dropdown][open]')
    .forEach((el) => el.removeAttribute('open'));
  window.dispatchEvent(new CustomEvent(DISMISS_EVENT));
}

let installed = false;
function ensureGlobalDismissListeners(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('pointerdown', (event) => {
    const { target } = event;
    if (target instanceof Element && isInsideOpenDropdown(target)) return;
    dismissOpenDropdowns();
  });
  document.addEventListener('mousedown', (event) => {
    const { target } = event;
    if (target instanceof Element && isInsideOpenDropdown(target)) return;
    dismissOpenDropdowns();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') dismissOpenDropdowns();
  });
}

/**
 * Subscribe one dropdown to the global dismissal layer. While `open` is true,
 * an outside mousedown or Escape calls `close`; the dropdown's trigger and
 * popup must live inside an element marked `data-dropdown-root` (conditionally
 * on `open`) so clicks inside it don't count as "outside".
 *
 * Also registers with the overlay registry while open, so the app-level
 * Escape "go back" shortcut yields while the menu is up (same contract as
 * useClickOutside's escapeKey option).
 */
export function useDropdownDismiss(open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  useEffect(() => {
    if (!open) return;
    ensureGlobalDismissListeners();
    registerOverlay();
    const onDismiss = () => closeRef.current();
    window.addEventListener(DISMISS_EVENT, onDismiss);
    return () => {
      window.removeEventListener(DISMISS_EVENT, onDismiss);
      unregisterOverlay();
    };
  }, [open]);
}
