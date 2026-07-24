import { useEffect, useRef } from 'react';
import { animate, createScope, stagger, utils } from 'animejs';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * Topbar entrance animation — subtle glassmorphism fade-in on page load.
 *
 * Animates the topbar and its child elements (toggle, search, actions)
 * with a staggered fade-down entrance.
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
      if (prefersReduced) {
        utils.set(root, { opacity: 1 });
        return;
      }

      // Topbar container fade-down entrance
      animate(root, {
        opacity: [0, 1],
        translateY: [-6, 0],
        duration: 300,
        ease: 'out(3)',
      });

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
