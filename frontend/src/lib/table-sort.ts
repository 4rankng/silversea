/**
 * Shared sort-header state contract for data tables.
 *
 * Used with `DataTable`'s `sort`/`onSortChange` props and with URL-driven sort
 * params on pages that keep query state in the address bar. The toggle matches
 * the UsersPage precedent: a fresh column starts ascending, the active column
 * flips asc ↔ desc, and the table never returns to the unsorted default once a
 * sort is engaged (the backend default order covers that case until clicked).
 */

export type TableSortDir = 'asc' | 'desc';

export interface TableSortState {
  by: string;
  dir: TableSortDir;
}

export function nextTableSort(
  current: TableSortState | null | undefined,
  key: string,
): TableSortState {
  if (current?.by !== key) return { by: key, dir: 'asc' };
  return { by: key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

/** Parses a raw URL/param pair into a sort state, or null when absent/invalid. */
export function readTableSort(
  by: string | null | undefined,
  dir: string | null | undefined,
): TableSortState | null {
  if (!by) return null;
  return { by, dir: dir === 'desc' ? 'desc' : 'asc' };
}

/**
 * Client-side comparator for small, non-paginated tables whose full row set is
 * already loaded (fleet catalogs, portal sub-tables, import previews). Mirrors
 * the server contract: null/undefined/empty values sort last in both
 * directions, then the caller's stable tiebreaker decides.
 */
export function sortClientSide<T>(
  rows: readonly T[],
  sort: TableSortState | null | undefined,
  accessors: Record<string, (row: T) => string | number | null | undefined>,
  tiebreaker: (a: T, b: T) => number,
): T[] {
  const accessor = sort ? accessors[sort.by] : undefined;
  if (!sort || !accessor) return [...rows];
  const direction = sort.dir === 'desc' ? -1 : 1;
  const isEmpty = (value: string | number | null | undefined) => value == null || value === '';
  return [...rows].sort((a, b) => {
    const left = accessor(a);
    const right = accessor(b);
    if (isEmpty(left) && isEmpty(right)) return tiebreaker(a, b);
    if (isEmpty(left)) return 1;
    if (isEmpty(right)) return -1;
    if (left === right) return tiebreaker(a, b);
    // String pairs use Vietnamese collation so names like "Ánh Minh" sort as
    // "Anh", not after "Zeta" by codepoint; everything else compares ordinally.
    const cmp = typeof left === 'string' && typeof right === 'string'
      ? left.localeCompare(right, 'vi')
      : left < right ? -1 : 1;
    return cmp * direction;
  });
}
