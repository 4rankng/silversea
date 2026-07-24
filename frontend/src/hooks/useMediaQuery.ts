import { useState, useEffect } from 'react';

/**
 * Reactive CSS media-query hook.
 *
 * Returns whether `query` currently matches, updating on change. Use for
 * breakpoint-driven rendering (e.g. full vs compact number formatting).
 *
 * Follows the same `matchMedia` listener idiom as `usePrefersReducedMotion`.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
