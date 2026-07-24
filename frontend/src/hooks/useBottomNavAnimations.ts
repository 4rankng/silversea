import { useEffect, useRef } from 'react';
import { animate, createScope, cubicBezier, stagger, utils } from 'animejs';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * Mobile bottom nav animations — active indicator spring and touch press feedback.
 *
 * Uses anime.js v4 createScope for automatic cleanup.
 * Respects prefers-reduced-motion (instant state changes only).
 */
export function useBottomNavAnimations({ ready = true }: { ready?: boolean } = {}) {
  const rootRef = useRef<HTMLElement>(null);
  const scopeRef = useRef<ReturnType<typeof createScope> | null>(null);
  const hasAnimated = useRef(false);
  const prefersReduced = usePrefersReducedMotion();

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !ready || hasAnimated.current) return;

    const items = root.querySelectorAll<HTMLButtonElement>('.bottom-nav-item');
    if (items.length === 0) return;

    hasAnimated.current = true;

    const scope = createScope({ root }).add((self) => {
      if (!self) return;

      // Active indicator spring entrance
      const activeItem = root.querySelector<HTMLButtonElement>(
        '.bottom-nav-item.active .bottom-nav-indicator',
      );

      if (activeItem && !prefersReduced) {
        animate(activeItem, {
          scaleX: [0, 1],
          duration: 400,
          ease: cubicBezier(0.34, 1.56, 0.64, 1), // --ease-spring
        });
      }

      // Touch press feedback for all bottom nav items
      items.forEach((item) => {
        const onPressStart = () => {
          if (prefersReduced) return;
          animate(item, {
            scale: 0.92,
            duration: 100,
            ease: 'out(3)',
          });
        };

        const onPressEnd = () => {
          if (prefersReduced) return;
          animate(item, {
            scale: 1,
            duration: 250,
            ease: cubicBezier(0.34, 1.56, 0.64, 1), // spring settle
          });
        };

        item.addEventListener('pointerdown', onPressStart);
        item.addEventListener('pointerup', onPressEnd);
        item.addEventListener('pointerleave', onPressEnd);
        item.addEventListener('pointercancel', onPressEnd);

        // Clean up listeners on scope revert
        self.add('cleanup', () => {
          item.removeEventListener('pointerdown', onPressStart);
          item.removeEventListener('pointerup', onPressEnd);
          item.removeEventListener('pointerleave', onPressEnd);
          item.removeEventListener('pointercancel', onPressEnd);
        });
      });

      // Staggered entrance on mount
      if (!prefersReduced) {
        animate(items, {
          opacity: [0, 1],
          translateY: [12, 0],
          delay: stagger(60),
          duration: 350,
          ease: 'out(3)',
        });
      } else {
        utils.set(items, { opacity: 1 });
      }

      // Safety fallback: ensure items become visible even if anime.js fails
      const fallbackTimer = setTimeout(() => {
        items.forEach(item => { item.style.opacity = '1'; });
      }, 2000);

      self.add('cleanup', () => {
        clearTimeout(fallbackTimer);
      });
    });

    scopeRef.current = scope;
    return () => {
      scope.revert();
      scopeRef.current = null;
    };
  }, [prefersReduced, ready]);

  return rootRef;
}
