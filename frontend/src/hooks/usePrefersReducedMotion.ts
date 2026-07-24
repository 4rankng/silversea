import { createContext, useContext, useState, useEffect, createElement } from 'react';

/**
 * Context holding the current `prefers-reduced-motion` value.
 * Provided by `<ReducedMotionProvider>` at the app root — a single
 * `matchMedia` listener is shared across all consumers instead of
 * each component creating its own.
 */
const ReducedMotionContext = createContext(false);

/**
 * Single-source-of-truth provider for reduced-motion preference.
 * Place at app root (outside AuthProvider) so all hooks share one listener.
 */
export function ReducedMotionProvider({ children }: { children: React.ReactNode }) {
  const [reduced, setReduced] = useState(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return createElement(ReducedMotionContext.Provider, { value: reduced }, children);
}

/**
 * Reactive hook for `prefers-reduced-motion` media query.
 * Returns `true` when the user has requested reduced motion.
 * Reads from `<ReducedMotionProvider>` — no per-component listener.
 */
export function usePrefersReducedMotion(): boolean {
  return useContext(ReducedMotionContext);
}
