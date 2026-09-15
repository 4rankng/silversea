import { useLayoutEffect, useRef } from 'react';
import { animate, createScope } from 'animejs';
import { usePrefersReducedMotion } from '../usePrefersReducedMotion';
import { entranceDelay, visibleEntranceTargets } from './operational-entrance';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export interface UsePageAnimationsOptions {
  /** Enable staggered entrance (default: true) */
  stagger?: boolean;
  /** Stagger delay in ms (default: 20); total delay is bounded to 80ms. */
  staggerDelay?: number;
  /** Base delay before first animation (default: 0) */
  startDelay?: number;
  /** Element selectors for independent section entrances */
  selectors?: string[];
  /** Data is loaded and ready to animate */
  ready: boolean;
}

/* ─── Default selectors ──────────────────────────────────────────────────── */

const DEFAULT_SELECTORS = [
  '.page-header',
  '.kpi-grid',
  '.panel',
  '.wf-card',
  '.table-card',
  '.table-wrap',
];

/* ─── Hook ───────────────────────────────────────────────────────────────── */

/**
 * Brief entrance for independent visible sections. Nested panels and sticky
 * tables must not receive compounded movement or persistent compositor layers.
 *
 * Follows the Vantai design philosophy: subtle, "barely visible" motion.
 * Respects prefers-reduced-motion.
 *
 * Usage:
 *   const { rootRef } = usePageAnimations({ ready: !loading });
 *   return <div ref={rootRef}>...</div>
 */
export function usePageAnimations({
  stagger: useStagger = true,
  staggerDelay = 20,
  startDelay = 0,
  selectors = DEFAULT_SELECTORS,
  ready,
}: UsePageAnimationsOptions) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scopeRef = useRef<ReturnType<typeof createScope> | null>(null);
  const hasAnimated = useRef(false);
  const prefersReduced = usePrefersReducedMotion();

  useLayoutEffect(() => {
    if (!ready || hasAnimated.current) return;

    const root = rootRef.current;
    if (!root) return;

    hasAnimated.current = true;

    const scope = createScope({ root }).add(() => {
      if (prefersReduced) return;
      const elements = visibleEntranceTargets(selectors.flatMap(selector => [...root.querySelectorAll(selector)]));
      if (!elements.length) return;
      animate(elements, {
        opacity: [0.7, 1],
        delay: (_element: unknown, index: number) => entranceDelay(useStagger ? index : 0, staggerDelay, startDelay),
        duration: 160,
        ease: 'out(2)',
      });
    });

    scopeRef.current = scope;

    return () => {
      scope.revert();
      scopeRef.current = null;
    };
  }, [ready, useStagger, staggerDelay, startDelay, selectors, prefersReduced]);

  return { rootRef };
}
