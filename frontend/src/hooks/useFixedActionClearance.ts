import { useCallback, useLayoutEffect, useState } from 'react';

/** Fixed actions reserve the actual shell scrollport they cover, including
 * responsive wrapping and a Driver navigation bar below them. */
export function useFixedActionClearance<T extends HTMLElement>(heightProperty?: string) {
  const [bar, setBar] = useState<T | null>(null);
  const barRef = useCallback((node: T | null) => { setBar(node); }, []);

  useLayoutEffect(() => {
    if (!bar) return;
    const scroller = bar.closest<HTMLElement>('.app-body,.content');
    const root = document.documentElement;
    let clearance = '';
    let height = '';
    const publish = () => {
      const rect = bar.getBoundingClientRect();
      if (heightProperty) {
        height = `${rect.height}px`;
        root.style.setProperty(heightProperty, height);
      }
      if (!scroller) return;
      if (rect.height > 0 && getComputedStyle(bar).position === 'fixed') {
        const covered = Math.max(0, scroller.getBoundingClientRect().bottom - rect.top);
        clearance = `calc(${covered}px + var(--space-sm))`;
        scroller.style.setProperty('--fixed-action-clearance', clearance);
      } else {
        scroller.style.removeProperty('--fixed-action-clearance');
        clearance = '';
      }
    };
    publish();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(bar);
    if (scroller) observer?.observe(scroller);
    window.addEventListener('resize', publish);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', publish);
      if (scroller?.style.getPropertyValue('--fixed-action-clearance') === clearance) {
        scroller.style.removeProperty('--fixed-action-clearance');
      }
      if (heightProperty && root.style.getPropertyValue(heightProperty) === height) {
        root.style.removeProperty(heightProperty);
      }
    };
  }, [bar, heightProperty]);

  return barRef;
}
