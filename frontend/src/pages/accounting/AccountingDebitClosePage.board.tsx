import type { KeyboardEvent } from 'react';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';
import type { RowSelection } from '../../hooks/useTableRowSelection';
import type { CellContext, DebitColumn } from './AccountingDebitClosePage.columns';

/**
 * SIL-835 (QA 27/11) — the chot-debit board is a keyboard-focusable scroll
 * region (`tabIndex={0}`), so ArrowLeft/ArrowRight are its paging affordance
 * when the canvas is too narrow to fit the table: scroll the region a
 * comfortable step instead of doing nothing. A board that already fits its
 * canvas (the normal 1440px case — the clip law owns that) is left to the
 * browser defaults. Shared with the rounds board, which renders the same
 * region anatomy.
 */
export function handleDebitBoardArrowKeys(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const el = event.currentTarget;
  if (el.scrollWidth <= el.clientWidth) return;
  event.preventDefault();
  el.scrollBy({ left: event.key === 'ArrowRight' ? 160 : -160, behavior: 'smooth' });
}

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
export function DebitBoardTable({ rows, columns, context, selection, cargoView = 'FCL', ariaLabel, caption }: {
  rows: AccountingDebitBoardRow[];
  columns: readonly DebitColumn[];
  context: CellContext;
  selection: RowSelection<number>;
  cargoView?: 'FCL' | 'LCL';
  ariaLabel: string;
  caption: string;
}) {
  return (
    <div className="debit-board__wrap ledger-desktop" role="region" aria-label={ariaLabel} tabIndex={0} onKeyDown={handleDebitBoardArrowKeys}>
      <table className={cargoView === 'LCL' ? 'debit-board debit-board--lcl' : 'debit-board debit-board--fcl'}>
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
            // KB Ch.10 §10.6.1 (SIL-1075 ruling, Frank 26/11 — "follow KB"):
            // the Kế hoạch điều động tổng hợp renders ONE row per lot. The
            // per-container split (ticket 18/11 Task 2.2a / SIL-864) is
            // retired on this screen — every container row re-rendered the
            // lot's whole money face, so summed rows read double the lot
            // total (K10.29). Selection stays the LOT's single affordance
            // (Khóa lô / Chọn Debit / Xuất Debit Note act on the whole lot).
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
                  <td key={column.key} className={column.className}>
                    {column.cell(row, {
                      ...context,
                      rowSelect: pickable
                        ? { selected: isRowSelected, toggle: () => selection.toggle(row.shipmentId) }
                        : null,
                    })}
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
