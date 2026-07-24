import { useEffect, useRef, useCallback } from 'react';
import { animate, createScope, svg } from 'animejs';
import { usePrefersReducedMotion } from '../usePrefersReducedMotion';

/**
 * Reusable hook that animates an element along an SVG `<path>` using
 * `svg.createMotionPath()` from anime.js v4.
 *
 * Follows the established animation-hook conventions:
 * - Uses `createScope({ root })` for automatic cleanup via `scope.revert()`
 * - Respects `prefers-reduced-motion` (hides the target element)
 * - try/catch around `createMotionPath` (matching `createDrawable` pattern)
 * - Returns `{ rootRef, replay }`
 */

export interface UseMotionPathOptions {
  /** CSS selector for the SVG `<path>` element inside rootRef */
  pathSelector: string;
  /** CSS selector for the element to animate along the path */
  targetSelector: string;
  /** Animation duration in ms (default: 3000) */
  duration?: number;
  /** Easing function (default: 'linear') */
  ease?: string;
  /** Loop the animation (default: true) */
  loop?: boolean;
  /** Delay before starting in ms (default: 0) */
  delay?: number;
  /** Whether animation is active (default: true) */
  enabled?: boolean;
}

export interface UseMotionPathReturn {
  rootRef: React.RefObject<HTMLDivElement | null>;
  replay: () => void;
}

export function useMotionPath({
  pathSelector,
  targetSelector,
  duration = 3000,
  ease = 'linear',
  loop = true,
  delay = 0,
  enabled = true,
}: UseMotionPathOptions): UseMotionPathReturn {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scopeRef = useRef<ReturnType<typeof createScope> | null>(null);
  const prefersReduced = usePrefersReducedMotion();

  const run = useCallback(() => {
    const root = rootRef.current;
    if (!root || !enabled) return;

    const pathEl = root.querySelector(pathSelector) as SVGPathElement | null;
    const targetEl = root.querySelector(targetSelector);
    if (!pathEl || !targetEl) return;

    // Respect prefers-reduced-motion — skip animation
    if (prefersReduced) return;

    try {
      const motionPath = svg.createMotionPath(pathEl);
      animate(targetEl, {
        ...motionPath,
        duration,
        ease,
        loop,
        delay,
      });
    } catch {
      // createMotionPath may throw if path is invalid or not in DOM — skip silently
    }
  }, [pathSelector, targetSelector, duration, ease, loop, delay, enabled, prefersReduced]);

  useEffect(() => {
    if (!enabled) return;

    const root = rootRef.current;
    if (!root) return;

    const scope = createScope({ root }).add(() => {
      run();
    });

    scopeRef.current = scope;

    return () => {
      scope.revert();
      scopeRef.current = null;
    };
  }, [enabled, run]);

  const replay = useCallback(() => {
    // Revert existing scope and re-run
    if (scopeRef.current) {
      scopeRef.current.revert();
      scopeRef.current = null;
    }
    const root = rootRef.current;
    if (!root) return;

    const scope = createScope({ root }).add(() => {
      run();
    });
    scopeRef.current = scope;
  }, [run]);

  return { rootRef, replay };
}
