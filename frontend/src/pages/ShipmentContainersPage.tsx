import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { useQueuedSearchParams } from '../hooks/useQueuedSearchParams';
import {
  SHIPMENT_CUS_CONTAINER_SORT_KEYS,
  type ShipmentCusContainerSortKey,
} from '@tingting/shared';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { Alert } from '../components/shared/Alert';
import { Skeleton } from '../components/shared/Skeleton';
import { Button as UUIButton } from '../components/untitled-ui/base/buttons/button';
import { Input as UUIInput } from '../components/untitled-ui/base/input/input';
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
    page, searchSuffix: suffixParam, transportDateFrom: dateFrom, transportDateTo: dateTo,
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
    setSearchError(isEmptyOrPartial || isValid ? null : 'Nhập số Bill/Book, container hoặc tờ khai đầy đủ, hoặc tối thiểu 4 ký tự cuối (không dùng % hoặc _).');

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
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Column visibility (20260917_4): user-configurable hide/show, persisted in
  // localStorage. The three identity columns (khách hàng, chứng từ, thông số)
  // are pinned and cannot hide — the horizontal-scroll context stays readable.
  const HIDEABLE_COLUMNS: Array<{ key: string; label: string }> = [
    { key: 'route', label: 'Địa điểm nâng / hạ' },
    { key: 'schedule', label: 'Lịch trình' },
    { key: 'vehicle', label: 'Phân xe' },
    { key: 'notes', label: 'Ghi chú' },
    { key: 'status', label: 'Trạng thái' },
  ];
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('cus-containers-hidden-cols') ?? '[]') as string[]; } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem('cus-containers-hidden-cols', JSON.stringify(hiddenColumns)); } catch { /* private mode */ }
  }, [hiddenColumns]);
  const toggleColumn = (key: string) => setHiddenColumns((current) => (
    current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
  ));

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
            <UUIInput label="Container, Bill/Booking hoặc tờ khai" size="sm" icon={Search} value={searchInput} onChange={updateSearch} placeholder="Số đầy đủ hoặc tối thiểu 4 ký tự cuối" hint={searchError ?? undefined} isInvalid={Boolean(searchError)} inputProps={{ maxLength: 64, autoCapitalize: 'characters', autoCorrect: 'off', spellCheck: false }} className="shipments-detail-filter shipments-detail-filter--search" />
            <UUIButton
              type="button"
              size="sm"
              color="secondary"
              className="cus-advanced-toggle"
              aria-label={activeDetailFilterCount > 0 ? `Bộ lọc nâng cao · ${activeDetailFilterCount}` : 'Bộ lọc nâng cao'}
              aria-expanded={advancedOpen}
              aria-controls="cus-detail-advanced-filters"
              onPress={() => setAdvancedOpen((o) => !o)}
              iconLeading={SlidersHorizontal}
            >
              Bộ lọc{activeDetailFilterCount > 0 ? ` · ${activeDetailFilterCount}` : ''}
            </UUIButton>
            <div id="cus-detail-advanced-filters" className="shipments-detail-filters__advanced" data-open={advancedOpen ? '' : undefined}>
              <div className="shipments-detail-filters__group shipments-detail-filters__group--dates">
                <BufferedUuiDateInput key={`from-${dateResetKey}`} label="Từ ngày vận chuyển" size="sm" value={dateFrom} onChange={(value) => updateParam('transportDateFrom', value || null)} inputProps={{ max: dateTo || undefined }} className="shipments-detail-filter" />
                <BufferedUuiDateInput key={`to-${dateResetKey}`} label="Đến ngày vận chuyển" size="sm" value={dateTo} onChange={(value) => updateParam('transportDateTo', value || null)} inputProps={{ min: dateFrom || undefined }} className="shipments-detail-filter" />
              </div>
              <div className="shipments-detail-filters__group shipments-detail-filters__group--selects">
                <UuiSelectField label="Khách hàng" value={customerId ? String(customerId) : ''} onChange={(event) => updateParam('customerId', event.target.value || null)} options={[{ value: '', label: 'Tất cả khách hàng' }, ...customers.map((customer) => ({ value: String(customer.id), label: customer.name }))]} wrapperClassName="shipments-detail-filter" />
                <UuiSelectField label="Nhập / Xuất" value={direction} onChange={(event) => updateParam('direction', event.target.value || null)} options={[{ value: '', label: 'Tất cả' }, { value: 'IMPORT', label: 'Nhập' }, { value: 'EXPORT', label: 'Xuất' }]} wrapperClassName="shipments-detail-filter" />
                <UuiSelectField label="Trạng thái" value={dispatchStatus} onChange={(event) => updateParam('dispatchStatus', event.target.value || null)} options={[{ value: '', label: 'Tất cả' }, ...Object.entries(DISPATCH_STATUS).map(([value, meta]) => ({ value, label: meta.label }))]} wrapperClassName="shipments-detail-filter" />
                <UuiSelectField label="Trạng thái dữ liệu" value={informationStatus} onChange={(event) => updateParam('informationStatus', event.target.value || null)} options={[{ value: '', label: 'Tất cả' }, { value: 'MISSING', label: 'Chưa cập nhật' }]} wrapperClassName="shipments-detail-filter" />
              </div>
            </div>
            <div className="shipments-detail-filters__columns">
              <span className="shipments-detail-filters__columns-label">Cột hiển thị</span>
              {HIDEABLE_COLUMNS.map(({ key, label }) => (
                <label key={key} className="shipments-detail-filters__columns-option">
                  <input
                    type="checkbox"
                    checked={!hiddenColumns.includes(key)}
                    onChange={() => toggleColumn(key)}
                  />
                  {label}
                </label>
              ))}
              <button type="button" className="shipments-detail-filters__reset" onClick={() => setHiddenColumns([])}>Mặc định</button>
            </div>
            <div className="shipments-detail-filters__footer">
              <div className="shipments-detail-filters__date-actions">
                <UUIButton
                  size="sm"
                  color="secondary"
                  onPress={showToday}
                  aria-pressed={dateFrom === today && dateTo === today}
                >
                  Hôm nay
                </UUIButton>
                <UUIButton
                  size="sm"
                  color="secondary"
                  onPress={showTomorrow}
                  aria-pressed={dateFrom === tomorrow && dateTo === tomorrow}
                >
                  Hôm sau
                </UUIButton>
                <UUIButton
                  size="sm"
                  color="secondary"
                  onPress={showAllDates}
                  aria-pressed={allDates}
                >
                  Tất cả
                </UUIButton>
                <UUIButton
                  size="sm"
                  color="secondary"
                  className="shipments-detail-filters__reset"
                  onPress={resetFilters}
                  iconLeading={<RotateCcw aria-hidden="true" />}
                >
                  Xóa bộ lọc
                </UUIButton>
              </div>
            </div>
          </div>
        </div>

        {detail.error && <Alert variant="error" style="soft" className="shipments-detail-error" icon={<AlertCircle size={18} />} action={<UUIButton size="sm" color="secondary" onPress={() => void detail.loadRows()}>Thử lại</UUIButton>}>{detail.error}</Alert>}

        {detail.loading ? <ShipmentContainerLedgerSkeleton /> : detail.error ? null : items.length === 0 ? (
          <EmptyState illustration="/assets/illustrations/empty-container-search-v1.png" title={hasFilters ? 'Không có container phù hợp' : 'Chưa có container'} description={hasFilters ? 'Đổi hoặc xóa bộ lọc để xem lại công việc.' : 'Container của các lô hàng sẽ xuất hiện tại đây.'} action={hasFilters ? <UUIButton size="sm" color="secondary" onPress={resetFilters} iconLeading={<RotateCcw aria-hidden="true" />}>Xóa bộ lọc</UUIButton> : undefined} />
        ) : <>
          <ShipmentContainerLedger rows={items} hiddenColumns={hiddenColumns} totalContainers={totalContainers} today={today} sort={sort} onSortChange={applySort} footer={<Pagination page={page} totalPages={totalPages} summary={<span className="ds-pagination__summary">Trang này có <b>{items.length.toLocaleString('vi-VN')}</b> / <b>{totalContainers.toLocaleString('vi-VN')}</b> container phù hợp</span>} onChange={(nextPage) => updateParam('page', String(nextPage))} />} activeEdit={detail.activeEdit} editLoadingRowId={detail.editLoadingRowId} editError={detail.editError} onStartEdit={(row, mode, triggerId) => void detail.startEdit(row, mode, triggerId)} onCancelEdit={detail.cancelEdit} onSaveIdentity={detail.saveIdentity} onSaveDocuments={detail.saveDocuments} onSaveContainer={detail.saveContainer} onSaveRoute={detail.saveRoute} onSaveVehicle={detail.saveVehicle} onSaveSchedule={detail.saveSchedule} onSaveNotes={detail.saveNotes} copying={detail.copyingAppointment} onCopyAppointmentToEmpty={(row) => void detail.copyAppointmentToEmpty(row)} />
        </>}
      </section>
    </div>
  );
}
