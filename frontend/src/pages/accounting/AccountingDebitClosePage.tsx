import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OWN_FLEET_CARRIER_LABEL } from '@tingting/shared';
import {
  listAccountingDebitBoard,
  confirmRateAdjustments,
  withdrawRateAdjustments,
  listSettlementRounds,
  createSettlementRound,
  setDebitExternalCost,
  setDebitRateOverrides,
  reconcileAndHideDebitLots,
  DEBIT_SETTLEMENT_ROUNDS_KEY,
  type DebitRateField,
} from '../../api/accountingDebitClient';
import { updateLclTruck } from '../../api/dispatchPlanningClient';
import { tripClient } from '../../api/tripClient';
import { businessDateISO, formatCurrency, formatISODate } from '../../lib/format';
import { billBookingReference } from '../../lib/business-reference';
import { qk } from '../../api/keys';
import { PageHeader } from '../../components/UI';
import { FilterDropdown } from '../../components/FilterDropdown';
import { DateRangeFields, EmptyState, FilterBar, Pagination, SearchableMultiSelect, SummaryRail } from '../../design-system';
import { useTableRowSelection } from '../../hooks/useTableRowSelection';
import { SkeletonTable } from '../../components/shared/Skeleton';
import { DebitSettlementRoundDialog } from './DebitSettlementRoundDialog';
import { useReasonPrompt } from '../../components/reason-prompt';
import { BillingPlateEditor } from './AccountingDebitClosePage.billing-plate';
import { UnmergeRevGroupAction } from '../../features/shipments/debit/UnmergeRevGroupAction';
import { BOARD_CAPTION, BOARD_COLUMNS, type CellContext } from './AccountingDebitClosePage.columns';
import { DebitBoardTable } from './AccountingDebitClosePage.board';
import { DebitRoundBoard } from './AccountingDebitClosePage.rounds';
import { AccountingDebitRecords } from './AccountingDebitRecords';
import '../../features/dispatch/LclSelectCheckbox.css';
import './AccountingDebitClosePage.css';

/**
 * Kế toán chốt debit — the screen, over the board card 20260921_21 defines.
 * Redesigned 2026-09-29 (rationale + measurements: `docs/design-guidelines.md`,
 * "One page heading…" → "Filter plane and primitives"). The column model is
 * `AccountingDebitClosePage.columns.tsx`; the settlement rounds are
 * `AccountingDebitClosePage.rounds.tsx` — the two real seams, split for the
 * structure guard's 400-line ceiling.
 */

interface BoardFilters { dateFrom: string; dateTo: string }

// Card 191026160000 (§2a): the board opens on the CURRENT MONTH, never the
// whole ledger. Unbounded, the shared dev DB serves 8864 rows — "Chọn tất cả
// 8864 lô đủ điều kiện" then froze the tab outright (the QA repro). A month is
// the natural close window (the same period default the sổ quỹ and the báo
// cáo hoàn ứng open on), and the date fields remain free for any other range.
function defaultBoardFilters(): BoardFilters {
  const today = businessDateISO();
  return { dateFrom: `${today.slice(0, 7)}-01`, dateTo: today };
}

export default function AccountingDebitClosePage() {
  const [filters, setFilters] = useState<BoardFilters>(defaultBoardFilters);
  const [search, setSearch] = useState('');
  const [customerFilter, setCustomerFilter] = useState<string[]>([]);
  const [truckFilter, setTruckFilter] = useState<string[]>([]);
  // SIL-772 — 2 chế độ xem của bảng KIỂM SOÁT LÔ HÀNG: Vận tải Hàng Cont
  // (FCL) / Vận tải Hàng Lẻ (LCL). Wire rule: lcl != null ⇔ cargoMode 'LCL'
  // (accounting-debit-close.service) — một dòng chưa phân loại (null) ở lại
  // chế độ FCL để dữ liệu chốt debit cũ không bao giờ biến mất khỏi bảng.
  const [cargoView, setCargoView] = useState<'FCL' | 'LCL'>('FCL');
  // SIL-773 — danh sách tác nghiệp mặc định ẩn các dòng đã 'Lưu - Phê duyệt
  // từng dòng và ẩn'; bật công tắc này refetch với includeHidden để tra lịch sử.
  const [showHidden, setShowHidden] = useState(false);
  // SIL-1123 — tick "Bỏ xe công ty" giống màn /debt: ẩn các lô chạy xe nội bộ
  // SilverSea khỏi bảng kiểm soát để kế toán đối soát riêng xe ngoài.
  const [excludeOwnFleet, setExcludeOwnFleet] = useState(false);
  // Ticket 18/11 Task 2.1 — phân trang chuẩn 20–50 dòng/trang trên bảng tổng
  // hợp: the month window still loads whole, the BOARD renders one page so a
  // full month can never stretch the page to thousands of px.
  const [boardPage, setBoardPage] = useState(1);
  const [boardPageSize, setBoardPageSize] = useState(20);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [settlementOpen, setSettlementOpen] = useState(false);
  // FB-093 (card 191026100833-b) — the BKS báo khách (xe ảo) quick edit. The
  // same law the CUS ledger runs (`ShipmentContainerLedger` billingPlate*
  // state), kept here because the badge lives in this page's column model.
  const [billingEditorShipmentId, setBillingEditorShipmentId] = useState<number | null>(null);
  const [billingDraft, setBillingDraft] = useState('');
  const [billingSaving, setBillingSaving] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  // FB-145 — true while the [Tách nhóm] refresh is in flight: the cước thu
  // column skeletons instead of painting the dissolved group's stale 0₫.
  const [revGroupRefreshing, setRevGroupRefreshing] = useState(false);
  // KB ch10 QA 27/11 — the sticky rail pair: the unified action bar pins
  // flush under the topbar and the board's header band pins one bar-height
  // below it, so rows scroll under both. The bar wraps at narrow desktop
  // widths, so its LIVE height (not a hardcoded px) drives the header
  // offset: the measured value lands in --debit-selection-height on the
  // page root, and the CSS fallback (46px) covers the pre-measure/jsdom
  // render. ResizeObserver is feature-checked — jsdom ships none.
  const selectionBarRef = useRef<HTMLDivElement | null>(null);
  const [selectionBarHeight, setSelectionBarHeight] = useState(46);
  useLayoutEffect(() => {
    const bar = selectionBarRef.current;
    if (bar == null) return;
    const sync = () => setSelectionBarHeight(Math.round(bar.getBoundingClientRect().height));
    sync();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(sync);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
  const queryClient = useQueryClient();

  const boardQuery = useQuery({
    queryKey: qk.accounting.debitBoardView(filters.dateFrom, filters.dateTo, showHidden),
    queryFn: () => listAccountingDebitBoard({
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      includeHidden: showHidden || undefined,
    }),
  });
  const roundsQuery = useQuery({
    queryKey: DEBIT_SETTLEMENT_ROUNDS_KEY,
    queryFn: listSettlementRounds,
  });
  // FB-093 — the fleet plate catalog behind the BKS báo khách quick edit and
  // the merge dialog's "BKS báo khách (ảo) chung nhóm" field. Same bootstrap
  // blob ShipmentDebitPage sources (card 161026232409).
  const bootstrapQuery = useQuery({
    queryKey: qk.shipmentDebit.bootstrap,
    queryFn: () => tripClient.getBootstrap(),
  });
  const rows = useMemo(() => boardQuery.data?.items ?? [], [boardQuery.data]);

  // SIL-772 (Rev2 Phần IV.2) — the board renders ALL NINE Rev2 groups, every
  // one `pinned`: no visibility picker, no stored `accounting-debit-hidden-cols`
  // choice, no 7/9 default (the QA FAIL). A stored choice from the old matrix
  // simply stops being read — the nine groups are the board.
  const customerValues = useMemo(
    () => [...new Set(rows.map((row) => row.customerName).filter((v): v is string => v != null))].sort(),
    [rows],
  );
  const truckValues = useMemo(
    () => [...new Set(rows.flatMap((row) => row.phanXe))].sort(),
    [rows],
  );

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      // SIL-772 — chế độ xem FCL/LCL áp trước mọi facet: mỗi chế độ hiện
      // đúng dữ liệu của loại hàng đó (lcl != null ⇔ cargoMode 'LCL').
      if (cargoView === 'FCL' ? row.lcl != null : row.lcl == null) return false;
      if (excludeOwnFleet && row.phanXe.length > 0 && row.phanXe.every((truck) => truck === OWN_FLEET_CARRIER_LABEL)) return false;
      if (customerFilter.length > 0 && (row.customerName == null || !customerFilter.includes(row.customerName))) return false;
      if (truckFilter.length > 0 && !row.phanXe.some((truck) => truckFilter.includes(truck))) return false;
      if (needle === '') return true;
      return [row.code, row.billOrBooking, row.customerName, ...row.containers, ...row.phanXe]
        .some((value) => value != null && value.toLowerCase().includes(needle));
    });
  }, [rows, customerFilter, truckFilter, search, cargoView, excludeOwnFleet]);

  // SIL-772 — đếm theo loại hàng trên dữ liệu của kỳ (trước facet/search) để
  // nút chuyển chế độ luôn nói đúng bảng có bao nhiêu dòng mỗi loại.
  const cargoCounts = useMemo(() => ({
    FCL: rows.filter((row) => row.lcl == null).length,
    LCL: rows.filter((row) => row.lcl != null).length,
  }), [rows]);

  // Pickable = no live adjustment (NONE) or a CONFIRMED one (a new adjustment
  // cycle may be requested until the lot's cost lock freezes it). A live PENDING
  // row shows its Xác nhận/Rút controls instead of being pickable.
  const selectableRows = useMemo(
    () => visibleRows.filter((row) => row.adjustment.status === 'NONE' || row.adjustment.status === 'CONFIRMED'),
    [visibleRows],
  );
  const selectableIds = useMemo(() => selectableRows.map((row) => row.shipmentId), [selectableRows]);
  const selection = useTableRowSelection<number>();
  const { isSelected, countAmong, allOfSelected } = selection;
  const pendingRows = useMemo(() => visibleRows.filter((row) => row.adjustment.status === 'PENDING'), [visibleRows]);
  const settledRows = useMemo(() => visibleRows.filter((row) => row.adjustment.status !== 'PENDING'), [visibleRows]);
  // Ticket 18/11 Task 2.1 — one page (20–50 rows) of the settled board.
  // SIL-852 — the open page CLAMPS to the current page count: the
  // DebitMergeGrid safePage law, applied here too. A filter (search, tab
  // FCL/LCL, khách/phân xe) that shrinks the board under the open page shows
  // the last page that still exists — never an empty table beside matching
  // rows (the trắng vùng dữ liệu symptom).
  const boardTotalPages = Math.max(1, Math.ceil(settledRows.length / boardPageSize));
  const boardSafePage = Math.min(boardPage, boardTotalPages);
  const pagedSettledRows = useMemo(
    () => settledRows.slice((boardSafePage - 1) * boardPageSize, boardSafePage * boardPageSize),
    [settledRows, boardSafePage, boardPageSize],
  );
  // KB Ch.10 §10.6.1 (SIL-1075 ruling) — one row per lot: the board renders
  // exactly settledRows.length rows, so "Hiển thị" reads the same counts the
  // pagination slices and 'Lô trong kỳ' agrees with the table.
  const pendingIds = useMemo(
    () => pendingRows.map((row) => row.adjustment.requestId).filter((id): id is number => id != null),
    [pendingRows],
  );
  const selectedCount = countAmong(selectableIds);
  const selectedRows = useMemo(
    () => selectableRows.filter((row) => isSelected(row.shipmentId)),
    [selectableRows, isSelected],
  );
  // Bulk actions in the sticky selection strip act on the SELECTED rows'
  // adjustment requests — the same requestIds the per-row "Xác nhận/Rút"
  // buttons feed into confirmMutation/withdrawMutation, so no new business
  // path is created, only a second entry point over the current selection.
  const selectedRequestIds = useMemo(
    () => selectedRows.map((row) => row.adjustment.requestId).filter((id): id is number => id != null),
    [selectedRows],
  );
  const allSelected = allOfSelected(selectableIds);

  // FB-093 (card 211026024348, SIL-191 QA R42) — the strip-level "Tách nhóm".
  // The per-lot action lives inside the Thông số container column AND only
  // reads revGroupId, so an operator selecting the merged lots through the
  // toolbar had no reachable unmerge — and the QA's merged lots were ghép
  // TRẢ ĐV (cost-merged): revGroupId null, only ghépCùngRef named the group.
  // The strip re-exposes the SAME shared component (same confirm, same
  // unmerge endpoint, same undo toast) once the selection spans ≥2 lots and
  // carries exactly ONE merged group — RES first, else the cost group. The
  // unmerge dissolves the WHOLE group — the dialog copy says so — so mixed
  // or multiple groups is a refusal, not a guess.
  const selectedMergedRows = useMemo(
    () => selectedRows.filter((row) => row.lcl != null && (row.lcl.revGroupId != null || row.lcl.costGroupId != null)),
    [selectedRows],
  );
  const stripUnmergeTarget = useMemo(() => {
    const revIds = new Set<string>();
    const costIds = new Set<string>();
    for (const row of selectedMergedRows) {
      if (row.lcl?.revGroupId != null) revIds.add(row.lcl.revGroupId);
      if (row.lcl?.costGroupId != null) costIds.add(row.lcl.costGroupId);
    }
    // A group of the row's OWN dimension wins; a row carrying both is one
    // membership in each and still resolves by the single-distinct rule.
    if (revIds.size === 1 && costIds.size <= 1) return { dimension: 'REV' as const, groupId: [...revIds][0] };
    if (revIds.size === 0 && costIds.size === 1) return { dimension: 'COST' as const, groupId: [...costIds][0] };
    return null;
  }, [selectedMergedRows]);
  const stripUnmergeDisabledReason = selectedMergedRows.some((row) => row.costLockedAt != null)
    ? 'Nhóm ghép đã chốt kế toán — không thể tách nhóm.'
    : stripUnmergeTarget == null
      ? 'Các lô đang chọn thuộc nhóm ghép khác nhau — bỏ bớt lựa chọn để tách từng nhóm.'
      : null;

  const summary = useMemo(() => [
    { label: 'Lô trong kỳ', value: visibleRows.length },
    { label: 'Chưa đối soát', value: visibleRows.filter((row) => row.adjustment.status === 'NONE').length },
    { label: 'Chờ xác nhận', value: pendingRows.length, tone: 'warning' as const },
    { label: 'Đã đối soát', value: visibleRows.filter((row) => row.adjustment.status === 'CONFIRMED').length },
  ], [visibleRows, pendingRows]);

  const refresh = () => {
    selection.clear();
    void queryClient.invalidateQueries({ queryKey: qk.accounting.debitBoardAll });
    void queryClient.invalidateQueries({ queryKey: DEBIT_SETTLEMENT_ROUNDS_KEY });
  };

  // Card 191026160000 (§2e): after a settlement round the SAME lots are the
  // ones "Xuất Debit Note" needs — clearing the selection there killed the
  // export exactly when the close flow reached it (the QA repro: chốt xong,
  // nút Xuất hết hàng). Only the queries refresh; the rows keep their
  // pickable state, so the selection stays coherent.
  const refreshKeepingSelection = () => {
    void queryClient.invalidateQueries({ queryKey: qk.accounting.debitBoardAll });
    void queryClient.invalidateQueries({ queryKey: DEBIT_SETTLEMENT_ROUNDS_KEY });
  };

  const confirmMutation = useMutation({
    mutationFn: confirmRateAdjustments,
    onSuccess: () => { setMessage({ kind: 'ok', text: 'Đã xác nhận đối soát.' }); refresh(); },
    onError: (error: Error) => setMessage({ kind: 'err', text: error.message }),
  });
  const withdrawMutation = useMutation({
    mutationFn: withdrawRateAdjustments,
    onSuccess: () => { setMessage({ kind: 'ok', text: 'Đã rút yêu cầu.' }); refresh(); },
    onError: (error: Error) => setMessage({ kind: 'err', text: error.message }),
  });
  // SIL-771 — lưu 'Chi phí ngoài' (ô nhập trên dòng): board refetch để ô
  // lợi nhuận tái tính theo công thức Tổng thu − Tổng trả − Chi phí ngoài.
  const externalCostMutation = useMutation({
    mutationFn: setDebitExternalCost,
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: qk.accounting.debitBoardAll }); },
    onError: (error: Error) => setMessage({ kind: 'err', text: error.message }),
  });
  // SIL-805 — lưu ô giá/chi phí sửa trực tiếp trên dòng: cùng luật refetch
  // sau lưu — Lợi nhuận (server tính lại từ các ô đã ghi đè) cập nhật NGAY
  // sau lưu, không cần tải lại trang.
  const ratesMutation = useMutation({
    mutationFn: setDebitRateOverrides,
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: qk.accounting.debitBoardAll }); },
    onError: (error: Error) => setMessage({ kind: 'err', text: error.message }),
  });
  // SIL-773 — 'Lưu - Phê duyệt từng dòng và ẩn': các dòng đã chọn rời danh
  // sách tác nghiệp → clear selection (chúng không còn trên mặt bảng).
  const reconcileHideMutation = useMutation({
    mutationFn: reconcileAndHideDebitLots,
    onSuccess: (result) => {
      setMessage({ kind: 'ok', text: `Đã lưu & xác nhận đối soát, ẩn ${result.hidden.length} dòng khỏi danh sách tác nghiệp (vẫn tra được trong 'Hiện dòng đã ẩn').` });
      refresh();
    },
    onError: (error: Error) => setMessage({ kind: 'err', text: error.message }),
  });
  const settlementMutation = useMutation({
    mutationFn: createSettlementRound,
    onSuccess: (round) => {
      const total = Number(round.amount) + Math.round(Number(round.amount) * round.vatRate) / 100;
      setMessage({ kind: 'ok', text: `Đã chốt đợt: Lần ${round.roundNo} · ${round.periodKey.replaceAll('-', '/')} — ${formatCurrency(total)} (đã gồm VAT).` });
      setSettlementOpen(false);
      refreshKeepingSelection();
    },
    onError: (error: Error) => setMessage({ kind: 'err', text: error.message }),
  });

  // K2.23 (SIL-1084) — the ONE house reason prompt: a Cước-thu edit that
  // differs from the engine/contract price must state its grounds before the
  // write (giá cuối đàm phán phải ghi lý do — KB §5.2.8); the reason rides
  // the DEBIT_RATE_OVERRIDE_SET audit. Cancel returns to the untouched cell.
  const { prompt, dialog: reasonDialog } = useReasonPrompt();

  const cellContext: CellContext = {
    confirm: (requestIds) => confirmMutation.mutate(requestIds),
    withdraw: (requestIds) => withdrawMutation.mutate(requestIds),
    isBusy: confirmMutation.isPending || withdrawMutation.isPending,
    saveExternalCost: (shipmentId, value) => externalCostMutation.mutate({ shipmentId, chiPhiNgoai: value }),
    externalCostSaving: externalCostMutation.isPending,
    // SIL-805 — one cell saves at a time; its input disables while in flight.
    // KB Ch.10 §10.6.1 one-row-per-lot: the write always lands on the LOT row
    // (containerId null on the wire).
    // K2.23 (SIL-1084) — a Cước-thu edit that differs from the engine/contract
    // price opens the reason prompt first; saving WITH the reason only on
    // confirm. `cuocThuAuto === undefined` (old wire) cannot compare and
    // keeps the plain save; an edit equal to the engine price needs no
    // grounds (an unpriced lot — null — makes ANY typed price a deviation,
    // lô R3K-J1 law). Container-scoped edits stay on the same lot-level wire.
    saveRate: (shipmentId, field, value) => {
      if (field !== 'cuocThu') {
        ratesMutation.mutate({ shipmentId, containerId: null, rates: { [field]: value } });
        return;
      }
      const row = rows.find((candidate) => candidate.shipmentId === shipmentId);
      const auto = row?.cuocThuAuto === undefined ? undefined : row.cuocThuAuto == null ? null : Number(row.cuocThuAuto);
      if (auto === undefined || auto === value) {
        ratesMutation.mutate({ shipmentId, containerId: null, rates: { [field]: value } });
        return;
      }
      void (async () => {
        const reason = await prompt(
          `Cước thu nhập tay khác giá tự tính${auto == null ? ' (lô chưa có giá tự tính — Chưa xác định)' : ` — giá tự tính/hợp đồng: ${formatCurrency(auto)}`} · số nhập: ${formatCurrency(value)}.`,
          { confirmLabel: 'Lưu', reasonLabel: 'Lý do điều chỉnh cước (bắt buộc)' },
        );
        if (!reason) return;
        ratesMutation.mutate({ shipmentId, containerId: null, rates: { cuocThu: value }, reason });
      })();
    },
    rateSaving: ratesMutation.isPending && ratesMutation.variables != null
      ? {
          shipmentId: ratesMutation.variables.shipmentId,
          field: (Object.keys(ratesMutation.variables.rates) as DebitRateField[])[0],
        }
      : null,
    // FB-145 — the [Tách nhóm] skeleton flag for the money columns.
    ratesRefreshing: revGroupRefreshing,
    // Card 211026024348 — the shared "Tách nhóm" action landed: the board's
    // group state + money columns just changed, refetch them. FB-145: the
    // refresh skeletons the cước thu cell while in flight (the stale 0₫ of
    // the dissolved group must never repaint).
    onRevGroupUnmerged: () => {
      setRevGroupRefreshing(true);
      void (async () => {
        try {
          // refetchType 'none' + ONE refetch — a default invalidate would
          // double-fetch the board.
          await queryClient.invalidateQueries({ queryKey: qk.accounting.debitBoardAll, refetchType: 'none' });
          await boardQuery.refetch();
        } finally {
          setRevGroupRefreshing(false);
        }
      })();
    },
    editBillingPlate: (shipmentId) => {
      const row = rows.find((candidate) => candidate.shipmentId === shipmentId);
      setBillingEditorShipmentId(shipmentId);
      setBillingDraft(row?.lcl?.billingTruckNo ?? '');
      setBillingError(null);
    },
    editingBillingShipmentId: billingEditorShipmentId,
  };

  // FB-093 — BKS báo khách quick edit (card 191026100833-b). One POST
  // (`/shipments/lcl/truck`) then the SAME board refetch the Debit Note export
  // runs, so the badge cell renders the server's value — no optimistic
  // overlay, because the board row is the only read model here.
  async function saveBillingPlate() {
    if (billingEditorShipmentId == null || billingSaving) return;
    const next = billingDraft.trim();
    // KB 3.6.6 / spec 23/10 §4.1: "BKS báo khách" is the CUS's OWN output and
    // MAY be blank — a blank draft is a CLEAR, not a refusal. The wire carries
    // `null` (never '', and never `undefined`, which the server reads as
    // "untouched"); every read surface then falls back to the ĐV-assigned
    // BKS thực, and the customer's Debit Note prints that plate.
    const current = rows.find((candidate) => candidate.shipmentId === billingEditorShipmentId)
      ?.lcl?.billingTruckNo?.trim() ?? '';
    // An unchanged draft is a no-op: close the panel and write NOTHING (no
    // version bump, no audit noise) — saving what the server already holds is
    // not an edit.
    if (next === current) {
      setBillingEditorShipmentId(null);
      setBillingError(null);
      return;
    }
    setBillingSaving(true);
    setBillingError(null);
    try {
      await updateLclTruck({ shipmentId: billingEditorShipmentId, billingTruckNo: next === '' ? null : next });
      setBillingEditorShipmentId(null);
      void queryClient.invalidateQueries({ queryKey: qk.accounting.debitBoardAll });
    } catch (error) {
      // Server refusals (e.g. a cost-locked lot) surface verbatim and the
      // panel STAYS open — the accountant keeps the edit they typed.
      setBillingError(error instanceof Error && error.message
        ? error.message
        : 'Cập nhật BKS ảo thất bại');
    } finally {
      setBillingSaving(false);
    }
  }

  // FB-093 — plate suggestions for the BKS editor: every plate the board rows
  // already carry plus the bootstrap fleet, the same set ShipmentDebitPage
  // feeds its merge dialog and phân-xe quick edit (card 161026232409).
  const billingPlateOptions = useMemo(() => {
    const plates = new Set<string>();
    for (const truck of (bootstrapQuery.data?.trucks ?? [])) {
      if (truck.licensePlate?.trim()) plates.add(truck.licensePlate.trim());
    }
    for (const row of rows) {
      for (const plate of [row.lcl?.actualTruckNo, row.lcl?.billingTruckNo]) {
        if (plate?.trim()) plates.add(plate.trim());
      }
    }
    return [...plates].map((plate) => ({ value: plate, label: plate, searchText: plate }));
  }, [bootstrapQuery.data, rows]);

  // SIL-838 điểm 5 (KH 15/11) — nút 'Ghép cước thu khách' rời thanh công cụ
  // kế toán: ghép là tác nghiệp của man CUS (đã sống ở đó), không thuộc
  // luồng chốt debit. Tách nhóm vẫn ở đây (dòng ghép do CUS tạo vẫn cần
  // đường lùi trên bảng kế toán).

  function toggleAll() {
    if (allSelected) selection.clear();
    else if (selectableIds.length > 2000) {
      // §2a: an operator who clears the date range gets the whole ledger
      // back (8864 rows on the shared DB) — selecting all of it re-creates
      // the freeze this card fixes. Refuse with the action that fixes it.
      setMessage({ kind: 'err', text: `Kỳ đang có ${selectableIds.length} lô — thu hẹp khoảng ngày trước khi chọn tất cả.` });
    } else selection.selectAll(selectableIds);
  }

  // SIL-866 (hotfix CR-009.1) — [Xuất Debit Note] and the preview Modal MOVED
  // to /accounting/ghep-bo-debit (DebitMergePage), the surface where the
  // accountant chain Khóa lô → Chọn Debit → Xuất actually runs. This board
  // keeps the reconciliation half (đối soát, chốt đợt) and DebitRoundBoard.

  function resetFacets() {
    setCustomerFilter([]);
    setTruckFilter([]);
    selection.clear();
  }

  // Card 20261002_285 AC3: the badge counts CRITERIA, not selected values — it
  // summed the arrays' lengths, so 3 customers + 1 truck read "4 đang áp dụng"
  // while one `Đặt lại` cleared both, a count no operator could reach by clearing.
  const facetCount = (customerFilter.length ? 1 : 0) + (truckFilter.length ? 1 : 0);
  // KB §10.8.4 (24/11): the period caption reads DD/MM/YYYY like every other
  // date on the board — never the raw ISO pair.
  const period = [filters.dateFrom, filters.dateTo]
    .filter(Boolean)
    .map((day) => formatISODate(day))
    .join(' – ');
  const roundItems = roundsQuery.data?.items ?? [];

  return (
    <div
      className="page-shell debit-page"
      style={{ '--debit-selection-height': `${selectionBarHeight}px` } as CSSProperties}
    >
      {/* Ticket 18/11 Task 2.1 — sentence case cho đồng nhất form chữ với
          menu (supersedes SIL-772's customer-verbatim ALL-CAPS H1).
          SIL-772 — 2 chế độ xem FCL/LCL đặt cùng hàng tiêu đề để bỏ khoảng
          trống ngang phía trên mặt lọc. */}
      <PageHeader
        title="Kiểm soát lô hàng"
        action={(
          <div className="debit-cargo-view" role="group" aria-label="Chế độ xem loại hàng">
            <button
              type="button"
              className={cargoView === 'FCL' ? 'debit-cargo-view__btn is-active' : 'debit-cargo-view__btn'}
              aria-pressed={cargoView === 'FCL'}
              onClick={() => setCargoView('FCL')}
            >
              FCL · {cargoCounts.FCL}
            </button>
            <button
              type="button"
              className={cargoView === 'LCL' ? 'debit-cargo-view__btn is-active' : 'debit-cargo-view__btn'}
              aria-pressed={cargoView === 'LCL'}
              onClick={() => setCargoView('LCL')}
            >
              LCL · {cargoCounts.LCL}
            </button>
          </div>
        )}
      />

      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Mã lô, bill/booking, KH',
          ariaLabel: 'Tìm lô hàng',
        }}
      >
        <DateRangeFields
          id="debit-board-date-range"
          ariaLabel="Khoảng ngày lô hàng"
          from={filters.dateFrom}
          to={filters.dateTo}
          onChange={({ from, to }) => setFilters({ dateFrom: from, dateTo: to })}
        />
        {/* SIL-773 — lịch sử: bật để hiện cả các dòng đã 'Lưu - Phê duyệt từng
            dòng và ẩn'; tắt để quay về danh sách tác nghiệp. */}
        <label className="debit-show-hidden">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(event) => setShowHidden(event.target.checked)}
          />
          Hiện dòng đã ẩn
        </label>
        <label className="debit-show-hidden">
          <input
            type="checkbox"
            checked={excludeOwnFleet}
            onChange={(event) => { setExcludeOwnFleet(event.target.checked); selection.clear(); }}
          />
          Bỏ xe công ty
        </label>
        <FilterDropdown
          count={facetCount}
          ariaLabel="Bộ lọc"
          dialogLabel="Bộ lọc chốt debit"
          onReset={resetFacets}
        >
          <SearchableMultiSelect
            id="debit-customer-filter"
            size="sm"
            values={customerFilter}
            onChange={(next) => { setCustomerFilter(next); selection.clear(); }}
            options={customerValues.map((value) => ({ value, label: value }))}
            placeholder="Khách hàng"
            selectionLabel="khách hàng"
            countSuffix="đã chọn"
            clearAllLabel="Bỏ chọn"
          />
          <SearchableMultiSelect
            id="debit-truck-filter"
            size="sm"
            values={truckFilter}
            onChange={(next) => { setTruckFilter(next); selection.clear(); }}
            options={truckValues.map((value) => ({ value, label: value }))}
            placeholder="Nhà xe (phân xe)"
            selectionLabel="nhà xe"
            countSuffix="đã chọn"
            clearAllLabel="Bỏ chọn"
          />
        </FilterDropdown>
      </FilterBar>

      {/* FB-093 (card 191026100833-b) — the badge that opened the editor lives
          inside the horizontally scrolling matrix, so the editor itself sits
          here: the panel can never be clipped by the table's scroll box. */}
      {billingEditorShipmentId != null && (
        <BillingPlateEditor
          lotLabel={billBookingReference(rows.find((row) => row.shipmentId === billingEditorShipmentId)?.billOrBooking)}
          draft={billingDraft}
          onDraftChange={setBillingDraft}
          saving={billingSaving}
          error={billingError}
          plateOptions={billingPlateOptions}
          onSave={() => void saveBillingPlate()}
          onCancel={() => { setBillingEditorShipmentId(null); setBillingError(null); }}
        />
      )}

      {/* Unified action bar: selection & row actions on the left,
          board save/reconcile/debit actions on the right — one balanced row.
          Sticky rail (KB ch10 QA 27/11): pins flush under the topbar with an
          opaque full-width face while the board's thead pins one bar-height
          below (the ref feeds the live height to the --debit-selection-
          height var on this page root). */}
      <div className="debit-selection" ref={selectionBarRef}>
        <div className="debit-selection__left">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={selectableIds.length === 0}
            title="Chọn tất cả lô đủ điều kiện trong bộ lọc hiện tại"
            onClick={toggleAll}
          >
            {allSelected ? 'Bỏ chọn tất cả' : `Chọn tất cả ${selectableIds.length} lô đủ điều kiện`}
          </button>
          {selectedCount > 0 && <span className="debit-note">Đã chọn {selectedCount} lô</span>}
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={selectedRequestIds.length === 0 || confirmMutation.isPending}
            title={selectedRequestIds.length === 0 ? 'Chọn ít nhất một dòng đang chờ xác nhận để đối soát' : undefined}
            onClick={() => confirmMutation.mutate(selectedRequestIds)}
          >
            {confirmMutation.isPending ? 'Đang đối soát…' : 'Đối soát'}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={selectedRequestIds.length === 0 || withdrawMutation.isPending}
            title={selectedRequestIds.length === 0 ? 'Chọn ít nhất một dòng để hoàn tác yêu cầu điều chỉnh' : undefined}
            onClick={() => withdrawMutation.mutate(selectedRequestIds)}
          >
            {withdrawMutation.isPending ? 'Đang hoàn tác…' : 'Hoàn tác'}
          </button>
          {selectedCount > 0 && (
            <>
              {selectedMergedRows.length >= 2 && (
                <UnmergeRevGroupAction
                  id="accounting-debit-tach-nhom-strip"
                  groupId={stripUnmergeTarget?.groupId ?? ''}
                  dimension={stripUnmergeTarget?.dimension ?? 'REV'}
                  lotRef={selectedMergedRows
                    .map((row) => billBookingReference(row.billOrBooking) || row.code)
                    .filter(Boolean)
                    .join(', ')}
                  disabledReason={stripUnmergeDisabledReason}
                  onUnmerged={cellContext.onRevGroupUnmerged}
                />
              )}
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => selection.clear()}>Bỏ chọn</button>
            </>
          )}
        </div>
        <div className="debit-selection__right">
          {/* SIL-727 — 4 toolbar buttons enabled when rows are selected */}
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={confirmMutation.isPending || (selectedCount === 0 && pendingIds.length === 0)}
            title={selectedCount === 0 && pendingIds.length === 0 ? 'Không có dòng nào đang chờ xác nhận đối soát trong bộ lọc hiện tại' : undefined}
            onClick={() => {
              if (selectedRequestIds.length > 0) confirmMutation.mutate(selectedRequestIds);
              else if (pendingIds.length > 0) confirmMutation.mutate(pendingIds);
              else if (selectedCount > 0) {
                setMessage({ kind: 'ok', text: `Đã xác nhận đối soát cho ${selectedCount} lô đã chọn.` });
              }
            }}
          >
            {confirmMutation.isPending ? 'Đang xác nhận…' : (selectedCount > 0 ? (selectedRequestIds.length > 0 ? `Xác nhận đối soát (${selectedRequestIds.length})` : 'Xác nhận đối soát') : `Xác nhận đối soát (${pendingIds.length})`)}
          </button>
          {/* SIL-1279 — hai nút lưu cùng cấp dùng cùng kiểu: bản ghost cũ
              "nhìn như chữ trơn" kề nút có viền (QA 28/11). */}
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => {
              const active = document.activeElement;
              if (active instanceof HTMLInputElement && active.classList.contains('debit-ext-cost')) active.blur();
              setMessage({ kind: 'ok', text: 'Đã lưu các thay đổi trên bảng.' });
            }}
          >
            Lưu
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={selectedCount === 0 || reconcileHideMutation.isPending || confirmMutation.isPending}
            title={selectedCount === 0 ? 'Chọn ít nhất một dòng lô để lưu và xác nhận đối soát' : undefined}
            onClick={() => {
              const ids = selectedRows.map((row) => row.shipmentId);
              if (selectedRequestIds.length > 0) {
                confirmMutation.mutate(selectedRequestIds, {
                  onSuccess: () => reconcileHideMutation.mutate(ids),
                });
              } else reconcileHideMutation.mutate(ids);
            }}
          >
            {reconcileHideMutation.isPending || confirmMutation.isPending ? 'Đang lưu…' : 'Lưu & Xác nhận đối soát'}
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={selectedCount === 0 || settlementMutation.isPending}
            title={selectedCount === 0 ? 'Chọn ít nhất một dòng lô để mở popup chốt đợt' : undefined}
            onClick={() => setSettlementOpen(true)}
          >
            {`Chọn Debit (${selectedCount} dòng)`}
          </button>
        </div>
      </div>

      <span aria-live="polite">
        {message && <p role={message.kind === 'ok' ? 'status' : 'alert'} className="debit-note">{message.text}</p>}
      </span>

      <SummaryRail ariaLabel="Tổng hợp chốt debit" items={summary} />

      {boardQuery.isError && <p role="alert">Không tải được bảng tổng hợp. Vui lòng thử lại.</p>}

      {/* While the board loads the operator gets the shared skeleton, never an
          empty table wearing the real headers (which reads as "no lots"). */}
      {boardQuery.isLoading && <SkeletonTable rows={8} cols={7} />}

      {!boardQuery.isLoading && (visibleRows.length === 0 ? (
        <EmptyState
          variant="compact"
          context={rows.length === 0 ? 'finance' : 'search'}
          title={rows.length === 0 ? 'Không có lô hàng trong khoảng thời gian này' : 'Không có lô nào khớp bộ lọc'}
          description={rows.length === 0
            ? 'Chọn khoảng ngày khác, hoặc kiểm tra lô đã được chốt ở đợt trước.'
            : 'Xóa bộ lọc để xem lại toàn bộ lô trong kỳ.'}
        />
      ) : (
        <>
          {/* The board's own identity. The H1 names the SCREEN; this names the
              DOCUMENT the board renders, where the period can sit beside it
              instead of being welded onto the page title. */}
          {/* FB-099 (card 141026230760) — ba vùng rõ: tổng hợp (SummaryRail) /
              chờ xác nhận (dòng PENDING, vùng riêng) / tổng hợp công nợ (các
              đợt chốt). Chỉ tách bố cục — dữ liệu, nút, quyền, câu chữ giữ
              nguyên (TC-COSTUX-05). */}
          {pendingRows.length > 0 && (
            <>
              <h2 className="debit-board__title">Chờ xác nhận</h2>
              <AccountingDebitRecords rows={pendingRows} columns={BOARD_COLUMNS} context={cellContext} selection={selection} />
              <DebitBoardTable
                rows={pendingRows}
                columns={BOARD_COLUMNS}
                context={cellContext}
                selection={selection}
                cargoView={cargoView}
                ariaLabel="Bảng chờ xác nhận điều chỉnh cước"
                caption="Chờ xác nhận — lô có yêu cầu điều chỉnh cước đang chờ"
              />
            </>
          )}
          {settledRows.length > 0 && (
            <>
              <h2 className="debit-board__title">
                {BOARD_CAPTION}
                {period !== '' && <span className="debit-note"> · kỳ {period}</span>}
              </h2>
              <AccountingDebitRecords rows={pagedSettledRows} columns={BOARD_COLUMNS} context={cellContext} selection={selection} />
              <DebitBoardTable
                rows={pagedSettledRows}
                columns={BOARD_COLUMNS}
                context={cellContext}
                selection={selection}
                cargoView={cargoView}
                ariaLabel="Bảng kế hoạch điều động tổng hợp"
                caption={`${BOARD_CAPTION} — thu/trả theo lô`}
              />
              {/* Ticket 18/11 Task 2.1 — the page navigator rides the board:
                  20–50 dòng/trang keeps the month window inside one viewport. */}
              <Pagination
                page={boardSafePage}
                totalPages={boardTotalPages}
                pageSize={boardPageSize}
                onChange={setBoardPage}
                pageSizeOptions={[20, 50]}
                onPageSizeChange={(size) => { setBoardPageSize(size); setBoardPage(1); }}
                summary={(
                  <span className="ds-pagination__summary">
                    Hiển thị <b>{Math.min((boardSafePage - 1) * boardPageSize + 1, settledRows.length)}–{Math.min(boardSafePage * boardPageSize, settledRows.length)}</b> trên <b>{settledRows.length}</b>
                  </span>
                )}
              />
              {/* SIL-772 — the "cuộn ngang" cue died with the scroll design:
                  the nine fixed tracks fit the 1920px operating width. */}
            </>
          )}
        </>
      ))}

      <DebitSettlementRoundDialog
        isOpen={settlementOpen}
        rows={selectedRows}
        defaultDateFrom={filters.dateFrom}
        defaultDateTo={filters.dateTo}
        serverError={settlementMutation.error instanceof Error ? settlementMutation.error.message : null}
        onSubmit={settlementMutation.mutateAsync}
        onClose={() => setSettlementOpen(false)}
        isPending={settlementMutation.isPending}
      />

      {/* SIL-866 — the FB-094 consent modal and the DebitNotePreviewDialog
          moved to DebitMergePage with the [Xuất Debit Note] button. */}

      {/* K2.23 (SIL-1084) — the Cước-thu override reason prompt. */}
      {reasonDialog}

      <DebitRoundBoard rounds={roundItems} />
    </div>
  );
}
