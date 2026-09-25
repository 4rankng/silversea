import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { ListFilterBar } from '../components/ListFilterBar';
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
import { EmptyState, Pagination, BufferedUuiDateInput, UuiSelectField } from '../design-system';
import { PageHeader } from '../components/UI';
import {
  DISPATCH_STATUS,
  ShipmentContainerLedger,
} from '../features/shipments/detail/ShipmentContainerLedger';
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
  const today = useMemo(() => formatVietnamDateInput(new Date()), []);
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
  const [searchError, setSearchError] = useState<string | null>(null);
  const [dateResetKey, setDateResetKey] = useState(0);
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
  const totalPages = detail.data?.totalPages ?? 0;
  const totalContainers = detail.data?.total ?? 0;
  const customers = detail.data?.filterOptions.customers ?? [];
  const hasFilters = Boolean(suffixParam || customerId || direction || dateFrom || dateTo || dispatchStatus || informationStatus);
  const activeDetailFilterCount = [customerId, direction, dateFrom, dateTo, dispatchStatus, informationStatus].filter(Boolean).length;
  // Phone/tablet: secondary criteria collapse so records start higher.

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

  const showAllDates = () => {
    setDateResetKey((key) => key + 1);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('transportDateFrom');
      next.delete('transportDateTo');
      next.set('dateScope', 'all');
      next.delete('page');
      return next;
    }, { replace: true });
  };

  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return formatVietnamDateInput(d);
  }, []);

  const showToday = () => {
    setDateResetKey((key) => key + 1);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('dateScope');
      next.set('transportDateFrom', today);
      next.set('transportDateTo', today);
      next.delete('page');
      return next;
    }, { replace: true });
  };

  const showTomorrow = () => {
    setDateResetKey((key) => key + 1);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('dateScope');
      next.set('transportDateFrom', tomorrow);
      next.set('transportDateTo', tomorrow);
      next.delete('page');
      return next;
    }, { replace: true });
  };

  return (
    <div className="shipments-detail-page">
      <Breadcrumbs items={[{ label: 'Tổng quan lô hàng', to: '/shipments' }, { label: 'Chi tiết lô hàng' }]} />
      <PageHeader title="Chi tiết lô hàng" iconName="cargo" description="Bảng điều hành có thể chỉnh trực tiếp từng ô dữ liệu được phép của lô hàng và container." />
      {detail.editNotice && <Alert variant="success">{detail.editNotice}</Alert>}

      <section className="shipments-detail-workspace" aria-label="Danh sách container" aria-busy={detail.loading}>
        <div className="shipments-detail-workspace__header">
          <div className="shipments-detail-filters">
            {/* Card 20260922_42: shared ListFilterBar (card _38 contract).
                Search + all controls ride the shared bar in one wrapping row;
                the self-made disclosure chrome is deleted. Filter semantics
                are byte-identical: same params, same handlers, same presets. */}
            <ListFilterBar
              search={{
                value: searchInput,
                onChange: updateSearch,
                placeholder: 'Bill/Book, số container hoặc tờ khai',
                ariaLabel: 'Container, Bill/Booking hoặc tờ khai',
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
              {/* Card 20260925_8 (REBUILD): the pair rides the shared
                  ListFilterBar pair grid — one cell, two dates side by side,
                  the exact pattern Tổng quan lô hàng uses. The bespoke
                  shared label + arrow row is deleted; each input keeps its
                  own compact label. Filter semantics byte-identical. */}
              <div className="list-filter-bar__pair" role="group" aria-label="Khoảng ngày vận chuyển">
                <BufferedUuiDateInput key={`from-${dateResetKey}`} label="Từ ngày" size="sm" value={dateFrom} onChange={(value) => updateParam('transportDateFrom', value || null)} inputProps={{ max: dateTo || undefined }} className="shipments-detail-filter shipments-detail-filter--from" />
                <BufferedUuiDateInput key={`to-${dateResetKey}`} label="Đến ngày" size="sm" value={dateTo} onChange={(value) => updateParam('transportDateTo', value || null)} inputProps={{ min: dateFrom || undefined }} className="shipments-detail-filter shipments-detail-filter--to" />
              </div>
              <UuiSelectField label="Khách hàng" value={customerId ? String(customerId) : ''} onChange={(event) => updateParam('customerId', event.target.value || null)} options={[{ value: '', label: 'Tất cả khách hàng' }, ...customers.map((customer) => ({ value: String(customer.id), label: customer.name }))]} wrapperClassName="shipments-detail-filter shipments-detail-filter--customer" />
              <UuiSelectField label="Nhập / Xuất" value={direction} onChange={(event) => updateParam('direction', event.target.value || null)} options={[{ value: '', label: 'Tất cả' }, { value: 'IMPORT', label: 'Nhập' }, { value: 'EXPORT', label: 'Xuất' }]} wrapperClassName="shipments-detail-filter shipments-detail-filter--direction" />
              <UuiSelectField label="Trạng thái điều xe" value={dispatchStatus} onChange={(event) => updateParam('dispatchStatus', event.target.value || null)} options={[{ value: '', label: 'Tất cả' }, ...Object.entries(DISPATCH_STATUS).map(([value, meta]) => ({ value, label: meta.label }))]} wrapperClassName="shipments-detail-filter shipments-detail-filter--dispatch" />
              <UuiSelectField label="Trạng thái dữ liệu" value={informationStatus} onChange={(event) => updateParam('informationStatus', event.target.value || null)} options={[{ value: '', label: 'Tất cả' }, { value: 'MISSING', label: 'Chưa cập nhật' }]} wrapperClassName="shipments-detail-filter shipments-detail-filter--info" />
              <div className="shipments-detail-presets" role="group" aria-label="Lọc nhanh theo ngày">
                <UUIButton size="sm" color="secondary" onPress={showToday} aria-pressed={dateFrom === today && dateTo === today}>
                  Hôm nay
                </UUIButton>
                <UUIButton size="sm" color="secondary" onPress={showTomorrow} aria-pressed={dateFrom === tomorrow && dateTo === tomorrow}>
                  Hôm sau
                </UUIButton>
                <UUIButton size="sm" color="secondary" onPress={showAllDates} aria-pressed={allDates}>
                  Tất cả
                </UUIButton>
              </div>
            </ListFilterBar>
          </div>
        </div>

        {detail.error && <Alert variant="error" style="soft" className="shipments-detail-error" icon={<AlertCircle size={18} />} action={<UUIButton size="sm" color="secondary" onPress={() => void detail.loadRows()}>Thử lại</UUIButton>}>{detail.error}</Alert>}

        {detail.loading ? <ShipmentContainerLedgerSkeleton /> : detail.error ? null : items.length === 0 ? (
          <EmptyState illustration="/assets/illustrations/empty-container-search-v1.png" title={hasFilters ? 'Không có container phù hợp' : 'Chưa có container'} description={hasFilters ? 'Đổi hoặc xóa bộ lọc để xem lại công việc.' : 'Container của các lô hàng sẽ xuất hiện tại đây.'} action={hasFilters ? <UUIButton size="sm" color="secondary" onPress={resetFilters} iconLeading={<RotateCcw aria-hidden="true" />}>Xóa bộ lọc</UUIButton> : undefined} />
        ) : <>
          <ShipmentContainerLedger rows={items} totalContainers={totalContainers} today={today} sort={sort} onSortChange={applySort} footer={<Pagination page={page} totalPages={totalPages} pageSize={pageSize} pageSizeOptions={SHIPMENT_CUS_PAGE_SIZES} onPageSizeChange={(nextSize) => updateParam('limit', String(nextSize))} summary={<span className="ds-pagination__summary">Trang này có <b>{items.length.toLocaleString('vi-VN')}</b> / <b>{totalContainers.toLocaleString('vi-VN')}</b> container phù hợp</span>} onChange={(nextPage) => updateParam('page', String(nextPage))} />} activeEdit={detail.activeEdit} editLoadingRowId={detail.editLoadingRowId} editError={detail.editError} onStartEdit={(row, mode, triggerId) => void detail.startEdit(row, mode, triggerId)} onCancelEdit={detail.cancelEdit} onSaveIdentity={detail.saveIdentity} onSaveDocuments={detail.saveDocuments} onSaveContainer={detail.saveContainer} onSaveRoute={detail.saveRoute} onSaveVehicle={detail.saveVehicle} onSaveSchedule={detail.saveSchedule} onSaveNotes={detail.saveNotes} />
        </>}
      </section>
    </div>
  );
}
