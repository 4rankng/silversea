import { useEffect, useRef, useCallback } from 'react';
import { animate } from 'animejs';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export interface CounterTarget {
  /** DOM element whose textContent will be animated */
  el: HTMLElement | null;
  /** Target numeric value */
  value: number;
  /** Optional prefix (e.g., '₫') */
  prefix?: string;
  /** Optional suffix (e.g., '%', ' chuyến') */
  suffix?: string;
  /** Locale for number formatting (default: 'vi-VN') */
  locale?: string;
  /** Optional custom formatter — overrides default locale formatting */
  format?: (val: number) => string;
}

export interface CounterOptions {
  /** Animation duration per counter (ms, default: 1000) */
  duration?: number;
  /** Base delay before first counter starts (ms, default: 300) */
  delay?: number;
  /** Stagger between counters (ms, default: 80) */
  stagger?: number;
}

/* ─── Hook ───────────────────────────────────────────────────────────────── */

/**
 * Animated number counter — counts from 0 to target value with outExpo easing.
 *
 * Designed for KPI values. Uses Vietnamese locale formatting by default.
 * Cancels running animations when called again (handles data refresh).
 *
 * Usage:
 *   const { animateCounters } = useCounterAnimation({ duration: 1200 });
 *   // After render, when data is ready:
 *   animateCounters([
 *     { el: revenueEl, value: 150000000, prefix: '₫' },
 *     { el: countEl, value: 42, suffix: ' chuyến' },
 *   ]);
 */
export function useCounterAnimation({
  duration = 1000,
  delay = 300,
  stagger: staggerMs = 80,
}: CounterOptions = {}) {
  const animationsRef = useRef<ReturnType<typeof animate>[]>([]);

  const animateCounters = useCallback(
    (targets: CounterTarget[]) => {
      // Cancel any running counter animations
      animationsRef.current.forEach((a) => a.pause());
      animationsRef.current = [];

      targets.forEach(
        ({ el, value, prefix = '', suffix = '', locale = 'vi-VN', format }, i) => {
          if (!el) return;
          const obj = { val: 0 };
          const anim = animate(obj, {
            val: value,
            duration,
            delay: delay + i * staggerMs,
            ease: 'outExpo',
            onUpdate: () => {
              el.textContent = format
                ? format(obj.val)
                : `${prefix}${Math.round(obj.val).toLocaleString(locale)}${suffix}`;
            },
          });
          animationsRef.current.push(anim);
        },
      );
    },
    [duration, delay, staggerMs],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      animationsRef.current.forEach((a) => a.pause());
      animationsRef.current = [];
    };
  }, []);

  return { animateCounters };
}
