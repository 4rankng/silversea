import type { CSSProperties, ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { TableSortState } from '../../lib/table-sort';
import '../../styles/table-sort.css';

/**
 * Sortable `<th>` for bespoke (non-DataTable) tables: the shared sort-button
 * contract from table-sort.css with `aria-sort` on the cell. The key is the
 * caller's stable sort identifier — the backend sortBy enum for server-sorted
 * lists, or a local accessor key for `sortClientSide` full-set tables.
 * `numeric` merges the record-table `num` alignment class into the cell.
 */
export function SortHeader({ label, sortKey, sort, onSortChange, style, className, numeric = false, dataLabel }: {
  label: ReactNode;
  sortKey: string;
  sort: TableSortState | null;
  onSortChange: (key: string) => void;
  style?: CSSProperties;
  className?: string;
  numeric?: boolean;
  /** Optional data-label mirroring the body cells' attribute — attribute-keyed
   *  column tracks and the card band both key on it (AUI-01, audit 2026-11-27). */
  dataLabel?: string;
}) {
  const active = sort?.by === sortKey;
  return (
    <th
      scope="col"
      style={style}
      className={numeric ? ['num', className].filter(Boolean).join(' ') : className}
      aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      data-label={dataLabel}
    >
      <button type="button" className="table-sort-button" onClick={() => onSortChange(sortKey)}>
        <span className="table-sort-button__label">{label}</span>
        {active
          ? (sort!.dir === 'asc'
            ? <ArrowUp size={13} aria-hidden="true" />
            : <ArrowDown size={13} aria-hidden="true" />)
          : <ArrowUpDown size={13} aria-hidden="true" className="table-sort-button__icon--idle" />}
      </button>
    </th>
  );
}
