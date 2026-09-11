import { useEffect } from 'react';

/**
 * Page-scoped sidebar policy for /dispatch-detail (customer doc2 BUG2,
 * kanban cd8a1aa2): the 7-column plan table is the primary surface, so the
 * sidebar yields first — dropping to its 48px icon rail — before the grid
 * falls back to its sub-900px card records. Default-OFF everywhere else:
 * every non-dispatch route keeps the stock sidebar behavior unchanged
 * (architect T6: page-scoped, default-OFF, additive-only).
 *
 * Extracted from Layout.tsx: that file is frozen at its structure-guard
 * ceiling, so policy growth lives here instead.
 */

/** Mirrors Layout's WIDE_DESKTOP_MIN_WIDTH; boundary sync asserted in test. */
const SIDEBAR_OPEN_MIN_WIDTH = 1440;

export function isDispatchFullwidthPage(pathname: string): boolean {
  return pathname === '/dispatch-detail' || pathname.startsWith('/dispatch-detail/');
}

/**
 * Pure decision: close the sidebar on dispatch-detail entry below the
 * wide-desktop threshold. Explicit reopens still win (they persist until
 * the next page/viewport crossing); ≥1440 never closes — the table fits
 * alongside the open sidebar there.
 */
export function shouldCloseSidebarOnDispatchEntry(pathname: string, innerWidth: number): boolean {
  if (!isDispatchFullwidthPage(pathname)) return false;
  return innerWidth < SIDEBAR_OPEN_MIN_WIDTH;
}

/**
 * Layout calls this single hook on every render; it closes the sidebar when
 * /dispatch-detail is entered below the wide-desktop threshold so the plan
 * table keeps full width before the grid's sub-900px card fallback fires.
 */
export function useDispatchFullwidthSidebar(pathname: string, close: () => void): void {
  useEffect(() => {
    if (!shouldCloseSidebarOnDispatchEntry(pathname, window.innerWidth)) return;
    close();
  }, [pathname, close]);
}
