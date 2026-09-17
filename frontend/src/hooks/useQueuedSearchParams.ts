import { useCallback, useLayoutEffect, useRef } from 'react';
import { createSearchParams, useSearchParams, type SetURLSearchParams } from 'react-router-dom';

/** Merge rapid filter writes before the router commits its next render.
 * React Router's functional setter reads the render's params, not a queue. */
export function useQueuedSearchParams() {
  const [params, setParams] = useSearchParams();
  const latest = useRef(params);
  const pendingQueries = useRef<string[]>([]);

  useLayoutEffect(() => {
    const observed = params.toString();
    const pendingIndex = pendingQueries.current.indexOf(observed);
    if (pendingIndex >= 0) {
      pendingQueries.current.splice(0, pendingIndex + 1);
      // An intermediate router render must not discard newer input changes.
      if (pendingQueries.current.length === 0) latest.current = params;
    } else {
      // A different URL (including back/forward navigation) owns the filters.
      pendingQueries.current = [];
      latest.current = params;
    }
  }, [params]);

  const setQueuedParams = useCallback<SetURLSearchParams>((nextInit, options) => {
    const next = createSearchParams(typeof nextInit === 'function'
      ? nextInit(new URLSearchParams(latest.current)) : nextInit);
    const query = next.toString();
    if (query === latest.current.toString()) return;
    latest.current = next;
    pendingQueries.current.push(query);
    setParams(next, options);
  }, [setParams]);

  return [params, setQueuedParams, latest] as const;
}
