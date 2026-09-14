import { useMemo, type FormEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import './Pagination.css';

export interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems?: number;
  pageSize?: number;
  onChange: (page: number) => void;
  summary?: ReactNode;
  siblingCount?: number;
  disabled?: boolean;
}

function buildPageWindow(current: number, total: number, sibling: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const start = Math.max(2, current - sibling);
  const end = Math.min(total - 1, current + sibling);
  if (start > 2) out.push('…');
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push('…');
  out.push(total);
  return out;
}

export function Pagination({
  page, totalPages, totalItems, pageSize, onChange, summary, siblingCount = 1, disabled = false,
}: PaginationProps) {
  const pages = useMemo(() => buildPageWindow(page, totalPages, siblingCount), [page, totalPages, siblingCount]);
  if (totalPages <= 1 && !summary) return null;

  const jumpToPage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextPage = Number(new FormData(event.currentTarget).get('page'));
    if (!disabled && Number.isInteger(nextPage) && nextPage >= 1 && nextPage <= totalPages && nextPage !== page) {
      onChange(nextPage);
    }
  };

  const defaultSummary = (totalItems !== undefined && pageSize !== undefined && (
    <span className="ds-pagination__summary">
      Hiển thị <b>{Math.min((page - 1) * pageSize + 1, totalItems)}–{Math.min(page * pageSize, totalItems)}</b> trên <b>{totalItems}</b>
    </span>
  ));

  return (
    <nav className="ds-pagination" aria-label="Phân trang">
      <div className="ds-pagination__summary-slot">{summary ?? defaultSummary}</div>
      <div className="ds-pagination__controls">
        <button
          className="ds-pagination__btn"
          disabled={disabled || page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="Trang trước"
          type="button"
        >
          <ChevronLeft size={14} />
        </button>
        {pages.map((p, i) =>
          p === '…'
            ? <span key={`e${i}`} className="ds-pagination__ellipsis" aria-hidden="true">…</span>
            : (
              <button
                key={p}
                className={`ds-pagination__btn ds-pagination__page${p === page ? ' ds-pagination__btn--active' : ''}`}
                disabled={disabled}
                onClick={() => onChange(p)}
                type="button"
                aria-current={p === page ? 'page' : undefined}
              >
                {p}
              </button>
            )
        )}
        <form className="ds-pagination__jump" onSubmit={jumpToPage} aria-label="Đến trang">
          <input
            key={page}
            name="page"
            type="number"
            inputMode="numeric"
            min={1}
            max={Math.max(1, totalPages)}
            step={1}
            defaultValue={page}
            disabled={disabled || totalPages <= 1}
            aria-label="Số trang"
            onFocus={(event) => event.currentTarget.select()}
            required
          />
          <span className="ds-pagination__total">/ {Math.max(1, totalPages)}</span>
          <button className="ds-pagination__btn" type="submit" disabled={disabled || totalPages <= 1} aria-label="Đi đến trang đã nhập">Đi</button>
        </form>
        <button
          className="ds-pagination__btn"
          disabled={disabled || page >= totalPages}
          onClick={() => onChange(page + 1)}
          aria-label="Trang sau"
          type="button"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </nav>
  );
}
