import { useLayoutEffect, useRef, useCallback } from 'react';
import { animate, createScope } from 'animejs';
import { usePrefersReducedMotion } from '../usePrefersReducedMotion';
import { entranceDelay, visibleEntranceTargets } from './operational-entrance';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export interface UseListAnimationsOptions {
  /** Selector for individual items (e.g., '.trip-row', '.m-card') */
  itemSelector: string;
  /** Stagger delay between items in ms (default: 12); total delay <= 80ms. */
  staggerDelay?: number;
  /** Max items to animate — performance guard (default: 30) */
  maxItems?: number;
  /** Card and row entrances share a quiet fade; cards get 20ms more settling time. */
  mode?: 'cards' | 'rows';
  /** Discover newly mounted records when deps change */
  deps?: unknown[];
}

/* ─── Hook ───────────────────────────────────────────────────────────────── */

/**
 * Brief fade for new visible records only. Existing records stay readable
 * through filtering, polling and other data refreshes. `replay()` discovers
 * new children without hiding the rows the user is already reading.
 * Respects prefers-reduced-motion.
 *
 * Usage:
 *   const { rootRef, replay } = useListAnimations({
 *     itemSelector: '.trip-row',
 *     deps: [data],
 *   });
 */
export function useListAnimations({
  itemSelector,
  staggerDelay = 12,
  maxItems = 30,
  mode = 'rows',
  deps = [],
}: UseListAnimationsOptions) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scopeRef = useRef<ReturnType<typeof createScope> | null>(null);
  const prefersReduced = usePrefersReducedMotion();
  const seen = useRef(new WeakSet<Element>());

  const runAnimation = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;

    const allItems = [...root.querySelectorAll(itemSelector)];
    const fresh = allItems.filter(item => !seen.current.has(item));
    allItems.forEach(item => seen.current.add(item));
    const items = visibleEntranceTargets(fresh).slice(0, Math.max(0, maxItems));
    if (items.length === 0) return;

    if (prefersReduced) return;
    animate(items, {
      opacity: [0.7, 1],
      delay: (_element: unknown, index: number) => entranceDelay(index, staggerDelay),
      duration: mode === 'cards' ? 180 : 160,
      ease: 'out(2)',
    });
  }, [itemSelector, staggerDelay, maxItems, mode, prefersReduced]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const scope = createScope({ root }).add(() => {
      runAnimation();
    });

    scopeRef.current = scope;

    return () => {
      scope.revert();
      scopeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runAnimation, ...deps]);

  return { rootRef, replay: runAnimation };
}
