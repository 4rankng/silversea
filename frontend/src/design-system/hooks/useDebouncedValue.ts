import { useEffect, useState } from 'react';

/**
 * Returns `value` after it has remained stable for `delayMs` milliseconds.
 *
 * Replaces the 8-line pattern that was hand-rolled in at least three pages
 * (TripListPage, CustomersPage, DebtListPage). Usage:
 *
 *   const [search, setSearch] = useState('');
 *   const debouncedSearch = useDebouncedValue(search, 300);
 *
 * Internally uses a single setTimeout per change. Unmounting cancels the
 * pending timeout so we never setState on an unmounted component.
 */
export function useDebouncedValue<T>(value: T, delayMs: number = 300): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    if (debounced === value) return;
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs, debounced]);
  return debounced;
}
