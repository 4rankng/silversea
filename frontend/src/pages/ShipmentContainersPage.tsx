import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { FilterDropdown } from '../components/FilterDropdown';
import { useQueuedSearchParams } from '../hooks/useQueuedSearchParams';
import { useAuth } from '../hooks/useAuth';
import {
  SHIPMENT_CUS_CONTAINER_SORT_KEYS,
  SHIPMENT_CUS_PAGE_SIZES,
  type ShipmentCusContainerFlatRow,
  type ShipmentCusContainerSortKey,
} from '@tingting/shared';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { Alert } from '../components/shared/Alert';
import { useToast } from '../components/shared/Toast';
import { Skeleton } from '../components/shared/Skeleton';
import { DisabledActionTip } from '../components/shared/DisabledActionTip';
import { Button as UUIButton } from '../components/untitled-ui/base/buttons/button';
import { DateRangeFields, DateRangePresets, DateRangePresetSelect, EmptyState, FilterBar, Pagination, type DateRangePreset, type DateRangeValue, UuiSelectField } from '../design-system';
import { PageHeader } from '../components/UI';
import {
  DISPATCH_STATUS,
  LEDGER_COLUMNS,
  ShipmentContainerLedger,
  type ShipmentDocumentsDraft,
} from '../features/shipments/detail/ShipmentContainerLedger';
import { MergeRevGroupDialog } from '../features/shipments/debit/MergeRevGroupDialog';
import { LclMergeModeToggle } from '../components/shared/LclMergeModeToggle';
import { useHiddenColumns } from '../hooks/useHiddenColumns';
import { useVietnamToday } from '../hooks/useVietnamToday';
import { formatVietnamDateInput } from '../lib/shipment-operations';
import { nextTableSort, readTableSort } from '../lib/table-sort';
import { completeDispatchExternalTrip } from '../api/dispatchPlanningClient';
import { canCloseExternalTrips, canManageShipmentDebit } from '../lib/role-access';
import { formatNumber, formatVolumeCbm, formatWeight } from '../lib/format';
import {
  CUS_SEARCH_PATTERN,
  DISPATCH_STATUS_VALUES,
  readIsoDate,
  readPositiveInteger,
  type DispatchStatusFilter,
} from '../features/shipments/cus/cusDetailModel';
import { useCusDetail } from '../features/shipments/cus/use-cus-detail';
import { readCusPageSize } from '../features/shipments/cus/use-cus-workspace-state';
import './ShipmentContainersPage.css';

// Date-scope quick ranges — the scopes the page always offered, in the shared
// preset shape: `DateRangePresets` (boxed chips) rides the bar and
// `DateRangePresetSelect` (the same ranges as a dropdown) rides the `Bộ lọc`
// dialog once the strip has folded its quick ranges there. `range()` is
// evaluated on click, so `Hôm nay` stays anchored to the day it is clicked.
const DATE_RANGE_PRESETS: DateRangePreset[] = [
  { id: 'today', label: 'Hôm nay', range: () => { const today = formatVietnamDateInput(new Date()); return { from: today, to: today }; } },
  { id: 'tomorrow', label: 'Hôm sau', range: () => { const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); const iso = formatVietnamDateInput(tomorrow); return { from: iso, to: iso }; } },
];

// The all-dates scope is a CHIP of the bar only: the dialog's dropdown appends
// its own "Tất cả" (the clear option, `DateRangePresetSelect`), so passing this
// entry to it as well would list the same range twice.
const ALL_DATES_PRESET: DateRangePreset = { id: 'all', label: 'Tất cả', range: () => ({ from: '', to: '' }) };

function ShipmentContainerLedgerSkeleton() {
  return (
    <div className="shipments-detail-skeleton" aria-label="Đang tải danh sách container" role="status">
      {Array.from({ length: 6 }).map((_, rowIndex) => (
        <div className="shipments-detail-skeleton__row" key={rowIndex}>
          {Array.from({ length: 7 }).map((__, columnIndex) => <Skeleton key={columnIndex} width={`${12 + (columnIndex % 3) * 2}%`} height={14} />)}
        </div>
      ))}
      <span className="sr-only">Đang tải container…</span>
    </div>
  );
}

export default function ShipmentContainersPage() {
  // Rolls at Vietnam midnight: a tab left open overnight keeps the default
  // date filter and the "Hôm nay chờ phân xe" rail on the current day.
  const today = useVietnamToday();
  // The auth context may be absent (bare render trees) — absence reads as
  // "not a manager", which only ever HIDES the toggle; the server stays the
  // merge authority either way.
  const auth = useAuth();
  // SIL-547 (spec 23/10 §2) — the merge mode gates to the SAME authority the
  // settlement board uses (ADMIN/ACCOUNTANT/CUS); readers never see the toggle.
  const canManageMerge = canManageShipmentDebit(auth?.user?.role);
  // SIL-592 — hide the staff close outside the backend's complete-external
  // allowlist (ADMIN/MANAGER/DISPATCHER/CUS).
  const canCloseExternal = canCloseExternalTrips(auth?.user?.role);
  const [searchParams, setSearchParams, latestSearchParams] = useQueuedSearchParams();
  const page = readPositiveInteger(searchParams.get('page'), 1);
  // Rows per page lives in the URL like every other workboard param, so a
  // 200-row view is shareable; an unknown value falls back to the default.
  const pageSize = readCusPageSize(searchParams.get('limit'));
  const rawSuffix = searchParams.get('searchSuffix') ?? '';
  const suffixParam = CUS_SEARCH_PATTERN.test(rawSuffix) ? rawSuffix.toUpperCase() : '';
  const parsedDateFrom = readIsoDate(searchParams.get('transportDateFrom'));
  const parsedDateTo = readIsoDate(searchParams.get('transportDateTo'));
  const allDates = searchParams.get('dateScope') === 'all';
  const datesAreOrdered = !parsedDateFrom || !parsedDateTo || parsedDateFrom <= parsedDateTo;
  const dateFrom = datesAreOrdered ? (parsedDateFrom || (!allDates && !parsedDateTo ? today : '')) : today;
  const dateTo = datesAreOrdered ? (parsedDateTo || (!allDates && !parsedDateFrom ? today : '')) : today;
  const customerId = readPositiveInteger(searchParams.get('customerId'));
  const rawDirection = searchParams.get('direction');
  const direction = rawDirection === 'IMPORT' || rawDirection === 'EXPORT' ? rawDirection : '';
  // Detail-only server-derived dispatch filter; the overview endpoint rejects it.
  const rawDispatchStatus = searchParams.get('dispatchStatus');
  const dispatchStatus = rawDispatchStatus && DISPATCH_STATUS_VALUES.includes(rawDispatchStatus as DispatchStatusFilter)
    ? rawDispatchStatus as DispatchStatusFilter
    : '';
  // Column sort lives in the URL like every other workboard param, so a sorted
  // view is shareable and survives reload. Unknown keys fall back to the
  // backend's default order instead of erroring the page.
  // Trạng thái dữ liệu (20260917_3): 'MISSING' lọc các dòng thiếu trường bắt buộc.
  const informationStatus = searchParams.get('informationStatus') === 'MISSING' ? 'MISSING' : '';
  const rawSortBy = searchParams.get('sortBy');
  const sortKey = SHIPMENT_CUS_CONTAINER_SORT_KEYS.includes(rawSortBy as ShipmentCusContainerSortKey)
    ? rawSortBy as ShipmentCusContainerSortKey
    : null;
  const sort = sortKey ? readTableSort(sortKey, searchParams.get('sortDir')) : null;
  const sortDir = sort?.dir;
  const [searchInput, setSearchInput] = useState(suffixParam);
  // Remount key for the from/to group: a reset must clear a local INVALID
  // draft even when the URL value did not change (the controlled value alone
  // cannot, because '' → '' is not a change the field can see).
  const [dateResetKey, setDateResetKey] = useState(0);
  const [searchError, setSearchError] = useState<string | null>(null);
  const appliedSearchRef = useRef(suffixParam);

  // ── SIL-547 (spec 23/10 §2/§4.2) — the CUS [Gộp hàng] mode on Chi tiết lô
  // hàng, the twin of /shipments-debit's: OFF hides the CHỌN column; ON
  // reveals it (lot-level LCL rows only) with the floating bar, and completing
  // a merge — or [Thoát gộp hàng] — hides it again. Every list-changing
  // filter/page write below drops the picks so the bar can never count a lot
  // the current view no longer shows.
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedLotIds, setSelectedLotIds] = useState<Set<number>>(new Set());
  const [mergeOpen, setMergeOpen] = useState(false);
  const exitMergeMode = () => {
    setMergeMode(false);
    setSelectedLotIds(new Set());
  };
  // Stable so the filter writers' useCallback identities stay put.
  const dropPicks = useCallback(() => setSelectedLotIds(new Set()), []);
  const { toast } = useToast();
  // SIL-544's tick-time law, ported: a pick of another customer — or a lot
  // with none — is refused AT the tick with the reason named; the merge popup
  // and the server stay the later authorities.
  const refusePick = (incoming: ShipmentCusContainerFlatRow): string | null => {
    const label = incoming.billOrBookNumber || incoming.containerNumber || incoming.declarationNumber;
    if (incoming.isLotLevel !== true) {
      return label
        ? `Dòng ${label} là hàng cont (FCL) — chỉ chọn được các dòng LÔ HÀNG LẺ (LCL) để gộp cước thu khách.`
        : 'Chỉ chọn được các dòng LÔ HÀNG LẺ (LCL) để gộp cước thu khách.';
    }
    if (incoming.customerId == null) {
      return `Lô ${label ?? 'này'} chưa xác định khách hàng — chỉ gộp được các lô của cùng một khách hàng.`;
    }
    return null;
  };
  const selectLot = (shipmentId: number, next: boolean) => {
    if (next) {
      const incoming = items.find((row) => row.shipmentId === shipmentId);
      if (incoming) {
        const refusal = refusePick(incoming);
        if (refusal == null) {
          // Same-customer gate: the FIRST picked lot anchors the customer;
          // anything of another customer is refused with both names (the BE
          // law reads a null customer as a conflict too — caught above).
          const anchor = items.find((row) => selectedLotIds.has(row.shipmentId));
          if (anchor != null && anchor.customerId != null && anchor.customerId !== incoming.customerId) {
            const anchorName = anchor.customerName ?? 'chưa xác định';
            toast({
              kind: 'error',
              message: `Lô ${incoming.billOrBookNumber || incoming.containerNumber || incoming.declarationNumber} thuộc khách hàng ${incoming.customerName ?? 'chưa xác định'} — khác khách hàng với các lô đã chọn (${anchorName}). Chỉ gộp được các lô của cùng một khách hàng.`,
            });
            return;
          }
        } else {
          toast({ kind: 'error', message: refusal });
          return;
        }
      }
    }
    setSelectedLotIds((current) => {
      const set = new Set(current);
      if (next) set.add(shipmentId);
      else set.delete(shipmentId);
      return set;
    });
  };

  const detail = useCusDetail({
    page, pageSize, searchSuffix: suffixParam, transportDateFrom: dateFrom, transportDateTo: dateTo,
    customerId, direction, dispatchStatus, informationStatus, sortKey, sortDir,
  });

  /**
   * Copy giờ hẹn xuống các container của CÙNG lô chưa có lịch (one server
   * call for the whole lot). Feedback lives here, not in the ledger, because
   * this page already owns the mutation surface for the workboard.
   */
  const copyAppointment = useCallback(async (row: ShipmentCusContainerFlatRow): Promise<number> => {
    try {
      const written = await detail.copyAppointment(row);
      if (written > 0) {
        toast({ kind: 'success', message: `Đã copy giờ hẹn sang ${written} container chưa có lịch.` });
      } else {
        // Conflict recovery already swapped in fresh rows — say so rather
        // than implying the copy landed.
        toast({ kind: 'warning', message: 'Lô hàng vừa thay đổi. Đã tải lại danh sách — vui lòng thử copy lại.' });
      }
      return written;
    } catch (error) {
      toast({ kind: 'error', message: error instanceof Error ? error.message : 'Không thể copy giờ hẹn.' });
      return 0;
    }
  }, [detail, toast]);

  /** Card 261013200312: copy số tờ khai xuống các container của CÙNG lô chưa
   *  có số — same feedback contract as the appointment copy above (page owns
   *  the toast; the server reports how many containers it actually wrote). */
  const copyDeclaration = useCallback(async (row: ShipmentCusContainerFlatRow): Promise<number> => {
    try {
      const written = await detail.copyDeclaration(row);
      if (written > 0) {
        toast({ kind: 'success', message: `Đã copy số tờ khai sang ${written} container chưa có số.` });
      } else {
        toast({ kind: 'warning', message: 'Lô hàng vừa thay đổi. Đã tải lại danh sách — vui lòng thử copy lại.' });
      }
      return written;
    } catch (error) {
      toast({ kind: 'error', message: error instanceof Error ? error.message : 'Không thể copy số tờ khai.' });
      return 0;
    }
  }, [detail, toast]);

  /**
   * SIL-592 (id 692) — the CUS staff close for a live external-carrier trip
   * (xe ngoài không dùng app nên CUS chốt thay). Feedback lives here like the
   * copy actions above; the ledger owns only the confirm dialog and busy
   * state. Rejects keep the dialog open for retry.
   */
  const completeExternalTrip = useCallback(async (row: ShipmentCusContainerFlatRow) => {
    if (row.tripId == null) return;
    try {
      await completeDispatchExternalTrip(row.tripId);
      toast({ kind: 'success', message: 'Đã hoàn thành chuyến xe ngoài.' });
      await detail.loadRows();
    } catch (error) {
      toast({ kind: 'error', message: error instanceof Error ? error.message : 'Không thể hoàn thành chuyến xe ngoài.' });
      throw error;
    }
  }, [detail, toast]);

  /** Card 171026122100 (FB-109) auto-sync law — owner ruling 26/10 (SIL-498
   *  lot 257, retiring the SIL-184 "số-cũ đi theo" drag): saving a NON-EMPTY
   *  tờ khai on one container syncs the number onto the lot's STILL-EMPTY
   *  containers inside the same server transaction ONLY; a sibling holding
   *  ANY number — the replaced value included — keeps it (per-cont divergence
   *  stays reachable), and a clear never fans out. The hook reports what
   *  happened and this page owns the toast, matching the copy buttons above.
   *  A plain save (no sibling written) stays silent like every other editor
   *  save;
   *  save errors keep flowing to the editor's inline error channel
   *  untouched. */
  const saveDocuments = useCallback(async (row: ShipmentCusContainerFlatRow, draft: ShipmentDocumentsDraft) => {
    const outcome = await detail.saveDocuments(row, draft);
    if (outcome?.sync && outcome.sync.written > 0) {
      toast({ kind: 'success', message: `Đã lưu số tờ khai và tự đồng bộ sang ${outcome.sync.written} container của lô.` });
    }
  }, [detail, toast]);

  const updateParam = useCallback((key: string, value: string | null) => {
    // SIL-547: any criterion/page write can hide picked lots — the picks drop
    // so the floating bar never counts what the view no longer shows (the
    // settlement board's same law).
    dropPicks();
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value && key === 'transportDateFrom' && next.get('transportDateTo') && value > next.get('transportDateTo')!) return current;
      if (value && key === 'transportDateTo' && next.get('transportDateFrom') && value < next.get('transportDateFrom')!) return current;
      if (!value) next.delete(key);
      else next.set(key, value);
      if (key !== 'page') next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const updateSearch = useCallback((rawValue: string) => {
    const value = rawValue.toUpperCase();
    // Partial input while typing toward a valid reference: any prefix of a
    // valid value must not flash the error, and real references carry
    // separators (see CUS_SEARCH_PATTERN), so the partial class admits them.
    const isEmptyOrPartial = /^[A-Z0-9 ./-]{0,3}$/.test(value);
    const isValid = CUS_SEARCH_PATTERN.test(value);
    setSearchInput(value);
    setSearchError(isEmptyOrPartial || isValid ? null : 'Nhập một phần số Bill/Book, container hoặc tờ khai, tối thiểu 4 ký tự (không dùng % hoặc _).');

    const nextSuffix = isValid ? value : '';
    if (nextSuffix === (latestSearchParams.current.get('searchSuffix') ?? '')) return;
    appliedSearchRef.current = nextSuffix;
    updateParam('searchSuffix', nextSuffix || null);
  }, [latestSearchParams, updateParam]);

  // Both sort params are written in one setSearchParams pass (never via the
  // single-key updateParam) so no intermediate render can pair a new sortBy
  // with a stale sortDir.
  const applySort = useCallback((key: string) => {
    dropPicks();
    setSearchParams((current) => {
      const next = nextTableSort(readTableSort(current.get('sortBy'), current.get('sortDir')), key);
      const nextParams = new URLSearchParams(current);
      nextParams.set('sortBy', next.by);
      nextParams.set('sortDir', next.dir);
      nextParams.delete('page');
      return nextParams;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    if (suffixParam !== (latestSearchParams.current.get('searchSuffix') ?? '')) return;
    if (appliedSearchRef.current === suffixParam) return;
    appliedSearchRef.current = suffixParam;
    setSearchInput(suffixParam);
    setSearchError(null);
  }, [latestSearchParams, suffixParam]);

  const items = detail.data?.items ?? [];
  // ── SIL-547 derived selection facts (mirror the settlement board's): the
  // bar counts every picked row; only UNGROUPED lots feed the merge action.
  const selectedRows = items.filter((row) => selectedLotIds.has(row.shipmentId));
  const mergeableRows = selectedRows.filter((row) => row.revGroupId == null);
  // GP-01 clause — «Tổng X tấn | Y CBM» from the lot rows' own measures; a
  // measure no picked lot carries drops from the clause entirely.
  const selectionMeasureClause = (() => {
    let weight = 0;
    let volume = 0;
    let hasWeight = false;
    let hasVolume = false;
    for (const row of selectedRows) {
      const kg = Number(row.raw.cargoWeightKg);
      if (row.raw.cargoWeightKg != null && Number.isFinite(kg)) { weight += kg; hasWeight = true; }
      const cbm = Number(row.raw.cargoVolumeCbm);
      if (row.raw.cargoVolumeCbm != null && Number.isFinite(cbm)) { volume += cbm; hasVolume = true; }
    }
    return [
      hasWeight ? formatWeight(String(weight)) : null,
      hasVolume ? formatVolumeCbm(String(volume)) : null,
    ].filter(Boolean).join(' | ');
  })();
  const mergeDisabledReason = mergeableRows.length < 2
    ? 'Chọn ít nhất 2 lô lẻ chưa ghép cước để ghép.'
    : null;
  const mergeDisabled = mergeDisabledReason != null;
  // The merge popup's BKS catalog — every plate the loaded page knows (the
  // lot billing pair + the assigned fleet plates), same sourcing law as the
  // ledger's plate suggestions.
  const plateOptions = (() => {
    const plates = new Set<string>();
    for (const row of items) {
      for (const plate of [row.actualTruckNo, row.billingTruckNo, row.plateNumber]) {
        if (plate?.trim()) plates.add(plate.trim());
      }
    }
    return [...plates].map((plate) => ({ value: plate, label: plate, searchText: plate }));
  })();
  // The dialog's structural lot facts — identity + the customer the merge
  // groups by (the wire has no `code`; the labels fall through Bill → tờ khai).
  const dialogRows = mergeableRows.map((row) => ({
    shipmentId: row.shipmentId,
    customerId: row.customerId,
    customerName: row.customerName,
    billOrBookNumber: row.billOrBookNumber ?? '',
    customsNumber: row.declarationNumber,
  }));
  // Card 20260928_193: column visibility for the container ledger. Storage is
  // the key card 20260917_4 shipped for exactly this surface, so an operator who
  // had configured the ledger before the feature was deleted gets their columns
  // back. With no stored choice the default hides Ghi chú only while every
  // rendered row's note cell is empty.
  const ledgerColumns = useHiddenColumns({
    storageKey: 'cus-containers-hidden-cols',
    columns: LEDGER_COLUMNS,
    hasData: (column) => column.key !== 'notes'
      || items.some((row) => Boolean((row.customerNotes ?? '').trim() || (row.operationalNotes ?? '').trim())),
  });
  const totalPages = detail.data?.totalPages ?? 0;
  const totalContainers = detail.data?.total ?? 0;
  const customers = detail.data?.filterOptions.customers ?? [];
  const hasFilters = Boolean(suffixParam || customerId || direction || dateFrom || dateTo || dispatchStatus || informationStatus);

  const resetFilters = () => {
    setDateResetKey((key) => key + 1);
    dropPicks();
    appliedSearchRef.current = '';
    setSearchInput('');
    setSearchError(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('searchSuffix');
      next.delete('customerId');
      next.delete('direction');
      next.delete('informationStatus');
      next.delete('dispatchStatus');
      next.delete('transportDateFrom');
      next.delete('transportDateTo');
      next.set('dateScope', 'all');
      next.delete('page');
      return next;
    }, { replace: true });
  };

  // Card 20260927_152: the four criteria behind `Bộ lọc` — the count feeds the
  // trigger badge, `Đặt lại` clears exactly those four and never the search or
  // the dates.
  const secondaryCount = (customerId ? 1 : 0) + (direction ? 1 : 0) + (dispatchStatus ? 1 : 0) + (informationStatus ? 1 : 0);

  const resetSecondary = () => {
    updateParam('customerId', null);
    updateParam('direction', null);
    updateParam('dispatchStatus', null);
    updateParam('informationStatus', null);
  };

  // One pass writes both date params, so no render pairs a new Từ with a stale
  // Đến. The date fields hand it the range they hold; a quick range asks it to
  // settle `dateScope` as well, because an EMPTY range IS the "Tất cả" scope —
  // without the flag the page would snap back to today the moment both ends are
  // empty.
  const writeDateRange = useCallback((range: DateRangeValue, settleScope: boolean) => {
    dropPicks();
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (range.from) next.set('transportDateFrom', range.from); else next.delete('transportDateFrom');
      if (range.to) next.set('transportDateTo', range.to); else next.delete('transportDateTo');
      if (settleScope) {
        if (range.from || range.to) next.delete('dateScope');
        else next.set('dateScope', 'all');
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const applyDateRange = useCallback((range: DateRangeValue) => writeDateRange(range, false), [writeDateRange]);

  // A quick range also drops a local invalid draft (remount key) — the duty the
  // retired `show*` handlers carried.
  const applyDatePreset = (range: DateRangeValue) => {
    setDateResetKey((key) => key + 1);
    writeDateRange(range, true);
  };

  // The same quick ranges in the two forms the strip needs: boxed chips on the
  // bar (plus the all-dates chip), the ranges alone as a dropdown inside
  // `Bộ lọc` once the bar has folded them there.
  const presetNode = <DateRangePresets presets={[...DATE_RANGE_PRESETS, ALL_DATES_PRESET]} value={{ from: dateFrom, to: dateTo }} onChange={applyDatePreset} ariaLabel="Lọc nhanh theo ngày" />;
  const presetDialogNode = <DateRangePresetSelect presets={DATE_RANGE_PRESETS} value={{ from: dateFrom, to: dateTo }} onChange={applyDatePreset} ariaLabel="Lọc nhanh theo ngày" />;

  return (
    <div className="shipments-detail-page">
      <Breadcrumbs items={[{ label: 'Tổng quan lô hàng', to: '/shipments' }, { label: 'Chi tiết lô hàng' }]} />
      <PageHeader title="Chi tiết lô hàng" iconName="cargo" description="Bảng điều hành có thể chỉnh trực tiếp từng ô dữ liệu được phép của lô hàng và container." />
      {detail.editNotice && <Alert variant="success">{detail.editNotice}</Alert>}

      <section className="shipments-detail-workspace" aria-label="Danh sách container" aria-busy={detail.loading}>
        <div className="shipments-detail-workspace__header">
          <div className="shipments-detail-filters">
            {/* Card 20260927_152: the shared bar. The search, the from/to pair
                and the quick ranges ride the bar; Khách hàng, Nhập/Xuất, Trạng
                thái điều xe and Trạng thái dữ liệu render INLINE while the
                strip still fits two rows and fold into `Bộ lọc (N)` only when
                the width leaves no other choice. Filter semantics identical:
                same params, same handlers, same ranges. */}
            <FilterBar
              search={{
                value: searchInput,
                onChange: updateSearch,
                placeholder: 'Bill/Book, mã lô, container, tờ khai, khách hàng',
                ariaLabel: 'Container, Bill/Booking, mã lô, tờ khai hoặc khách hàng',
                error: searchError,
              }}
              presets={presetNode}
              columns={{
                items: LEDGER_COLUMNS,
                hidden: ledgerColumns.hidden,
                customized: ledgerColumns.customized,
                onToggle: ledgerColumns.toggle,
                onReset: ledgerColumns.reset,
              }}
              actions={(
                /* SIL-547 (spec 23/10 §2) — the [Gộp hàng] toggle LEADS the
                    action slot on this surface exactly like the settlement
                    board's ribbon: it owns the CHỌN column's visibility and
                    the floating bar. */
                <>
                  {canManageMerge && (
                    <LclMergeModeToggle
                      active={mergeMode}
                      onToggle={() => {
                        // The toggle both exits and enters: either way the
                        // picks drop so a reopened mode never shows a stale bar.
                        if (mergeMode) exitMergeMode();
                        else { setSelectedLotIds(new Set()); setMergeMode(true); }
                      }}
                    />
                  )}
                  <UUIButton
                    size="sm"
                    color="secondary"
                    className="shipments-detail-filters__reset"
                    onPress={resetFilters}
                    iconLeading={<RotateCcw aria-hidden="true" />}
                  >
                    Xóa bộ lọc
                  </UUIButton>
                </>
              )}
            >
              {/* Card 20260927_150/151: the from/to dates are the shared
                  DateRangeFields group — two independent single-date fields,
                  no merged trigger and no dual-calendar popover (CHIEF
                  2026-09-27). */}
              <DateRangeFields
                key={`shipments-detail-dates-${dateResetKey}`}
                className="shipments-detail-filter"
                id="shipments-detail-date-range"
                ariaLabel="Khoảng ngày vận chuyển"
                size="sm"
                from={dateFrom}
                to={dateTo}
                onChange={applyDateRange}
              />
              <FilterDropdown
                count={secondaryCount}
                ariaLabel="Bộ lọc"
                dialogLabel="Bộ lọc container"
                presets={presetDialogNode}
                onReset={resetSecondary}
              >
                <UuiSelectField label="Khách hàng" value={customerId ? String(customerId) : ''} onChange={(event) => updateParam('customerId', event.target.value || null)} options={[{ value: '', label: 'Tất cả khách hàng' }, ...customers.map((customer) => ({ value: String(customer.id), label: customer.name }))]} wrapperClassName="shipments-detail-criterion" />
                <UuiSelectField label="Nhập / Xuất" value={direction} onChange={(event) => updateParam('direction', event.target.value || null)} options={[{ value: '', label: 'Tất cả' }, { value: 'IMPORT', label: 'Nhập' }, { value: 'EXPORT', label: 'Xuất' }]} wrapperClassName="shipments-detail-criterion" />
                <UuiSelectField label="Trạng thái điều xe" value={dispatchStatus} onChange={(event) => updateParam('dispatchStatus', event.target.value || null)} options={[{ value: '', label: 'Tất cả' }, ...Object.entries(DISPATCH_STATUS).map(([value, meta]) => ({ value, label: meta.label }))]} wrapperClassName="shipments-detail-criterion" />
                <UuiSelectField label="Trạng thái dữ liệu" value={informationStatus} onChange={(event) => updateParam('informationStatus', event.target.value || null)} options={[{ value: '', label: 'Tất cả' }, { value: 'MISSING', label: 'Chưa cập nhật' }]} wrapperClassName="shipments-detail-criterion" />
              </FilterDropdown>
            </FilterBar>
          </div>
        </div>

        {detail.error && <Alert variant="error" style="soft" className="shipments-detail-error" icon={<AlertCircle size={18} />} action={<UUIButton size="sm" color="secondary" onPress={() => void detail.loadRows()}>Thử lại</UUIButton>}>{detail.error}</Alert>}

        {detail.loading ? <ShipmentContainerLedgerSkeleton /> : detail.error ? null : items.length === 0 ? (
          <EmptyState illustration="/assets/illustrations/empty-container-search-v1.png" title={hasFilters ? 'Không có container phù hợp' : 'Chưa có container'} description={hasFilters ? 'Đổi hoặc xóa bộ lọc để xem lại công việc.' : 'Container của các lô hàng sẽ xuất hiện tại đây.'} action={hasFilters ? <UUIButton size="sm" color="secondary" onPress={resetFilters} iconLeading={<RotateCcw aria-hidden="true" />}>Xóa bộ lọc</UUIButton> : undefined} />
        ) : <>
          <ShipmentContainerLedger rows={items} hiddenColumns={ledgerColumns.hidden} totalContainers={totalContainers} today={today} sort={sort} onSortChange={applySort} mergeMode={canManageMerge && mergeMode} selectedLotIds={selectedLotIds} onSelectLot={selectLot} footer={<Pagination page={page} totalPages={totalPages} pageSize={pageSize} pageSizeOptions={SHIPMENT_CUS_PAGE_SIZES} onPageSizeChange={(nextSize) => updateParam('limit', String(nextSize))} summary={<span className="ds-pagination__summary">Trang này có <b>{formatNumber(items.length)}</b> / <b>{formatNumber(totalContainers)}</b> container phù hợp</span>} onChange={(nextPage) => updateParam('page', String(nextPage))} />} activeEdit={detail.activeEdit} editLoadingRowId={detail.editLoadingRowId} editError={detail.editError} onStartEdit={(row, mode, triggerId) => void detail.startEdit(row, mode, triggerId)} onCancelEdit={detail.cancelEdit} onSaveIdentity={detail.saveIdentity} onSaveDocuments={saveDocuments} onSaveContainer={detail.saveContainer} onSaveRoute={detail.saveRoute} onSaveVehicle={detail.saveVehicle} onSaveSchedule={detail.saveSchedule} onSaveNotes={detail.saveNotes} onCopyAppointment={copyAppointment} onCopyDeclaration={copyDeclaration} onCompleteExternalTrip={canCloseExternal ? completeExternalTrip : undefined} />
          {/* Spec 23/10 §2 — the Bottom Floating Bar (shared lcl-merge.css
              look): «Đang chọn N lô: Tổng X tấn | Y CBM — Lô 1 giữ 100% tiền
              thu khách…» + [Bỏ chọn] + [Gộp hàng] (opens the §4.2 popup).
              Hidden entirely outside the mode or with no picks. */}
          {canManageMerge && mergeMode && selectedRows.length > 0 && (
            <div className="lcl-selection-bar" role="status">
              <span className="lcl-selection-bar__totals">
                {`Đang chọn ${selectedRows.length} lô${selectionMeasureClause ? `: Tổng ${selectionMeasureClause}` : ''}`}
              </span>
              {mergeableRows.length > 0 && (
                <span className="lcl-selection-bar__first" title="Lô 1 giữ 100% tiền thu khách">
                  {`— Lô 1 giữ 100% tiền thu khách: ${mergeableRows[0]?.billOrBookNumber || mergeableRows[0]?.declarationNumber || ''}`}
                </span>
              )}
              <button
                type="button"
                className="lcl-selection-bar__clear"
                onClick={dropPicks}
              >
                Bỏ chọn
              </button>
              <DisabledActionTip id="shipments-detail-bar-merge" reason={mergeDisabledReason}>
                <button
                  type="button"
                  className="lcl-selection-bar__assign"
                  aria-disabled={mergeDisabled || undefined}
                  title="Gộp xe thu khách"
                  onClick={() => { if (mergeDisabled) return; setMergeOpen(true); }}
                >
                  Gộp hàng
                </button>
              </DisabledActionTip>
            </div>
          )}
        </>}
      </section>

      {/* Spec 23/10 §4.2 — the shared «Gộp xe thu khách» popup (3 fields,
          same-customer gate): completing the merge EXITS the mode so the CHỌN
          column hides itself and the bar closes with the group change. */}
      {mergeOpen && dialogRows.length > 0 && (
        <MergeRevGroupDialog
          rows={dialogRows}
          plateOptions={plateOptions}
          onClose={() => setMergeOpen(false)}
          onMerged={() => {
            exitMergeMode();
            void detail.loadRows();
          }}
        />
      )}
    </div>
  );
}
