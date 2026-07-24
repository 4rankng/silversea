import { useEffect, useRef } from 'react';
import { animate, stagger, createScope, utils } from 'animejs';
import { usePrefersReducedMotion } from '../usePrefersReducedMotion';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export interface UsePageAnimationsOptions {
  /** Enable staggered entrance (default: true) */
  stagger?: boolean;
  /** Stagger delay in ms (default: 60) */
  staggerDelay?: number;
  /** Base delay before first animation (default: 50) */
  startDelay?: number;
  /** Element selectors to animate with fadeUp, in phase order */
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
 * Generic page entrance animation — fadeUp with optional stagger for sections.
 *
 * Animates page sections (header, KPIs, panels, tables) with a fadeUp
 * entrance (opacity 0→1, translateY 12→0) in staggered phases.
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
  staggerDelay = 60,
  startDelay = 50,
  selectors = DEFAULT_SELECTORS,
  ready,
}: UsePageAnimationsOptions) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scopeRef = useRef<ReturnType<typeof createScope> | null>(null);
  const hasAnimated = useRef(false);
  const prefersReduced = usePrefersReducedMotion();

  useEffect(() => {
    if (!ready || hasAnimated.current) return;

    const root = rootRef.current;
    if (!root) return;

    hasAnimated.current = true;

    const scope = createScope({ root }).add(() => {
      // Collect all existing elements matching selectors
      const phaseElements: Element[] = [];
      selectors.forEach((sel) => {
        const els = root.querySelectorAll(sel);
        els.forEach((el) => phaseElements.push(el));
      });

      if (phaseElements.length === 0) {
        // Fallback: just fade the root
        utils.set(root, { opacity: 1 });
        return;
      }

      if (prefersReduced) {
        utils.set(phaseElements, { opacity: 1, translateY: 0, scale: 1 });
        return;
      }

      // Set initial hidden state
      utils.set(phaseElements, {
        opacity: 0,
        translateY: 12,
        willChange: 'opacity, transform',
      });

      if (useStagger) {
        // Staggered entrance: all matched elements animate in sequence
        animate(phaseElements, {
          opacity: [0, 1],
          translateY: [12, 0],
          delay: stagger(staggerDelay, { start: startDelay }),
          duration: 450,
          ease: 'out(3)',
        });
      } else {
        // Single-phase entrance: all at once with slight delay
        animate(phaseElements, {
          opacity: [0, 1],
          translateY: [12, 0],
          delay: startDelay,
          duration: 450,
          ease: 'out(3)',
        });
      }
    });

    scopeRef.current = scope;

    return () => {
      scope.revert();
      scopeRef.current = null;
    };
  }, [ready, useStagger, staggerDelay, startDelay, selectors, prefersReduced]);

  return { rootRef };
}
