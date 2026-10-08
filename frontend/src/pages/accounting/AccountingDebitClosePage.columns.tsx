import type { ReactNode } from 'react';
import { formatCurrency, formatDate } from '../../lib/format';
import { billBookingReference } from '../../lib/business-reference';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';
import type { LedgerColumn } from '../../lib/column-visibility';

/**
 * The chốt-debit board's column model (card 20260921_21).
 *
 * Split out of `AccountingDebitClosePage.tsx` on 2026-09-29: the page carries
 * the board's render logic and this module owns what a COLUMN IS — its header,
 * its track budget class, its tier-1 group, the wire value behind the cell, and
 * the one cell renderer. `frontend/frontend/scripts/check-structure.mjs` caps a
 * source file at 400 lines; this is the widest seam in the page and it is a
 * real one (nothing here reads page state).
 */

/** The board's own identity — the DOCUMENT it renders, under the screen's H1. */
export const BOARD_CAPTION = 'Kế hoạch điều động tổng hợp';

type GroupKey = 'thu' | 'tra';

export interface CellContext {
  confirm: (requestIds: number[]) => void;
  withdraw: (requestIds: number[]) => void;
  isBusy: boolean;
}

export interface DebitColumn extends LedgerColumn {
  /** The column's own minimum width (see the stylesheet). */
  className: string;
  /** Tier-1 header this column belongs to, for the grouped head. */
  group?: GroupKey;
  /**
   * The wire value behind the cell. A column that declares `autoHideWhenEmpty`
   * is hidden while NO rendered row carries a value — absence is not data, so a
   * breakdown that is still "Thiếu cước thu" on every row does not get to hold
   * a track on the board (column-visibility law: it shows the moment it carries
   * something, and an explicit choice in the picker always wins).
   */
  raw?: (row: AccountingDebitBoardRow) => string | null;
  /** The cell body — the ONE place a column's value is rendered. */
  cell: (row: AccountingDebitBoardRow, context: CellContext) => ReactNode;
}

export const GROUP_LABELS: Record<GroupKey, string> = { thu: 'Phải thu', tra: 'Phải trả' };

/** A missing money value names the FIELD it is missing from (§1) — never the
 *  generic "Chưa xác định", which names nothing and repeats three times a row. */
function money(value: string | null, missingLabel: string): ReactNode {
  return value == null
    ? <span className="debit-missing">{missingLabel}</span>
    : formatCurrency(Number(value));
}

export const BOARD_COLUMNS: readonly DebitColumn[] = [
  {
    key: 'ngay', label: 'Ngày', className: 'debit-col--date', pinned: true,
    cell: (row) => (row.ngay == null ? '—' : formatDate(row.ngay)),
  },
  {
    key: 'lo', label: 'Thông tin lô hàng', className: 'debit-col--lot', pinned: true,
    cell: (row) => (
      <div className="record-cell-stack">
        <span>{billBookingReference(row.billOrBooking)}</span>
        {row.customerName != null && <small>{row.customerName}</small>}
      </div>
    ),
  },
  {
    key: 'container', label: 'Thông số container', className: 'debit-col--container',
    cell: (row) => (row.containers.length > 0 ? row.containers.join(' · ') : '—'),
  },
  {
    key: 'phanXe', label: 'Phân xe', className: 'debit-col--truck',
    cell: (row) => (row.phanXe.length > 0 ? row.phanXe.join(', ') : '—'),
  },
  {
    key: 'cuocThu', label: 'Cước thu (tự động)', className: 'debit-col--money', group: 'thu',
    autoHideWhenEmpty: true, raw: (row) => row.thu.cuocThu,
    cell: (row) => money(row.thu.cuocThu, 'Thiếu cước thu'),
  },
  {
    key: 'lachHuyen', label: 'Lạch Huyện (tự động)', className: 'debit-col--money', group: 'thu',
    autoHideWhenEmpty: true, raw: (row) => row.thu.lachHuyen,
    cell: (row) => money(row.thu.lachHuyen, 'Thiếu lạch huyền'),
  },
  {
    key: 'phuPs', label: 'Phụ ps (tự động)', className: 'debit-col--money', group: 'thu',
    autoHideWhenEmpty: true, raw: (row) => row.thu.phuPs,
    cell: (row) => money(row.thu.phuPs, 'Thiếu phụ PS'),
  },
  {
    key: 'phatSinhCus', label: 'Phát sinh (cus)', className: 'debit-col--money', group: 'thu',
    autoHideWhenEmpty: true, raw: (row) => row.thu.phatSinhCus,
    cell: (row) => money(row.thu.phatSinhCus, 'Thiếu phát sinh (cus)'),
  },
  {
    key: 'tongThu', label: 'Tổng thu', className: 'debit-col--money', group: 'thu',
    cell: (row) => money(row.thu.tongThu, 'Thiếu tổng thu'),
  },
  {
    key: 'cuocTraDv', label: 'Cước trả ĐV', className: 'debit-col--money', group: 'tra',
    autoHideWhenEmpty: true, raw: (row) => row.tra.cuocTraDv,
    cell: (row) => money(row.tra.cuocTraDv, 'Thiếu cước trả ĐV'),
  },
  {
    key: 'lachHuyenDv', label: 'Lạch Huyện ĐV', className: 'debit-col--money', group: 'tra',
    autoHideWhenEmpty: true, raw: (row) => row.tra.lachHuyenDv,
    cell: (row) => money(row.tra.lachHuyenDv, 'Thiếu lạch huyền ĐV'),
  },
  {
    key: 'phatSinhDv', label: 'Phát sinh ĐV', className: 'debit-col--money', group: 'tra',
    autoHideWhenEmpty: true, raw: (row) => row.tra.phatSinhDv,
    cell: (row) => money(row.tra.phatSinhDv, 'Thiếu phát sinh ĐV'),
  },
  {
    key: 'tong1', label: 'Tổng 1', className: 'debit-col--money', group: 'tra',
    cell: (row) => money(row.tra.tong1, 'Thiếu tổng 1'),
  },
  {
    key: 'phiRu', label: 'Phí RU (tự động)', className: 'debit-col--money', group: 'tra',
    autoHideWhenEmpty: true, raw: (row) => row.tra.phiRu,
    cell: (row) => money(row.tra.phiRu, 'Thiếu phí RU'),
  },
  {
    key: 'loiNhuan', label: 'Lợi nhuận', className: 'debit-col--money',
    cell: (row) => money(row.loiNhuan, 'Thiếu lợi nhuận'),
  },
  {
    key: 'ghiChu', label: 'Ghi chú', className: 'debit-col--note',
    autoHideWhenEmpty: true, raw: (row) => row.ghiChu,
    cell: (row) => row.ghiChu ?? '—',
  },
  {
    key: 'doiSoat', label: 'Đối soát', className: 'debit-col--status', pinned: true,
    cell: (row, { confirm, withdraw, isBusy }) => {
      if (row.adjustment.status === 'NONE') return 'Chưa gửi';
      if (row.adjustment.status === 'CONFIRMED') return 'Đã đối soát';
      const requestId = row.adjustment.requestId;
      return (
        <span className="debit-pending">
          Chờ xác nhận
          <button type="button" className="btn btn--secondary btn--sm" disabled={isBusy || requestId == null} onClick={() => requestId != null && confirm([requestId])}>Xác nhận</button>
          <button type="button" className="btn btn--ghost btn--sm" disabled={isBusy || requestId == null} onClick={() => requestId != null && withdraw([requestId])}>Rút</button>
        </span>
      );
    },
  },
];
