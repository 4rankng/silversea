import { isValidElement, useState, type ReactElement, type ReactNode } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import './LedgerRecordList.css';

/** One labelled fact inside a record. `primary` facts stay visible; the rest
 *  collapse under the record's "Chi tiết" disclosure. `layout: "full-width"`
 *  stacks the label above a full-lane value for composite editors and source
 *  lists (QA-AUDIT-UI-65); everything else keeps the paired label/value row. */
export interface LedgerFact {
  key: string;
  label: ReactNode;
  value: ReactNode;
  primary?: boolean;
  align?: 'end';
  layout?: 'full-width';
  /** Extra class carried over from the desktop matrix cell (e.g. warn tint). */
  className?: string;
}

/** One phone record: identity header plus the desktop row's facts. */
export interface LedgerRecord {
  key: string | number;
  title: string;
  subtitle?: string;
  facts: LedgerFact[];
  selected?: boolean;
  selectable?: boolean;
  onSelect?: () => void;
}

/** The shared 20-row seam: one page size for every ledger, so the pager is
 *  the same muscle memory on every surface that rides this band. */
const PAGE_SIZE = 20;

type ElementWithChildren = ReactElement<{ children?: ReactNode }>;

const hasChildren = (node: ReactNode): node is ElementWithChildren => isValidElement(node);

/** Plain text of a label node, for the `data-label` the fact band renders
 *  from (consumers pass strings, fragments and JSX headings alike). */
const textOf = (node: ReactNode): string => {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((child) => textOf(child)).join('');
  if (hasChildren(node)) return textOf(node.props.children);
  return '';
};

function FactItem({ fact }: { fact: LedgerFact }) {
  return (
    <div
      className={`ledger-record__fact${fact.className ? ` ${fact.className}` : ''}`}
      data-label={textOf(fact.label)}
      data-layout={fact.layout}
      data-align={fact.align}
    >
      <div className="ledger-record__value">{fact.value}</div>
    </div>
  );
}

function LedgerRecordCard({ record }: { record: LedgerRecord }) {
  const primary = record.facts.filter((fact) => fact.primary);
  const rest = record.facts.filter((fact) => !fact.primary);
  return (
    <article
      className="ledger-record"
      aria-label={record.title}
      data-selected={record.selected ? 'true' : undefined}
    >
      <header className="ledger-record__head">
        {record.onSelect && (
          <input
            type="checkbox"
            className="ledger-record__select"
            aria-label={`Chọn ${record.title}`}
            checked={record.selected === true}
            disabled={record.selectable === false}
            onChange={() => record.onSelect?.()}
          />
        )}
        <div className="ledger-record__id">
          <h5 className="ledger-record__title">{record.title}</h5>
          {record.subtitle && <p className="ledger-record__subtitle">{record.subtitle}</p>}
        </div>
      </header>
      <div className="ledger-record__facts">
        {primary.map((fact) => <FactItem key={fact.key} fact={fact} />)}
      </div>
      {rest.length > 0 && (
        <details className="ledger-record__more">
          <summary>Chi tiết</summary>
          <div className="ledger-record__facts">
            {rest.map((fact) => <FactItem key={fact.key} fact={fact} />)}
          </div>
        </details>
      )}
    </article>
  );
}

/** The phone record band for wide ledgers and pricing matrices. Renders the
 *  records only inside the phone breakpoint — on desktop the surface keeps
 *  its own table (standalone consumers wrap it in `.ledger-desktop`, the
 *  LedgerMatrix renders that wrapper itself). */
export function LedgerRecordList({ rows }: { rows: LedgerRecord[] }) {
  const phone = useMediaQuery('(max-width: 640px)');
  const [page, setPage] = useState(0);
  if (!phone) return null;
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = pageCount > 1
    ? rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
    : rows;
  return (
    <div className="ledger-record-list">
      {visible.map((record) => <LedgerRecordCard key={record.key} record={record} />)}
      {pageCount > 1 && (
        <nav className="ledger-record-list__pager" aria-label="Trang bản ghi">
          <button type="button" className="btn btn--secondary btn--sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Trang trước
          </button>
          <span className="ledger-record-list__page">{current + 1}/{pageCount}</span>
          <button type="button" className="btn btn--secondary btn--sm" disabled={current === pageCount - 1} onClick={() => setPage(current + 1)}>
            Trang sau
          </button>
        </nav>
      )}
    </div>
  );
}
