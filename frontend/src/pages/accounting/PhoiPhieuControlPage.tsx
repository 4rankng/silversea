import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { LedgerRecordList, type LedgerRecord } from '../../components/shared/LedgerRecordList';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { ReceiptText } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listPhoiPhieuRows, listPhoiPhieuStk, type PhoiPhieuRow, type ChiHoConfirmation } from '../../api/phoiPhieuClient';
import { qk } from '../../api/keys';
import { PhoiPhieuReportSection } from './PhoiPhieuControlPage.reports';
import { formatCurrency, formatDate, formatMoney, formatWeight, businessDateISO } from '../../lib/format';
import { billBookingReference } from '../../lib/business-reference';
import { PageHeader } from '../../components/UI';
import { Money } from '../../components/shared/Money';
import { FilterDropdown } from '../../components/FilterDropdown';
import { ColumnMiniFilter, DateRangeFields, FilterBar, UuiSelectField } from '../../design-system';
import { PhoiPhieuChiHoDialog } from '../../features/accounting/PhoiPhieuChiHoDialog';
import { PhoiPhieuInvoiceCell, phoiChiHoFeeLabel } from '../../features/accounting/PhoiPhieuInvoiceCell';
import {
  PhoiPhieuVoucherPreviewDrawer,
  phoiPhieuVoucherPreviewLines,
} from '../../features/accounting/PhoiPhieuVoucherPreviewDrawer';
import { ExpenseCreateDrawer } from '../../features/expense-accounting/ExpenseCreateDrawer';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { OpsExpenseNoteLines } from '../../features/dispatch/components/OpsExpenseNoteLines';
import { PhoiPhieuTienDuongDialog } from '../../features/accounting/PhoiPhieuTienDuongDialog';
import { useTableRowSelection } from '../../hooks/useTableRowSelection';
import { useHiddenColumns } from '../../hooks/useHiddenColumns';
import type { LedgerColumn } from '../../lib/column-visibility';
import { PhoiPhieuTruckAssignments } from '../../features/accounting/PhoiPhieuTruckAssignments';
import { UnattachedTripsTable } from '../../features/shipments/debit/ShipmentDebitTables.unattached';
import './PhoiPhieuControlPage.css';

const TRIP_STATUS_OPTIONS = [
  { value: '', label: 'Tất cả' },
  { value: 'CREATED', label: 'Đã tạo chuyến' },
  { value: 'IN_TRANSIT', label: 'Đang chạy' },
  { value: 'COMPLETED', label: 'Đã hoàn thành' },
];

const STATUS_LABELS: Record<string, string> = {
  CREATED: 'Đã tạo chuyến', IN_TRANSIT: 'Đang chạy', COMPLETED: 'Đã hoàn thành',
};

const money = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? 'Chưa xác định' : <Money value={value} />;

/** Normalized "contains" for the column mini-filters: case-folded and
 *  Vietnamese-diacritic-folded, so "kh binh" finds "KH Bình" and "51a" finds
 *  "51A-1". */
function foldQuery(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

/** The board's binary phoi state: the day the paper was taken on the desktop
 *  detail dialog is what "đã nhận phơi" means; the free-text take status is
 *  ride-along detail, never a second state machine. */
function phoiStateOf(row: PhoiPhieuRow): string {
  return row.phoiTakenDate ? 'Đã nhận phơi' : 'Chưa nhận phơi';
}

function phoiStatusLine(row: PhoiPhieuRow): string {
  const status = row.phoiTakeStatus?.trim();
  return `Phơi: ${phoiStateOf(row)}${status ? ` · ${status}` : ''}`;
}

// SIL-763 (id 884) — Cảnh báo 4 ngày (KB Chương 6, bảng Kiểm soát phơi phiếu):
// một chuyến đã vận chuyển từ 4 ngày trở lên mà kế toán chưa tích "Đã nhận
// phơi" thì cột Ghi chú tự hiện chữ đỏ "Phơi chưa được nhận". Tích nhận phơi
// (lưu ngày lấy phơi ở hộp thoại chi tiết) xóa cảnh báo ngay qua invalidate.
export const PHOI_NOT_RECEIVED_AFTER_DAYS = 4;
export const PHOI_NOT_RECEIVED_LABEL = 'Phơi chưa được nhận';

/** SIL-783 (id 906) — the overdue AGE in calendar days (transport day →
 *  today), or null when the trip must not warn: POD ticked, unparsable day,
 *  or inside the 3-day window. The warning text prints this number, so
 *  "(Quá hạn 6 ngày)" always names the real gap. */
export function phoiNotReceivedOverdueDays(
  row: Pick<PhoiPhieuRow, 'transportDate' | 'phoiTakenDate'>,
  today = businessDateISO(),
): number | null {
  if (!row.transportDate || row.phoiTakenDate) return null;
  const transportMs = Date.parse(`${row.transportDate}T00:00:00Z`);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(transportMs) || Number.isNaN(todayMs)) return null;
  const days = Math.floor((todayMs - transportMs) / 86_400_000);
  return days >= PHOI_NOT_RECEIVED_AFTER_DAYS ? days : null;
}

/** VN calendar-day gap between the transport day and today, ≥ 4 days, and no
 *  POD date ticked. `today` injectable so the boundary is testable; an
 *  unparsable transport day never warns. */
export function phoiNotReceivedWarning(
  row: Pick<PhoiPhieuRow, 'transportDate' | 'phoiTakenDate'>,
  today = businessDateISO(),
): boolean {
  return phoiNotReceivedOverdueDays(row, today) !== null;
}

/** SIL-783 (id 906) — spec Task 3.3.1 text: "⚠️ Phơi chưa được nhận (Quá hạn
 *  X ngày)" with X = the overdue age; null when the trip must not warn. */
export function phoiNotReceivedMessage(
  row: Pick<PhoiPhieuRow, 'transportDate' | 'phoiTakenDate'>,
  today = businessDateISO(),
): string | null {
  const days = phoiNotReceivedOverdueDays(row, today);
  return days === null ? null : `⚠️ ${PHOI_NOT_RECEIVED_LABEL} (Quá hạn ${days} ngày)`;
}

/** Ticket 18/11 Task 3.1 — bộ lọc Ẩn/Hiện cột (card 20260928_193): the board's
 *  columns in table order; the picker offers exactly this list. The TWO identity
 *  columns (Bill/Booking + Khách hàng/Nhà máy/Tuyến) are pinned — a row outside
 *  its own context is unreadable. The composed Ghi chú carries the card's
 *  auto-hide rule (hidden by default only while every rendered cell is empty);
 *  the three separate note columns never auto-hide, so the red Phơi-chưa-được-
 *  nhận warning and the not-charged reason always have their slots. */
const PHOI_BOARD_COLUMNS: readonly LedgerColumn[] = [
  { key: 'lich-trinh', label: 'Số Bill / Booking', pinned: true },
  { key: 'customer-route', label: 'Khách hàng / Nhà máy / Tuyến', pinned: true },
  { key: 'thongso', label: 'Thông số container' },
  { key: 'diadiem', label: 'Địa điểm nâng / hạ' },
  { key: 'xe', label: 'Thông tin xe' },
  { key: 'hoadon', label: 'Chi phí phát sinh / Số HĐ' },
  { key: 'money', label: 'Tiền đường' },
  { key: 'status', label: 'Trạng thái' },
  { key: 'ghichu', label: 'Ghi chú', autoHideWhenEmpty: true },
  { key: 'date', label: 'Ngày hẹn' },
  { key: 'ghichu-vantai', label: 'Ghi chú vận tải' },
  { key: 'ghichu-ops', label: 'Ghi chú chi phí OPS' },
  { key: 'ghichu-lai-xe', label: 'Ghi chú lái xe' },
];

/* SIL-875 (CR-009.1 follow-up 21/11) — the board's chốt ladder floors, in
 * table order. The CSS col rules carry the matching % shares (each share =
 * floor ÷ the 13-column base 1132, so scale re-normalization sums ~100% for
 * ANY rendered subset) and these px floors; the table's inline style derives
 * BOTH from the RENDERED column set so hiding a column via the Ẩn/Hiện
 * picker relaxes the horizontal-scroll floor (--ppc-min) instead of
 * over-constraining `table-layout: fixed`, and --ppc-share-scale re-bases
 * the % shares onto that set. Measured at the live 12px board font with the
 * 6px dense gutter: identity token 88px (12ch bill), container token 84px
 * content (11ch — SIL-879: QA scrollWidth 92–96px incl. the gutter; the old
 * 65px 'TWCU2259939' reading was short, and the 78px floor let the number
 * bleed into Địa điểm), the 'Xem chi tiết' /
 * '+ Chi phí' buttons 90–91px, plate pill 60px. SIL-879 pays the wider
 * container floor from the wrap-only donors (status 84→78, the four Ghi chú
 * 74→70 — their longest words still fit), so the sum and the canvas law
 * hold. SIL-920: the 48px date reading was short — the live board renders
 * 'DD/MM/YYYY' at ≈74.3px content, and the 62px floor broke it mid-number
 * ('22/12/2' / '026', QA 24/11). Date floor 62→90, paid by the
 * anywhere-wrap donors status 78→64 and KH/Nhà máy/Tuyến 100→94 (both cells
 * carry the global `overflow-wrap: anywhere`, so the narrower track only
 * wraps text inside its own cell — never a bleed). The FULL thirteen-column
 * set (composed Ghi chú included) sums 1132px ≤ the 1144px sidebar-open
 * canvas (measured live on the local dev build at 1440×900) — the QA board
 * measured 2160px = the full set under table-layout: auto — so the default
 * view never scrolls and Tiền đường's 'Xem chi tiết' reaches the right edge
 * whole.
 * SIL-988 (QA tablet 25/11, /tmp/kb-tablet-768-sil.md §6.1): at 768px the
 * 104px hoadon floor left the Số-HĐ input a 78px client box that clipped
 * 'HD-QA1110-01' to 'HD-QA1110-(', and the 64px status floor wrapped
 * 'Đang chạy / Phơi: …' into a six-line cramped column. KB §6.1 — 'ô nhập
 * số hóa đơn hiện trọn vẹn, không bị cắt chữ' — outranks the comfort
 * floors: hoadon 104→120 (input client ≈94px ≥ the 89px token) and status
 * 64→96 ('Trạng thái' one line, the pair wraps ≤3 short lines per §6.1's
 * 'ba dòng ngắn'). Paid by the same anywhere-wrap donors — KH 94→88 · địa
 * điểm 84→78 · xe 96→90 · thông số 100→96 (= the SIL-879 container-token
 * minimum) · Ghi chú ×4 70→66 — so the full set sums 1142px and stays
 * under the 1144px canvas: no horizontal scroll at 1440. Change a floor
 * here AND its var in PhoiPhieuControlPage.css together (pinned by
 * PhoiPhieuControlPage.styles.test.ts). */
const PCC_COL_WIDTHS: Readonly<Record<string, number>> = {
  'lich-trinh': 116,
  'customer-route': 88,
  thongso: 96,
  diadiem: 78,
  xe: 90,
  hoadon: 120,
  money: 104,
  status: 96,
  date: 90,
  ghichu: 66,
  'ghichu-vantai': 66,
  'ghichu-ops': 66,
  'ghichu-lai-xe': 66,
};

/** SIL-875: the share base — every board column's floor sum (the
 *  thirteen-column full set). Every CSS share = its floor ÷ this sum, and
 *  scale = this ÷ the rendered floor sum, so the declared widths of ANY
 *  rendered subset re-normalize to ~100% and can never phantom-scroll.
 *  Computed from the map so the two can never drift. */
const PCC_SPEC_BASE_SUM = ([
  'lich-trinh', 'customer-route', 'thongso', 'diadiem', 'xe', 'hoadon',
  'money', 'status', 'date', 'ghichu', 'ghichu-vantai', 'ghichu-ops',
  'ghichu-lai-xe',
] as const).reduce((sum, key) => sum + PCC_COL_WIDTHS[key], 0);

interface Filters {
  dateFrom: string; dateTo: string; status: string; search: string; sortBy: 'grouped' | 'date';
  confirmation: ChiHoConfirmation | '';
}

export default function PhoiPhieuControlPage() {
  const phone = useMediaQuery('(max-width: 640px)');
  const [filters, setFilters] = useState<Filters>({ dateFrom: '', dateTo: '', status: '', search: '', sortBy: 'grouped', confirmation: '' });
  const [direction, setDirection] = useState<'IN' | 'OUT'>('OUT');
  const [treasuryAccountId, setTreasuryAccountId] = useState('');
  // SIL-1085 (K2.71) — the confirm step: the board's voucher action opens a
  // preview that names every khoản the phiếu will carry AND every khoản it
  // leaves out (with the reason), before a single đồng moves.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [chiHoTripId, setChiHoTripId] = useState<number | null>(null);
  // Card 20260923_11: the board owns two detail surfaces — exactly one may be
  // open at a time, so each trigger clears the other's state.
  const [tienDuongTripId, setTienDuongTripId] = useState<number | null>(null);
  // SIL-783 (id 906) — "+ Chi phí" straight on the board: the trip whose
  // expense drawer is open. Kế toán khai chi phí phát sinh mà không cần mở
  // chi tiết chi hộ, kể cả khi chưa nhận phơi.
  const [addExpenseTripId, setAddExpenseTripId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  // Same lazy catalog the chi-hộ dialog's ＋Thêm dòng panel loads — the
  // drawer only mounts once the catalog has arrived.
  const catalogQuery = useQuery({
    queryKey: qk.expenseAccounting.catalog,
    queryFn: expenseAccountingClient.catalog,
    enabled: addExpenseTripId !== null,
  });

  const rowsQuery = useQuery({
    queryKey: qk.phoiPhieu.rows(filters),
    queryFn: () => listPhoiPhieuRows(filters),
  });
  const stkQuery = useQuery({ queryKey: qk.phoiPhieu.stk, queryFn: () => listPhoiPhieuStk() });
  const rows = useMemo(() => rowsQuery.data?.items ?? [], [rowsQuery.data]);
  // SIL-974 (K10.54 §10.8.6) — mục "Ngoài chốt" chỉ đọc dưới bảng, cùng cửa
  // sổ ngày/trạng thái với các dòng; ẩn khi mảng rỗng.
  const unattachedTrips = useMemo(() => rowsQuery.data?.unattachedTrips ?? [], [rowsQuery.data]);
  /** FB-097 — nhà xe chạy chuyến cho form "Thêm khoản chi": NCC khớp theo id,
   *  dự phòng theo tên; không có nhà xe ngoài thì form để chọn tay. */
  const carrierOf = (tripId: number | null) => {
    const row = rows.find((item) => item.tripId === tripId);
    return row ? { supplierId: row.carrierSupplierId ?? null, name: row.carrierName ?? null } : undefined;
  };
  // SIL-783 (id 906) — the board row the "+ Chi phí" drawer targets; null
  // once the rows window no longer lists it (filters narrowed mid-open).
  const addExpenseRow = addExpenseTripId !== null
    ? rows.find((row) => row.tripId === addExpenseTripId) ?? null
    : null;
  // The column mini-filters narrow the ALREADY-grouped server window here in
  // the page — the fetch, its window and the grouped order stay the server's;
  // this is a plain match over each column's own text, so a filter can never
  // re-sort what the server grouped.
  const [columnFilters, setColumnFilters] = useState<{ customer: string; vehicle: string }>({ customer: '', vehicle: '' });
  const [onlyPendingRoad, setOnlyPendingRoad] = useState(false);
  const pendingRoadRowCount = useMemo(
    () => rows.filter((row) => (row.pendingTienDuongCount ?? 0) > 0).length,
    [rows],
  );
  const visibleRows = useMemo(() => {
    const customerNeedle = foldQuery(columnFilters.customer);
    const vehicleNeedle = foldQuery(columnFilters.vehicle);
    if (!customerNeedle && !vehicleNeedle && !onlyPendingRoad) return rows;
    return rows.filter((row) => {
      if (onlyPendingRoad && (row.pendingTienDuongCount ?? 0) <= 0) return false;
      const customerHaystack = foldQuery([row.customerName, row.factoryName, row.routeName].filter(Boolean).join(' '));
      const vehicleHaystack = foldQuery([row.plateNumber, row.carrierName, row.driverName].filter(Boolean).join(' '));
      return (!customerNeedle || customerHaystack.includes(customerNeedle))
        && (!vehicleNeedle || vehicleHaystack.includes(vehicleNeedle));
    });
  }, [rows, columnFilters, onlyPendingRoad]);
  // Ticket 18/11 Task 3.1 — Ẩn/Hiện cột tùy ý (card 20260928_193): the shared
  // mechanism, storage-keyed per workstation; an explicit choice always wins
  // over the auto-hide default. The composed Ghi chú only ever auto-hides
  // while no rendered row carries one.
  const boardColumns = useHiddenColumns({
    storageKey: 'phoi-phieu-hidden-cols',
    columns: PHOI_BOARD_COLUMNS,
    hasData: (column) => column.key !== 'ghichu'
      || visibleRows.some((row) => Boolean((row.ghiChu ?? '').trim())),
  });
  // SIL-875 (CR-009.1 follow-up) — the chốt ladder rides the RENDERED set:
  // --ppc-min is the rendered floor sum (the wrapper's horizontal-scroll
  // floor — at the 1440px sidebar-open canvas ≈1129px the default twelve
  // (1054px) do NOT scroll, the ticket's AC) and --ppc-share-scale re-bases
  // the CSS % shares onto that set, so a column hidden through the
  // Ẩn/Hiện picker (or the composed Ghi chú appearing) keeps the rendered
  // columns summing to ~100% — above 100% the fixed layout widens the table
  // past its container and phantom-scrolls at every width.
  const renderedColKeys = [
    'lich-trinh', 'customer-route',
    ...(!boardColumns.isHidden('thongso') ? ['thongso'] : []),
    ...(!boardColumns.isHidden('diadiem') ? ['diadiem'] : []),
    'xe',
    ...(!boardColumns.isHidden('hoadon') ? ['hoadon'] : []),
    ...(!boardColumns.isHidden('money') ? ['money'] : []),
    ...(!boardColumns.isHidden('status') ? ['status'] : []),
    ...(!boardColumns.isHidden('ghichu') ? ['ghichu'] : []),
    ...(!boardColumns.isHidden('date') ? ['date'] : []),
    ...(!boardColumns.isHidden('ghichu-vantai') ? ['ghichu-vantai'] : []),
    ...(!boardColumns.isHidden('ghichu-ops') ? ['ghichu-ops'] : []),
    ...(!boardColumns.isHidden('ghichu-lai-xe') ? ['ghichu-lai-xe'] : []),
  ] as string[];
  const tableMinWidth = renderedColKeys.reduce((sum, key) => sum + (PCC_COL_WIDTHS[key] ?? 0), 0);
  const ppcShareScale = (PCC_SPEC_BASE_SUM / tableMinWidth).toFixed(5);
  // The three Ghi chú columns share one col class (one width law).
  const ppcColClass = (key: string) => key.startsWith('ghichu') ? 'ppc-col--ghichu' : `ppc-col--${key}`;
  const canSelect = (row: PhoiPhieuRow) => row.confirmable;
  // Card 20260929_207: the checkbox column is gone app-wide — a row is picked by
  // clicking it (keyboard: focus the row, press Space). `selectable` still
  // decides WHICH rows may be picked, so a row that cannot be issued stays
  // inert instead of silently taking part in the voucher.
  const selection = useTableRowSelection<number>();
  const { clear: clearSelection } = selection;
  const selectableRows = useMemo(() => visibleRows.filter(canSelect), [visibleRows]);
  // SIL-1085 (K2.71) — memoized so the preview's own memo (the khoản the
  // phiếu will carry vs the ones it leaves out) keeps a stable input while
  // the accountant picks rows.
  const selectedIds = useMemo(
    () => (rowsQuery.isFetching || rowsQuery.isError ? [] : selection.selectedAmong(selectableRows.map((row) => row.tripId))),
    [rowsQuery.isFetching, rowsQuery.isError, selection, selectableRows],
  );
  const allSelected = selection.allOfSelected(selectableRows.map((row) => row.tripId));
  const selectedCount = selectedIds.length;
  // A narrowed column view must never keep picks it no longer shows — same
  // contract the strip's own criteria run on.
  useEffect(() => { clearSelection(); }, [filters.dateFrom, filters.dateTo, filters.status, filters.search, filters.confirmation, columnFilters, clearSelection]);
  // Card 20260929_207: the "select every row" affordance moved out of the
  // deleted header checkbox and into the toolbar, where its scope is stated in
  // the label: it covers the rows ON THIS PAGE, never the whole filtered set.
  function toggleAll() {
    if (allSelected) selection.clear();
    else selection.selectAll(selectableRows.map((row) => row.tripId));
  }

  /** The preview issued the phiếu — the board names it, drops the selection
   *  and refreshes the window (the drawer closes with the action). */
  async function onVoucherIssued(voucher: { code: string; entries: number; total: number }) {
    setPreviewOpen(false);
    setMessage({ kind: 'ok', text: `Đã lập phiếu ${voucher.code}: ${voucher.entries} khoản, tổng ${formatCurrency(voucher.total)} — sổ quỹ đã được điều chỉnh.` });
    selection.clear();
    await queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.rowsAll });
  }

  // The selected rows — the preview reads their chi-hộ khoản.
  const selectedRows = useMemo(
    () => selectedIds.flatMap((tripId) => {
      const row = rows.find((candidate) => candidate.tripId === tripId);
      return row ? [row] : [];
    }),
    [selectedIds, rows],
  );
  // SIL-1085 (K2.71) — the counter's meaning, spelled out beside the button:
  // how many of the selected khoản the phiếu carries, how many it leaves out,
  // and how many of those wait for their đối chiếu. Before this the board
  // said "Lập phiếu chi (5 khoản)" over eight chips and the three missing
  // khoản vanished in silence (KB OpsVanHanh §9.2 rule 1).
  const previewLines = useMemo(
    () => phoiPhieuVoucherPreviewLines(selectedRows, direction),
    [selectedRows, direction],
  );
  const carriedCount = previewLines.filter((line) => line.source.included).length;
  const excludedCount = previewLines.length - carriedCount;
  const unconfirmedCount = previewLines.filter((line) => line.source.reason === 'UNCONFIRMED').length;
  const voucherNote = selectedIds.length === 0
    ? ''
    : excludedCount === 0
      ? `${carriedCount} khoản chi hộ sẽ được lập phiếu`
      : `${carriedCount}/${previewLines.length} khoản chi hộ sẽ được lập phiếu · ${unconfirmedCount > 0
        ? `${unconfirmedCount} khoản chưa xác nhận sẽ bị bỏ qua`
        : `${excludedCount} khoản bị bỏ qua`}`;

  // Secondary criteria share the existing filter trigger and reset action.
  const secondaryCount = (filters.status ? 1 : 0) + (filters.sortBy !== 'grouped' ? 1 : 0)
    + (direction !== 'OUT' ? 1 : 0) + (treasuryAccountId ? 1 : 0) + (filters.confirmation ? 1 : 0);
  const resetSecondary = () => {
    setFilters((current) => ({ ...current, status: '', sortBy: 'grouped', confirmation: '' }));
    setDirection('OUT');
    setTreasuryAccountId('');
  };
  const voucherLabel = selectedIds.length === 0
    ? `Lập phiếu ${direction === 'IN' ? 'thu' : 'chi'}`
    : `Lập phiếu ${direction === 'IN' ? 'thu' : 'chi'} (${selectedIds.reduce((sum, tripId) => {
        const row = rows.find((candidate) => candidate.tripId === tripId);
        return sum + (row ? (direction === 'IN' ? row.eligibleIn : row.eligibleOut) : 0);
      }, 0)} khoản)`;

  return (
    <div className="page-shell">
      <PageHeader title="Kiểm soát phơi phiếu" />
      {/* Card 20260927_152: the ONE shared strip. The search, the from/to pair
          and the Lập phiếu action are the bar's own items; the four secondary
          criteria render inline while the strip still fits two rows and fold
          into `Bộ lọc (N)` only when the width leaves no other choice. The page
          declares no filter layout — that is the bar's job (filter-bar law). */}
      <FilterBar
        columns={{
          items: PHOI_BOARD_COLUMNS,
          hidden: boardColumns.hidden,
          customized: boardColumns.customized,
          onToggle: boardColumns.toggle,
          onReset: boardColumns.reset,
        }}
        search={{
          value: filters.search,
          onChange: (search) => setFilters((current) => ({ ...current, search })),
          placeholder: 'Bill/Booking, phí, hóa đơn',
          ariaLabel: 'Tìm kiếm',
        }}
        actions={(
          <div className="ppc-actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={toggleAll}
              disabled={selectableRows.length === 0}
              title={allSelected ? 'Bỏ chọn các dòng kết quả' : `Chọn ${selectableRows.length} dòng trong kết quả`}
            >
              {allSelected ? (phone ? 'Bỏ chọn tất cả' : 'Bỏ chọn dòng trang này') : `${phone ? 'Chọn tất cả' : 'Chọn cả trang này'} (${selectableRows.length})`}
            </button>
            {/* SIL-1085 (K2.71) — the action and its meaning travel together:
                the counter says how many khoản the phiếu will carry, the line
                under it says how many of the selected khoản are left out (and
                how many of those wait for their đối chiếu), and the click opens
                the preview that NAMES each of them. */}
            <div className="ppc-voucher-action">
              <button
                type="button"
                className="btn btn--primary"
                disabled={selectedIds.length === 0}
                title={selectedIds.length === 0 ? 'Chọn ít nhất một dòng đã đối chiếu để lập phiếu' : `${voucherNote} — bấm để xem trước khoản nào được lập phiếu`}
                onClick={() => setPreviewOpen(true)}
              >
                {voucherLabel}
              </button>
              {voucherNote && <p className="ppc-voucher-note">{voucherNote}</p>}
            </div>
          </div>
        )}
      >
        <DateRangeFields
          id="phoi-phieu-date-range"
          ariaLabel="Khoảng ngày hẹn"
          from={filters.dateFrom}
          to={filters.dateTo}
          onChange={({ from, to }) => setFilters((current) => ({ ...current, dateFrom: from, dateTo: to }))}
        />
        <button
          type="button"
          className={onlyPendingRoad ? 'btn btn--primary btn--sm' : 'btn btn--secondary btn--sm'}
          aria-pressed={onlyPendingRoad}
          onClick={() => setOnlyPendingRoad((current) => !current)}
        >
          Có chi phí chờ duyệt{pendingRoadRowCount > 0 ? ` (${pendingRoadRowCount})` : ''}
        </button>
        <FilterDropdown count={secondaryCount} ariaLabel="Bộ lọc" dialogLabel="Bộ lọc phơi phiếu" onReset={resetSecondary}>
          <UuiSelectField label="Trạng thái" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} options={TRIP_STATUS_OPTIONS} />
          <UuiSelectField label="Đối chiếu chi hộ" value={filters.confirmation} onChange={(event) => setFilters({ ...filters, confirmation: event.target.value as Filters['confirmation'] })}
            options={[{ value: '', label: 'Tất cả' }, { value: 'CONFIRMED', label: 'Đã đối chiếu' }, { value: 'UNCONFIRMED', label: 'Chưa đối chiếu' }]} />
          <UuiSelectField label="Sắp xếp" value={filters.sortBy} onChange={(e) => setFilters({ ...filters, sortBy: e.target.value as 'grouped' | 'date' })} options={[{ value: 'grouped', label: 'Gom theo số xe' }, { value: 'date', label: 'Theo ngày' }]} />
          <UuiSelectField label="Loại phiếu" value={direction} onChange={(e) => setDirection(e.target.value as 'IN' | 'OUT')}
            options={[{ value: 'OUT', label: 'Phiếu chi' }, { value: 'IN', label: 'Phiếu thu' }]} />
          <UuiSelectField label="Số tài khoản quỹ (STK)" value={treasuryAccountId} onChange={(e) => setTreasuryAccountId(e.target.value)}
            options={[{ value: '', label: '— Chọn STK —' }, ...(stkQuery.data?.items ?? []).map((account) => ({ value: String(account.id), label: account.code + ' - ' + account.name }))]} />
        </FilterDropdown>
      </FilterBar>

      {message && <p role="status" style={{ color: message.kind === 'ok' ? 'var(--ok, #16a34a)' : 'var(--err, #dc2626)' }}>{message.text}</p>}
      {rowsQuery.isError && <p role="alert">Không tải được bảng kiểm soát. Vui lòng thử lại.</p>}

      {/* Card 20260929_207: the selection model is no longer a checkbox column, so
          the board says so once, and keeps a live count. A row that cannot be
          issued is dimmed and inert rather than looking pickable. */}
      <p className="ppc-selection-hint" role="status">
        {selectedCount === 0
          ? `${phone ? 'Dùng ô Chọn của bản ghi' : 'Bấm vào một dòng để chọn'} · ${selectableRows.length} dòng lập được phiếu trong kết quả`
          : `Đã chọn ${selectedCount} dòng`}
      </p>
      {rows.length > 0 && visibleRows.length === 0 && (
        <p className="ppc-selection-hint" role="status">
          Không có dòng nào khớp bộ lọc cột.{' '}
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setColumnFilters({ customer: '', vehicle: '' })}>
            Bỏ lọc cột
          </button>
        </p>
      )}
      <LedgerRecordList rows={visibleRows.map((row): LedgerRecord => ({
        key: row.tripId, title: billBookingReference(row.billOrBooking),
        subtitle: row.customerName ?? 'Chưa có khách hàng',
        selected: selection.isSelected(row.tripId), selectable: canSelect(row),
        onSelect: () => selection.toggle(row.tripId),
        facts: [
          { key: 'factory', label: 'Nhà máy', value: row.factoryName ?? 'Chưa có nhà máy', primary: true },
          { key: 'route', label: 'Tuyến', value: row.routeName ?? 'Chưa có tuyến', primary: true },
          { key: 'container', label: 'Container', value: <>{row.containerNumber ?? '—'} · {row.containerTypeLabel ?? '—'}{row.containerPayloadKg != null ? <> · {formatWeight(row.containerPayloadKg)}</> : null}</>, primary: true },
          { key: 'date', label: 'Ngày hẹn', value: formatDate(row.transportDate ?? null, { empty: 'Chưa có ngày hẹn' }), primary: true },
          { key: 'phoiDate', label: 'Ngày nhận phơi', value: row.phoiTakenDate ? formatDate(row.phoiTakenDate, { empty: '—' }) : '—' },
          { key: 'status', label: 'Trạng thái', value: row.tripStatus ? STATUS_LABELS[row.tripStatus] ?? row.tripStatus : '—', primary: true },
          { key: 'phoiState', label: 'Nhận phơi', value: phoiStateOf(row) },
          { key: 'chiHoThu', label: 'Chi hộ phải thu', value: money(row.chiHoThu), primary: true },
          { key: 'chiHoTra', label: 'Chi hộ phải trả', value: row.chiHoTripTra != null || row.chiHoTripThu != null
            ? <>{money(row.chiHoTra)}<div className="row-meta">Công ty: {money(row.chiHoTripTra)} / thu {money(row.chiHoTripThu)}</div></>
            : money(row.chiHoTra), primary: true },
          { key: 'road', label: 'Tiền đường', value: (row.pendingTienDuongCount ?? 0) > 0
            ? <>{money(row.tienDuong)}<div className="ppc-pending">Chờ duyệt: {formatMoney(row.pendingTienDuongAmount ?? 0)} đ ({row.pendingTienDuongCount})</div></>
            : money(row.tienDuong), primary: true },
          // SIL-783 (id 906) — the same invoice lines the desktop board edits,
          // read-only here; the edit surface is the desktop table input.
          // SIL-1085 (K2.71) — the unconfirmed khoản carries the SAME label
          // the desktop chip wears, so the phone view cannot read a khoản the
          // phiếu will skip as a confirmed one.
          { key: 'invoices', label: 'Chi phí / Số HĐ', value: (row.chiHoRows ?? []).length
            ? (row.chiHoRows ?? []).map((chiHoRow) => (
              <div key={chiHoRow.entryId} className="row-meta">
                {`${phoiChiHoFeeLabel(chiHoRow)}: ${chiHoRow.invoiceNumber ?? '—'}`}
                {!chiHoRow.confirmed && <span className="ppc-invoice-flag">Chưa xác nhận</span>}
              </div>
            ))
            : '—' },
          // Ticket 18/11 Task 3.1 — trọng tải merged into the container fact;
          // the 'Trọng tải container' prefixed fact is gone with it.
          { key: 'weight', label: 'Trọng lượng hàng', value: row.cargoWeightKg != null ? formatWeight(row.cargoWeightKg) : 'Chưa có' },
          { key: 'sites', label: 'Địa điểm nâng / hạ', value: <>{row.liftSite ?? '—'} → {row.dropSite ?? '—'}</> },
          { key: 'truck', label: 'Biển số xe', value: row.plateNumber ?? '—' },
          { key: 'carrier', label: 'Nhà vận tải', value: row.carrierName ?? 'Chưa xác định nhà vận tải' },
          { key: 'driver', label: 'Lái xe', value: row.driverName ?? 'Chưa có lái xe' },
          // Ticket 18/11 Task 3.1 — the composed Ghi chú fact mirrors the new
          // desktop column (CUS trước, điều vận sau).
          { key: 'ghiChu', label: 'Ghi chú', value: row.ghiChu ?? '—' },
          { key: 'cusNotes', label: 'Ghi chú vận tải', value: phoiNotReceivedMessage(row)
            ? <><span className="ppc-phoi-overdue">{phoiNotReceivedMessage(row)}</span>{row.cusDispatchNotes.length ? <div className="row-meta">{row.cusDispatchNotes.join('; ')}</div> : null}</>
            : (row.cusDispatchNotes.length ? row.cusDispatchNotes.join('; ') : '—') },
          { key: 'opsNotes', label: 'Ghi chú chi phí OPS', value: row.opsRecoveryNotes?.length ? <OpsExpenseNoteLines notes={row.opsRecoveryNotes} /> : '—' },
          { key: 'driverNotes', label: 'Ghi chú lái xe', value: row.driverNote ?? '—' },
          { key: 'chiHoAction', label: 'Chi hộ', value: <button type="button" className="btn btn--secondary" aria-label={`Chi tiết chi hộ ${billBookingReference(row.billOrBooking)}`} onClick={() => { setTienDuongTripId(null); setChiHoTripId(row.tripId); }}>Chi tiết chi hộ</button> },
          { key: 'roadAction', label: 'Tiền đường', value: <button type="button" className="btn btn--secondary" onClick={() => { setChiHoTripId(null); setTienDuongTripId(row.tripId); }}>Xem chi tiết</button> },
          // SIL-783 (id 906) — khai chi phí phát sinh ngay từ bảng, không cần
          // mở chi tiết chi hộ.
          { key: 'addExpenseAction', label: 'Thêm chi phí', value: <button type="button" className="btn btn--secondary" aria-label={`Thêm chi phí phát sinh ${billBookingReference(row.billOrBooking)}`} onClick={() => { setChiHoTripId(null); setTienDuongTripId(null); setAddExpenseTripId(row.tripId); }}>+ Chi phí</button> },
        ],
      }))} />
      <div className="ppc-board-wrap ledger-desktop" role="region" aria-label="Bảng kiểm soát phơi phiếu" tabIndex={0}>
        <table className="tt-table ops-table ppc-board" style={{ '--ppc-min': `${tableMinWidth}px`, '--ppc-share-scale': ppcShareScale } as CSSProperties}>
          <caption className="sr-only">Phơi phiếu và tiền đường theo chuyến</caption>
          {/* SIL-875 — the colgroup carries the ladder: Chromium honors
              min-width on <col> in table-layout: fixed (probe-verified,
              SIL-872), so each col pins its % share + px floor while the
              th/td classes keep their styling hooks. */}
          <colgroup>
            {renderedColKeys.map((key) => <col key={key} className={ppcColClass(key)} />)}
          </colgroup>
          <thead><tr>
            <th scope="col" className="ppc-col--lich-trinh">Số Bill / Booking</th>
            <th scope="col" className="ppc-col--customer-route">
              <ColumnMiniFilter
                label="Khách hàng / Nhà máy / Tuyến"
                value={columnFilters.customer}
                placeholder="Nhập khách hàng, nhà máy, tuyến"
                onApply={(value) => setColumnFilters((current) => ({ ...current, customer: value }))}
                onClear={() => setColumnFilters((current) => ({ ...current, customer: '' }))}
              />
            </th>
            {!boardColumns.isHidden('thongso') && <th scope="col" className="ppc-col--thongso">Thông số container</th>}
            {!boardColumns.isHidden('diadiem') && <th scope="col" className="ppc-col--diadiem">Địa điểm nâng / hạ</th>}
            <th scope="col" className="ppc-col--xe">
              <ColumnMiniFilter
                label="Thông tin xe"
                value={columnFilters.vehicle}
                placeholder="Nhập biển số xe / nhà xe / lái xe"
                onApply={(value) => setColumnFilters((current) => ({ ...current, vehicle: value }))}
                onClear={() => setColumnFilters((current) => ({ ...current, vehicle: '' }))}
              />
            </th>
            {/* SIL-783 (id 906) — inline Số-HĐ editing + thêm chi phí phát sinh ngay trên bảng, kể cả khi chưa nhận phơi.
                Ticket 18/11 Task 3.1d — the duplicate 'Chi hộ (thu / trả)' column is gone; its Chi-tiết-chi-hộ
                affordance moved into this cell beside '+ Chi phí'. */}
            {!boardColumns.isHidden('hoadon') && <th scope="col" className="ppc-col--hoadon" title="Số hóa đơn từng khoản chi hộ — sửa trực tiếp, và nút thêm chi phí phát sinh">Chi phí phát sinh / Số HĐ</th>}
            {!boardColumns.isHidden('money') && <th scope="col" className="ppc-col--money">Tiền đường</th>}
            {!boardColumns.isHidden('status') && <th scope="col" className="ppc-col--status">Trạng thái</th>}
            {/* Ticket 18/11 Task 3.1e — cột GHI CHÚ đứng ngay sau TRẠNG THÁI: the composed
                note (CUS customerNotes trước, điều vận operationalNotes sau). The three
                separate note columns keep their own cells at the end of the row. */}
            {!boardColumns.isHidden('ghichu') && <th scope="col" className="ppc-col--ghichu" title="Ghi chú composed của lô — CUS và điều vận">Ghi chú</th>}
            {!boardColumns.isHidden('date') && <th scope="col" className="ppc-col--date">Ngày hẹn</th>}
            {!boardColumns.isHidden('ghichu-vantai') && <th scope="col" className="ppc-col--ghichu" title="Ghi chú vận tải của CUS và điều vận">Ghi chú vận tải</th>}
            {/* Card 20260928_162 — the second ruled surface for the not-charged
                reason. Same content as the dispatch plan grids, through the same
                shared component; reason text only, never an amount. */}
            {!boardColumns.isHidden('ghichu-ops') && <th scope="col" className="ppc-col--ghichu-ops" title="Lý do khoản không thu khách và ghi chú thu khách của lô — chỉ nội dung lý do, không kèm số tiền">Ghi chú chi phí OPS</th>}
            {!boardColumns.isHidden('ghichu-lai-xe') && <th scope="col" className="ppc-col--ghichu">Ghi chú lái xe</th>}
          </tr></thead>
          <tbody>
            {visibleRows.map((row) => {
              const pickable = canSelect(row);
              const isSelected = selection.isSelected(row.tripId);
              return (
              <tr
                key={row.tripId}
                data-selected={isSelected || undefined}
                aria-selected={pickable ? isSelected : undefined}
                className={pickable ? 'ppc-row--pickable' : 'ppc-row--locked'}
                tabIndex={pickable ? 0 : undefined}
                {...selection.rowProps(row.tripId, { selectable: pickable })}
              >
                <td className="ppc-col--lich-trinh">
                  {/* SIL-875 — the identifier token keeps the nowrap identity
                      law inside the 116px floor (the widest live bill fits);
                      the null fallback is NOT an identifier — as a plain text
                      node it wraps at spaces instead of painting over the
                      neighbor column. */}
                  {row.billOrBooking
                    ? <span className="ppc-identity">{billBookingReference(row.billOrBooking)}</span>
                    : 'Chưa có số Bill/Booking'}
                </td>
                {/* Ticket 18/11 Task 3.1c — col 2 prints the three VALUES only
                    (Long Minh / Askey / KCN Quế Võ, Bắc Ninh); the long
                    'Khách hàng:' / 'Nhà máy:' / 'Tuyến:' prefixes are gone. */}
                <td className="ppc-col--customer-route">{row.customerName ?? 'Chưa có khách hàng'}<br /><small>{row.factoryName ?? 'Chưa có nhà máy'}</small><br /><small>{row.routeName ?? 'Chưa có tuyến'}</small></td>
                {!boardColumns.isHidden('thongso') && (
                <td className="ppc-col--thongso">
                  {/* Ticket 18/11 Task 3.1c — col 3 is THREE lines: Số cont /
                      loại cont / trọng tải (CSNU1122338 / 20'DC / 20 tấn);
                      the 'Trọng tải container:' prefix line and the cargo-weight
                      line leave the cell (cargo weight stays a mobile fact).
                      KB §7.2.1 (CUS-08): trọng lượng hiển thị theo TẤN trên
                      mọi màn — formatWeight là hàm dùng chung. */}
                  <span className="ppc-identity">{row.containerNumber ?? '—'}</span>
                  <br /><small>{row.containerTypeLabel ?? '—'}</small>
                  <br /><small>{formatWeight(row.containerPayloadKg)}</small>
                </td>
                )}
                {!boardColumns.isHidden('diadiem') && <td className="ppc-col--diadiem">{row.liftSite ?? '—'} → {row.dropSite ?? '—'}</td>}
                <td className="ppc-col--xe"><span className="ppc-identity">{row.plateNumber ?? '—'}</span><br /><small>Nhà vận tải: {row.carrierName ?? 'Chưa xác định nhà vận tải'}</small><br /><small>Lái xe: {row.driverName ?? 'Chưa có lái xe'}</small></td>
                {/* Ticket 18/11 Task 3.1d — the duplicate 'Chi hộ (thu / trả)' cell is gone;
                    its Chi-tiết-chi-hộ affordance lives in the Số-HĐ cell beside '+ Chi phí'. */}
                {!boardColumns.isHidden('hoadon') && (
                <td className="ppc-col--hoadon">
                  {(row.chiHoRows ?? []).length === 0 && <span className="ppc-line">—</span>}
                  {(row.chiHoRows ?? []).map((chiHoRow) => (
                    <PhoiPhieuInvoiceCell
                      key={chiHoRow.entryId}
                      tripId={row.tripId}
                      chiHoRow={chiHoRow}
                      ariaLabel={`Số hóa đơn ${phoiChiHoFeeLabel(chiHoRow)} ${billBookingReference(row.billOrBooking)}`}
                    />
                  ))}
                  <span className="ppc-cell-actions">
                    <button type="button" className="btn btn--secondary btn--icon" aria-label={`Chi tiết chi hộ ${billBookingReference(row.billOrBooking)}`} title="Chi tiết chi hộ" onClick={() => { setTienDuongTripId(null); setChiHoTripId(row.tripId); }}><ReceiptText size={14} aria-hidden="true" /></button>
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      aria-label={`Thêm chi phí phát sinh ${billBookingReference(row.billOrBooking)}`}
                      onClick={() => { setChiHoTripId(null); setTienDuongTripId(null); setAddExpenseTripId(row.tripId); }}
                    >
                      + Chi phí
                    </button>
                  </span>
                </td>
                )}
                {!boardColumns.isHidden('money') && (
                <td className="ppc-col--money">
                  <span className="ppc-line"><span className="ppc-value">{money(row.tienDuong)}</span></span>
                  {(row.pendingTienDuongCount ?? 0) > 0 && (
                    <span className="ppc-line ppc-pending">
                      Chờ duyệt: {formatMoney(row.pendingTienDuongAmount ?? 0)} đ ({row.pendingTienDuongCount})
                    </span>
                  )}
                  <button type="button" className="btn btn--secondary" onClick={() => { setChiHoTripId(null); setTienDuongTripId(row.tripId); }}>Xem chi tiết</button>
                </td>
                )}
                {!boardColumns.isHidden('status') && (
                <td className="ppc-col--status">
                  <span className="ppc-line">{row.tripStatus ? STATUS_LABELS[row.tripStatus] ?? row.tripStatus : '—'}</span>
                  <small className="ppc-line">{phoiStatusLine(row)}</small>
                </td>
                )}
                {/* Ticket 18/11 Task 3.1e — GHI CHÚ ngay sau TRẠNG THÁI: the composed
                    note of the lot (CUS trước, điều vận sau) — '—' when the lot has none. */}
                {!boardColumns.isHidden('ghichu') && <td className="ppc-col--ghichu">{row.ghiChu ?? '—'}</td>}
                {!boardColumns.isHidden('date') && (
                <td className="ppc-col--date">
                  <span className="ppc-line">{formatDate(row.transportDate ?? null, { empty: 'Chưa có ngày hẹn' })}</span>
                  {row.phoiTakenDate && (
                    <small className="ppc-line">Nhận phơi: {formatDate(row.phoiTakenDate, { empty: '—' })}</small>
                  )}
                </td>
                )}
                {!boardColumns.isHidden('ghichu-vantai') && (
                <td className="ppc-col--ghichu">
                  {phoiNotReceivedMessage(row) && (
                    <span className="ppc-phoi-overdue">{phoiNotReceivedMessage(row)}</span>
                  )}
                  {row.cusDispatchNotes.length ? row.cusDispatchNotes.join('; ') : '—'}
                </td>
                )}
                {!boardColumns.isHidden('ghichu-ops') && <td className="ppc-col--ghichu-ops">{row.opsRecoveryNotes?.length ? <OpsExpenseNoteLines notes={row.opsRecoveryNotes} /> : '—'}</td>}
                {!boardColumns.isHidden('ghichu-lai-xe') && <td className="ppc-col--ghichu">{row.driverNote ?? '—'}</td>}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="ppc-board-hint ledger-desktop">Vuốt ngang để xem đầy đủ các cột.</p>
      {unattachedTrips.length > 0 && (
        <section className="ppc-unattached" aria-label="Ngoài chốt">
          <h2 className="ppc-unattached__title">Ngoài chốt</h2>
          <UnattachedTripsTable trips={unattachedTrips} />
        </section>
      )}
      {tienDuongTripId != null && (
        <PhoiPhieuTienDuongDialog
          tripId={tienDuongTripId}
          shipmentId={rows.find((row) => row.tripId === tienDuongTripId)!.shipmentId}
          billOrBooking={rows.find((row) => row.tripId === tienDuongTripId)?.billOrBooking}
          carrier={carrierOf(tienDuongTripId)}
          onClose={() => setTienDuongTripId(null)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.rowsAll })}
        />
      )}
      <PhoiPhieuReportSection />
      <PhoiPhieuTruckAssignments />
      {/* SIL-1085 (K2.71) — the confirm step between the selection and the
          phiếu: it lists the khoản the phiếu will carry and every khoản it
          leaves out WITH the reason (chưa xác nhận first), so nothing is
          dropped in silence (KB OpsVanHanh §9.2 rule 1). The STK picker rides
          the same state as the strip's own field. */}
      {previewOpen && (
        <PhoiPhieuVoucherPreviewDrawer
          direction={direction}
          rows={selectedRows}
          treasuryAccountId={treasuryAccountId}
          stkAccounts={stkQuery.data?.items ?? []}
          onTreasuryAccountChange={setTreasuryAccountId}
          onClose={() => setPreviewOpen(false)}
          onIssued={(voucher) => void onVoucherIssued(voucher)}
        />
      )}
      {chiHoTripId != null && (
        <PhoiPhieuChiHoDialog
          tripId={chiHoTripId}
          shipmentId={rows.find((row) => row.tripId === chiHoTripId)!.shipmentId}
          billOrBooking={rows.find((row) => row.tripId === chiHoTripId)?.billOrBooking}
          carrier={carrierOf(chiHoTripId)}
          confirmation={filters.confirmation || undefined}
          onClose={() => setChiHoTripId(null)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.rowsAll })}
        />
      )}
      {/* SIL-783 (id 906) — the same ExpenseCreateDrawer the chi-hộ dialog's
          ＋Thêm dòng panel mounts, opened straight from the board row. The
          drawer only renders once the catalog query has its data, and a saved
          expense invalidates the whole rows family so the new khoản lands in
          the board's chi-hộ totals and its Số-HĐ editor list. */}
      {addExpenseTripId != null && catalogQuery.isPending && <p role="status">Đang tải loại phí và nhân viên…</p>}
      {addExpenseTripId != null && catalogQuery.isError && (
        <p role="alert">
          {catalogQuery.error.message}{' '}
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void catalogQuery.refetch()}>Thử lại</button>{' '}
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setAddExpenseTripId(null)}>Hủy</button>
        </p>
      )}
      {addExpenseTripId != null && catalogQuery.data && addExpenseRow && (
        <ExpenseCreateDrawer
          work={{ tripId: addExpenseRow.tripId, shipmentId: addExpenseRow.shipmentId, shipmentCode: billBookingReference(addExpenseRow.billOrBooking), containerNumber: null }}
          catalog={catalogQuery.data}
          /* Card 191026160000: manual entry carries ONLY the two DRIVER tabs —
             the drawer rejects any other initialGroup, so none is passed here. */
          entryScope="OPS"
          carrier={carrierOf(addExpenseRow.tripId)}
          onClose={() => setAddExpenseTripId(null)}
          onSaved={() => { void queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.rowsAll }); }}
        />
      )}
    </div>
  );
}
