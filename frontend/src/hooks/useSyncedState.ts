import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

/**
 * State seeded from an external value, owned by the user after first edit
 * ("uncontrolled-after-touch").
 *
 * - On mount, initializes to `transform(externalValue)` when `externalValue`
 *   is defined (non-null/non-undefined), else `defaultValue`.
 * - Re-syncs from external changes UNLESS the user has touched the field
 *   (`isDirty`) — so server pushes mid-edit don't clobber in-progress typing.
 * - `markSynced()` re-enables external-driven re-sync (e.g. after a 409
 *   refetch re-seeds the form from server state).
 * - `transform` runs ONLY on external values (not user sets). Callers MUST
 *   pass a stable reference (module-level fn or useCallback) so the effect
 *   doesn't re-fire every render.
 *
 * Returns: [value, setValue, { isDirty, markSynced }]
 */
export function useSyncedState<T>(
  externalValue: T | undefined | null,
  defaultValue: T,
  transform?: (raw: T) => T,
): [T, (v: T | ((prev: T) => T)) => void, { isDirty: boolean; markSynced: () => void }] {
  const [value, setValueInternal] = useState<T>(() => {
    if (externalValue === undefined || externalValue === null) return defaultValue;
    return transform ? transform(externalValue) : externalValue;
  });
  const isDirtyRef = useRef(false);
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (isDirtyRef.current) return;
    if (externalValue === undefined || externalValue === null) return;
    setValueInternal(transform ? transform(externalValue) : externalValue);
  }, [externalValue, transform]);

  const setValue = useCallback((v: T | ((prev: T) => T)) => {
    isDirtyRef.current = true;
    setValueInternal(v);
  }, []);

  const markSynced = useCallback(() => {
    isDirtyRef.current = false;
    forceRender((n) => n + 1);
  }, []);

  return [value, setValue, { isDirty: isDirtyRef.current, markSynced }];
}

/**
 * State that always mirrors the external value (memoized, read-only). Use for
 * computed/derived fields the user must NOT edit.
 */
export function useDerivedState<T>(
  externalValue: T | undefined | null,
  defaultValue: T,
  transform?: (raw: T) => T,
): T {
  return useMemo(
    () =>
      externalValue === undefined || externalValue === null
        ? defaultValue
        : transform
          ? transform(externalValue)
          : externalValue,
    [externalValue, transform, defaultValue],
  );
}
