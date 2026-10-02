import { useEffect } from 'react';

/**
 * Locks body scroll while `active` is true. The save/restore pattern is
 * nest-safe: overlapping overlays unmount innermost-first (React runs child
 * effect cleanups before parents'), so each restore writes back the value
 * that was in force when that overlay opened — the outermost close is what
 * finally unlocks the page.
 */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [active]);
}
