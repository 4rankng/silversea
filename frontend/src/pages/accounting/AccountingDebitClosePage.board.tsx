import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';
import type { RowSelection } from '../../hooks/useTableRowSelection';
import type { CellContext, DebitColumn } from './AccountingDebitClosePage.columns';

/**
 * FB-099 (card 141026230760) — the KIỂM SOÁT LÔ HÀNG money board, rendered
 * once per zone: the "Chờ xác nhận" queue and the board share this table so
 * the two zones cannot drift on columns, grouping or cell law.
 *
 * SIL-772 (Rev2 Phần IV.2, QA FAIL 1ae5afcb) — the board renders the NINE
 * Rev2 groups as one fixed, multi-line grid: a single header row (the tier-1
 * PHẢI THU/PHẢI TRÀ spanning band retired with the 17-track matrix), a fixed
 * track budget per group (stylesheet), and no horizontal scroll at the 1920px
 * operating width — TỔNG TRẢ can no longer sit past the right edge.
 */
export function DebitBoardTable({ rows, columns, context, selection, ariaLabel, caption }: {
  rows: AccountingDebitBoardRow[];
  columns: readonly DebitColumn[];
  context: CellContext;
  selection: RowSelection<number>;
  ariaLabel: string;
  caption: string;
}) {
  return (
    <div className="debit-board__wrap ledger-desktop" role="region" aria-label={ariaLabel} tabIndex={0}>
      <table className="debit-board">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.className}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const pickable = row.adjustment.status === 'NONE' || row.adjustment.status === 'CONFIRMED';
            const isRowSelected = selection.isSelected(row.shipmentId);
            // Ticket 18/11 Task 2.2a — mỗi container một dòng độc lập: an FCL
            // lot with N containers renders N rows (head + N−1 continuation).
            // Lot-level money/edition facts live on the head row; a
            // continuation row renders ONLY the spansSubrows columns (its own
            // container + vehicle facts), so nothing can read as duplicated
            // money. LCL/container-less lots stay one row.
            const subRowCount = row.lcl || row.containers.length <= 1
              ? 1
              : row.containers.length;
            return Array.from({ length: subRowCount }, (_, containerIndex) => {
              const isHead = containerIndex === 0;
              return (
                <tr
                  key={`${row.shipmentId}-${containerIndex}`}
                  className={[
                    pickable ? 'debit-row--pickable' : 'debit-row--locked',
                    isHead ? undefined : 'debit-row--cont',
                  ].filter(Boolean).join(' ')}
                  data-selected={isRowSelected || undefined}
                  aria-selected={pickable ? isRowSelected : undefined}
                  tabIndex={pickable && isHead ? 0 : undefined}
                  {...selection.rowProps(row.shipmentId, { selectable: pickable })}
                >
                  {columns.map((column) => (
                    <td key={column.key} className={column.className}>
                      {/* SIL-727 — only the pickable HEAD row's leading track
                          gets the checkbox affordance (the whole lot is one
                          selection unit). */}
                      {(!isHead && !column.spansSubrows)
                        ? null
                        : column.cell(row, {
                          ...context,
                          containerIndex,
                          rowSelect: isHead && pickable
                            ? { selected: isRowSelected, toggle: () => selection.toggle(row.shipmentId) }
                            : null,
                        })}
                    </td>
                  ))}
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
}
