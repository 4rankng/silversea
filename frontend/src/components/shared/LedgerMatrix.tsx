import type { Key, ReactNode } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { LedgerRecordList, type LedgerRecordFact } from './LedgerRecordList';
import { Panel } from '../UI';

export interface LedgerMatrixColumn extends Pick<LedgerRecordFact, 'key' | 'label' | 'primary' | 'align' | 'layout'> { rowHeader?: boolean }
export interface LedgerMatrixRow { key: Key; title: ReactNode; subtitle?: ReactNode; cells: ReactNode[]; cellClassNames?: (string | undefined)[]; className?: string }

/** Explicit columns/cells keep phone records and desktop matrices on one value/action mapping. */
export function LedgerMatrix({ caption, columns, rows, className, framed = false }: {
  caption: ReactNode; columns: LedgerMatrixColumn[]; rows: LedgerMatrixRow[]; className?: string; framed?: boolean;
}) {
  const phone = useMediaQuery('(max-width: 640px)');
  const print = useMediaQuery('print');
  if (phone && !print) return <section>
    <h3 className="ledger-matrix__caption">{caption}</h3>
    <LedgerRecordList rows={rows.map((row) => ({
      key: row.key, title: row.title, subtitle: row.subtitle,
      facts: columns.flatMap((column, index) => column.rowHeader ? [] : [{ ...column, value: row.cellClassNames?.[index] ? <div className={row.cellClassNames[index]}>{row.cells[index]}</div> : row.cells[index] }]),
    }))} />
  </section>;
  const table = <table className={className}>
    <caption>{caption}</caption>
    <thead><tr>{columns.map((column) => <th key={column.key} scope="col" data-row-header={column.rowHeader || undefined} data-align={column.align}>{column.label}</th>)}</tr></thead>
    <tbody>{rows.map((row) => <tr key={row.key} className={row.className}>
      {row.cells.map((cell, index) => columns[index].rowHeader
        ? <th key={columns[index].key} scope="row" className={row.cellClassNames?.[index]}>{cell}</th>
        : <td key={columns[index].key} className={row.cellClassNames?.[index]} data-align={columns[index].align}>{cell}</td>)}
    </tr>)}</tbody>
  </table>;
  return framed ? <Panel flush><div className="table-scroll" data-ledger-matrix>{table}</div></Panel> : table;
}
