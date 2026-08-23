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
