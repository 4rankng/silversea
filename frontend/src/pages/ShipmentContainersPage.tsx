import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { FilterDropdown } from '../components/FilterDropdown';
import { useQueuedSearchParams } from '../hooks/useQueuedSearchParams';
import {
  SHIPMENT_CUS_CONTAINER_SORT_KEYS,
  SHIPMENT_CUS_PAGE_SIZES,
  type ShipmentCusContainerSortKey,
} from '@tingting/shared';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { Alert } from '../components/shared/Alert';
import { Skeleton } from '../components/shared/Skeleton';
import { Button as UUIButton } from '../components/untitled-ui/base/buttons/button';
import { DateRangeFields, DateRangePresets, DateRangePresetSelect, EmptyState, FilterBar, Pagination, type DateRangePreset, type DateRangeValue, UuiSelectField } from '../design-system';
import { PageHeader } from '../components/UI';
import {
  DISPATCH_STATUS,
  LEDGER_COLUMNS,
  ShipmentContainerLedger,
} from '../features/shipments/detail/ShipmentContainerLedger';
import { useHiddenColumns } from '../hooks/useHiddenColumns';
import { useVietnamToday } from '../hooks/useVietnamToday';
import { formatVietnamDateInput } from '../lib/shipment-operations';
import { nextTableSort, readTableSort } from '../lib/table-sort';
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
import { formatNumber } from '../../lib/format';

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

  const detail = useCusDetail({
    page, pageSize, searchSuffix: suffixParam, transportDateFrom: dateFrom, transportDateTo: dateTo,
    customerId, direction, dispatchStatus, informationStatus, sortKey, sortDir,
  });

  const updateParam = useCallback((key: string, value: string | null) => {
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
                placeholder: 'Bill/Book, container, tờ khai',
                ariaLabel: 'Container, Bill/Booking hoặc tờ khai',
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
                <UUIButton
                  size="sm"
                  color="secondary"
                  className="shipments-detail-filters__reset"
                  onPress={resetFilters}
                  iconLeading={<RotateCcw aria-hidden="true" />}
                >
                  Xóa bộ lọc
                </UUIButton>
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
          <ShipmentContainerLedger rows={items} hiddenColumns={ledgerColumns.hidden} totalContainers={totalContainers} today={today} sort={sort} onSortChange={applySort} footer={<Pagination page={page} totalPages={totalPages} pageSize={pageSize} pageSizeOptions={SHIPMENT_CUS_PAGE_SIZES} onPageSizeChange={(nextSize) => updateParam('limit', String(nextSize))} summary={<span className="ds-pagination__summary">Trang này có <b>{formatNumber(items.length)}</b> / <b>{formatNumber(totalContainers)}</b> container phù hợp</span>} onChange={(nextPage) => updateParam('page', String(nextPage))} />} activeEdit={detail.activeEdit} editLoadingRowId={detail.editLoadingRowId} editError={detail.editError} onStartEdit={(row, mode, triggerId) => void detail.startEdit(row, mode, triggerId)} onCancelEdit={detail.cancelEdit} onSaveIdentity={detail.saveIdentity} onSaveDocuments={detail.saveDocuments} onSaveContainer={detail.saveContainer} onSaveRoute={detail.saveRoute} onSaveVehicle={detail.saveVehicle} onSaveSchedule={detail.saveSchedule} onSaveNotes={detail.saveNotes} />
        </>}
      </section>
    </div>
  );
}
