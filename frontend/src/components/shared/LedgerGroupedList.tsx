import { Children, isValidElement, useEffect, useState, type Key, type ReactNode } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import './LedgerGroupedList.css';

/** The SIL-478 verdict's chip tones (2026-10-25). The wire's lock states map
 *  open→open, locked→neutral; done/overdue arrive with the screens that own
 *  those states. */
export type LedgerGroupChipTone = 'open' | 'done' | 'overdue' | 'neutral';
export interface LedgerGroupChip {
  label: string;
  tone: LedgerGroupChipTone;
}
export interface LedgerGroupRow {
  key: Key;
  /** Accessible row name — the row's business display key (Số Bill/Booking). */
  name: string;
  /** Line 1 — the identity the row is about (14px/600, truncates). */
  title: ReactNode;
  /** Line 2 — muted meta segments (12px, truncates; compose with ' · '). */
  meta?: ReactNode;
  /** Right side, same baseline as the chip: the row's headline money
   *  (16px/600 tabular; absent renders nothing, never a fabricated 0). */
  amount?: ReactNode;
  chip?: LedgerGroupChip | null;
  selected?: boolean;
  selectable?: boolean;
  onSelect?: (selected: boolean) => void;
  /** Controlled tap-to-expand (the verdict kills the per-row '…'/'Mở chi tiết'
   *  button: the row itself is the control). Rows without onToggle do not
   *  expand. */
  expanded?: boolean;
  onToggle?: () => void;
  /** The expanded region — secondary facts and the row's workspace. */
  detail?: ReactNode;
}
interface LedgerGroupedListProps {
  rows: LedgerGroupRow[];
  emptyMessage?: ReactNode;
}

const PAGE_SIZE = 20;

function textOf(node: ReactNode): string {
  return Children.toArray(node).map((child): string => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    return isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : '';
  }).join(' ').replace(/\s+/g, ' ').trim();
}

/** Phone counterpart of a ledger matrix — the verdict's grouped list: ONE
 *  bordered container, hairline row dividers, each row a 2-column grid
 *  (identity left, money + status chip right, same baseline). The row tap —
 *  not a per-row button — opens the detail (SIL-478, owner-approved consult
 *  verdict 2026-10-25). Values/actions stay owned by callers. */
export function LedgerGroupedList({ rows, emptyMessage = 'Chưa có dữ liệu.' }: LedgerGroupedListProps) {
  const phone = useMediaQuery('(max-width: 640px)');
  const [page, setPage] = useState(1);
  const signature = JSON.stringify(rows.map((row) => row.key));
  useEffect(() => { setPage(1); }, [signature]);
  if (!phone) return null;
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * PAGE_SIZE;
  const visible = rows.slice(start, start + PAGE_SIZE);
  const toggleRow = (row: LedgerGroupRow) => () => row.onToggle?.();
  const rowKeyDown = (row: LedgerGroupRow) => (event: React.KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      row.onToggle?.();
    }
  };
  return (
    <div className="ledger-glist">
      {rows.length === 0 && <p className="ledger-glist__empty">{emptyMessage}</p>}
      {visible.length > 0 && (
        <section className="ledger-glist__group">
          {visible.map((row) => {
            const expandable = typeof row.onToggle === 'function';
            return (
              <article key={row.key} aria-label={row.name} className="ledger-glist__item" data-selected={row.selected || undefined}>
                <div
                  className="ledger-glist__row"
                  role={expandable ? 'button' : undefined}
                  tabIndex={expandable ? 0 : undefined}
                  aria-expanded={expandable ? !!row.expanded : undefined}
                  aria-label={expandable ? `Chi tiết ${row.name}` : undefined}
                  data-selectable={row.selectable || undefined}
                  data-expandable={expandable || undefined}
                  onClick={expandable ? toggleRow(row) : undefined}
                  onKeyDown={expandable ? rowKeyDown(row) : undefined}
                >
                  {row.selectable && (
                    <label className="ledger-glist__pick" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={!!row.selected}
                        onChange={(event) => row.onSelect?.(event.target.checked)}
                        aria-label={`Chọn ${row.name}`}
                      />
                      <span aria-hidden="true">Chọn</span>
                    </label>
                  )}
                  <span className="ledger-glist__id">
                    <span className="ledger-glist__name">{row.title}</span>
                    {row.meta != null && <span className="ledger-glist__meta">{row.meta}</span>}
                  </span>
                  <span className="ledger-glist__side">
                    {row.amount != null && <span className="ledger-glist__amount">{row.amount}</span>}
                    {row.chip && (
                      <span className="ledger-glist__chip" data-tone={row.chip.tone}>{row.chip.label}</span>
                    )}
                  </span>
                </div>
                {row.expanded && row.detail != null && (
                  <div className="ledger-glist__detail">{row.detail}</div>
                )}
              </article>
            );
          })}
        </section>
      )}
      {rows.length > PAGE_SIZE && <nav className="ledger-glist__pager" aria-label="Trang bản ghi">
        <button type="button" className="btn btn--secondary btn--sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Trang trước</button>
        <span role="status">{`${start + 1}–${Math.min(start + PAGE_SIZE, rows.length)} / ${rows.length}`}</span>
        <button type="button" className="btn btn--secondary btn--sm" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Trang sau</button>
      </nav>}
    </div>
  );
}

/** Exposed for callers composing meta segments with the shared separator. */
export const LEDGER_GROUP_META_SEPARATOR = ' · ';
export { textOf as ledgerGroupRowText };
