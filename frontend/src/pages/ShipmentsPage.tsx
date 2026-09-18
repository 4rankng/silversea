import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, FileLock2, Loader2, Plus, RotateCcw, Save, Search, SlidersHorizontal, X } from 'lucide-react';
import {
  CUS_SEARCH_PATTERN,
  SHIPMENT_CUS_BUCKET_LABELS,
  SHIPMENT_CUS_WORKSPACE_SORT_KEYS,
  SHIPMENT_DOCUMENT_CUSTODY_LABELS,
  ShipmentCusBucket,
  ShipmentDocumentCustody,
  Role,
  type ShipmentCusWorkspaceListItem,
  type ShipmentCusWorkspaceSortKey,
} from '@tingting/shared';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { StatusSwatch } from '../components/shared/StatusStrip';
import { Drawer, Modal, PageHeader } from '../components/UI';
import { Button as UUIButton } from '../components/untitled-ui/base/buttons/button';
import { Input as UUIInput } from '../components/untitled-ui/base/input/input';
import { EmptyState, Pagination, BufferedUuiDateInput, UuiSelectField } from '../design-system';
import { nextTableSort, readTableSort, type TableSortState } from '../lib/table-sort';
import { SortHeader } from '../components/shared/SortHeader';
import { routes } from '../lib/routes';
import { CusFilterSummary } from '../features/shipments/cus/CusFilterSummary';
import { useAuth } from '../hooks/useAuth';
import { useQueuedSearchParams } from '../hooks/useQueuedSearchParams';
import { parseDateTime24 } from '../lib/format';
import { validateDateInputText } from '../design-system/hooks/useBufferedDateTextValue';
import { useClickOutside } from '../hooks/useClickOutside';
import { FinanceEvidence, ShipmentSignals, WorkflowBadge } from '../features/shipments/cus/CusBadges';
import { ShipmentQuickEditFields } from '../features/shipments/cus/CusQuickEdit';
import { ShipmentDetailContent } from '../features/shipments/cus/CusDetailContent';
import { CusDrawerFooter } from '../features/shipments/cus/CusDrawerFooter';
import type { ContainerLedgerHandle } from '../features/shipments/cus/CusContainerLedger';
import { CusShipmentRow } from '../features/shipments/cus/CusShipmentRow';
import { SHIPMENT_CUS_PAGE_SIZES, readCusPageSize, useCusWorkspaceState } from '../features/shipments/cus/use-cus-workspace-state';
import { useCusQuickEdit } from '../features/shipments/cus/use-cus-quick-edit';
import { factoryDetailPath } from '../features/shipments/cus/cusQuickEditModel';
import { useCusActions } from '../features/shipments/cus/use-cus-actions';
import { exportCusWorksheet } from '../features/shipments/cus/cusExport';
import { appointmentGroupFactorySegment, formatAppointmentGroupLine, quickEditTitle, safeError, SHIPMENT_BUCKET_COLORS } from '../features/shipments/cus/cusUtils';
import '../styles/operational-table-typography.css';
import '../styles/table-sort.css';
import './ShipmentsPage.css';
const BUCKETS = Object.values(ShipmentCusBucket);
export default function ShipmentsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canCreateShipment = user?.role === Role.ADMIN || user?.role === Role.CUS || user?.role === Role.MANAGER;
  const [searchParams, setSearchParams, latestSearchParams] = useQueuedSearchParams();
  const page = Math.max(1, Number(searchParams.get('page') || 1) || 1);
  const pageSize = readCusPageSize(searchParams.get('limit'));
  const suffixParam = searchParams.get('searchSuffix') ?? '';
  const dateFrom = searchParams.get('transportDateFrom') ?? '';
  const dateTo = searchParams.get('transportDateTo') ?? '';
  // 20260917_12: 'true' = chỉ lệnh chạy ngoài, 'false' = chỉ luồng danh mục.
  const adHoc = ['true', 'false'].includes(searchParams.get('adHoc') ?? '')
    ? (searchParams.get('adHoc') as 'true' | 'false')
    : '';
  const rawBucket = searchParams.get('bucket');
  const bucket = BUCKETS.includes(rawBucket as ShipmentCusBucket)
    ? rawBucket as ShipmentCusBucket
    : '';
  const rawDirection = searchParams.get('direction');
  const direction = rawDirection === 'IMPORT' || rawDirection === 'EXPORT' ? rawDirection : '';
  // Column sort lives in the URL like every other workboard param. Unknown
  // keys fall back to the backend's default operational queue order.
  const rawSortBy = searchParams.get('sortBy');
  const sortKey = SHIPMENT_CUS_WORKSPACE_SORT_KEYS.includes(rawSortBy as ShipmentCusWorkspaceSortKey)
    ? rawSortBy as ShipmentCusWorkspaceSortKey
    : null;
  const sortDir = searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc';
  const sort: TableSortState | null = useMemo(() => sortKey ? { by: sortKey, dir: sortDir } : null, [sortKey, sortDir]);

  const [searchInput, setSearchInput] = useState(suffixParam);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [drawerCloseConfirmId, setDrawerCloseConfirmId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [dateResetKey, setDateResetKey] = useState(0);
  const [hasDateDraft, setHasDateDraft] = useState(false);
  const filterFormRef = useRef<HTMLFormElement>(null);
  const containerLedgerRef = useRef<ContainerLedgerHandle | null>(null);

  const ws = useCusWorkspaceState({
    page, pageSize, searchSuffix: suffixParam, transportDateFrom: dateFrom, transportDateTo: dateTo,
    direction, bucket, adHoc, sortKey, sortDir,
  }, drawerId);
  const qe = useCusQuickEdit({
    setError: ws.setError, setNotice: ws.setNotice, loadList: ws.loadList, invalidateDetail: ws.invalidateDetail,
  });
  const actions = useCusActions({
    dirtyDetailIds: ws.dirtyDetailIds, drawerId, setDrawerId,
    setError: ws.setError, setNotice: ws.setNotice, loadList: ws.loadList,
    loadDetail: ws.loadDetail, invalidateDetail: ws.invalidateDetail,
    getIdempotencyKey: ws.getIdempotencyKey, clearIdempotencyKey: ws.clearIdempotencyKey,
  });

  const { loadList, loadDetail, applySavedContainerLine, dirtyDetailIds, savingDetailIds, setDetailDirty, setDetailSaving } = ws;
  const { quickEditDraft, setQuickEditDraft, savingQuickEdit, quickEditError, startQuickEdit, closeQuickEdit, saveQuickEdit } = qe;

  const updateParam = useCallback((key: string, value: string | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      // A second date can arrive before React has rendered the first date's
      // min/max prop. Keep its invalid draft out of the applied URL range.
      if (value && key === 'transportDateFrom' && next.get('transportDateTo') && value > next.get('transportDateTo')!) return current;
      if (value && key === 'transportDateTo' && next.get('transportDateFrom') && value < next.get('transportDateFrom')!) return current;
      if (!value) next.delete(key);
      else next.set(key, value);
      if (key !== 'page') next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => setSearchInput(suffixParam), [suffixParam]);

  // Both sort params are written in one setSearchParams pass so no render can
  // pair a new sortBy with a stale sortDir; sorting resets the page to 1.
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

  const openShipmentDetail = useCallback((shipmentId: number) => {
    setDrawerId(shipmentId);
    void loadDetail(shipmentId);
  }, [loadDetail]);

  const requestCloseMobileDetail = useCallback(() => {
    if (drawerId != null && savingDetailIds.has(drawerId)) {
      ws.setError('Đang lưu dữ liệu container. Vui lòng chờ hoàn tất.');
      return;
    }
    if (drawerId != null && dirtyDetailIds.has(drawerId)) {
      setDrawerCloseConfirmId(drawerId);
      return;
    }
    setDrawerId(null);
  }, [dirtyDetailIds, drawerId, savingDetailIds, ws]);

  const discardMobileDetailChanges = useCallback(() => {
    containerLedgerRef.current?.discardAll();
    if (drawerCloseConfirmId != null) setDetailDirty(drawerCloseConfirmId, false);
    setDrawerCloseConfirmId(null);
    setDrawerId(null);
  }, [drawerCloseConfirmId, setDetailDirty]);

  const validateFilterDates = () => {
    const fromInput = filterFormRef.current?.querySelector<HTMLInputElement>('#cus-filter-date-from');
    const toInput = filterFormRef.current?.querySelector<HTMLInputElement>('#cus-filter-date-to');
    const visibleFrom = fromInput?.value ? parseDateTime24(`00:00 ${fromInput.value}`)?.slice(0, 10) ?? '' : '';
    const visibleTo = toInput?.value ? parseDateTime24(`00:00 ${toInput.value}`)?.slice(0, 10) ?? '' : '';
    // Read the actual draft pair: a rapid submit can precede the next render
    // and its validity effect, so URL state alone is not validation evidence.
    if (fromInput) fromInput.setCustomValidity(validateDateInputText(fromInput.value, '', visibleTo));
    if (toInput) toInput.setCustomValidity(validateDateInputText(toInput.value, visibleFrom));
    const invalidInput = filterFormRef.current?.querySelector<HTMLInputElement>('[data-date-input]:invalid');
    if (!invalidInput) return true;
    setAdvancedOpen(true);
    // Reveal collapsed criteria before moving focus to the invalid draft.
    requestAnimationFrame(() => {
      invalidInput.focus();
      invalidInput.reportValidity();
    });
    return false;
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    if (!validateFilterDates()) return;
    const value = (filterFormRef.current?.querySelector<HTMLInputElement>('#cus-filter-search')?.value ?? searchInput).trim();
    if (value && !CUS_SEARCH_PATTERN.test(value)) {
      setSearchError('Nhập số Bill/Book, container hoặc tờ khai đầy đủ, hoặc tối thiểu 4 ký tự cuối (không dùng % hoặc _).');
      return;
    }
    setSearchError(null);
    updateParam('searchSuffix', value || null);
  };

  // One apply model for the whole bar (2026-09-18): every control applies as it
  // changes — the text search on a short debounce. Enter still applies at once.
  useEffect(() => {
    const value = searchInput.trim();
    if (value === suffixParam) return;
    if (value && !CUS_SEARCH_PATTERN.test(value)) return;
    const timer = setTimeout(() => {
      setSearchError(null);
      updateParam('searchSuffix', value || null);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput, suffixParam, updateParam]);

  const clearFilters = () => {
    setDateResetKey((key) => key + 1);
    setHasDateDraft(false);
    setSearchInput('');
    setSearchError(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      ['searchSuffix', 'transportDateFrom', 'transportDateTo', 'direction', 'bucket', 'adHoc', 'page'].forEach((key) => next.delete(key));
      return next;
    }, { replace: true });
  };

  const items = ws.data?.items ?? [];
  const total = ws.data?.total ?? 0;
  const totalPages = Math.max(1, ws.data?.totalPages ?? Math.ceil(total / pageSize));
  const drawerItem = items.find((item) => item.id === drawerId) ?? (drawerId != null ? ws.details[drawerId]?.summary : null) ?? null;
  const quickEditItem = quickEditDraft
    ? items.find((item) => item.id === quickEditDraft.shipmentId) ?? null
    : null;
  const quickEditFormRef = useRef<HTMLFormElement>(null);
  // Outside pointerdown / global Escape dismisses the Chứng từ quick bubble,
  // matching the ledger inline editors (72725707); paused while saving so a
  // save can't be cancelled mid-flight. The whole .modal__content (head,
  // footer buttons, form) counts as inside — a press on "Lưu thay đổi" in the
  // Modal footer sits outside the form ref and must not cancel the draft —
  // and portaled select popovers keep owning their own interaction.
  useClickOutside(quickEditFormRef, () => {
    if (!savingQuickEdit) closeQuickEdit();
  }, {
    escapeKey: true,
    enabled: quickEditDraft != null && quickEditItem != null,
    ignoreSelector: '.modal__content, .searchable-select__popover, .searchable-select__backdrop, .react-aria-Popover, .time-picker__popup, .time-picker__overlay, .time-picker__sheet, .time-picker__inline, [data-time-picker-overlay], [data-date-picker]',
  });
  const hasFilters = Boolean(suffixParam || dateFrom || dateTo || direction || bucket || adHoc);
  const activeFilterCount = [dateFrom, dateTo, direction, bucket, adHoc].filter(Boolean).length;
  // Phone/tablet: secondary criteria collapse so records start higher.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const exportWorksheet = async () => {
    if (!validateFilterDates()) return;
    setExporting(true);
    ws.setError(null);
    try {
      const current = latestSearchParams.current;
      await exportCusWorksheet({
        searchSuffix: current.get('searchSuffix') ?? '',
        transportDateFrom: current.get('transportDateFrom') ?? '',
        transportDateTo: current.get('transportDateTo') ?? '',
        direction: current.get('direction') === 'IMPORT' ? 'IMPORT' : current.get('direction') === 'EXPORT' ? 'EXPORT' : undefined,
        bucket: BUCKETS.includes(current.get('bucket') as ShipmentCusBucket) ? current.get('bucket') as ShipmentCusBucket : undefined,
      });
    } catch (exportError) {
      ws.setError(safeError(exportError, 'Không thể tải bảng XLSX.'));
    } finally {
      setExporting(false);
    }
  };

  const shipmentActionButton = (item: ShipmentCusWorkspaceListItem) => {
    if (item.action.kind === 'NONE') return null;
    const mode = item.action.kind === 'CONFIRM_FINANCE'
      ? 'confirm'
      : item.action.kind === 'LOCK'
        ? 'lock'
        : 'reopen';
    return (
      <UUIButton
        size="sm"
        color={item.action.enabled ? 'primary' : 'secondary'}
        className="cus-drawer-primary-action"
        isDisabled={!item.action.enabled}
        aria-label={item.action.label}
        aria-describedby={!item.action.enabled && item.action.disabledReason ? `cus-drawer-action-reason-${item.id}` : undefined}
        onPress={() => actions.openAction(item, mode)}
        iconLeading={item.action.kind === 'LOCK' ? <FileLock2 size={16} aria-hidden="true" /> : undefined}
      >
        {item.action.label}
      </UUIButton>
    );
  };

  return (
    <div className="shipments-page shipments-page--worksheet">
      <Breadcrumbs items={[{ label: 'Tổng quan', to: '/dashboard' }, { label: 'Tổng quan lô hàng' }]} />
      <PageHeader
        title="Tổng quan lô hàng"
        iconName="cargo"
        description="Bảng điều hành giao nhận theo từng lô hàng"
        action={canCreateShipment && <UUIButton size="sm" color="primary" className="shipment-uui-button shipment-uui-button--primary cus-create-shipment" onPress={() => navigate(routes.shipmentNew)} iconLeading={<Plus size={17} aria-hidden="true" />}>Tạo lô mới</UUIButton>}
      />

      <section
        className="cus-workspace cus-workspace--worksheet"
        aria-labelledby="cus-workspace-title"
        aria-busy={ws.loading}
        aria-hidden={drawerId != null ? true : false}
        inert={drawerId != null ? true : false}
      >
        <h2 id="cus-workspace-title" className="sr-only">Bảng kế hoạch lô hàng</h2>
        <form ref={filterFormRef} className="cus-worksheet-toolbar" onSubmit={submitSearch} noValidate
          onInput={(event) => { if ((event.target as HTMLElement).matches('[data-date-input]')) setHasDateDraft(true); }}>
          <div className="cus-worksheet-toolbar__filters" aria-label={'Bộ lọc' + (activeFilterCount ? ' đang áp dụng ' + activeFilterCount : '')}>
            <div className="cus-search-field">
              <div className="cus-search-field__anchor">
                <UUIInput
                  id="cus-filter-search"
                  label="Bill/Book hoặc tờ khai"
                  size="sm"
                  icon={Search}
                  value={searchInput}
                  onChange={(value) => {
                    setSearchInput(value);
                    setSearchError(null);
                  }}
                  placeholder="Số đầy đủ hoặc tối thiểu 4 ký tự cuối"
                  inputProps={{
                    inputMode: 'text',
                    pattern: '[A-Za-z0-9 .\\-\\/]{4,64}',
                    autoCapitalize: 'characters',
                    autoCorrect: 'off',
                    spellCheck: false,
                  }}
                  isInvalid={Boolean(searchError)}
                  aria-describedby={searchError ? 'cus-search-error' : undefined}
                  className="shipment-uui-field"
                  wrapperClassName="shipment-uui-control"
                  inputClassName="shipment-uui-control__input shipment-uui-control__input--search"
                  iconClassName="shipment-uui-control__icon"
                  tooltipClassName="cus-search-field__validation-icon"
                />
                {searchInput && (
                  <UUIButton
                    size="sm"
                    color="tertiary"
                    className="shipment-uui-clear"
                    onPress={() => {
                      setSearchInput('');
                      setSearchError(null);
                      updateParam('searchSuffix', null);
                    }}
                    aria-label="Xóa tìm kiếm"
                    iconLeading={<X size={16} aria-hidden="true" />}
                  />
                )}
              </div>
              {searchError && <span id="cus-search-error" className="cus-field-error" role="alert">{searchError}</span>}
            </div>

            <UUIButton
              type="button" size="sm" color="secondary" className="cus-advanced-toggle"
              aria-label="Bộ lọc nâng cao"
              aria-expanded={advancedOpen} aria-controls="cus-advanced-filters"
              onPress={() => setAdvancedOpen((o) => !o)}
              iconLeading={SlidersHorizontal}>
              Bộ lọc{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
            </UUIButton>
            {activeFilterCount > 0 && !advancedOpen && (
              <CusFilterSummary direction={direction} dateFrom={dateFrom} dateTo={dateTo} bucket={bucket} />
            )}
            <div id="cus-advanced-filters" className="cus-worksheet-advanced" data-open={advancedOpen ? '' : undefined}>
              <BufferedUuiDateInput
                id="cus-filter-date-from"
                key={`from-${dateResetKey}`}
                label="Từ ngày giao"
                size="sm"
                value={dateFrom}
                onChange={(value) => updateParam('transportDateFrom', value || null)}
                max={dateTo || undefined}
                className="shipment-uui-field"
                wrapperClassName="shipment-uui-control"
                inputClassName="shipment-uui-control__input"
              />
              <BufferedUuiDateInput
                id="cus-filter-date-to"
                key={`to-${dateResetKey}`}
                label="Đến ngày giao"
                size="sm"
                value={dateTo}
                onChange={(value) => updateParam('transportDateTo', value || null)}
                min={dateFrom || undefined}
                className="shipment-uui-field"
                wrapperClassName="shipment-uui-control"
                inputClassName="shipment-uui-control__input"
              />
              <UuiSelectField
                label="Xuất / Nhập"
                value={direction}
                onChange={(event) => updateParam('direction', event.target.value || null)}
                options={[
                  { value: '', label: 'Tất cả' },
                  { value: 'EXPORT', label: 'Xuất' },
                  { value: 'IMPORT', label: 'Nhập' },
                ]}
                wrapperClassName="shipment-uui-field"
                controlClassName="shipment-uui-select"
              />
              <UuiSelectField
                label="Loại lô"
                value={adHoc}
                onChange={(event) => updateParam('adHoc', event.target.value || null)}
                options={[
                  { value: '', label: 'Tất cả' },
                  { value: 'true', label: 'Lệnh chạy ngoài' },
                  { value: 'false', label: 'Thường' },
                ]}
                wrapperClassName="shipment-uui-field"
                controlClassName="shipment-uui-select"
              />
              <UuiSelectField
                label="Kế hoạch"
                value={bucket}
                onChange={(event) => updateParam('bucket', event.target.value || null)}
                options={[
                  { value: '', label: 'Tất cả trạng thái' },
                  ...BUCKETS.map((value) => ({ value, label: SHIPMENT_CUS_BUCKET_LABELS[value] })),
                ]}
                wrapperClassName="shipment-uui-field"
                controlClassName="shipment-uui-select"
              />
            </div>
          </div>

          {(hasFilters || hasDateDraft) && (
            <UUIButton
              size="sm"
              color="tertiary"
              className="shipment-uui-button shipment-uui-button--tertiary cus-worksheet-toolbar__reset"
              onPress={clearFilters}
              iconLeading={<RotateCcw size={16} aria-hidden="true" />}
            >
              Xóa lọc
            </UUIButton>
          )}
        </form>

        {ws.data && (
          <section className="cus-workspace-summary" aria-label="Tóm tắt ưu tiên xử lý">
            <dl>
              <div className="cus-workspace-summary__item">
                <dt>Lô phù hợp</dt>
                <dd>{total.toLocaleString('vi-VN')}</dd>
              </div>
              <div className="cus-workspace-summary__item cus-workspace-summary__item--warning">
                <dt>Chưa chốt lịch</dt>
                <dd>{ws.data.pageSummary.needsSchedule.toLocaleString('vi-VN')}</dd>
              </div>
              <div className="cus-workspace-summary__item cus-workspace-summary__item--warning">
                <dt>Chờ điều xe</dt>
                <dd>{ws.data.pageSummary.needsVehicle.toLocaleString('vi-VN')}</dd>
              </div>
              <div className="cus-workspace-summary__item cus-workspace-summary__item--info">
                <dt>Chờ đối soát</dt>
                <dd>{ws.data.pageSummary.waitingAccounting.toLocaleString('vi-VN')}</dd>
              </div>
            </dl>
            <UUIButton
              size="sm"
              color="secondary"
              isDisabled={exporting || ws.loading}
              isLoading={exporting}
              className="shipment-uui-button shipment-uui-button--secondary cus-workspace-summary__export"
              onPress={() => void exportWorksheet()}
              iconLeading={<Download size={16} aria-hidden="true" />}
              showTextWhileLoading
            >
              Tải XLSX
            </UUIButton>
          </section>
        )}

        {ws.notice && <div className="cus-notice cus-notice--success" role="status">{ws.notice}</div>}
        {ws.error && (
          <div className="cus-notice cus-notice--error" role="alert">
            <span>{ws.error}</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void loadList()}>Thử lại</button>
          </div>
        )}

        {ws.loading && !ws.data ? (
          <div className="cus-loading"><Loader2 className="spin" aria-hidden="true" /> Đang tải lô hàng…</div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Search}
            title={hasFilters ? 'Không có lô hàng phù hợp' : 'Chưa có lô hàng'}
            description={hasFilters ? 'Điều chỉnh hoặc xóa bộ lọc để xem lại danh sách.' : 'Dữ liệu lô hàng sẽ xuất hiện tại đây.'}
            action={hasFilters ? <button type="button" className="btn btn--secondary" onClick={clearFilters}><RotateCcw size={17} aria-hidden="true" /> Xóa bộ lọc</button> : undefined}
          />
        ) : (
          <>
            <p id="cus-worksheet-instructions" className="sr-only">
              Bảng lô hàng gồm bảy nhóm thông tin. Chọn trực tiếp ô dữ liệu được phép để sửa; nhấn Enter để lưu và Escape để hủy. Mở Chi tiết để chỉnh từng container.
            </p>
            <div className="cus-dashboard-viewport" role="region" aria-label="Bảng tổng hợp lô hàng" aria-describedby="cus-worksheet-instructions" tabIndex={0}>
              <table className="cus-dashboard-table ops-table">
                <caption className="sr-only">Tổng hợp lô hàng theo bảy nhóm thông tin</caption>
                <colgroup>
                  <col className="cus-dashboard-col--customer" />
                  <col className="cus-dashboard-col--documents" />
                  <col className="cus-dashboard-col--classification" />
                  <col className="cus-dashboard-col--cargo" />
                  <col className="cus-dashboard-col--schedule" />
                  <col className="cus-dashboard-col--notes" />
                  <col className="cus-dashboard-col--status" />
                </colgroup>
                <thead><tr>
                  <SortHeader label="Khách hàng &amp; nhà máy" sortKey="customerName" sort={sort} onSortChange={applySort} />
                  <SortHeader label="Chứng từ" sortKey="billOrBookNumber" sort={sort} onSortChange={applySort} />
                  <SortHeader label="Phân loại &amp; hãng tàu" sortKey="shippingLineName" sort={sort} onSortChange={applySort} />
                  <SortHeader label="Tổng quan hàng hóa" sortKey="cargoWeightKg" sort={sort} onSortChange={applySort} />
                  <SortHeader label="Lịch trình &amp; điều xe" sortKey="transportDate" sort={sort} onSortChange={applySort} />
                  <SortHeader label="Ghi chú" sortKey="customerNotes" sort={sort} onSortChange={applySort} />
                  <SortHeader label="Trạng thái" sortKey="status" sort={sort} onSortChange={applySort} />
                </tr></thead>
                <tbody>
                  {items.map((item) => (
                    <CusShipmentRow
                      key={item.id}
                      item={item}
                      dateFrom={dateFrom}
                      dateTo={dateTo}
                      editing={quickEditDraft?.shipmentId === item.id}
                      quickEditOpen={Boolean(quickEditDraft)}
                      savingQuickEdit={savingQuickEdit}
                      onStartQuickEdit={(item, field) => item.cargoMode === 'FCL' && field === 'identity' ? navigate(factoryDetailPath(item)) : startQuickEdit(item, field)}
                      onOpenAction={actions.openAction}
                      onOpenDetail={openShipmentDetail}
                    />
                  ))}
                </tbody>
              </table>
              {total > 0 && (
                <Pagination page={page} totalPages={totalPages} totalItems={total} pageSize={pageSize} pageSizeOptions={SHIPMENT_CUS_PAGE_SIZES} onPageSizeChange={(nextSize) => updateParam('limit', String(nextSize))} onChange={(nextPage) => updateParam('page', String(nextPage))} />
              )}
            </div>
          </>
        )}
      </section>

      <Modal
        isOpen={quickEditDraft != null && quickEditItem != null}
        title={quickEditDraft ? quickEditTitle(quickEditDraft.field) : 'Chỉnh sửa lô hàng'}
        onClose={closeQuickEdit}
        maxWidth={480}
        footer={<>
          <UUIButton size="sm" color="secondary" className="cus-quick-edit-modal__action" onPress={closeQuickEdit} isDisabled={savingQuickEdit}>Hủy</UUIButton>
          <UUIButton
            size="sm"
            color="primary"
            className="cus-quick-edit-modal__action"
            isLoading={savingQuickEdit}
            showTextWhileLoading
            onPress={() => quickEditFormRef.current?.requestSubmit()}
            iconLeading={<Save size={16} aria-hidden="true" />}
          >
            Lưu thay đổi
          </UUIButton>
        </>}
      >
        {quickEditDraft && quickEditItem && (
          <form ref={quickEditFormRef} className="cus-quick-edit-modal"
            aria-busy={savingQuickEdit}
            onSubmit={(event) => {
              event.preventDefault();
              if (!event.currentTarget.reportValidity()) return;
              void saveQuickEdit(quickEditItem);
            }}
          >
            <p className="cus-quick-edit-modal__context">{quickEditItem.billOrBookNumber || quickEditItem.declarationNumber || quickEditItem.customerName || 'Lô hàng'}</p>
            <ShipmentQuickEditFields
              draft={quickEditDraft}
              item={quickEditItem}
              saving={savingQuickEdit}
              error={quickEditError}
              onChange={setQuickEditDraft}
            />
          </form>
        )}
      </Modal>

      <Drawer
        isOpen={drawerId != null}
        onClose={requestCloseMobileDetail}
        title={drawerItem?.customerName || 'Chi tiết lô hàng'}
        subtitle={drawerItem?.billOrBookNumber || drawerItem?.declarationNumber || undefined}
        className="cus-shipment-drawer"
        headerGraphic={drawerItem ? <StatusSwatch color={SHIPMENT_BUCKET_COLORS[drawerItem.bucket]} /> : undefined}
        footer={drawerItem ? <CusDrawerFooter isDirty={dirtyDetailIds.has(drawerItem.id)} isSaving={savingDetailIds.has(drawerItem.id)} onDiscard={() => containerLedgerRef.current?.discardAll()} onSave={() => { void containerLedgerRef.current?.saveAll().then((saved) => { if (saved) setDrawerId(null); }); }} /> : undefined}
      >
        <div id={drawerItem ? `cus-detail-drawer-${drawerItem.id}` : undefined}>
          {drawerItem && (
            <>
              <section className="cus-drawer-workflow" aria-labelledby="cus-drawer-workflow-title">
                <div className="cus-drawer-workflow__heading">
                  <h3 id="cus-drawer-workflow-title">Trạng thái lô</h3>
                  {drawerItem.raw.isAdHoc && <span className="adhoc-label" data-adhoc-label>Chạy ngoài</span>}
                  <WorkflowBadge item={drawerItem} />
                </div>
                <ShipmentSignals item={drawerItem} />

                <div className="cus-drawer-decision-grid" aria-label="Điều kiện xử lý lô hàng">
                  <div className="cus-drawer-decision cus-drawer-decision--schedule">
                    <span className="cus-drawer-decision__label">Lịch cont</span>
                    {drawerItem.appointmentGroups.length > 0 ? (
                      <div className="cus-drawer-decision__appointments">
                        {drawerItem.appointmentGroups.map((group) => (
                          <span key={`${group.at}-${group.factoryName ?? ''}`}>
                            {formatAppointmentGroupLine(group.at, group.localDate)}{appointmentGroupFactorySegment(group.factoryName)} · {group.containerSummary}
                          </span>
                        ))}
                      </div>
                    ) : <strong>Chưa có lịch</strong>}
                  </div>
                  <div className="cus-drawer-decision cus-drawer-decision--custody">
                    <UuiSelectField
                      label="Phơi phiếu"
                      value={drawerItem.documentCustody.status ?? ''}
                      disabled={drawerItem.bucket === ShipmentCusBucket.LOCKED || !drawerItem.documentCustody.available || !drawerItem.documentCustody.editable}
                      onChange={(event) => void actions.updateCustody(drawerItem, event.target.value as ShipmentDocumentCustody)}
                      options={[
                        { value: '', label: 'Chưa xác định', disabled: true },
                        ...Object.values(ShipmentDocumentCustody).map((status) => ({ value: status, label: SHIPMENT_DOCUMENT_CUSTODY_LABELS[status] })),
                      ]}
                      wrapperClassName="cus-drawer-uui-field"
                      controlClassName="cus-drawer-uui-select"
                    />
                  </div>
                  <div className="cus-drawer-decision cus-drawer-decision--finance"><FinanceEvidence item={drawerItem} /></div>
                </div>

                <div className={`cus-drawer-workflow__action cus-drawer-workflow__action--${drawerItem.action.kind === 'NONE' ? 'idle' : drawerItem.action.enabled ? 'ready' : 'blocked'}`}>
                  <div>
                    <strong>{drawerItem.action.kind === 'NONE' ? 'Theo dõi' : drawerItem.action.label}</strong>
                    {!drawerItem.action.enabled && drawerItem.action.disabledReason && <p id={`cus-drawer-action-reason-${drawerItem.id}`}>{drawerItem.action.disabledReason}</p>}
                  </div>
                  {shipmentActionButton(drawerItem)}
                </div>
              </section>

              <ShipmentDetailContent detail={ws.details[drawerItem.id]} loading={ws.detailLoadingIds.has(drawerItem.id)} error={ws.detailErrors[drawerItem.id]} onRetry={() => void loadDetail(drawerItem.id, true)} onLineSaved={(line) => applySavedContainerLine(drawerItem.id, line)} getIdempotencyKey={ws.getIdempotencyKey} clearIdempotencyKey={ws.clearIdempotencyKey} idPrefix="cus-drawer-detail" onDirtyChange={(dirty) => setDetailDirty(drawerItem.id, dirty)} onSavingChange={(saving) => setDetailSaving(drawerItem.id, saving)} actionsRef={containerLedgerRef} onExternalTripCompleted={() => void loadDetail(drawerItem.id, true)} onAppointmentSavedAndExit={requestCloseMobileDetail} />
            </>
          )}
        </div>
      </Drawer>

      <Modal
        isOpen={drawerCloseConfirmId != null}
        title="Bỏ thay đổi container?"
        onClose={() => setDrawerCloseConfirmId(null)}
        footer={(
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setDrawerCloseConfirmId(null)}>Tiếp tục chỉnh sửa</button>
            <button type="button" className="btn btn--secondary" onClick={discardMobileDetailChanges}>Bỏ thay đổi và đóng</button>
          </>
        )}
      >
        <p>Có thay đổi container chưa lưu. Hãy lưu dữ liệu hoặc xác nhận bỏ thay đổi trước khi đóng.</p>
      </Modal>

      <Modal
        isOpen={Boolean(actions.actionItem && actions.actionMode)}
        title={actions.actionMode === 'confirm' ? 'Xác nhận nguồn chi phí' : actions.actionMode === 'lock' ? 'Xác nhận khóa lô' : actions.actionMode === 'delete' ? 'Xóa lô hàng' : 'Điều chỉnh lô hàng'}
        onClose={actions.closeAction}
        onConfirm={() => void actions.submitAction()}
        footer={(
          <>
            <button type="button" className="btn btn--ghost" onClick={actions.closeAction} disabled={actions.submitting}>Hủy</button>
            <button type="button" className="btn btn--primary" onClick={() => void actions.submitAction()} disabled={actions.submitting || !actions.reason.trim()}>
              {actions.submitting ? <Loader2 className="spin" size={17} aria-hidden="true" /> : null}
              {actions.actionMode === 'confirm' ? 'Xác nhận chi phí' : actions.actionMode === 'lock' ? 'Khóa lô' : actions.actionMode === 'delete' ? 'Xóa lô hàng' : 'Gửi điều chỉnh'}
            </button>
          </>
        )}
      >
        {actions.actionMode === 'confirm' ? (
          <p>Xác nhận này chụp lại phiên bản Debit Note, chuyến xe và chi phí hiện hành. Nếu nguồn thay đổi, xác nhận sẽ hết hiệu lực.</p>
        ) : actions.actionMode === 'lock' ? (
          <p>Khóa lô sẽ chuyển toàn bộ trường nhập và tệp tải lên sang chế độ chỉ đọc. Chỉ người có quyền mở khóa mới có thể mở lại dữ liệu.</p>
        ) : actions.actionMode === 'delete' ? (
          <p>Xóa lô hàng sẽ loại bỏ hoàn toàn dữ liệu. Thao tác không thể hoàn tác.</p>
        ) : (
          <p>Ghi rõ lý do điều chỉnh.</p>
        )}
        <label className="cus-action-reason">
          <span>{actions.actionMode === 'confirm' ? 'Lý do xác nhận' : actions.actionMode === 'lock' ? 'Lý do khóa' : actions.actionMode === 'delete' ? 'Lý do xóa' : 'Lý do điều chỉnh'}</span>
          <textarea value={actions.reason} onChange={(event) => actions.setReason(event.target.value)} rows={4} maxLength={500} required autoFocus />
          <small>{actions.reason.length}/500 ký tự</small>
        </label>
      </Modal>
    </div>
  );
}
