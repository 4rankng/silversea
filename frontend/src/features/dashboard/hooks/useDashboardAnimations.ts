import { useEffect, useRef, useCallback } from 'react';
import {
  animate,
  stagger,
  createScope,
  utils,
} from 'animejs';
import { usePrefersReducedMotion } from '../../../hooks/usePrefersReducedMotion';

/**
 * Orchestrates dashboard entrance animations via anime.js v4.
 *
 * Flat, opacity-led entrance sequence with bounded delays. Data-reveal
 * animations remain for progress bars, without simulated depth. Chart series
 * stay visible throughout; hiding financial data behind a delayed stroke-draw
 * animation makes the chart look broken while it is interactive.
 *
 * Respects prefers-reduced-motion.
 */
export function useDashboardAnimations(ready: boolean) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scopeRef = useRef<ReturnType<typeof createScope> | null>(null);
  const hasAnimated = useRef(false);
  const prefersReduced = usePrefersReducedMotion();

  useEffect(() => {
    if (!ready || hasAnimated.current) return;

    const root = rootRef.current;
    if (!root) return;

    // Double-check elements exist
    const hasKpis = root.querySelectorAll('.wf-kpi').length > 0;
    if (!hasKpis) return;

    hasAnimated.current = true;

    const scope = createScope({ root }).add(() => {
      const entranceElements = root.querySelectorAll(
        '.wf-head, .wf-kpi, .wf-bento > *',
      );

      if (prefersReduced) {
        utils.set(
          root.querySelectorAll('.wf-head, .wf-kpi, .wf-bento > *, .wf-aurow'),
          { opacity: 1 },
        );
        return;
      }

      utils.set(entranceElements, {
        opacity: 0,
      });

      // Flat dashboard motion is limited to opacity; no lift, scale, or
      // simulated-depth effects.
      // ── Phase 1: Header entrance ──
      const header = root.querySelector('.wf-head');
      if (header) {
        animate(header, {
          opacity: [0, 1],
          duration: 260,
          ease: 'out(3)',
        });
      }

      // ── Phase 2: KPI cards fade in sequence ──
      const kpis = root.querySelectorAll('.wf-kpi');
      if (kpis.length > 0) {
        animate(kpis, {
          opacity: [0, 1],
          delay: stagger(45, { start: 80 }),
          duration: 260,
          ease: 'out(3)',
        });
      }

      // ── Phase 3: Content panels fade in sequence ──
      const bentoChildren = root.querySelectorAll('.wf-bento > *');
      if (bentoChildren.length > 0) {
        animate(bentoChildren, {
          opacity: [0, 1],
          delay: stagger(55, { start: 180 }),
          duration: 320,
          ease: 'out(3)',
        });
      }

      // Safety net: animate any bento children that render late
      // (e.g. audit log bento-full loads from separate query)
      const animateLateBento = () => {
        const stuckBento = root.querySelectorAll('.wf-bento > *');
        const stillHidden: Element[] = [];
        stuckBento.forEach((el) => {
          const htmlEl = el as HTMLElement;
          if (htmlEl.style.opacity !== '1' && window.getComputedStyle(htmlEl).opacity === '0') {
            stillHidden.push(el);
          }
        });
        if (stillHidden.length > 0) {
          animate(stillHidden, {
            opacity: [0, 1],
            delay: stagger(45),
            duration: 260,
            ease: 'out(3)',
          });
        }
      };
      setTimeout(animateLateBento, 2500);

      // ── Phase 5: Donut segment reveal ──
      const donutCircles = root.querySelectorAll(
        '.wf-donut circle[stroke]:not([stroke="#eef1ef"])',
      );
      if (donutCircles.length > 0) {
        animate(donutCircles, {
          opacity: [0, 1],
          duration: 400,
          delay: stagger(120, { start: 900 }),
          ease: 'out(3)',
        });
      }

      // ── Phase 6: Fleet utilization bar grows ──
      const utilBar = root.querySelector('.wf-util progress.track');
      if (utilBar) {
        animate(utilBar, {
          scaleX: [0, 1],
          duration: 800,
          delay: 800,
          ease: 'out(3)',
        });
      }

      // ── Phase 7: Truck margin bars grow ──
      const truckBars = root.querySelectorAll('.wf-vrow progress.bar');
      truckBars.forEach((bar, i) => {
        animate(bar, {
          scaleX: [0, 1],
          duration: 600,
          delay: 900 + i * 80,
          ease: 'out(3)',
        });
      });

      // ── Phase 8: Audit log rows stagger ──
      // Audit rows may render late (role-gated, separate query).
      // Set initial opacity via JS only when present at animation time.
      const animateAuditRows = () => {
        const rows = root.querySelectorAll('.wf-aurow');
        if (rows.length === 0) return;
        utils.set(rows, { opacity: 0 });
        animate(rows, {
          opacity: [0, 1],
          delay: stagger(40, { start: 200 }),
          duration: 350,
          ease: 'out(3)',
        });
      };
      // Try immediately (if already rendered)
      animateAuditRows();
      // Safety net: try again after data likely loaded
      setTimeout(animateAuditRows, 2000);
    });

    scopeRef.current = scope;

    return () => {
      scope.revert();
      scopeRef.current = null;
    };
  }, [ready, prefersReduced]);

  /**
   * Animate KPI number counters from 0 → final value.
   * Staggered delay so counters cascade naturally.
   */
  const animateCounters = useCallback(
    (
      targets: {
        el: HTMLElement;
        value: number;
        prefix?: string;
        suffix?: string;
      }[],
    ) => {
      targets.forEach(({ el, value }, i) => {
        const obj = { val: 0 };
        animate(obj, {
          val: value,
          duration: 1200,
          delay: 400 + i * 100,
          ease: 'outExpo',
          onUpdate: () => {
            el.textContent = Math.round(obj.val).toLocaleString('vi-VN');
          },
        });
      });
    },
    [],
  );

  return { rootRef, animateCounters };
}
