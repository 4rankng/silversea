import { useEffect, useRef } from 'react';
import { animate, createScope, createAnimatable } from 'animejs';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * Sidebar nav item animations — hover micro-lift and active indicator slide.
 *
 * Uses anime.js v4 createScope for automatic cleanup.
 * Respects prefers-reduced-motion (skips transforms, instant opacity only).
 */
export function useSidebarAnimations() {
  const rootRef = useRef<HTMLElement>(null);
  const scopeRef = useRef<ReturnType<typeof createScope> | null>(null);
  const prefersReduced = usePrefersReducedMotion();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const scope = createScope({ root }).add((self) => {
      if (!self) return;
      const items = root.querySelectorAll<HTMLButtonElement>(
        '.sidebar-item',
      );

      if (items.length === 0) return;

      // For each nav item, create an animatable for hover micro-lift
      const animatables = Array.from(items).map((item) => {
        if (prefersReduced) return null;

        const lift = createAnimatable(item, {
          translateY: {
            duration: 180,
            ease: 'out(3)',
          },
        });

        return lift;
      });

      // Hover micro-lift: translateY -1px on enter, 0 on leave
      if (!prefersReduced) {
        items.forEach((item, i) => {
          const animatable = animatables[i];
          if (!animatable) return;

          const onEnter = () => animatable.translateY(-1);
          const onLeave = () => animatable.translateY(0);

          item.addEventListener('mouseenter', onEnter);
          item.addEventListener('mouseleave', onLeave);

          // Store listeners for cleanup
          self.add('cleanup', () => {
            item.removeEventListener('mouseenter', onEnter);
            item.removeEventListener('mouseleave', onLeave);
          });
        });
      }

      // Active indicator slide transition: when an item becomes .active,
      // animate the ::before pseudo-element via CSS custom property
      // The CSS reads --sidebar-indicator-scale for the active indicator
      if (!prefersReduced) {
        const activeItem = root.querySelector<HTMLButtonElement>(
          '.sidebar-item.active',
        );
        if (activeItem) {
          // Entrance animation for the active indicator
          animate(activeItem, {
            opacity: [0, 1],
            duration: 180,
            ease: 'out(3)',
          });
        }
      }

      // Active nav item icon glow pulse on mount
      if (!prefersReduced) {
        const activeIcon = root.querySelector<HTMLButtonElement>(
          '.sidebar-item.active svg',
        );
        if (activeIcon) {
          animate(activeIcon, {
            scale: [0.85, 1],
            duration: 300,
            ease: 'out(3)',
          });
        }
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
