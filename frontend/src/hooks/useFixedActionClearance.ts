import { useCallback, useEffect, useState, type RefCallback } from 'react';

/**
 * Clearance var the app shell consumes (`scroll-padding-block-end` in
 * app-shell.css) so keyboard/scroll focus never parks under a fixed bar.
 */
const DEFAULT_CLEARANCE_VAR = '--fixed-action-clearance';

/**
 * Attach to a fixed bottom action bar; publish its rendered height as a CSS
 * custom property on `:root` and keep it current while the bar resizes.
 *
 * - `ActionBar` publishes `--trip-action-bar-height` so the app-root-mounted
 *   guided tour stays above the controls instead of being covered by them.
 * - The default var feeds the shell's scroll clearance for the sticky
 *   accept/complete bars (DriverTripDetailPage) and the edit mobile bar
 *   (TripEditPage).
 *
 * Returns a callback ref: the bar may be conditionally mounted (the driver
 * screen swaps accept ↔ complete), and the publish follows whichever element
 * is currently attached. Unmounting the bar removes the property.
 */
export function useFixedActionClearance<T extends HTMLElement>(
  cssVar: string = DEFAULT_CLEARANCE_VAR,
): RefCallback<T> {
  const [element, setElement] = useState<T | null>(null);
  const ref = useCallback((node: T | null) => setElement(node), []);

  useEffect(() => {
    if (!element) {
      document.documentElement.style.removeProperty(cssVar);
      return;
    }
    const publish = () => {
      document.documentElement.style.setProperty(cssVar, `${element.offsetHeight}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty(cssVar);
    };
  }, [cssVar, element]);

  return ref;
}
