import { useEffect, useState } from 'react';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';
import type { CellContext, DebitColumn } from './AccountingDebitClosePage.columns';
import { billBookingReference } from '../../lib/business-reference';
import type { RowSelection } from '../../hooks/useTableRowSelection';
import { useMediaQuery } from '../../hooks/useMediaQuery';

/** The phone record band shares the ledger record list's 20-row page. */
const PAGE_SIZE = 20;

/** Columns that read as the row's spine stay on the collapsed card; the
 *  breakdown figures and free-text notes ride the `Chi tiết` disclosure. */
const ALWAYS_VISIBLE = new Set(['ngay', 'lo', 'container', 'phanXe', 'tongThu', 'tong1', 'loiNhuan', 'doiSoat']);
/** Wide content (an action lane, prose) takes the full card width instead of
 *  sharing the two-track fact grid. */
const FULL_WIDTH = new Set(['doiSoat', 'ghiChu']);

/**
 * Phone (≤640px, non-print) rendering of the chốt-debit board: one article
 * per lot in the shared ledger-record band. The board's column model stays
 * the single source of truth — every visible column renders its own cell body
 * as a labeled fact (`data-label`, `data-layout` on the wide ones), so a
 * column picked or auto-hidden on the strip reshapes the records too.
 *
 * Selection is independent of the facts: a pickable row carries its own tick
 * (`Chọn <bill>`), a PENDING row shows its Xác nhận/Rút lane instead. The
 * desktop board keeps its own scroll table beside this view.
 */
export function AccountingDebitRecords({ rows, columns, context, selection }: {
  rows: AccountingDebitBoardRow[];
  columns: readonly DebitColumn[];
  context: CellContext;
  selection: RowSelection<number>;
}) {
  const phone = useMediaQuery('(max-width: 640px)');
  const print = useMediaQuery('print');
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  // The desktop table owns wide canvases; this band is phone-only.
  if (!phone || print) return null;

  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="ledger-record-list accounting-debit-records">
      {pageRows.map((row) => {
        const reference = billBookingReference(row.billOrBooking);
        const pickable = row.adjustment.status === 'NONE' || row.adjustment.status === 'CONFIRMED';
        const isSelected = selection.isSelected(row.shipmentId);
        return (
          <article
            key={row.shipmentId}
            className="ledger-record accounting-debit-record"
            aria-label={reference}
            data-selected={isSelected || undefined}
            aria-selected={pickable ? isSelected : undefined}
          >
            <div className="ledger-record__head">
              {pickable && (
                <input
                  type="checkbox"
                  className="ledger-record__pick"
                  aria-label={`Chọn ${reference}`}
                  checked={isSelected}
                  onChange={() => selection.toggle(row.shipmentId)}
                />
              )}
              <div className="record-cell-stack ledger-record__identity">
                <strong className="ledger-record__title">{reference}</strong>
                {row.customerName != null && <small className="ledger-record__subtitle">{row.customerName}</small>}
              </div>
              <span className="ledger-record__tag">{row.adjustment.status === 'PENDING' ? 'Chờ xác nhận' : row.adjustment.status === 'CONFIRMED' ? 'Đã đối soát' : 'Chưa gửi'}</span>
            </div>
            <div className="ledger-record__facts">
              {columns.filter((column) => ALWAYS_VISIBLE.has(column.key) && column.key !== 'lo').map((column) => (
                <DebitRecordFact key={column.key} column={column} row={row} context={context} />
              ))}
            </div>
            <RecordFactDisclosure row={row} columns={columns} context={context} />
            {pickable && (
              <div className="ledger-record__actions">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => selection.toggle(row.shipmentId)}>
                  {isSelected ? 'Bỏ chọn lô' : 'Chọn lô để chốt'}
                </button>
              </div>
            )}
          </article>
        );
      })}
      {pageCount > 1 && (
        <nav className="ledger-record__pager" aria-label="Phân trang bản ghi">
          <button type="button" className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Trang trước</button>
          <span className="ledger-record__pager-status">Trang {page}/{pageCount}</span>
          <button type="button" className="btn btn--ghost btn--sm" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Trang sau</button>
        </nav>
      )}
    </div>
  );
}

/** One labeled fact: the column's own cell body inside the shared record
 *  fact frame — label as `data-label` for the band's card styling, plus a
 *  visible small label so the fact reads without the table header. */
function DebitRecordFact({ column, row, context }: {
  column: DebitColumn;
  row: AccountingDebitBoardRow;
  context: CellContext;
}) {
  return (
    <div
      className={`ledger-record__fact${column.className === 'debit-col--money' ? ' ledger-record__fact--money' : ''}`}
      data-label={column.label}
      data-layout={FULL_WIDTH.has(column.key) ? 'full-width' : undefined}
    >
      <span className="ledger-record__fact-label">{column.label}</span>
      {column.cell(row, context)}
    </div>
  );
}

/** The breakdown figures behind the per-record `Chi tiết` disclosure. Kept
 *  as its own block so the collapsed card stays a glanceable summary; the
 *  disclosure only reveals figures — it never touches the pick tick. */
function RecordFactDisclosure({ row, columns, context }: {
  row: AccountingDebitBoardRow;
  columns: readonly DebitColumn[];
  context: CellContext;
}) {
  const [open, setOpen] = useState(false);
  const secondary = columns.filter((column) => !ALWAYS_VISIBLE.has(column.key));
  if (secondary.length === 0) return null;
  return (
    <>
      <button
        type="button"
        className="btn btn--ghost btn--sm ledger-record__disclose"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Chi tiết
      </button>
      {open && (
        <div className="ledger-record__facts ledger-record__facts--secondary">
          {secondary.map((column) => (
            <DebitRecordFact key={column.key} column={column} row={row} context={context} />
          ))}
        </div>
      )}
    </>
  );
}
