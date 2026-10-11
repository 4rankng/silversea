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
 * Driver payroll roster — a sortable, paginated table.
 *
 * Replaces the driver card wall. The wall was the compact option at 43
 * drivers (~398px) but inverted at 100+: minmax(140px,1fr) x 7 = 22 rows of
 * near-identical cards cannot be scanned or sorted, and the roster is useless
 * at that size without paging. Untitled UI PRO v8's `application/table`
 * (sortable + pagination) is the catalog source for this anatomy; it is
 * rebuilt in house tokens.
 *
 * The columns are the per-driver facts the hero band already aggregates
 * (tripDays / standbyDays / netSalary / confirmationStatus), so the table
 * backs its own summary instead of repeating a name and a number.
 *
 * Deliberately NOT a bulk-action surface: the salary subsystem's PRD is not
 * delivered yet (PhanHeKeToan.docx lists chấm công/lương as "ngoài phạm vi",
 * pending its own document), and a selection affordance with no consumer is
 * bloat that reads like it should drive "Ghi thanh toán". Row identity is one
 * driverId per row, so a selection set can be added later without a rewrite
 * if the PRD asks for it.
 */
export function DriverPayrollTable({
  drivers,
  selectedDriverId,
  onSelect,
  loading,
}: {
  drivers: DriverPayrollRow[];
  selectedDriverId: number | null;
  onSelect: (driverId: number) => void;
  loading: boolean;
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
                <td colSpan={5} className="dpt__empty">Đang tải danh sách lái xe…</td>
              </tr>
            )}
            {!loading && pageRows.length === 0 && (
              <tr>
                <td colSpan={5} className="dpt__empty">Không tìm thấy lái xe</td>
              </tr>
            )}
            {!loading && pageRows.map((row) => {
              const isSelected = row.id === selectedDriverId;
              const net = row.salary?.netSalary ?? 0;
              // Selection-state contract (owner law: retain all labels, values
              // and keyboard access) — the roster refactor moved the driver
              // select into this table as a mouse-only <tr>. The labelled,
              // keyboard-activatable control returns as a real <button>, the
              // salary staying in the accessible name while it is visible.
              const salaryLabel = row.salary ? ` · ${money(net)}` : '';
              return (
                <tr
                  key={row.id}
                  className={`dpt__row${isSelected ? ' is-active' : ''}`}
                  onClick={() => onSelect(row.id)}
                >
                  <th scope="row" className="dpt__td dpt__td--name">
                    <button
                      type="button"
                      className="dpt__name"
                      aria-label={`Xem bảng công của ${row.name}${salaryLabel}`}
                      aria-current={isSelected ? 'true' : undefined}
                      onClick={() => onSelect(row.id)}
                    >
                      {row.name}
                    </button>
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
