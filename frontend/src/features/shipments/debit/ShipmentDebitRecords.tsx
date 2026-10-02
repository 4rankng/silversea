import { useEffect, useState } from 'react';
import type { ShipmentDebitLotRow } from '../../../api/shipmentDebit';
import { formatMoney } from '../../../lib/format';
import { ShipmentDebitWorkspace } from './ShipmentDebitWorkspace';

/** The phone record band shares the ledger record list's 20-row page. */
const PAGE_SIZE = 20;

const money = (value: number | null | undefined) => (value == null
  ? <span className="debit-missing">Chưa xác định</span>
  : <span className="data-token">{formatMoney(value)}</span>);

/**
 * Phone (≤640px, non-print) rendering of `/shipments-debit` L1 (card
 * 20260924_9): the nine-column settlement table becomes one article per lot
 * in the shared ledger-record band — identity header, the pick tick, key
 * money facts, and a `Chi tiết` disclosure for the supporting figures. The
 * workspace (Bảng 2.1+) opens inside the record through its own toggle, so
 * expanding costs never unmounts the pick tick.
 *
 * Mount-scoped: the page remounts this view on every filter change (its
 * `key`), which resets the page and drops nothing the URL doesn't already
 * own; selection lives in the page.
 */
export function ShipmentDebitRecords({ rows, canManage, selectedIds, expandedId, onToggle, onSaved, onSelect }: {
  rows: ShipmentDebitLotRow[];
  canManage: boolean;
  selectedIds: ReadonlySet<number>;
  expandedId: number | null;
  onToggle: (id: number) => void;
  onSaved: () => void;
  onSelect: (id: number, next: boolean) => void;
}) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  // A list that shrank under the pager (refetch while reading) must not
  // strand the reader on an empty page.
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="ledger-record-list shipment-debit-records">
      {pageRows.map((row) => {
        // Identity renders from business keys only — DB ids and id-derived
        // codes never surface as user-visible text.
        const lotLabel = row.billOrBookNumber || row.customsNumber || '—';
        const locked = row.lockStatus === 'LOCKED';
        const selected = selectedIds.has(row.shipmentId);
        const workspaceOpen = canManage && expandedId === row.shipmentId;
        return (
          <article
            key={row.shipmentId}
            className="ledger-record shipment-debit-record"
            aria-label={lotLabel}
            data-locked={locked ? '' : undefined}
            data-selected={selected || undefined}
          >
            <div className="ledger-record__head">
              {canManage && locked && (
                <input
                  type="checkbox"
                  className="ledger-record__pick"
                  aria-label={`Chọn ${lotLabel}`}
                  checked={selected}
                  onChange={(event) => onSelect(row.shipmentId, event.target.checked)}
                />
              )}
              <div className="record-cell-stack ledger-record__identity">
                <strong className="shipment-debit-row__code">{lotLabel}</strong>
                <small className="shipment-debit-row__customer">{row.customerName?.toUpperCase()}</small>
                {row.factoryName && <small className="shipment-debit-row__factory">({row.factoryName})</small>}
                {row.factoryAddress && <small className="shipment-debit-row__address"><em>{row.factoryAddress}</em></small>}
              </div>
              {locked
                ? <span className="shipment-debit-row__lock shipment-debit-row__lock--locked">Đã khóa</span>
                : <span className="shipment-debit-row__lock shipment-debit-row__lock--open">Đang mở</span>}
            </div>
            <div className="ledger-record__facts">
              <div className="ledger-record__fact" data-label="Cước vận tải (Auto)">
                <span className="ledger-record__fact-label">Cước vận tải (Auto)</span>
                {money(row.freightAuto)}
              </div>
              <div className="ledger-record__fact" data-label="Tổng phải thu khách">
                <span className="ledger-record__fact-label">Tổng phải thu khách</span>
                {money(row.receivableTotal)}
              </div>
              <div className="ledger-record__fact" data-label="Lợi nhuận">
                <span className="ledger-record__fact-label">Lợi nhuận</span>
                {money(row.profit)}
              </div>
            </div>
            <div className="ledger-record__actions">
              {canManage && (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  aria-expanded={workspaceOpen}
                  aria-label={`${workspaceOpen ? 'Đóng' : 'Mở'} chi tiết lô ${lotLabel}`}
                  onClick={() => onToggle(row.shipmentId)}
                >
                  {workspaceOpen ? 'Đóng chi tiết' : 'Mở chi tiết'}
                </button>
              )}
            </div>
            {/* The record's own money detail rides a disclosure so the
                collapsed card stays a glanceable summary; `Chi tiết` only
                reveals figures — it never touches the pick tick. */}
            {canManage && <DebitRecordFacts row={row} />}
            {workspaceOpen && (
              <div className="ledger-record__detail shipment-debit-record__workspace">
                {/* Card _202: the fee catalog keys off the ROW's customer —
                    the list can span customers, so the page's filter is not
                    the truth. */}
                <ShipmentDebitWorkspace shipmentId={row.shipmentId} customerId={row.customerId} locked={locked} onSaved={onSaved} />
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

/** The supporting figures behind the per-record `Chi tiết` disclosure. Kept
 *  as a separate internal block so the toggle lives beside the always-visible
 *  summary facts without duplicating the fact markup. */
function DebitRecordFacts({ row }: { row: ShipmentDebitLotRow }) {
  const [open, setOpen] = useState(false);
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
          <div className="ledger-record__fact" data-label="Chứng từ">
            <span className="ledger-record__fact-label">Chứng từ</span>
            <span className="record-cell-stack">
              <span><small>Số Bill:</small> {row.billOrBookNumber || 'Chưa có'}</span>
              <span><small>Số tờ khai:</small> {row.customsNumber ?? 'Chưa có'}</span>
            </span>
          </div>
          <div className="ledger-record__fact" data-label="Tổng chi hộ">
            <span className="ledger-record__fact-label">Tổng chi hộ</span>
            {money(row.chiHoTotal)}
          </div>
          <div className="ledger-record__fact" data-label="Tổng phải trả">
            <span className="ledger-record__fact-label">Tổng phải trả</span>
            {money(row.payableTotal ?? null)}
          </div>
          <div className="ledger-record__fact" data-label="Chứng từ đã nộp">
            <span className="ledger-record__fact-label">Chứng từ đã nộp</span>
            <span className="data-token">{row.documentsSummary ?? '—'}</span>
          </div>
        </div>
      )}
    </>
  );
}
