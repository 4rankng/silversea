/**
 * Tracks whether any overlay (modal, drawer, dialog, dropdown, photo viewer) is
 * currently open, so the ESC "go back" shortcut (useBackShortcut) can yield and
 * let the overlay's own ESC handler close it instead of navigating away.
 *
 * Two layers of detection:
 *  - A registry count: incremented/decremented by overlay hooks
 *    (useAnimatedOverlay, useClickOutside w/ escapeKey, PhotoViewer).
 *  - A DOM fallback: any portal'd element with role="dialog"/"alertdialog"
 *    (catches overlays that don't use our hooks).
 *
 * The count is decremented on the *next* tick after an overlay closes (via React
 * effect cleanup), so during the ESC press that closes an overlay the value is
 * still truthy — which is what we want (that press closes the overlay; the next
 * press navigates back).
 */
let count = 0;

export function registerOverlay(): void {
  count += 1;
}

export function unregisterOverlay(): void {
  count = Math.max(0, count - 1);
}

export function isOverlayOpen(): boolean {
  if (count > 0) return true;
  if (typeof document !== 'undefined') {
    return !!document.querySelector('[role="dialog" i], [role="alertdialog" i]');
  }
  return false;
}
