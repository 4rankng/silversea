import type { ReactNode } from 'react';
import { Panel } from '../UI';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { LedgerRecordList, type LedgerRecord } from './LedgerRecordList';

/** One column of the matrix. `rowHeader` marks the identity column: it
 *  becomes the semantic desktop row header and its cell is not repeated as a
 *  phone fact (the record's title/subtitle already carry the identity).
 *  `align: "end"` right-aligns numeric values/editors only. `layout:
 *  "full-width"` opts a composite editor or source-list cell into the phone
 *  full-width lane; the desktop grid keeps its column. */
export interface LedgerMatrixColumn {
  key: string | number;
  label: ReactNode;
  primary?: boolean;
  rowHeader?: boolean;
  align?: 'end';
  layout?: 'full-width';
}

/** One row: identity title/subtitle plus exactly one cell per column, in
 *  column order. `cellClassNames` lines up with the columns one-to-one and
 *  rides the cell on both anatomies (e.g. the debit warn tint). */
export interface LedgerMatrixRow {
  key: string | number;
  title: string;
  subtitle?: string;
  className?: string;
  cells: ReactNode[];
  cellClassNames?: Array<string | undefined>;
}

/** One explicit columns/rows mapping that owns both anatomies of a ledger:
 *  the desktop semantic table (including its `table-matrix` row-axis
 *  opt-in via the caller's own classes) and the phone LedgerRecordList.
 *  `framed` wraps the desktop table in the house Panel + shared scroll rail;
 *  phone records always keep their own shared Panel shells. */
export function LedgerMatrix({ caption, columns, rows, className, framed }: {
  caption: ReactNode;
  columns: LedgerMatrixColumn[];
  rows: LedgerMatrixRow[];
  className?: string;
  framed?: boolean;
}) {
  const phone = useMediaQuery('(max-width: 640px)');
  if (phone) {
    const records: LedgerRecord[] = rows.map((row) => ({
      key: row.key,
      title: row.title,
      subtitle: row.subtitle,
      facts: columns.flatMap((column, index) => {
        // The rowHeader column is the identity fact — the record header
        // (title/subtitle) already says it, so it is never repeated.
        if (column.rowHeader) return [];
        return [{
          key: String(column.key),
          label: column.label,
          value: row.cells[index],
          primary: column.primary,
          align: column.align,
          layout: column.layout,
          className: row.cellClassNames?.[index],
        }];
      }),
    }));
    return (
      <section className="ledger-record-section">
        <h4 className="ledger-record-section__caption">{caption}</h4>
        <LedgerRecordList rows={records} />
      </section>
    );
  }
  const table = (
    <table className={className}>
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              data-row-header={column.rowHeader ? 'true' : undefined}
              data-align={column.align}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className={row.className}>
            {columns.map((column, index) => {
              const cellClassName = row.cellClassNames?.[index];
              if (column.rowHeader) {
                return <th key={column.key} scope="row" className={cellClassName}>{row.cells[index]}</th>;
              }
              return (
                <td key={column.key} className={cellClassName} data-align={column.align}>
                  {row.cells[index]}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
  if (!framed) return <div className="ledger-desktop">{table}</div>;
  return (
    <div className="ledger-desktop">
      <Panel flush className="ledger-matrix__panel">
        <div className="ds-table-scroll">{table}</div>
      </Panel>
    </div>
  );
}
