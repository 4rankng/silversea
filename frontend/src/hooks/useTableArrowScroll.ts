import { useEffect } from 'react';
import { isOverlayOpen } from '../lib/overlayState';

/**
 * SIL-531 — GLOBAL behaviour: the ← / → arrow keys scroll the tables of this
 * app horizontally. Wide operational sheets (dispatch-detail, the container
 * ledger, the shipments worksheet) carry columns the viewport cannot show;
 * until now the only way to reach GHI CHÚ / THAO TÁC was dragging the bottom
 * scrollbar. The shortcut is mounted once in the app shell (Layout), so it
 * applies to EVERY table in the app, not a single page.
 *
 * Yields exactly like the house ESC law (useBackShortcut):
 *  - an open overlay owns its own arrow keys (combobox menus, dialogs,
 *    drawers) — the shortcut never fires while one is open;
 *  - an editable target keeps the native caret/selection behaviour — the
 *    keys are only stolen where they would otherwise do nothing;
 *  - modifier chords (Alt/Ctrl/Cmd) keep their browser/OS meanings.
 *
 * Which table moves? The one the pointer rests on when several scrollable
 * tables share the viewport, else the most-visible one. Scrolling a container
 * that holds no <table> (tab strips, KPI rails) never happens — the
 * candidate must own a table element.
 */

/** Step per keypress: ~60% of the visible width (min 120px) — one press is
 * meaningful feedback, holding the key repeats fast enough to cross a
 * 2000px sheet. Instant ('auto') so keyboard repeat stays crisp. */
function scrollStep(container: HTMLElement): number {
  return Math.max(120, Math.round(container.clientWidth * 0.6));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

function isScrollableX(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  if (style.overflowX !== 'auto' && style.overflowX !== 'scroll') return false;
  return element.scrollWidth > element.clientWidth + 1;
}

/** The nearest ancestor (or self) of a table that actually scrolls X. */
function nearestScrollerOf(table: Element): HTMLElement | null {
  let node: HTMLElement | null = table.parentElement;
  while (node != null && node !== document.body) {
    if (isScrollableX(node)) return node;
    node = node.parentElement;
  }
  return null;
}

function visibleArea(rect: DOMRect): number {
  const left = Math.max(rect.left, 0);
  const right = Math.min(rect.right, window.innerWidth);
  const top = Math.max(rect.top, 0);
  const bottom = Math.min(rect.bottom, window.innerHeight);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function pickScroller(pointer: { x: number; y: number } | null): HTMLElement | null {
  const seen = new Set<HTMLElement>();
  const candidates: HTMLElement[] = [];
  for (const table of document.querySelectorAll('table')) {
    const scroller = nearestScrollerOf(table);
    if (!scroller || seen.has(scroller)) continue;
    seen.add(scroller);
    candidates.push(scroller);
  }
  if (candidates.length === 0) return null;
  if (pointer) {
    const underPointer = candidates.find((el) => {
      const rect = el.getBoundingClientRect();
      return pointer.x >= rect.left && pointer.x <= rect.right && pointer.y >= rect.top && pointer.y <= rect.bottom;
    });
    if (underPointer) return underPointer;
  }
  let best: HTMLElement | null = null;
  let bestArea = 0;
  for (const el of candidates) {
    const area = visibleArea(el.getBoundingClientRect());
    if (area > bestArea) {
      best = el;
      bestArea = area;
    }
  }
  return best;
}

export function useTableArrowScroll(): void {
  useEffect(() => {
    // Last pointer position — a hovered scroller wins over the largest one.
    let pointer: { x: number; y: number } | null = null;
    const trackPointer = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener('pointermove', trackPointer, { passive: true });

    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      // An open overlay (combobox menu, dialog, drawer) owns its arrows.
      if (isOverlayOpen()) return;
      // Fields keep the native caret/selection behaviour.
      if (isEditableTarget(event.target)) return;
      if ((event.target as Element | null)?.closest?.('[role="listbox"], [role="menu"], [role="combobox"]')) return;
      const scroller = pickScroller(pointer);
      if (!scroller) return;
      event.preventDefault();
      const step = scrollStep(scroller);
      scroller.scrollBy({ left: event.key === 'ArrowRight' ? step : -step, behavior: 'auto' });
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('pointermove', trackPointer);
    };
  }, []);
}
