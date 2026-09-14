import { useEffect, type RefObject } from 'react';

/**
 * Arrow-key horizontal scrolling for the trips table: ←/→ scroll the table's
 * horizontal scrollport by 200px, ignored while typing in an input, textarea,
 * or select. (The keyboard-horizontal-navigation half of the trips-table
 * accessibility contract.)
 */
export function useArrowKeyScroll(scrollRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const el = scrollRef.current;
      if (!el) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        el.scrollLeft = Math.max(0, el.scrollLeft - 200);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        el.scrollLeft = Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + 200);
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [scrollRef]);
}
