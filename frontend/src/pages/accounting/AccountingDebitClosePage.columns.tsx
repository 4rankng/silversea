import { Fragment, type ReactNode } from 'react';
import { formatCurrency, formatDate } from '../../lib/format';
import { billBookingReference } from '../../lib/business-reference';
import { StatusPill } from '../../components/UI';
import { NameCell } from '../../components/shared/NameCell';
import { UnmergeRevGroupAction } from '../../features/shipments/debit/UnmergeRevGroupAction';
import { Skeleton } from '../../components/shared/Skeleton';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';
import { ExternalCostCell } from './AccountingDebitClosePage.external-cost';
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
  /** Card 211026024348 — the shared "Tách nhóm" action finished: the board
   *  refetch the caller owns (the group state and money just changed). */
  onRevGroupUnmerged: () => void;
  /** FB-145 — true while the tách-nhóm refresh is in flight: the cước thu
   *  cell skeletons (h-4 w-16) instead of repainting the dissolved group's
   *  stale 0₫. */
  ratesRefreshing?: boolean;
  /** SIL-771 — lưu 'Chi phí ngoài' của một lô (null = xoá); the page owns
   *  the mutation, the column model stays page-state-free. */
  saveExternalCost?: (shipmentId: number, value: number | null) => void;
  /** SIL-771 — true while the external-cost save is in flight: the ô nhập
   *  disables so a blur storm cannot double-send. */
  externalCostSaving?: boolean;
  /** SIL-727 — the leading track's selection affordance, set per row by the
   *  board table ONLY for pickable rows (adjustment NONE|CONFIRMED): the
   *  checkbox drives the SAME one selection model the row click uses
   *  (`useTableRowSelection`), it is not a second selection state. A locked
   *  row gets null and the track keeps its cost-state marker. */
  rowSelect?: { selected: boolean; toggle: () => void } | null;
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
    //
    // SIL-727 — a PICKABLE row renders the selection checkbox here instead of
    // the dot: the board's selection had no visible affordance after the
    // app-wide checkbox removal (PM directive 2026-09-29), and QA read the
    // dot AS the (missing) checkbox. The checkbox drives the same
    // `useTableRowSelection` state as the row click — one selection model,
    // one shared implementation (house primitive `LclSelectCheckbox`,
    // card 181026145000). A LOCKED row cannot be picked, so it keeps the
    // cost-state marker. The "Thiếu …" muted labels still name the lack.
    key: 'chiPhi', label: 'Chi phí', className: 'debit-col--cost-state', pinned: true, srOnlyHeader: true,
    cell: (row, context) => context?.rowSelect
      ? (
        <input
          type="checkbox"
          role="checkbox"
          className="debit-row-checkbox"
          checked={context.rowSelect.selected}
          aria-checked={context.rowSelect.selected}
          aria-label={`Chọn lô ${billBookingReference(row.billOrBooking) || row.code}`}
          title="Chọn lô"
          onClick={(e) => e.stopPropagation()}
          onChange={() => context.rowSelect?.toggle()}
        />
      )
      : hasMissingCost(row)
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
    // FB-093 re-verify (card 211026024348): this column hosts the "Tách nhóm"
    // action and the "Ghép cùng Bill X" group note. The KT4 essential default
    // hid the whole column on a fresh workstation — burying the action with it
    // (the FB-093 defect resurfaced as "no Tách nhóm phía Kế toán").
    // essentialWhenHasData + raw keep the KT4 matrix minimal on FCL-only
    // boards while the column shows itself the moment lcl/group data exists.
    // FB-093 (lan 3): a STORED choice can no longer bury it either — the QA
    // workstation's pre-essential `accounting-debit-hidden-cols` kept naming
    // this key after the re-verify fix landed, so the read repairs the payload
    // (sanitize + write-back) and the picker no longer offers the column.
    essentialWhenHasData: true,
    raw: (row) => row.lcl?.label ?? null,
    // FB-094: an LCL row states its own label — "Lẻ · Thu: 5T / Trả: 10T"
    // plus the "Ghép cùng Bill X" note when the lot is a group member.
    // Card 211026024348: a lot inside a merged rev group also carries the
    // shared "Tách nhóm" action here — the same component (and the same
    // existing unmerge endpoint) the CUS settlement board runs.
    cell: (row, context) => {
      // SIL-734(a) — the row-level entry exists for BOTH merged dimensions: a
      // COST-merged row (revGroupId null, costGroupId set — case R42) rides
      // the SAME shared action with dimension='COST', never a second unmerge
      // path. A cost-locked row stays blocked with the exact reason.
      const mergedGroupId = row.lcl?.revGroupId ?? row.lcl?.costGroupId ?? null;
      const mergedDimension = row.lcl?.revGroupId != null ? 'REV' as const : 'COST' as const;
      return row.lcl ? (
        <div className="record-cell-stack">
          <span>
            {row.lcl.label}
            {row.lcl.ghépCùngRef ? ` (Ghép cùng Bill ${row.lcl.ghépCùngRef})` : ''}
          </span>
          {mergedGroupId != null && (
            <UnmergeRevGroupAction
              id={`accounting-debit-tach-nhom-${row.shipmentId}`}
              groupId={mergedGroupId}
              dimension={mergedDimension}
              lotRef={billBookingReference(row.billOrBooking) || '—'}
              disabledReason={row.costLockedAt != null
                ? 'Nhóm ghép đã chốt kế toán — không thể tách nhóm.'
                : null}
              onUnmerged={context.onRevGroupUnmerged}
            />
          )}
        </div>
      ) : (row.containers.length > 0 ? row.containers.join(' · ') : '—');
    },
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
                title="Sửa BKS ảo"
                aria-label={`Sửa BKS ảo: ${xeoAo}`}
                aria-expanded={editingBillingShipmentId === row.shipmentId}
                onClick={() => editBillingPlate(row.shipmentId)}
              >
                BKS ảo: {xeoAo}
              </button>
            )}
          </div>
        );
      }
      return row.phanXe.length > 0 ? phanXeNames(row.phanXe) : '—';
    },
  },
  {
    // SIL-727 — essential: the full 10-column money matrix (5 PHẢI THU + 5 PHẢI TRẢ)
    // always renders on the board and is never hidden by autoHideWhenEmpty.
    key: 'cuocThu', label: 'Cước thu (tự động)', className: 'debit-col--money', group: 'thu',
    essential: true,
    // FB-145 — the tách-nhóm refresh skeletons the cell (design direction
    // 24/10: h-4 w-16); "Thiếu cước thu"/the fresh per-lot price renders only
    // from the refetched board.
    cell: (row, context) => (context?.ratesRefreshing
      ? <Skeleton width={64} height={16} />
      : money(row.thu.cuocThu, 'Thiếu cước thu')),
  },
  {
    key: 'lachHuyen', label: 'Lạch Huyện (tự động)', className: 'debit-col--money', group: 'thu',
    essential: true,
    cell: (row) => money(row.thu.lachHuyen, 'Thiếu lạch huyền'),
  },
  {
    key: 'phuPs', label: 'Phụ ps (tự động)', className: 'debit-col--money', group: 'thu',
    essential: true,
    cell: (row) => money(row.thu.phuPs, 'Thiếu phụ PS'),
  },
  {
    key: 'phatSinhCus', label: 'Phát sinh (cus)', className: 'debit-col--money', group: 'thu',
    essential: true,
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
    essential: true,
    cell: (row) => money(row.tra.cuocTraDv, 'Thiếu cước trả ĐV'),
  },
  {
    key: 'lachHuyenDv', label: 'Lạch Huyện ĐV', className: 'debit-col--money', group: 'tra',
    essential: true,
    cell: (row) => money(row.tra.lachHuyenDv, 'Thiếu lạch huyền ĐV'),
  },
  {
    key: 'phatSinhDv', label: 'Phát sinh ĐV', className: 'debit-col--money', group: 'tra',
    essential: true,
    cell: (row) => money(row.tra.phatSinhDv, 'Thiếu phát sinh ĐV'),
  },
  {
    // Card 191026181942 (KT4) — essential: the PHẢI TRẢ rollup (Tổng trả) is one
    // of the six columns the board opens on. SIL-701: nhãn đúng là 'Tổng trả'.
    key: 'tong1', label: 'Tổng trả', className: 'debit-col--money', group: 'tra', essential: true,
    cell: (row) => money(row.tra.tong1, 'Thiếu tổng trả'),
  },
  {
    key: 'phiRu', label: 'Phí RU (tự động)', className: 'debit-col--money', group: 'tra',
    essential: true,
    cell: (row) => money(row.tra.phiRu, 'Thiếu phí RU'),
  },
  {
    // SIL-771 — 'Chi phí ngoài' (nhóm Tổng kết & kiểm soát lãi/lỗ theo mẫu
    // khách): kế toán gõ trực tiếp trên ô — các chi phí ngoài cước phải thu /
    // phải trả (kẹt, hợp và phát sinh nâng/hạ cảng). Essential vì công thức
    // lợi nhuận bên dưới đọc đúng trường này.
    key: 'chiPhiNgoai', label: 'Chi phí ngoài', className: 'debit-col--money', essential: true,
    cell: (row, context) => (
      <ExternalCostCell
        row={row}
        onCommit={context?.saveExternalCost ?? (() => {})}
        saving={context?.externalCostSaving ?? false}
      />
    ),
  },
  {
    // SIL-771 — công thức khách chốt: Lợi nhuận = Tổng thu − Tổng trả − Chi
    // phí ngoài (tính server-side, computeDebitBoardProfit). Quy tắc cảnh báo
    // giữ nguyên: lợi nhuận âm → ô bôi nền đỏ đậm, chữ trắng.
    key: 'loiNhuan', label: 'Lợi nhuận', className: 'debit-col--money', essential: true,
    cell: (row) => {
      if (row.loiNhuan == null) return money(null, 'Thiếu lợi nhuận');
      const value = Number(row.loiNhuan);
      return (
        <span className={value < 0 ? 'debit-loinhuan debit-loinhuan--negative' : 'debit-loinhuan'}>
          {formatCurrency(value)}
        </span>
      );
    },
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
      // SIL-773 — a row hidden by 'Lưu - Phê duyệt từng dòng và ẩn' carries
      // its own marker so the history view (Hiện dòng đã ẩn) still tells the
      // hidden set apart from live rows.
      const hiddenMarker = row.debitHiddenAt != null
        ? <StatusPill variant="neutral">Đã lưu - ẩn</StatusPill>
        : null;
      if (row.adjustment.status === 'NONE') return <span className="debit-pending">{hiddenMarker}<StatusPill variant="neutral">Chưa gửi</StatusPill></span>;
      if (row.adjustment.status === 'CONFIRMED') return <span className="debit-pending">{hiddenMarker}<StatusPill variant="success">Đã đối soát</StatusPill></span>;
      return (
        <span className="debit-pending">
          {hiddenMarker}
          <StatusPill variant="warn">Chờ xác nhận</StatusPill>
          <button type="button" className="btn btn--secondary btn--sm" disabled={isBusy || requestId == null} onClick={() => requestId != null && confirm([requestId])}>Xác nhận</button>
          <button type="button" className="btn btn--ghost btn--sm" disabled={isBusy || requestId == null} onClick={() => requestId != null && withdraw([requestId])}>Rút</button>
        </span>
      );
    },
  },
];
