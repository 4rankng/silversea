// Task 2.3 (18/11) — Bảng Ghép bộ Debit: the ONE 6-column-group
// reconciliation grid shared by Kế toán (/accounting/ghep-bo-debit) and CUS
// (/shipments-debit). Props-driven (rows, features, callbacks) — no data
// fetching here; each page owns its query and passes filtered rows in.
//
// Column groups (EXACT headers, per the ticket):
//   1 Thông tin Lô hàng   Ngày | Lô hàng | Khách hàng | Nhà máy | Tuyến đường
//                         (+ NV phụ trách in CUS team mode) + the group's
//                         quick filters (Khách hàng / Tuyến đường) in the toolbar.
//   2 Container           Số cont | Loại cont (BSIU1234567 | 20'DC) — SIL-912
//                         (supersedes SIL-876's in-cell stacking): EVERY
//                         container renders as its OWN <tr> — a lot is never
//                         merged into one row. Money stays lot-level: it
//                         renders on the lot's FIRST container row only, so
//                         splitting rows can never double the money or the
//                         totals foot. The lot label is the Số Bill/Booking —
//                         the internal SHP-* code never reaches the screen.
//   3 Cước phải thu       Cước | Lạch Huyện | Phụ phí | Phát sinh | Tổng.
//   4 PHÍ CHI HỘ (Có hóa đơn) — 4 sub-groups from the expense-type catalog's
//                         settlement category.
//   5 PHÍ KHÔNG HÓA ĐƠN   Phí GN OP TC | Thực thu | Phí PS OP TC | Thực thu |
//                         Tên phí (SIL-876's five leaves; Wiki §8.1.3 & §9.9).
//   6 KIỂM SOÁT           Tổng TC | Trạng thái (Đã khóa/Mở chip). The row-pick
//                         checkbox lives on the FIRST sticky column (CR-010.1
//                         SIL-901) feeding Khóa lô / Chọn Debit.
//
// Money law (debit-summary precedent): a null money cell renders EMPTY —
// never a fabricated 0; a known 0 renders muted '0'. The amber law
// (SIL-801): a known non-zero Tổng TC wears var(--warning-text).
import { cloneElement, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DebitMergeContainer, DebitMergeInvoiceFee, DebitMergeItem, DebitMergeNoInvoice } from '@tingting/shared';
import type { LedgerColumn } from '../../lib/column-visibility';
import { useHiddenColumns } from '../../hooks/useHiddenColumns';
import { ColumnPicker } from '../../components/ColumnPicker';
import { Pagination } from '../../design-system';
import { DisabledActionTip } from '../../components/shared/DisabledActionTip';
import { formatISODate, formatMoney } from '../../lib/format';
import './DebitMergeGrid.css';

export const DEBIT_MERGE_PAGE_SIZES = [20, 50] as const;

/** The visible «Ghép thu cước cùng Lô 1» marker on a rev-group member's
 *  cước cell (SIL-546; the tooltip carries the full F-2 reason). */
export const MERGE_TAG_LABEL = 'Ghép thu cước cùng Lô 1';

/** SIL-889 — the pending fee tooltip + the red the money wears until Kế
 *  toán duyệt (#DC2626 via the CSS class, cascade after the zero rule). */
export const PENDING_FEE_TIP = 'Chờ kế toán duyệt chi phí';

/** SIL-897 r9 — no-truncate law for the header labels: a scrolling header
 *  cell whose box is PARTIALLY under the dock edge must never render a
 *  half-glyph label ('PHÍ HẠ-CONT / PHÍ BỐC XẾP' reading 'XẾP'). The label
 *  hides while its cell straddles the edge and returns once fully clear;
 *  fully-swallowed cells stay visible (the opaque dock covers them). The
 *  ±0.5px guard absorbs fractional-px boundaries (measured docks are raw
 *  cumulative chains). */
export function debitMergeHeadLabelOccluded(cellLeft: number, cellRight: number, zoneEdge: number): boolean {
  return cellLeft < zoneEdge - 0.5 && cellRight > zoneEdge + 0.5;
}

/** SIL-891 — the sticky zone: group 1 (Thông tin Lô hàng) through group 2's
 *  Loại cont inclusive. Hidden columns drop out of the zone; the offsets
 *  re-measure whenever the visible set changes. */
function isStickyColumn(column: LedgerColumn): boolean {
  const def = column as GridColumnDef;
  return def.group === 1 || def.group === 2;
}

interface GridColumnDef extends LedgerColumn {
  /** 1-based column group the leaf belongs to. */
  group: 1 | 2 | 3 | 4 | 5 | 6;
  /** Group 4's sub-group header (null elsewhere). */
  sub?: string;
}

const GROUP_HEADERS: Record<1 | 2 | 3 | 4 | 5 | 6, string> = {
  1: 'Thông tin Lô hàng',
  2: 'Container',
  3: 'Cước phải thu',
  4: 'PHÍ CHI HỘ (Có hóa đơn)',
  5: 'PHÍ KHÔNG HÓA ĐƠN',
  6: 'KIỂM SOÁT',
};

/** The base leaf set, in table order. `creator` is appended by the grid when
 *  the page asks for it (CUS team mode). CR-010.1 (SIL-901): the row-pick
 *  checkbox is the FIRST leaf, inside the sticky zone — the far-right
 *  Trạng thái keeps only the lock-state chip. */
const BASE_COLUMNS: GridColumnDef[] = [
  { key: 'pick', label: 'Chọn', group: 1, pinned: true },
  { key: 'ngay', label: 'Ngày', group: 1 },
  { key: 'lot', label: 'Lô hàng', group: 1, pinned: true },
  { key: 'customer', label: 'Khách hàng', group: 1 },
  { key: 'factory', label: 'Nhà máy', group: 1 },
  { key: 'route', label: 'Tuyến đường', group: 1 },
  { key: 'cont', label: 'Số cont', group: 2 },
  { key: 'contType', label: 'Loại cont', group: 2 },
  // SIL-944 (K9.19) — cột 'Thông số': the LCL container-params facts
  // ('Lẻ · Thu: 5T · Trả: 10T' + 'Ghép cùng Bill X') ride their OWN leaf
  // beside the container identity, fed by the wire's `lclParams`; FCL rows
  // keep it empty (absence is not data).
  { key: 'thongSo', label: 'Thông số', group: 2 },
  { key: 'cuoc', label: 'Cước', group: 3 },
  { key: 'lachHuyen', label: 'Lạch Huyện', group: 3 },
  { key: 'phuPhi', label: 'Phụ phí', group: 3 },
  { key: 'phatSinh', label: 'Phát sinh', group: 3 },
  { key: 'tong', label: 'Tổng', group: 3 },
  { key: 'cshtHd', label: 'Số HĐ', group: 4, sub: 'Phí CSHT' },
  { key: 'cshtTien', label: 'Tiền', group: 4, sub: 'Phí CSHT' },
  { key: 'liftHd', label: 'Số HĐ', group: 4, sub: 'Phí nâng-cont / Lưu kho hàng lẻ' },
  { key: 'liftTien', label: 'Tiền', group: 4, sub: 'Phí nâng-cont / Lưu kho hàng lẻ' },
  { key: 'liftThucChi', label: 'Thực chi', group: 4, sub: 'Phí nâng-cont / Lưu kho hàng lẻ' },
  { key: 'dropHd', label: 'Số HĐ', group: 4, sub: 'Phí hạ-cont / Phí bốc xếp' },
  { key: 'dropTien', label: 'Tiền', group: 4, sub: 'Phí hạ-cont / Phí bốc xếp' },
  { key: 'dropThucChi', label: 'Thực chi', group: 4, sub: 'Phí hạ-cont / Phí bốc xếp' },
  { key: 'khacHd', label: 'Số HĐ', group: 4, sub: 'Phí khác' },
  { key: 'khacSoTien', label: 'Số tiền', group: 4, sub: 'Phí khác' },
  { key: 'khacTenPhi', label: 'Tên phí', group: 4, sub: 'Phí khác' },
  // SIL-876 — PHÍ KHÔNG HÓA ĐƠN tách đủ 5 cột (Wiki §8.1.3/§9.9): hai bên
  // Phí/Thực thu cho từng họ Ops, rồi Tên phí.
  { key: 'gnFee', label: 'Phí GN OP TC', group: 5 },
  { key: 'gnPaid', label: 'Thực thu', group: 5 },
  { key: 'psFee', label: 'Phí PS OP TC', group: 5 },
  { key: 'psPaid', label: 'Thực thu', group: 5 },
  { key: 'noInvTenPhi', label: 'Tên phí', group: 5 },
  { key: 'tongTc', label: 'Tổng TC', group: 6 },
  { key: 'trangThai', label: 'Trạng thái', group: 6, pinned: true },
];

export interface DebitMergeGridProps {
  rows: DebitMergeItem[];
  /** useHiddenColumns storage key — each surface keeps its own choice. */
  storageKey: string;
  /** CUS team mode: appends the NV phụ trách column to group 1. */
  showCreator?: boolean;
  selection: ReadonlySet<number>;
  onSelectionChange: (id: number, next: boolean) => void;
  /** ShipmentDebitWorkspace's canLock law (ADMIN | ACCOUNTANT | CUS). */
  canLock: boolean;
  /** The office trio only — createSettlementRound is OFFICE_ROLES-gated. */
  canChooseDebit: boolean;
  /** SIL-866 (hotfix CR-009.1) — [Xuất Debit Note] rides THIS toolbar: the
   *  same gate as the issue endpoint (CUS | ACCOUNTANT | ADMIN). Absent →
   *  the surface carries no export step at all. */
  canExportDebitNote?: boolean;
  exportDebitPending?: boolean;
  lockPending?: boolean;
  onLockSelected: (shipmentIds: number[]) => void;
  onChooseDebit: (rows: DebitMergeItem[]) => void;
  /** SIL-866 — opens the preview Debit Note dialog over the current selection. */
  onExportDebitNote?: (rows: DebitMergeItem[]) => void;
  /** Row-identity click (the CUS page's Chốt giá bán drawer). */
  onOpenLot?: (row: DebitMergeItem) => void;
  /** The group-1 quick filters (Khách hàng / Tuyến đường), page-owned. */
  quickFilters?: React.ReactNode;
  /** SIL-923 — the post-lock slot of the toolbar. When EVERY picked lot is
   *  LOCKED, [Khóa lô] is replaced: the unlock trio (Quản trị · Giám đốc ·
   *  Kế toán — the /unlock route clearance) gets [Mở khóa lô]; everyone else
   *  gets the read-only [Đã khóa] face (spec alignment 24/11, item 11: NO
   *  ticketing flow — no đề nghị queue, direct unlock with reason + audit
   *  log only). Absent callbacks keep the retired disabled [Khóa lô] exactly
   *  as before. */
  canUnlock?: boolean;
  unlockPending?: boolean;
  onUnlockSelected?: (shipmentIds: number[]) => void;
}

/** Money-state cell: null/absent → EMPTY (chưa xác định, never a fabricated
 *  0); 0 → muted '0'; known → formatted. `warn` = the SIL-801 amber tone on
 *  a known NON-zero value (a settled 0 stays muted). `pending` = the SIL-883
 *  red: the money is saved but Kế toán chưa duyệt — the state beats both the
 *  zero mute and the amber (declared last in the CSS cascade). */
function MoneyCell({ value, warn, mergeTag, pending }: {
  value: string | null | undefined;
  warn?: boolean;
  mergeTag?: { label: string; title: string } | null;
  pending?: boolean;
}) {
  const num = value == null || value === '' ? null : Number(value);
  if (num == null || !Number.isFinite(num)) {
    return <span className="debit-merge-money" />;
  }
  return (
    <span className="debit-merge-money">
      <span
        className={`debit-merge-money__value${num === 0 ? ' debit-merge-money__zero' : ''}${num !== 0 && warn ? ' debit-merge-money__warn' : ''}${pending ? ' debit-merge-money__pending' : ''}`}
        title={pending ? PENDING_FEE_TIP : undefined}
      >
        {formatMoney(num)}
      </span>
      {mergeTag != null && (
        <span className="debit-merge-money__mergetag" title={mergeTag.title}>{mergeTag.label}</span>
      )}
    </span>
  );
}

/** One stacked fee line per invoiced chi-hộ row (money stays lot-level;
 *  several HĐ render as stacked lines inside the cell). A pending fee line
 *  (SIL-883 3.1) wears the red + the shared tooltip until duyệt. */
function FeeStack({ fees, mode }: {
  fees: DebitMergeInvoiceFee[];
  mode: 'hd' | 'amount' | 'actual' | 'name';
}) {
  if (fees.length === 0) return <span className="debit-merge-cell" />;
  return (
    <span className="debit-merge-cell debit-merge-cell--stack">
      {fees.map((fee, index) => (
        <span
          className={`debit-merge-cell__line${fee.pending ? ' debit-merge-cell__line--pending' : ''}`}
          key={`${fee.invoiceNumber ?? 'no-hd'}-${index}`}
          title={fee.pending ? PENDING_FEE_TIP : undefined}
        >
          {mode === 'hd' && (fee.invoiceNumber ?? '—')}
          {mode === 'amount' && formatMoney(Number(fee.amount))}
          {mode === 'actual' && (fee.actualAmount == null ? '' : formatMoney(Number(fee.actualAmount)))}
          {mode === 'name' && (fee.feeName ?? '—')}
        </span>
      ))}
    </span>
  );
}

const EMPTY_SET: ReadonlySet<number> = new Set();

/** SIL-912 — the lot-level money leaves. They render ONCE per lot, on the
 *  lot's FIRST container row; a continuation row keeps the cell EMPTY (the
 *  null-money law — never a fabricated 0), so the visible money column and
 *  the totals foot agree and splitting rows can never double the money. */
const LOT_MONEY_KEYS: Record<string, true> = {
  cuoc: true, lachHuyen: true, phuPhi: true, phatSinh: true, tong: true,
  cshtHd: true, cshtTien: true, liftHd: true, liftTien: true, liftThucChi: true,
  dropHd: true, dropTien: true, dropThucChi: true, khacHd: true, khacSoTien: true, khacTenPhi: true,
  gnFee: true, gnPaid: true, psFee: true, psPaid: true, noInvTenPhi: true, tongTc: true,
};

/** SIL-896 round 11 — one stacked money line per no-invoice fee of the
 *  family (Phí GN OP TC / Phí PS OP TC cells). QA build 2530c955 rejected
 *  the single aggregated cell (450.000₫ + 50.000₫ reading as one unnamed
 *  500.000₫): the cell now renders each fee's amount on its own line,
 *  positionally paired with the Tên phí stack, pending lines wearing the
 *  red. No fees of the family → the empty money cell (unknown, never a
 *  fabricated 0). */
function NoInvoiceFeeStack({ fees, side }: {
  fees: DebitMergeNoInvoice['fees'];
  side: 'gn' | 'ps';
}) {
  const lines = fees.filter((fee) => fee.side === side);
  if (lines.length === 0) return <span className="debit-merge-money" />;
  return (
    <span className="debit-merge-cell debit-merge-cell--stack">
      {lines.map((fee, index) => (
        <span
          className={`debit-merge-cell__line${fee.pending ? ' debit-merge-cell__line--pending' : ''}`}
          key={`${fee.name ?? 'khong-ten'}-${index}`}
          title={fee.pending ? PENDING_FEE_TIP : undefined}
        >
          {formatMoney(Number(fee.amount))}
        </span>
      ))}
    </span>
  );
}

export function DebitMergeGrid({
  rows,
  storageKey,
  showCreator = false,
  selection = EMPTY_SET,
  onSelectionChange,
  canLock,
  canChooseDebit,
  canExportDebitNote,
  exportDebitPending = false,
  lockPending = false,
  onLockSelected,
  onChooseDebit,
  onExportDebitNote,
  onOpenLot,
  quickFilters,
  canUnlock = false,
  unlockPending = false,
  onUnlockSelected,
}: DebitMergeGridProps) {
  const columns = useMemo<GridColumnDef[]>(() => (
    showCreator
      ? [...BASE_COLUMNS.slice(0, 5), { key: 'creator', label: 'NV phụ trách', group: 1 }, ...BASE_COLUMNS.slice(5)]
      : BASE_COLUMNS
  ), [showCreator]);
  const columnsApi = useHiddenColumns({
    storageKey,
    columns,
    hasData: () => true,
  });
  const visibleColumns = useMemo(
    () => columns.filter((column) => !columnsApi.isHidden(column.key)),
    [columns, columnsApi],
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEBIT_MERGE_PAGE_SIZES[0]);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [rows, safePage, pageSize],
  );

  // SIL-912 — one DISPLAY row per container: a lot with N containers renders
  // N <tr>s (never merged into one stacked row); a container-less lot keeps
  // ONE row. Pagination, selection and the totals foot stay LOT-based —
  // pageRows remain lots, so none of their money math re-runs per container.
  const displayRows = useMemo(
    () => pageRows.flatMap((lot): { lot: DebitMergeItem; container: DebitMergeContainer | null; index: number }[] => (
      lot.containers.length === 0
        ? [{ lot, container: null, index: 0 }]
        : lot.containers.map((container, index) => ({ lot, container, index }))
    )),
    [pageRows],
  );

  // SIL-901 — the pick header carries the page select-all checkbox (short
  // label «Tất cả»): it picks/clears exactly the CURRENT page's rows, and its
  // checked/indeterminate state derives from the live selection so picking or
  // clearing one row re-syncs it. A partially-picked page shows the native
  // indeterminate dash (set on the DOM node — React has no prop for it).
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const pageSelectedCount = pageRows.reduce(
    (count, row) => count + (selection.has(row.shipmentId) ? 1 : 0),
    0,
  );
  const allPageSelected = pageRows.length > 0 && pageSelectedCount === pageRows.length;
  const somePageSelected = pageSelectedCount > 0 && pageSelectedCount < pageRows.length;
  useLayoutEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = somePageSelected;
  }, [somePageSelected, allPageSelected]);
  const toggleSelectAllPage = (next: boolean) => {
    for (const row of pageRows) onSelectionChange(row.shipmentId, next);
  };

  // SIL-891/SIL-897 (CR-010.1) — the sticky-left zone (group 1 through Loại
  // cont). Offsets are CUMULATIVE WIDTH SUMS of the sticky leaf cells, never
  // viewport deltas: a cell's width does not depend on the pane's
  // scrollLeft, so the docks are exact at rest AND while scrolled (the old
  // cell.left − table.left delta was poisoned by any measurement taken
  // mid-scroll — LOẠI CONT then slid over CƯỚC at rest, and a search typed
  // while scrolled left a white void where the 5 left columns were). Neighbours
  // share one accumulated boundary, so rounding can never open a slit between
  // sticky cells. The measure re-runs on EVERY commit — the table is
  // content-sized, so search text, filters, hide/show, the team toggle
  // (NV phụ trách) and page churn all reflow widths — and the
  // ResizeObserver covers post-commit growth (webfonts, image-less cells).
  const tableRef = useRef<HTMLTableElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const stickyColumns = useMemo(() => visibleColumns.filter(isStickyColumn), [visibleColumns]);
  // The measure() closure reads the LIVE sticky set through a ref — the
  // effect itself stays dep-free so no commit can render stale docks.
  const stickyColumnsRef = useRef(stickyColumns);
  stickyColumnsRef.current = stickyColumns;
  const [stickyLefts, setStickyLefts] = useState<Record<string, number>>({});
  const stickyLastKey = stickyColumns.length > 0 ? stickyColumns[stickyColumns.length - 1]!.key : null;
  const stickyLeadingKey = useMemo(() => {
    const byGroup: Partial<Record<1 | 2, string>> = {};
    for (const column of stickyColumns) {
      const group = (column as GridColumnDef).group;
      if (group !== 1 && group !== 2) continue;
      if (byGroup[group] == null) byGroup[group] = column.key;
    }
    return byGroup;
  }, [stickyColumns]);
  // SIL-897 r10 — a filter-driven rows change RESETS the horizontal scroll.
  // The table is content-sized: the new result set reflows every column
  // width, and a pane still parked at scrollLeft>0 then shows the MIDDLE of
  // the new table with the sticky dock overlaying its first columns — QA
  // round 10 read the CƯỚC PHẢI THU group (values intact in the DOM, behind
  // the opaque dock) as "collapsed to 0 width"; scrolling fully left
  // restored it. The AC (CR-010.1) resets scrollLeft = 0 on a filter change,
  // so the board re-enters at the sticky zone. Identity-keyed: the SAME rows
  // array (a pagination tap, a toolbar re-render) never snaps the view; a
  // NEW array (search keystroke, facet, month, board refresh) re-enters
  // left. Declared BEFORE the measure effect so the occlusion sweep reads
  // the final scroll position in the same commit.
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (pane != null && pane.scrollLeft !== 0) pane.scrollLeft = 0;
  }, [rows]);
  // SIL-897 r9 — the no-truncate sweep: hide a scrolling header label while
  // its OWN glyph box straddles the dock edge (never a half-glyph label).
  // The cell box lies: a 955px group th keeps its centered label fully clear
  // of the dock while the box itself crosses the edge — hiding on the cell
  // box blanked a fully-visible 'PHÍ CHI HỘ (CÓ HÓA ĐƠN)'. Direct DOM
  // writes — a per-scroll-frame setState here would re-render the whole
  // grid. Dock cells are exempt (they ARE the zone); a fully swallowed label
  // stays put (the opaque dock covers it). Reads refs only, so the dep-free
  // layout effect and the scroll handler share one instance.
  const sweepHeadLabels = () => {
    const table = tableRef.current;
    const pane = paneRef.current;
    if (table == null || pane == null) return;
    const zoneEdge = table.querySelector<HTMLElement>('thead th[data-sticky-last]')
      ?.getBoundingClientRect().right
      ?? pane.getBoundingClientRect().left;
    for (const th of table.querySelectorAll('thead th:not([data-sticky])')) {
      const label = th.querySelector<HTMLElement>('.debit-merge__head-label');
      if (label == null) continue;
      const labelRect = label.getBoundingClientRect();
      if (debitMergeHeadLabelOccluded(labelRect.left, labelRect.right, zoneEdge)) label.setAttribute('data-occluded', '');
      else label.removeAttribute('data-occluded');
    }
  };
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const measure = () => {
      const next: Record<string, number> = {};
      let acc = 0;
      for (const column of stickyColumnsRef.current) {
        // Fractional px on purpose: each dock is the RAW accumulated width
        // chain, so two neighbours share the exact same boundary value —
        // rounding per boundary drifts up to 0.5px per column and opens
        // sub-pixel slits the scrolled money bleeds through (SIL-897).
        next[column.key] = acc;
        const cell = table.querySelector<HTMLElement>(`thead th[data-col="${column.key}"]`);
        if (cell == null) continue;
        acc += cell.getBoundingClientRect().width;
      }
      setStickyLefts((prev) => {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(next);
        if (prevKeys.length === nextKeys.length && nextKeys.every((key) => prev[key] === next[key])) return prev;
        return next;
      });
      // SIL-897 r9 — the vertical pins are MEASURED row heights, never
      // hardcoded px: the rows render 28/29/28px while the old CSS pinned at
      // 0/31/60, so every vertically-pinned pane (any 20-row session) ran a
      // 3px slit between the group band and the sub band with scrolled body
      // rows bleeding through, and the sub labels read as sunk into the
      // column band. Tops ride the same measured-chain law as the lefts.
      const headRows = table.querySelectorAll('thead tr');
      const groupsH = headRows[0]?.getBoundingClientRect().height ?? 0;
      const subsH = headRows[1]?.getBoundingClientRect().height ?? 0;
      if (groupsH > 0) table.style.setProperty('--debit-merge-subs-top', `${groupsH}px`);
      if (groupsH > 0 && subsH > 0) table.style.setProperty('--debit-merge-leaf-top', `${groupsH + subsH}px`);
      sweepHeadLabels();
    };
    measure();
    // jsdom (and engines without ResizeObserver) re-measure on commits only;
    // browsers get the live re-dock.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(table);
    return () => observer.disconnect();
  });
  // Occlusion changes with scrollLeft — re-sweep per scroll frame (rAF
  // coalesced), not per commit.
  const scrollRafRef = useRef(0);
  const onPaneScroll = () => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      sweepHeadLabels();
    });
  };
  /** Sticky dock props for a leaf cell (th/td) keyed by its column. */
  const stickyProps = (key: string): Record<string, unknown> => ({
    'data-sticky': '',
    style: { left: stickyLefts[key] ?? 0 },
    ...(key === stickyLastKey ? { 'data-sticky-last': '' } : {}),
  });

  // Totals foot (owner redesign 23/10 law — a settlement board MUST show its
  // totals): the sums EQUAL the rendered page's money cells (knowns-sum; a
  // column with no known value reads '—', never a fabricated 0). The Tổng TC
  // sum carries the SIL-801 amber tone when known and non-zero.
  const pageTotals = useMemo(() => {
    const sumKnown = (pick: (row: DebitMergeItem) => string | null): string | null => {
      let sum = 0;
      let any = false;
      for (const row of pageRows) {
        const raw = pick(row);
        if (raw != null && raw !== '') {
          const num = Number(raw);
          if (Number.isFinite(num)) {
            any = true;
            sum += num;
          }
        }
      }
      return any ? String(sum) : null;
    };
    return {
      cuoc: sumKnown((row) => row.revenue.cuoc),
      lachHuyen: sumKnown((row) => row.revenue.lachHuyen),
      phuPhi: sumKnown((row) => row.revenue.phuPhi),
      phatSinh: sumKnown((row) => row.revenue.phatSinh),
      tong: sumKnown((row) => row.revenue.tong),
      tongTc: sumKnown((row) => row.control.tongTc),
    };
  }, [pageRows]);

  const selectedRows = rows.filter((row) => selection.has(row.shipmentId));
  const unlockedSelected = selectedRows.filter((row) => row.control.lockStatus !== 'LOCKED');
  const incompleteLabels = unlockedSelected
    .map((row) => row.billOrBookNumber || `#${row.shipmentId}`)
    .slice(0, 3);
  // SIL-883 (3.2) — HARD-BLOCK: a selected lot still carrying ≥1 saved fee
  // awaiting Kế toán duyệt blocks all three money actions (FE mirrors the
  // BE guards' 409); the count drops to 0 the moment duyệt/từ chối lands.
  const pendingSelected = selectedRows.find((row) => (row.control.pendingFeeCount ?? 0) > 0);
  const pendingFeeReason = (actionLabel: string): string | null => (pendingSelected == null ? null
    : `Không thể ${actionLabel}: Lô ${pendingSelected.billOrBookNumber || `#${pendingSelected.shipmentId}`} còn ${pendingSelected.control.pendingFeeCount} khoản chi phí chưa được Kế toán duyệt.`);
  const lockDisabledReason = lockPending
    ? 'Đang khóa lô…'
    : !canLock
      ? 'Cần quyền khóa lô hàng.'
      : selectedRows.length === 0
        ? 'Chọn ít nhất một lô chưa khóa.'
        : unlockedSelected.length === 0
          ? 'Các lô đã chọn đều đã khóa.'
          : pendingFeeReason('khóa lô');
  // SIL-923 — the post-lock slot: once EVERY picked lot is LOCKED the lock
  // button is replaced by the forward path — [Mở khóa lô] for the unlock trio
  // (the /unlock route clearance), a read-only [Đã khóa] face for everyone
  // else (24/11 ruling, item 11: no đề nghị ticketing — the trio unlocks
  // directly with a required reason + audit log).
  const allSelectedLocked = selectedRows.length > 0 && unlockedSelected.length === 0;
  const showUnlockSlot = allSelectedLocked && canUnlock && onUnlockSelected != null;
  const unlockDisabledReason = showUnlockSlot && unlockPending ? 'Đang mở khóa lô…' : null;
  const chooseDebitDisabledReason = !canChooseDebit
    ? 'Tài khoản không có quyền chọn Debit.'
    : selectedRows.length === 0
      ? 'Chọn ít nhất một lô.'
      : pendingSelected != null
        ? pendingFeeReason('chọn Debit')
        : unlockedSelected.length > 0
          ? `Chọn Debit cần lô đã hoàn tất chi phí (đã khóa): ${incompleteLabels.join(', ')}`
          : null;
  // SIL-866 — the export step of the accountant chain (Khóa lô → Chọn Debit
  // → Xuất Debit Note): gated like the issue endpoint; the selection scopes
  // the preview's đợt picker the way the chot-debit board's did.
  const exportDisabledReason = canExportDebitNote !== true
    ? 'Tài khoản không có quyền xuất Debit Note.'
    : exportDebitPending
      ? 'Đang xuất…'
      : selectedRows.length === 0
        ? 'Chọn ít nhất một lô.'
        : pendingFeeReason('xuất Debit Note');

  // Header geometry: per group, the visible leaf count + sub-group buckets.
  const groupSpan = (group: 1 | 2 | 3 | 4 | 5 | 6) =>
    visibleColumns.filter((column) => column.group === group).length;

  return (
    <div className="debit-merge" data-component="debit-merge-grid">
      <div className="debit-merge__toolbar">
        <div className="debit-merge__filters" data-testid="debit-merge-quick-filters">{quickFilters}</div>
        <div className="debit-merge__toolbar-actions">
          {/* Spec alignment 24/11 (item 13): the selection count stays visible
              while picking so Kế toán kiểm soát chính xác phạm vi thao tác. */}
          {selectedRows.length > 0 && (
            <span className="debit-merge__picked-count" role="status">
              Đã chọn {selectedRows.length} lô
            </span>
          )}
          {showUnlockSlot && onUnlockSelected != null ? (
            <DisabledActionTip id="debit-merge-unlock" reason={unlockDisabledReason}>
              <button
                type="button"
                className="debit-merge__action"
                aria-disabled={unlockDisabledReason != null || undefined}
                onClick={() => { if (unlockDisabledReason == null) onUnlockSelected(selectedRows.map((row) => row.shipmentId)); }}
              >
                Mở khóa lô
              </button>
            </DisabledActionTip>
          ) : allSelectedLocked ? (
            <span
              // 24/11 ruling (item 11): roles without unlock clearance see the
              // read-only locked face — no đề nghị flow, direct unlock by the
              // trio only.
              className="debit-merge__action debit-merge__action--locked-state"
              aria-disabled="true"
              title="Liên hệ Kế toán hoặc Quản trị viên để mở khóa nếu cần điều chỉnh"
            >
              Đã khóa
            </span>
          ) : (
            <DisabledActionTip id="debit-merge-lock" reason={lockDisabledReason}>
              <button
                type="button"
                className="debit-merge__action"
                aria-disabled={lockDisabledReason != null || undefined}
                onClick={() => { if (lockDisabledReason == null) onLockSelected(unlockedSelected.map((row) => row.shipmentId)); }}
              >
                Khóa lô
              </button>
            </DisabledActionTip>
          )}
          <DisabledActionTip id="debit-merge-choose" reason={chooseDebitDisabledReason}>
            <button
              type="button"
              className="debit-merge__action debit-merge__action--primary"
              aria-disabled={chooseDebitDisabledReason != null || undefined}
              onClick={() => { if (chooseDebitDisabledReason == null) onChooseDebit(selectedRows); }}
            >
              Chọn Debit
            </button>
          </DisabledActionTip>
          {onExportDebitNote != null && (
            <DisabledActionTip id="debit-merge-export" reason={exportDisabledReason}>
              <button
                type="button"
                className="debit-merge__action"
                aria-disabled={exportDisabledReason != null || undefined}
                onClick={() => { if (exportDisabledReason == null) onExportDebitNote(selectedRows); }}
              >
                {exportDebitPending ? 'Đang xuất…' : 'Xuất Debit Note'}
              </button>
            </DisabledActionTip>
          )}
          {/* CR-010.1 (SIL-900, Spec §10.7.4) — ONE dropdown trigger on the
              filter row; never the raw checkbox panel inline in the toolbar. */}
          <ColumnPicker
            variant="dropdown"
            columns={columns}
            hidden={columnsApi.hidden}
            customized={columnsApi.customized}
            onToggle={columnsApi.toggle}
            onReset={columnsApi.reset}
            onShowAll={columnsApi.showAll}
          />
        </div>
      </div>
      <div className="debit-merge__pane" ref={paneRef} onScroll={onPaneScroll}>
        <table className="debit-merge__table" ref={tableRef}>
          <thead>
            <tr className="debit-merge__groups-row">
              {([1, 2, 3, 4, 5, 6] as const).map((group) => {
                const span = groupSpan(group);
                if (span === 0) return null;
                // Groups 1+2 sit wholly inside the sticky zone (SIL-891):
                // dock each at its leading leaf's measured offset.
                const leadingKey = group === 1 || group === 2 ? stickyLeadingKey[group] : undefined;
                return (
                  <th
                    key={group}
                    colSpan={span}
                    scope="colgroup"
                    className="debit-merge__group"
                    {...(leadingKey != null ? { 'data-sticky': '', style: { left: stickyLefts[leadingKey] ?? 0 } } : {})}
                  >
                    <span className="debit-merge__head-label">{GROUP_HEADERS[group]}</span>
                  </th>
                );
              })}
            </tr>
            <tr className="debit-merge__subs-row">
              {([1, 2, 3, 4, 5, 6] as const).flatMap((group) => {
                const groupColumns = visibleColumns.filter((column) => column.group === group);
                if (groupColumns.length === 0) return [];
                if (group !== 4) {
                  const leadingKey = group === 1 || group === 2 ? stickyLeadingKey[group] : undefined;
                  return [<th key={`sub-${group}`} colSpan={groupColumns.length} aria-hidden="true" className="debit-merge__sub debit-merge__sub--blank" {...(leadingKey != null ? { 'data-sticky': '', style: { left: stickyLefts[leadingKey] ?? 0 } } : {})} />];
                }
                // Group 4's sub-groups, in their fixed order.
                const subs = [...new Set(groupColumns.map((column) => column.sub!))];
                return subs.map((sub) => (
                  <th key={`sub-${sub}`} colSpan={groupColumns.filter((column) => column.sub === sub).length} scope="colgroup" className="debit-merge__sub"><span className="debit-merge__head-label">{sub}</span></th>
                ));
              })}
            </tr>
            <tr>
              {visibleColumns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  data-col={column.key}
                  className={`debit-merge-col--${column.key}`}
                  {...(isStickyColumn(column) ? stickyProps(column.key) : {})}
                >
                  {column.key === 'pick' ? (
                    <label
                      className="debit-merge__pick-all"
                      // Spec alignment 24/11 (item 13): the short UI label stays
                      // 'Tất cả'; the tooltip states the exact page scope so no
                      // one expects later pages to be picked implicitly.
                      title="Chọn tất cả các lô trên trang hiện tại"
                    >
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={allPageSelected}
                        disabled={pageRows.length === 0}
                        onChange={(event) => toggleSelectAllPage(event.target.checked)}
                      />
                      <span className="debit-merge__head-label">Tất cả</span>
                    </label>
                  ) : (
                    <span className="debit-merge__head-label">{column.label}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map(({ lot, container, index }) => {
              const isSelected = selection.has(lot.shipmentId);
              // SIL-876 — mã nội bộ SHP-* không bao giờ ra màn hình: nhãn lô
              // là Số Bill/Booking, thiếu thì '#id' (trên grid này bill/booking
              // là định danh khách hàng thấy).
              const lotLabel = lot.billOrBookNumber || `#${lot.shipmentId}`;
              const mergeTag = lot.revGroupId != null && (lot.revGroupOrder ?? 1) > 1 && lot.revenue.cuocReason
                ? { label: MERGE_TAG_LABEL, title: lot.revenue.cuocReason }
                : null;
              const renderCell = (key: string) => {
                // SIL-912 — lot-level money renders once, on the lot's FIRST
                // container row; a continuation row keeps the cell EMPTY (the
                // null-money law — never a fabricated 0), so the visible
                // column and the totals foot stay equal and the split can
                // never double the money.
                if (index > 0 && LOT_MONEY_KEYS[key]) return <td key={key} data-col={key} />;
                switch (key) {
                  // KB §10.8.4 (24/11): the house date law is DD/MM/YYYY —
                  // the raw ISO date never reaches the cell.
                  case 'ngay': return <td key={key} data-col={key}>{lot.deliveryDate ? formatISODate(lot.deliveryDate) : ''}</td>;
                  case 'lot':
                    return (
                      <td key={key} data-col={key} className="debit-merge-cell--lot">
                        {onOpenLot != null ? (
                          <button type="button" className="debit-merge__lot-link" onClick={() => onOpenLot(lot)} aria-label={`Mở lô ${lotLabel}`}>{lotLabel}</button>
                        ) : lotLabel}
                      </td>
                    );
                  case 'customer': return <td key={key} data-col={key}>{lot.customerName ?? ''}</td>;
                  case 'factory': return <td key={key} data-col={key}>{lot.factoryName ?? ''}</td>;
                  case 'route': return <td key={key} data-col={key}>{lot.routeName ?? ''}</td>;
                  case 'creator': return <td key={key} data-col={key}>{lot.creatorName ?? ''}</td>;
                  case 'cont':
                    // SIL-912 — mỗi container một dòng RIÊNG: ô này chỉ bao
                    // giờ mang đúng MỘT số cont (không còn stack, không nén).
                    return <td key={key} data-col={key}>{container == null ? '—' : container.containerNumber ?? '—'}</td>;
                  case 'contType':
                    return <td key={key} data-col={key}>{container?.containerType ?? ''}</td>;
                  case 'thongSo': {
                    // SIL-944 (K9.19) — the dedicated container-params cell:
                    // the LCL label + the 'Ghép cùng Bill X' note, rendered
                    // once per LOT on its first container row (a continuation
                    // row keeps the cell empty). FCL/ungrouped → empty cell.
                    const params = index === 0 ? lot.lclParams : undefined;
                    if (params == null) return <td key={key} data-col={key} />;
                    return (
                      <td key={key} data-col={key} className="debit-merge-cell--thongso">
                        <span className="debit-merge-cell debit-merge-cell--stack">
                          <span className="debit-merge-cell__line">{params.label}</span>
                          {params.ghepCungRef != null && (
                            <span className="debit-merge-cell__line">{`Ghép cùng Bill ${params.ghepCungRef}`}</span>
                          )}
                        </span>
                      </td>
                    );
                  }
                  case 'cuoc': return <td key={key} data-col={key}><MoneyCell value={lot.revenue.cuoc} mergeTag={mergeTag} /></td>;
                  case 'lachHuyen': return <td key={key} data-col={key}><MoneyCell value={lot.revenue.lachHuyen} /></td>;
                  case 'phuPhi': return <td key={key} data-col={key}><MoneyCell value={lot.revenue.phuPhi} /></td>;
                  case 'phatSinh': return <td key={key} data-col={key}><MoneyCell value={lot.revenue.phatSinh} /></td>;
                  case 'tong': return <td key={key} data-col={key}><MoneyCell value={lot.revenue.tong} /></td>;
                  case 'cshtHd': return <td key={key} data-col={key}><FeeStack fees={lot.chiHo.csht} mode="hd" /></td>;
                  case 'cshtTien': return <td key={key} data-col={key}><FeeStack fees={lot.chiHo.csht} mode="amount" /></td>;
                  case 'liftHd': return <td key={key} data-col={key}><FeeStack fees={lot.chiHo.lift} mode="hd" /></td>;
                  case 'liftTien': return <td key={key} data-col={key}><FeeStack fees={lot.chiHo.lift} mode="amount" /></td>;
                  case 'liftThucChi': return <td key={key} data-col={key}><FeeStack fees={lot.chiHo.lift} mode="actual" /></td>;
                  case 'dropHd': return <td key={key} data-col={key}><FeeStack fees={lot.chiHo.drop} mode="hd" /></td>;
                  case 'dropTien': return <td key={key} data-col={key}><FeeStack fees={lot.chiHo.drop} mode="amount" /></td>;
                  case 'dropThucChi': return <td key={key} data-col={key}><FeeStack fees={lot.chiHo.drop} mode="actual" /></td>;
                  case 'khacHd': return <td key={key} data-col={key}><FeeStack fees={lot.chiHo.other} mode="hd" /></td>;
                  case 'khacSoTien': return <td key={key} data-col={key}><FeeStack fees={lot.chiHo.other} mode="amount" /></td>;
                  case 'khacTenPhi': return <td key={key} data-col={key}><FeeStack fees={lot.chiHo.other} mode="name" /></td>;
                  case 'gnFee': return <td key={key} data-col={key}><NoInvoiceFeeStack fees={lot.noInvoice.fees} side="gn" /></td>;
                  case 'gnPaid': return <td key={key} data-col={key}><MoneyCell value={lot.noInvoice.gnPaid} pending={lot.noInvoice.gnPaidPending} /></td>;
                  case 'psFee': return <td key={key} data-col={key}><NoInvoiceFeeStack fees={lot.noInvoice.fees} side="ps" /></td>;
                  case 'psPaid': return <td key={key} data-col={key}><MoneyCell value={lot.noInvoice.psPaid} pending={lot.noInvoice.psPaidPending} /></td>;
                  case 'noInvTenPhi':
                    return (
                      <td key={key} data-col={key}>
                        {lot.noInvoice.fees.length === 0
                          ? <span className="debit-merge-cell" />
                          : (
                            <span className="debit-merge-cell debit-merge-cell--stack">
                              {lot.noInvoice.fees.map((fee, feeIndex) => (
                                <span
                                  className={`debit-merge-cell__line${fee.pending ? ' debit-merge-cell__line--pending' : ''}`}
                                  key={`${fee.name ?? 'khong-ten'}-${feeIndex}`}
                                  title={fee.pending ? PENDING_FEE_TIP : undefined}
                                >
                                  {fee.name ?? '—'}
                                </span>
                              ))}
                            </span>
                          )}
                      </td>
                    );
                  case 'tongTc': return <td key={key} data-col={key}><MoneyCell value={lot.control.tongTc} warn /></td>;
                  case 'pick':
                    // CR-010.1 (SIL-901) — the pick rides the FIRST (sticky)
                    // column; Trạng thái keeps the lock chip only. The three
                    // money actions keep their hard-block law (SIL-883)
                    // regardless of how many lots are picked. SIL-912: the
                    // checkbox repeats on every container row of the lot but
                    // stays bound to the LOT — one tap flips all of them.
                    return (
                      <td key={key} data-col={key} className="debit-merge-cell--pick">
                        <label className="debit-merge__pick">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(event) => onSelectionChange(lot.shipmentId, event.target.checked)}
                            aria-label={`Chọn lô ${lotLabel}`}
                          />
                        </label>
                      </td>
                    );
                  case 'trangThai':
                    return (
                      <td key={key} data-col={key} className="debit-merge-cell--status">
                        <span className={`debit-merge__lock-state${lot.control.lockStatus === 'LOCKED' ? ' debit-merge__lock-state--locked' : ''}`}>
                          {lot.control.lockStatus === 'LOCKED' ? 'Đã khóa' : 'Mở'}
                        </span>
                      </td>
                    );
                  default: return <td key={key} data-col={key} />;
                }
              };
              return (
                <tr key={`${lot.shipmentId}:${container?.id ?? 'lot'}`} className="debit-merge__row" data-shipment-id={lot.shipmentId}>
                  {visibleColumns.map((column) => {
                    const cell = renderCell(column.key);
                    if (!isStickyColumn(column)) return cell;
                    return cloneElement(cell, stickyProps(column.key));
                  })}
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr><td colSpan={visibleColumns.length} className="debit-merge__empty">Không có lô nào khớp bộ lọc hiện tại.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="debit-merge__totals-row" aria-label="Tổng cộng trang">
              {visibleColumns.map((column) => {
                const total = pageTotals[column.key as keyof typeof pageTotals];
                const isMoney = total !== undefined;
                return (
                  <td
                    key={column.key}
                    data-col={column.key}
                    className={`debit-merge__totals-cell debit-merge__totals-cell--${column.key}${column.key === 'tongTc' && total != null && Number(total) !== 0 ? ' debit-merge__totals-cell--warn' : ''}`}
                    {...(isStickyColumn(column) ? stickyProps(column.key) : {})}
                  >
                    {isMoney ? (total == null ? '—' : formatMoney(Number(total))) : column.key === 'lot' ? 'Tổng cộng' : ''}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      <Pagination
        page={safePage}
        totalPages={totalPages}
        totalItems={rows.length}
        pageSize={pageSize}
        onChange={setPage}
        pageSizeOptions={DEBIT_MERGE_PAGE_SIZES}
        onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
      />
    </div>
  );
}
