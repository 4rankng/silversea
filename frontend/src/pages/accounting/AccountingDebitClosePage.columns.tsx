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
 * The KIỂM SOÁT LÔ HÀNG board's column model (card 20260921_21).
 *
 * SIL-772 (Rev2 Phần IV.2, QA FAIL build 1ae5afcb comment 5047) — the board
 * renders the customer's LƯỚI 9 CỘT multi-line, not the old 17-track money
 * matrix that scrolled sideways at 1920px and cut TỔNG TRẢ at the right edge.
 * Each of the 9 groups is ONE column whose cell stacks its facts as labeled
 * lines; every group is `pinned`, so nothing hides behind the visibility
 * picker (the picker is gone from the page — 9/9 groups show by default).
 * All wire facts of the old matrix still render (PHÍ RU folds into Cước phải
 * trả as its 4th line; Đối soát folds into Ghi chú & Đối soát), so no data
 * left the board. `frontend/scripts/check-structure.mjs` caps a source file
 * at 400 lines; this is the widest seam in the page and it is a real one
 * (nothing here reads page state).
 */

/** The board's own identity — the DOCUMENT it renders, under the screen's H1. */
export const BOARD_CAPTION = 'Kế hoạch điều động tổng hợp';

export interface CellContext {
  confirm: (requestIds: number[]) => void;
  withdraw: (requestIds: number[]) => void;
  isBusy: boolean;
  /** SIL-771 — save the row's editable 'Chi phí ngoài'. */
  saveExternalCost?: (shipmentId: number, value: number | null) => void;
  externalCostSaving?: boolean;
  /** FB-145 — true while a [Tách nhóm] refresh skeletons the cước-thu line. */
  ratesRefreshing?: boolean;
  /** Card 211026024348 — after an unmerge the board refetches. */
  onRevGroupUnmerged: () => void;
  /** FB-093 — the BKS báo khách quick edit opens on the badge cell. */
  editBillingPlate: (shipmentId: number) => void;
  editingBillingShipmentId: number | null;
  rowSelect?: { selected: boolean; toggle: () => void } | null;
}

/**
 * Card 191026181942 (KT8) — the money fields behind the "Thiếu …" lines. A row
 * with ANY of these null still lacks cost data; the leading status mark says so
 * in one glance. `loiNhuan` is derived from these, and GHI CHÚ is prose, so
 * neither belongs to the predicate.
 */
const THU_COST_FIELDS = ['cuocThu', 'lachHuyen', 'phuPs', 'phatSinhCus', 'tongThu'] as const;
const TRA_COST_FIELDS = ['cuocTraDv', 'lachHuyenDv', 'phatSinhDv', 'phiRu', 'tong1'] as const;

/** True when the row still has ≥1 missing money field ("Thiếu chi phí"). */
export function hasMissingCost(row: AccountingDebitBoardRow): boolean {
  return THU_COST_FIELDS.some((field) => row.thu[field] == null)
    || TRA_COST_FIELDS.some((field) => row.tra[field] == null);
}

export interface DebitColumn extends LedgerColumn {
  /** The column's track class (see the stylesheet). */
  className: string;
  /** The wire value behind an auto-hide decision (unused while all 9 groups
   *  are pinned; kept for the LedgerColumn contract and the records view). */
  raw?: (row: AccountingDebitBoardRow) => string | null;
  /** The cell body — the ONE place a column's value is rendered. */
  cell: (row: AccountingDebitBoardRow, context: CellContext) => ReactNode;
}

/** A missing money value names the FIELD it is missing from (§1) — never the
 *  generic "Chưa xác định", which names nothing. */
function money(value: string | null, missingLabel: string): ReactNode {
  return value == null
    ? <span className="debit-missing">{missingLabel}</span>
    : formatCurrency(Number(value));
}

/** One labeled line of a multi-line money cell (Rev2: label muted, value
 *  tabular right; the label may wrap, the NUMBER never does). */
function MoneyLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="debit-line">
      <span className="debit-line__label">{label}</span>
      <span className="debit-line__value">{children}</span>
    </span>
  );
}

export const BOARD_COLUMNS: readonly DebitColumn[] = [
  {
    // Rev2 cột 1 — [Checkbox] & Lô: ngày đóng/trả, khách hàng (nhà máy /
    // tuyến đường ride the wire only after the BE adds them; see the ticket).
    // SIL-727 — a PICKABLE row renders the selection checkbox here (the same
    // useTableRowSelection state the row click drives); a LOCKED row keeps
    // the KT8 cost-state dot. The row's ✓ selection tick rides the leading
    // track (board.tsx).
    key: 'lo', label: 'Lô', className: 'debit-col--lot', pinned: true,
    cell: (row, context) => (
      <div className="record-cell-stack">
        <span className="debit-lot-ref">
          {/* §2c: the ✓ tick says WHICH row is selected — the count strip says
              HOW MANY. The 1.1em slot is always reserved so picking a row
              never shifts the lot's code. */}
          <span className="debit-row-tick" aria-hidden="true">{context?.rowSelect?.selected ? '✓' : ''}</span>
          {context?.rowSelect
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
              ? <span className="debit-cost-dot" role="img" aria-label="Thiếu chi phí" title="Thiếu chi phí" />
              : null}
          <span>{billBookingReference(row.billOrBooking) || '—'}</span>
        </span>
        <span className="debit-lot-date">{row.ngay == null ? '—' : formatDate(row.ngay)}</span>
        {/* Card 191026202000: the customer name rides the shared NameCell like
            every other grid — short name on the face, full name in the tooltip. */}
        <NameCell as="small" name={row.customerName} />
      </div>
    ),
  },
  {
    // Rev2 cột 2 — Hàng hóa & Cont. FB-093 re-verify (card 211026024348): the
    // cell also hosts the "Tách nhóm" action and the "Ghép cùng Bill X" note.
    key: 'hangHoaCont', label: 'Hàng hóa & Cont', className: 'debit-col--container', pinned: true,
    cell: (row, context) => {
      // SIL-734(a) — a COST-merged row (revGroupId null, costGroupId set)
      // rides the SAME shared action with dimension='COST'. A cost-locked row
      // stays blocked with the exact reason.
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
    // Rev2 cột 3 — Phương tiện. Card 161026232419 (§II.4) + FB-094: an LCL row
    // states BOTH facts — line 1 is the lot's real carrier identity next to the
    // plate that actually ran the lane, line 2 is the orange "xe ảo" badge that
    // fires only when the billing plate differs. The carrier half reuses
    // `row.phanXe` (the service batches that lookup once for the whole board).
    key: 'phuongTien', label: 'Phương tiện', className: 'debit-col--truck', pinned: true,
    cell: (row, { editBillingPlate, editingBillingShipmentId }) => {
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
                not `disabled`: the plate stays readable as text. */}
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
    // Rev2 cột 4 — Cước phải thu: cước chính, Lạch Huyện, phụ PS, phát sinh
    // (CUS) as stacked labeled lines. FB-145: while a [Tách nhóm] refresh is
    // in flight the cước-thu line skeletons instead of painting the dissolved
    // group's stale 0₫.
    key: 'cucPhaiThu', label: 'Cước phải thu', className: 'debit-col--money-group', pinned: true,
    cell: (row, context) => (
      <div className="debit-money-group">
        <MoneyLine label="Cước thu">
          {context?.ratesRefreshing
            ? <Skeleton width={64} height={16} />
            : money(row.thu.cuocThu, 'Thiếu cước thu')}
        </MoneyLine>
        <MoneyLine label="Lạch Huyện">{money(row.thu.lachHuyen, 'Thiếu lạch huyền')}</MoneyLine>
        <MoneyLine label="Phụ PS">{money(row.thu.phuPs, 'Thiếu phụ PS')}</MoneyLine>
        <MoneyLine label="Phát sinh (CUS)">{money(row.thu.phatSinhCus, 'Thiếu phát sinh (cus)')}</MoneyLine>
      </div>
    ),
  },
  {
    // Rev2 cột 5 — Tổng thu = cước thu + Lạch Huyện + phát sinh; the rollup
    // reads bold (the QA-passed rendering; Rev2's navy is the customer's Excel
    // face — no navy token exists in the house palette, so bold ink it is).
    key: 'tongThu', label: 'Tổng thu', className: 'debit-col--money', pinned: true,
    cell: (row) => <strong className="debit-tong-thu">{money(row.thu.tongThu, 'Thiếu tổng thu')}</strong>,
  },
  {
    // Rev2 cột 6 — Cước phải trả: cước trả ĐV, Lạch Huyện ĐV, phát sinh ĐV and
    // the 4th fee line. PHÍ RU is pricing_tables rate_key='RU', shown beside
    // (not inside) Tổng trả by the service — it folds here as its labeled line
    // so the fee stays on the board without a 10th track.
    key: 'cucPhaiTra', label: 'Cước phải trả', className: 'debit-col--money-group', pinned: true,
    cell: (row) => (
      <div className="debit-money-group">
        <MoneyLine label="Cước trả ĐV">{money(row.tra.cuocTraDv, 'Thiếu cước trả ĐV')}</MoneyLine>
        <MoneyLine label="Lạch Huyện ĐV">{money(row.tra.lachHuyenDv, 'Thiếu lạch huyền ĐV')}</MoneyLine>
        <MoneyLine label="Phát sinh ĐV">{money(row.tra.phatSinhDv, 'Thiếu phát sinh ĐV')}</MoneyLine>
        <MoneyLine label="Phí RU">{money(row.tra.phiRu, 'Thiếu phí RU')}</MoneyLine>
      </div>
    ),
  },
  {
    // Rev2 cột 7 — Tổng trả & Chi phí ngoài: the rollup line plus the SIL-771
    // editable external-cost input (công thức lợi nhuận đọc đúng trường này).
    key: 'tongTraChiPhiNgoai', label: 'Tổng trả & Chi phí ngoài', className: 'debit-col--money-group', pinned: true,
    cell: (row, context) => (
      <div className="debit-money-group">
        <MoneyLine label="Tổng trả">{money(row.tra.tong1, 'Thiếu tổng trả')}</MoneyLine>
        <span className="debit-line debit-line--stacked">
          <span className="debit-line__label">Chi phí ngoài</span>
          <ExternalCostCell
            row={row}
            onCommit={context?.saveExternalCost ?? (() => {})}
            saving={context?.externalCostSaving ?? false}
          />
        </span>
      </div>
    ),
  },
  {
    // Rev2 cột 8 — Lợi nhuận = Tổng thu − Tổng trả − Chi phí ngoài (server-side,
    // computeDebitBoardProfit). Lợi nhuận âm → ô bôi nền đỏ đậm, chữ trắng.
    key: 'loiNhuan', label: 'Lợi nhuận', className: 'debit-col--money', pinned: true,
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
    // Rev2 cột 9 — Ghi chú & Đối soát: the row's đối soát state + its two
    // actions (Xác nhận/Rút) ride with the ghi chú prose so the Rev2 nine-
    // column grid keeps every action reachable (kẹt/hợp TAGS have no wire
    // field yet; the Đối soát state is the third fact of this control column).
    // SIL-773 — a row hidden by 'Lưu - Phê duyệt từng dòng và ẩn' carries its
    // own marker so the history view still tells the hidden set apart.
    key: 'ghiChuDoiSoat', label: 'Ghi chú & Đối soát', className: 'debit-col--note', pinned: true,
    cell: (row, { confirm, withdraw, isBusy }) => {
      const requestId = row.adjustment.requestId;
      const hiddenMarker = row.debitHiddenAt != null
        ? <StatusPill variant="neutral">Đã lưu - ẩn</StatusPill>
        : null;
      const status = row.adjustment.status === 'NONE'
        ? <StatusPill variant="neutral">Chưa gửi</StatusPill>
        : row.adjustment.status === 'CONFIRMED'
          ? <StatusPill variant="success">Đã đối soát</StatusPill>
          : (
            <>
              <StatusPill variant="warn">Chờ xác nhận</StatusPill>
              <button type="button" className="btn btn--secondary btn--sm" disabled={isBusy || requestId == null} onClick={() => requestId != null && confirm([requestId])}>Xác nhận</button>
              <button type="button" className="btn btn--ghost btn--sm" disabled={isBusy || requestId == null} onClick={() => requestId != null && withdraw([requestId])}>Rút</button>
            </>
          );
      return (
        <div className="record-cell-stack">
          <span className="debit-pending">{hiddenMarker}{status}</span>
          <span className="debit-ghi-chu">{row.ghiChu ?? '—'}</span>
        </div>
      );
    },
  },
];
