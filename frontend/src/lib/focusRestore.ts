const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Return focus to an overlay opener after the overlay closes.
 *
 * Tolerates non-focusable openers (a row/cell a mouse user clicked) by making
 * them programmatically focusable first, and never yanks focus into detached
 * DOM. Shared owner of the focus-return class (SIL-573/SIL-576/SIL-579).
 */
export function restoreFocusTo(target: HTMLElement | null | undefined): void {
  if (!target || !target.isConnected) return;
  if (!target.hasAttribute('tabindex') && !target.matches(FOCUSABLE)) {
    target.tabIndex = -1;
  }
  target.focus({ preventScroll: true });
}
