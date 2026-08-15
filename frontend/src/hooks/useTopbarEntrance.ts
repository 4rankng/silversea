import { useEffect, useRef } from 'react';
import { animate, createScope, stagger, utils } from 'animejs';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * Topbar entrance animation — subtle glassmorphism fade-in on page load.
 *
 * Animates the topbar's child elements (toggle, search, actions) with a
 * staggered fade-down entrance. The shell itself remains visible at all
 * times: this is progressive enhancement, not a layout dependency.
 *
 * Uses anime.js v4 createScope for automatic cleanup.
 * Respects prefers-reduced-motion.
 */
export function useTopbarEntrance() {
  const rootRef = useRef<HTMLElement>(null);
  const scopeRef = useRef<ReturnType<typeof createScope> | null>(null);
  const prefersReduced = usePrefersReducedMotion();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const scope = createScope({ root }).add(() => {
      // Keep the reserved shell area visible even if anime.js cannot start.
      utils.set(root, { opacity: 1, translateY: 0 });

      if (prefersReduced) {
        return;
      }

      // Stagger child elements: toggle, search, breadcrumb, actions
      const children = root.querySelectorAll(
        '.topbar__toggle, .topbar__search, .topbar__breadcrumb, .topbar__actions, .topbar__left-driver, .topbar__center-driver',
      );

      if (children.length > 0) {
        animate(children, {
          opacity: [0, 1],
          translateY: [-4, 0],
          delay: stagger(40, { start: 100 }),
          duration: 250,
          ease: 'out(3)',
        });
      }
    });

    scopeRef.current = scope;
    return () => {
      scope.revert();
      scopeRef.current = null;
    };
  }, [prefersReduced]);

  return rootRef;
}
