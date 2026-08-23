import type { CSSProperties, ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { TableSortState } from '../../lib/table-sort';
import '../../styles/table-sort.css';

/**
 * Sortable `<th>` for bespoke (non-DataTable) tables: the shared sort-button
 * contract from table-sort.css with `aria-sort` on the cell. The key is the
 * caller's stable sort identifier — the backend sortBy enum for server-sorted
 * lists, or a local accessor key for `sortClientSide` full-set tables.
 */
export function SortHeader({ label, sortKey, sort, onSortChange, style, className }: {
  label: ReactNode;
  sortKey: string;
  sort: TableSortState | null;
  onSortChange: (key: string) => void;
  style?: CSSProperties;
  className?: string;
}) {
  const active = sort?.by === sortKey;
  return (
    <th style={style} className={className} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="table-sort-button" onClick={() => onSortChange(sortKey)}>
        {label}
        {active
          ? (sort!.dir === 'asc'
            ? <ArrowUp size={13} aria-hidden="true" />
            : <ArrowDown size={13} aria-hidden="true" />)
          : <ArrowUpDown size={13} aria-hidden="true" className="table-sort-button__icon--idle" />}
      </button>
    </th>
  );
}
