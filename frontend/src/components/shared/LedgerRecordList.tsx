import { Children, isValidElement, useEffect, useState, type Key, type ReactNode } from 'react';
import { Panel } from '../UI';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import './LedgerRecordList.css';

export interface LedgerRecordFact {
  key: Key;
  label: ReactNode;
  value: ReactNode;
  primary?: boolean;
  align?: 'end';
  /** Composite editors/workspaces own a full lane; scalar facts remain paired. */
  layout?: 'full-width';
}
export interface LedgerRecord {
  key: Key;
  title: ReactNode;
  subtitle?: ReactNode;
  facts: LedgerRecordFact[];
  selected?: boolean;
  selectable?: boolean;
  onSelect?: (selected: boolean) => void;
}
interface LedgerRecordListProps {
  rows: LedgerRecord[];
  emptyMessage?: ReactNode;
}
const PAGE_SIZE = 20;

function titleText(node: ReactNode): string {
  return Children.toArray(node).map((child): string => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    return isValidElement<{ children?: ReactNode }>(child) ? titleText(child.props.children) : '';
  }).join(' ').replace(/\s+/g, ' ').trim();
}
function Facts({ facts }: { facts: LedgerRecordFact[] }) {
  return <dl className="ledger-record__facts">{facts.map((fact) => (
    <div key={fact.key} className="ledger-record__fact" data-layout={fact.layout}>
      <dt>{fact.label}</dt><dd data-align={fact.align}>{fact.value}</dd>
    </div>
  ))}</dl>;
}

/** Phone counterpart of a ledger matrix. Values/actions remain owned by callers. */
export function LedgerRecordList({ rows, emptyMessage = 'Chưa có dữ liệu.' }: LedgerRecordListProps) {
  const phone = useMediaQuery('(max-width: 640px)');
  const [page, setPage] = useState(1);
  const signature = JSON.stringify(rows.map((row) => row.key));
  useEffect(() => { setPage(1); }, [signature]);
  if (!phone) return null;
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * PAGE_SIZE;
  const visible = rows.slice(start, start + PAGE_SIZE);
  return (
    <div className="ledger-record-list">
      {rows.length === 0 && <p className="ledger-record-list__empty">{emptyMessage}</p>}
      {visible.map((row) => {
        const name = titleText(row.title) || 'Bản ghi';
        const secondary = row.facts.filter((fact) => !fact.primary);
        return (
          <article key={row.key} aria-label={name} className="ledger-record" data-selected={row.selected || undefined}>
            <Panel title={row.title} subtitle={row.subtitle} action={row.selectable && row.onSelect ? (
              <label className="ledger-record__selection">
                <input type="checkbox" checked={!!row.selected} onChange={(event) => row.onSelect?.(event.target.checked)} aria-label={`Chọn ${name}`} />
                <span>Chọn</span>
              </label>
            ) : undefined}>
              <Facts facts={row.facts.filter((fact) => fact.primary)} />
              {secondary.length > 0 && <details className="ledger-record__details">
                <summary>Chi tiết</summary><Facts facts={secondary} />
              </details>}
            </Panel>
          </article>
        );
      })}
      {rows.length > PAGE_SIZE && <nav className="ledger-record-list__pager" aria-label="Trang bản ghi">
        <button type="button" className="btn btn--secondary btn--sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Trang trước</button>
        <span role="status">{start + 1}–{Math.min(start + PAGE_SIZE, rows.length)} / {rows.length}</span>
        <button type="button" className="btn btn--secondary btn--sm" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Trang sau</button>
      </nav>}
    </div>
  );
}
