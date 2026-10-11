import { useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp } from 'lucide-react';
import { formatCurrency } from '../../lib/format';
import './DriverPayrollTable.css';

export interface DriverPayrollRow {
  id: number;
  name: string;
  salary?: {
    tripDays?: number;
    standbyDays?: number;
    paidDays?: number;
    netSalary?: number;
    confirmationStatus?: 'DRAFT' | 'CONFIRMED';
  } | null;
}

type SortKey = 'name' | 'tripDays' | 'standbyDays' | 'netSalary' | 'confirmationStatus';

const PAGE_SIZE = 25;

/** Fiscal zero is a value (owner law D02): a computed 0 renders as 0 đ, never as a dash. */
function money(value: number | undefined | null): string {
  const amount = value ?? 0;
  return `${amount < 0 ? '-' : ''}${formatCurrency(Math.abs(amount))}`;
}

function cellNumber(value: number | undefined | null): string {
  return String(value ?? 0);
}

/**
 * Driver payroll roster — a sortable, paginated table with bulk selection.
 *
 * Replaces the driver card wall. The wall was the compact option at 43
 * drivers (~398px) but inverted at 100+: minmax(140px,1fr) x 7 = 22 rows of
 * near-identical cards cannot be scanned, sorted, or acted on in bulk, and
 * those three jobs are the whole screen. Untitled UI PRO v8's
 * `application/table` carries sortable + pagination + a checkbox column and
 * is the catalog source for this anatomy; it is rebuilt in house tokens.
 * The columns are the per-driver facts the hero band already aggregates
 * (tripDays / standbyDays / netSalary / confirmationStatus), so the table
 * backs its own summary instead of repeating a name and a number.
 */
export function DriverPayrollTable({
  drivers,
  selectedDriverId,
  onSelect,
  loading,
  selectedIds,
  onSelectionChange,
}: {
  drivers: DriverPayrollRow[];
  selectedDriverId: number | null;
  onSelect: (driverId: number) => void;
  loading: boolean;
  selectedIds: number[];
  onSelectionChange: (ids: number[]) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('netSalary');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...drivers].sort((a, b) => {
      const av = a.salary?.[sortKey === 'name' ? 'netSalary' : sortKey];
      const bv = b.salary?.[sortKey === 'name' ? 'netSalary' : sortKey];
      if (sortKey === 'name') return a.name.localeCompare(b.name, 'vi') * dir;
      if (sortKey === 'confirmationStatus') {
        return String(a.salary?.confirmationStatus ?? '').localeCompare(String(b.salary?.confirmationStatus ?? '')) * dir;
      }
      return ((Number(av) || 0) - (Number(bv) || 0)) * dir;
    });
  }, [drivers, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const pageIds = pageRows.map((row) => row.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    // Money and counts are a worklist — biggest value first. Names and status
    // read alphabetically.
    setSortDir(key === 'name' || key === 'confirmationStatus' ? 'asc' : 'desc');
    setPage(0);
  };

  const toggleRow = (id: number) => {
    onSelectionChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  };

  const togglePage = () => {
    if (allOnPageSelected) {
      onSelectionChange(selectedIds.filter((id) => !pageIds.includes(id)));
      return;
    }
    onSelectionChange([...new Set([...selectedIds, ...pageIds])]);
  };

  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    sortKey !== key ? 'none' : sortDir === 'asc' ? 'ascending' : 'descending';

  const header = (key: SortKey, label: string, numeric = false) => (
    <th
      scope="col"
      className={`dpt__th${numeric ? ' dpt__th--num' : ''}`}
      aria-sort={ariaSort(key)}
    >
      {/* The accessible name names the action, not just the column: a bare
          "Xác nhận" header button would collide with the confirm action
          button and blur which control is which. */}
      <button
        type="button"
        className="dpt__sort"
        onClick={() => toggleSort(key)}
        aria-label={`Sắp xếp theo ${label}`}
      >
        {label}
        {sortKey === key ? (
          sortDir === 'asc' ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />
        ) : (
          <ChevronsUpDown size={13} aria-hidden="true" className="dpt__sort-idle" />
        )}
      </button>
    </th>
  );

  return (
    <div className="dpt">
      <div className="dpt__scroll">
        <table className="dpt__table">
          <caption className="sr-only">Danh sách lái xe và lương thực nhận trong kỳ</caption>
          <thead>
            <tr>
              <th scope="col" className="dpt__th dpt__th--check">
                <input
                  type="checkbox"
                  className="dpt__check"
                  aria-label={allOnPageSelected ? 'Bỏ chọn tất cả lái xe trên trang' : 'Chọn tất cả lái xe trên trang'}
                  checked={allOnPageSelected}
                  onChange={togglePage}
                  disabled={loading || pageIds.length === 0}
                />
              </th>
              {header('name', 'Lái xe')}
              {header('tripDays', 'Ngày đi chuyển', true)}
              {header('standbyDays', 'Ngày chờ việc', true)}
              {header('netSalary', 'Lương thực nhận', true)}
              {header('confirmationStatus', 'Xác nhận')}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="dpt__empty">Đang tải danh sách lái xe…</td>
              </tr>
            )}
            {!loading && pageRows.length === 0 && (
              <tr>
                <td colSpan={6} className="dpt__empty">Không tìm thấy lái xe</td>
              </tr>
            )}
            {!loading && pageRows.map((row) => {
              const isSelected = row.id === selectedDriverId;
              const checked = selectedIds.includes(row.id);
              const net = row.salary?.netSalary ?? 0;
              return (
                <tr
                  key={row.id}
                  className={`dpt__row${isSelected ? ' is-active' : ''}${checked ? ' is-checked' : ''}`}
                  onClick={() => onSelect(row.id)}
                >
                  <td className="dpt__td dpt__td--check" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="dpt__check"
                      aria-label={`Chọn ${row.name}`}
                      checked={checked}
                      onChange={() => toggleRow(row.id)}
                    />
                  </td>
                  <th scope="row" className="dpt__td dpt__td--name">
                    <span className="dpt__name">{row.name}</span>
                  </th>
                  <td className="dpt__td dpt__td--num">{cellNumber(row.salary?.tripDays)}</td>
                  <td className="dpt__td dpt__td--num">{cellNumber(row.salary?.standbyDays)}</td>
                  <td className={`dpt__td dpt__td--num dpt__td--money${net < 0 ? ' is-neg' : ''}`}>{money(net)}</td>
                  <td className="dpt__td">
                    <span className={`dpt__status${row.salary?.confirmationStatus === 'CONFIRMED' ? ' is-confirmed' : ''}`}>
                      {row.salary?.confirmationStatus === 'CONFIRMED' ? 'Đã xác nhận' : 'Chưa xác nhận'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="dpt__footer">
        <p className="dpt__count" role="status">
          {sorted.length === 0
            ? '0 lái xe'
            : `${safePage * PAGE_SIZE + 1}–${Math.min((safePage + 1) * PAGE_SIZE, sorted.length)} / ${sorted.length} lái xe`}
          {selectedIds.length > 0 && ` · đã chọn ${selectedIds.length}`}
        </p>
        <nav className="dpt__pager" aria-label="Phân trang danh sách lái xe">
          <button
            type="button"
            className="dpt__page-btn"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            aria-label="Trang trước"
          >
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
          <span className="dpt__page-of">Trang {safePage + 1} / {pageCount}</span>
          <button
            type="button"
            className="dpt__page-btn"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
            aria-label="Trang sau"
          >
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </nav>
      </div>
    </div>
  );
}
