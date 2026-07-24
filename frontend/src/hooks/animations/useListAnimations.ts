import { useEffect, useRef, useCallback } from 'react';
import { animate, stagger, createScope, utils, spring } from 'animejs';
import { usePrefersReducedMotion } from '../usePrefersReducedMotion';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export interface UseListAnimationsOptions {
  /** Selector for individual items (e.g., '.trip-row', '.m-card') */
  itemSelector: string;
  /** Stagger delay between items in ms (default: 40) */
  staggerDelay?: number;
  /** Max items to animate — performance guard (default: 30) */
  maxItems?: number;
  /** Animation mode: 'cards' adds subtle scale spring, 'rows' slides up */
  mode?: 'cards' | 'rows';
  /** Trigger re-animation when deps change */
  deps?: unknown[];
}

/* ─── Hook ───────────────────────────────────────────────────────────────── */

/**
 * Staggered list/card entrance animation for table rows, card lists, etc.
 *
 * - Cards mode: animate with slight scale(0.97→1) spring
 * - Rows mode: animate rows in from below with fadeUp
 *
 * Call `replay()` when list data changes to re-animate new children.
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
  staggerDelay = 40,
  maxItems = 30,
  mode = 'rows',
  deps = [],
}: UseListAnimationsOptions) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scopeRef = useRef<ReturnType<typeof createScope> | null>(null);
  const prefersReduced = usePrefersReducedMotion();

  const runAnimation = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;

    const allItems = root.querySelectorAll(itemSelector);
    const items = Array.from(allItems).slice(0, maxItems);
    if (items.length === 0) return;

    if (prefersReduced) {
      utils.set(items, { opacity: 1, translateY: 0, translateX: 0, scale: 1 });
      return;
    }

    // Set initial hidden state
    utils.set(items, {
      opacity: 0,
      willChange: 'opacity, transform',
    });

    if (mode === 'cards') {
      // Card entrance: scale + fadeUp with spring
      utils.set(items, { scale: 0.97, translateY: 16 });
      animate(items, {
        opacity: [0, 1],
        translateY: [16, 0],
        scale: [0.97, 1],
        delay: stagger(staggerDelay, { start: 60 }),
        duration: 500,
        ease: spring({ stiffness: 170, damping: 20 }),
      });
    } else {
      // Row entrance: fadeUp with slight translateX from left
      utils.set(items, { translateY: 10, translateX: -6 });
      animate(items, {
        opacity: [0, 1],
        translateY: [10, 0],
        translateX: [-6, 0],
        delay: stagger(staggerDelay, { start: 40 }),
        duration: 400,
        ease: 'out(3)',
      });
    }
  }, [itemSelector, staggerDelay, maxItems, mode, prefersReduced]);

  useEffect(() => {
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
