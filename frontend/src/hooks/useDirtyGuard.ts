import { useEffect, useRef } from 'react';

/**
 * "Has the user changed anything since the form was populated?" signal for the
 * ESC "go back" discard guard.
 *
 * Reacts to the provided `deps` *values* (not setter calls), so autocomplete
 * selections, photo uploads, leg add/remove, etc. are all detected
 * automatically — wherever the form keeps its state.
 *
 * - `ready` should be true once the form's initial data has loaded. The snapshot
 *   taken on the first `ready` pass is the clean **baseline**; the form is dirty
 *   only once the snapshot diverges from it. This correctly handles edit pages
 *   where values arrive asynchronously (the population pass is NOT treated as an
 *   edit). Defaults to `true` for create-mode forms with no async load.
 * - `markClean()` re-baselines to the current snapshot (e.g. after a save that
 *   keeps the user on the page).
 *
 * Returns a stable getter `isDirty()` (read at event time) plus `markClean`.
 */
export function useDirtyGuard(
  deps: unknown[],
  ready = true,
): {
  isDirty: () => boolean;
  markClean: () => void;
} {
  const baselineRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const snapshot = JSON.stringify(deps);

  useEffect(() => {
    if (!ready) {
      // Form not populated yet — reset and wait for the baseline.
      baselineRef.current = null;
      dirtyRef.current = false;
      return;
    }
    if (baselineRef.current === null) {
      // First observation after ready: this is the clean baseline.
      baselineRef.current = snapshot;
      return;
    }
    dirtyRef.current = snapshot !== baselineRef.current;
  }, [ready, snapshot]);

  return {
    isDirty: () => dirtyRef.current,
    markClean: () => {
      baselineRef.current = snapshot;
      dirtyRef.current = false;
    },
  };
}
