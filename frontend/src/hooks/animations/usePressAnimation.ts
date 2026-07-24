import { useRef, useCallback } from 'react';
import { animate, spring } from 'animejs';
import { usePrefersReducedMotion } from '../usePrefersReducedMotion';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export interface PressAnimationOptions {
  /** Scale target on press-in (default: 0.97) */
  pressScale?: number;
  /** Axis for the press scale: 'x' uses scaleX, 'y' uses scaleY, 'uniform' uses scale (default: 'x') */
  axis?: 'x' | 'y' | 'uniform';
  /** Press-in duration ms (default: 100) */
  pressInDuration?: number;
  /** Press-out duration ms (default: 300) */
  pressOutDuration?: number;
  /** Spring stiffness for press-out (default: 400) */
  springStiffness?: number;
  /** Spring damping for press-out (default: 18) */
  springDamping?: number;
}

/* ─── Hook ───────────────────────────────────────────────────────────────── */

/**
 * Press feedback animation hook — animate element on pointer-down, spring back on pointer-up/leave.
 *
 * Returns `{ ref, handlers }`. Attach `ref` to the element and spread
 * `handlers` onto `onPointerDown`, `onPointerUp`, `onPointerLeave`.
 *
 * Respects prefers-reduced-motion (no-op when enabled).
 *
 * Usage:
 *   const { ref, handlers } = usePressAnimation();
 *   <button ref={ref} {...handlers}>Click</button>
 */
export function usePressAnimation({
  pressScale = 0.97,
  axis = 'x',
  pressInDuration = 100,
  pressOutDuration = 300,
  springStiffness = 400,
  springDamping = 18,
}: PressAnimationOptions = {}) {
  const ref = useRef<HTMLElement>(null);
  const animRef = useRef<ReturnType<typeof animate> | null>(null);
  const prefersReduced = usePrefersReducedMotion();

  const scaleProp = axis === 'x' ? 'scaleX' : axis === 'y' ? 'scaleY' : 'scale';

  const handlePointerDown = useCallback(() => {
    const el = ref.current;
    if (!el || prefersReduced) return;
    animRef.current?.pause();
    animRef.current = animate(el, {
      [scaleProp]: pressScale,
      duration: pressInDuration,
      ease: 'out(3)',
    });
  }, [prefersReduced, pressScale, scaleProp, pressInDuration]);

  const handlePointerUp = useCallback(() => {
    const el = ref.current;
    if (!el || prefersReduced) return;
    animRef.current?.pause();
    animRef.current = animate(el, {
      [scaleProp]: 1,
      duration: pressOutDuration,
      ease: spring({ stiffness: springStiffness, damping: springDamping }),
    });
  }, [prefersReduced, scaleProp, pressOutDuration, springStiffness, springDamping]);

  return {
    ref: ref as React.RefObject<HTMLElement>,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerUp: handlePointerUp,
      onPointerLeave: handlePointerUp,
    },
  };
}
