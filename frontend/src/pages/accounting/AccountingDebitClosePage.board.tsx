import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';
import type { RowSelection } from '../../hooks/useTableRowSelection';
import { GROUP_LABELS, type CellContext, type DebitColumn } from './AccountingDebitClosePage.columns';

/**
 * FB-099 (card 141026230760) — the debit money matrix, rendered once per zone:
 * the "Chờ xác nhận" queue and the "Kế hoạch điều động tổng hợp" board share
 * this table so the two zones cannot drift on columns, grouping or cell law.
 */
export function DebitBoardTable({ rows, columns, context, selection, ariaLabel, caption }: {
  rows: AccountingDebitBoardRow[];
  columns: DebitColumn[];
  context: CellContext;
  selection: RowSelection<number>;
  ariaLabel: string;
  caption: string;
}) {
  const groupedHead = columns.filter((column) => column.group != null);
  return (
    <div className="debit-board__wrap ledger-desktop" role="region" aria-label={ariaLabel} tabIndex={0}>
      <table className="debit-board">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column, index) => {
              if (column.group == null) {
                return <th key={column.key} scope="col" rowSpan={2} className={column.className}>{column.label}</th>;
              }
              // One spanning header over the contiguous run of the group's
              // VISIBLE members: the run is measured, so a column hidden
              // through the picker can never leave the group header
              // covering the wrong cells.
              if (columns[index - 1]?.group === column.group) return null;
              const run = columns.filter((candidate) => candidate.group === column.group).length;
              return <th key={column.group} scope="colgroup" colSpan={run}>{GROUP_LABELS[column.group]}</th>;
            })}
          </tr>
          <tr>
            {groupedHead.map((column) => (
              <th key={column.key} scope="col" className={column.className}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const pickable = row.adjustment.status === 'NONE' || row.adjustment.status === 'CONFIRMED';
            const isRowSelected = selection.isSelected(row.shipmentId);
            return (
              <tr
                key={row.shipmentId}
                className={pickable ? 'debit-row--pickable' : 'debit-row--locked'}
                data-selected={isRowSelected || undefined}
                aria-selected={pickable ? isRowSelected : undefined}
                tabIndex={pickable ? 0 : undefined}
                {...selection.rowProps(row.shipmentId, { selectable: pickable })}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`${column.className}${column.className === 'debit-col--money' ? ' num' : ''}`}
                  >
                    {column.cell(row, context)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
