import { Fragment, type ReactNode } from 'react';
import { formatCurrency, formatDate } from '../../lib/format';
import { billBookingReference } from '../../lib/business-reference';
import { StatusPill } from '../../components/UI';
import { NameCell } from '../../components/shared/NameCell';
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
  /** FB-093 (card 191026100833) — the "Báo khách (Ảo)" badge was a plain
   *  <span>, so kế toán could READ the plate the customer is told but never
   *  correct it here. The same quick edit the CUS ledger runs
   *  (`ShipmentContainerLedger.billingPlateTrigger`); the page owns the
   *  editor state and passes the opener down. */
  editBillingPlate: (shipmentId: number) => void;
  /** The lot whose BKS-báo-khách editor is open, or null — so the cell can
   *  render the badge as the pressed trigger while the panel is up. */
  editingBillingShipmentId: number | null;
}

/**
 * Card 191026181942 (KT8) — the money fields behind the "Thiếu …" cells. A row
 * with ANY of these null still lacks cost data; the leading status column's
 * red dot says so in one glance. `loiNhuan` is derived from these, and GHI CHÚ
 * is prose, so neither belongs to the predicate.
 */
const THU_COST_FIELDS = ['cuocThu', 'lachHuyen', 'phuPs', 'phatSinhCus', 'tongThu'] as const;
const TRA_COST_FIELDS = ['cuocTraDv', 'lachHuyenDv', 'phatSinhDv', 'phiRu', 'tong1'] as const;

/** True when the row still has ≥1 missing money field ("Thiếu chi phí"). */
export function hasMissingCost(row: AccountingDebitBoardRow): boolean {
  return THU_COST_FIELDS.some((field) => row.thu[field] == null)
    || TRA_COST_FIELDS.some((field) => row.tra[field] == null);
}

export interface DebitColumn extends LedgerColumn {
  /** The column's own minimum width (see the stylesheet). */
  className: string;
  /** Tier-1 header this column belongs to, for the grouped head. */
  group?: GroupKey;
  /**
   * Card 191026181942 (KT8): the header text renders screen-reader-only —
   * for the slim leading cost-state track, whose 34px cannot hold a label
   * without wrapping the head band. The picker still shows the real label.
   */
  srOnlyHeader?: boolean;
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
    // Card 191026181942 (KT8) — the slim LEADING status column: one red dot
    // when the row still lacks cost data, so "dễ kiểm tra" is a pre-attentive
    // scan down the first track instead of reading every money cell. The
    // money cells keep their muted "Thiếu …" labels (§1 names the field);
    // the row is NEVER flooded red — that would fight the selection state.
    key: 'chiPhi', label: 'Chi phí', className: 'debit-col--cost-state', pinned: true, srOnlyHeader: true,
    cell: (row) => hasMissingCost(row)
      ? (
        <span
          className="debit-cost-dot"
          role="img"
          aria-label="Thiếu chi phí"
          title="Thiếu chi phí"
        />
      )
      : <span aria-hidden="true">—</span>,
  },
  {
    key: 'ngay', label: 'Ngày', className: 'debit-col--date', pinned: true,
    cell: (row) => (row.ngay == null ? '—' : formatDate(row.ngay)),
  },
  {
    key: 'lo', label: 'Thông tin lô hàng', className: 'debit-col--lot', pinned: true,
    // Card 191026202000: the customer name rides the shared NameCell like
    // every other grid — the wire already carries the operational short name,
    // the cell keeps the full name reachable through the tooltip law.
    cell: (row) => (
      <div className="record-cell-stack">
        <span>{billBookingReference(row.billOrBooking)}</span>
        <NameCell as="small" name={row.customerName} />
      </div>
    ),
  },
  {
    key: 'container', label: 'Thông số container', className: 'debit-col--container',
    // FB-094: an LCL row states its own label — "Lẻ · Thu: 5T / Trả: 10T"
    // plus the "Ghép cùng Bill X" note when the lot is a group member.
    cell: (row) => row.lcl ? (
      <div className="record-cell-stack">
        <span>
          {row.lcl.label}
          {row.lcl.ghépCùngRef ? ` (Ghép cùng Bill ${row.lcl.ghépCùngRef})` : ''}
        </span>
      </div>
    ) : (row.containers.length > 0 ? row.containers.join(' · ') : '—'),
  },
  {
    key: 'phanXe', label: 'Phân xe', className: 'debit-col--truck',
    // Card 161026232419 (§II.4) + FB-094: an LCL row states BOTH facts so kế
    // toán can check them side by side — line 1 is the lot's real carrier
    // identity next to the plate that actually ran the lane, line 2 is the
    // orange "xe ảo" badge that fires only when the billing plate differs.
    // The carrier half reuses `row.phanXe`, the SAME active-trip labels the
    // FCL cell renders below (subcontracted ⇒ nhà xe name, own fleet ⇒ own
    // plate) — the service batches that lookup once for the whole board, so
    // this cell MUST NOT resolve a carrier of its own.
    cell: (row, { editBillingPlate, editingBillingShipmentId }) => {
      // Card 191026202000: each nhà xe label rides the shared NameCell (short
      // name from the wire, full name in the tooltip) instead of a joined
      // full-legal-name string.
      const phanXeNames = (labels: string[]) => labels.map((label, index) => (
        <Fragment key={`${label}-${index}`}>
          {index > 0 && ', '}
          <NameCell name={label} />
        </Fragment>
      ));
      if (row.lcl) {
        const carrierLabels = row.phanXe.filter((label) => label.trim() !== '');
        const carrier = carrierLabels.length > 0 ? phanXeNames(carrierLabels) : null;
        const actual = row.lcl.actualTruckNo?.trim() || null;
        const billing = row.lcl.billingTruckNo?.trim() || null;
        const xeoAo = billing != null && billing !== actual ? billing : null;
        // Absence is not data: an LCL row carrying neither identity renders
        // the ONE em-dash, never an empty string or a bare "Thực: undefined".
        if (carrier == null && actual == null && xeoAo == null) return <span>—</span>;
        return (
          <div className="record-cell-stack">
            <span>{carrier ?? '—'} · Thực: {actual ?? '—'}</span>
            {/* FB-093 (card 191026100833): the badge IS the editor trigger —
                the CUS ledger's `billingPlateTrigger` law, same button, same
                title. Not `disabled`: the plate stays readable as text. */}
            {xeoAo != null && (
              <button
                type="button"
                className="debit-billing-badge"
                title="Sửa BKS báo khách"
                aria-label={`Sửa BKS báo khách: ${xeoAo}`}
                aria-expanded={editingBillingShipmentId === row.shipmentId}
                onClick={() => editBillingPlate(row.shipmentId)}
              >
                Báo khách (Ảo): {xeoAo}
              </button>
            )}
          </div>
        );
      }
      return row.phanXe.length > 0 ? phanXeNames(row.phanXe) : '—';
    },
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
    // Card 191026181942 (KT4) — essential: the PHẢI THU rollup is one of the
    // six columns the board opens on.
    key: 'tongThu', label: 'Tổng thu', className: 'debit-col--money', group: 'thu', essential: true,
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
    // Card 191026181942 (KT4) — essential: the PHẢI TRẢ rollup (Tổng 1) is one
    // of the six columns the board opens on.
    key: 'tong1', label: 'Tổng 1', className: 'debit-col--money', group: 'tra', essential: true,
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
      const requestId = row.adjustment.requestId;
      // One status per lot, always as a StatusPill so the whole board reads as
      // one voice (never a bare word beside pills elsewhere). The pending case
      // keeps its two row actions beside the pill — layout only, no logic moved.
      if (row.adjustment.status === 'NONE') return <StatusPill variant="neutral">Chưa gửi</StatusPill>;
      if (row.adjustment.status === 'CONFIRMED') return <StatusPill variant="success">Đã đối soát</StatusPill>;
      return (
        <span className="debit-pending">
          <StatusPill variant="warn">Chờ xác nhận</StatusPill>
          <button type="button" className="btn btn--secondary btn--sm" disabled={isBusy || requestId == null} onClick={() => requestId != null && confirm([requestId])}>Xác nhận</button>
          <button type="button" className="btn btn--ghost btn--sm" disabled={isBusy || requestId == null} onClick={() => requestId != null && withdraw([requestId])}>Rút</button>
        </span>
      );
    },
  },
];
