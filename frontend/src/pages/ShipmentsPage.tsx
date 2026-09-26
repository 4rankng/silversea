import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileLock2, FileSpreadsheet, Loader2, Plus, RotateCcw, Save, Search } from 'lucide-react';
import {
  CUS_SEARCH_PATTERN,
  SHIPMENT_CUS_WORKSPACE_SORT_KEYS,
  SHIPMENT_CUS_BUCKET_LABELS,
  SHIPMENT_DOCUMENT_CUSTODY_LABELS,
  ShipmentCusBucket,
  ShipmentDocumentCustody,
  Role,
  type ShipmentCusWorkspaceListItem,
  type ShipmentCusWorkspaceListResponse,
  type ShipmentCusWorkspaceSortKey,
} from '@tingting/shared';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { ShipmentActionModal } from '../components/shipments/ShipmentActionModal';
import { StatusSwatch } from '../components/shared/StatusStrip';
import { Drawer, Modal } from '../components/UI';
import { Button as UUIButton } from '../components/untitled-ui/base/buttons/button';
import { DateRangePopover, EmptyState, InlineLabelSelect, Pagination, SearchableMultiSelect, Tabs, UuiSelectField } from '../design-system';
import { nextTableSort, readTableSort, type TableSortState } from '../lib/table-sort';
import { SortHeader } from '../components/shared/SortHeader';
import { routes } from '../lib/routes';
import { useAuth } from '../hooks/useAuth';
import { useQueuedSearchParams } from '../hooks/useQueuedSearchParams';
import { useClickOutside } from '../hooks/useClickOutside';
import { isOverlayOpen } from '../lib/overlayState';
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

// Card 20260923_1 — the drawer's Xóa lô answers with a reason instead of
// vanishing. The dispatched wording is the lifecycle guard's own message
// (shipment-lifecycle softDeleteShipment), so the inline banner and the 409
// the API would raise say the same thing.
const LOT_DELETE_BLOCK_MESSAGES = {
  containers: 'Chưa xoá hết container — hãy xoá bớt/xoá hết container trước khi xoá lô',
  dispatched: 'Không thể xóa lô hàng đã có container được điều xe. Chỉ xóa được khi mọi container chưa phát lệnh.',
} as const;

// Card 20260926_47 — Row 1 status tabs. Each tab is a lens over the current
// page, matching the pageSummary vocabulary the API already reports (the
// workspace list endpoint has no server-side status param — the slice is
// client-side over the loaded page, so "Tất cả" counts come from `total`
// while the three readiness tabs count the current page, exactly like the
// summary rail they replace).
const LOT_STATUS_TABS = [
  {
    id: 'all',
    label: 'Tất cả',
    countTone: undefined,
    countOf: (summary: ShipmentCusWorkspaceListResponse['pageSummary'], total: number) => total,
    matches: () => true,
  },
  {
    id: 'needsSchedule',
    label: 'Chưa chốt lịch',
    countTone: undefined,
    countOf: (summary: ShipmentCusWorkspaceListResponse['pageSummary']) => summary.needsSchedule,
    matches: (item: ShipmentCusWorkspaceListItem) => item.operational.scheduleReadiness === 'WAITING_DATE',
  },
  {
    id: 'needsVehicle',
    label: 'Chờ điều xe',
    countTone: 'warning' as const,
    countOf: (summary: ShipmentCusWorkspaceListResponse['pageSummary']) => summary.needsVehicle,
    matches: (item: ShipmentCusWorkspaceListItem) => (
      item.operational.vehicleReadiness === 'WAITING_CARRIER' || item.operational.vehicleReadiness === 'WAITING_PLATE'
    ),
  },
  {
    id: 'waitingAccounting',
    label: 'Chờ đối soát',
    countTone: 'info' as const,
    countOf: (summary: ShipmentCusWorkspaceListResponse['pageSummary']) => summary.waitingAccounting,
    matches: (item: ShipmentCusWorkspaceListItem) => (
      item.activeLock == null
      && (item.accountingConfirmation.status === 'PENDING' || item.accountingConfirmation.status === 'STALE')
    ),
  },
] as const;

// Valid plan buckets — same derivation the shared WorkboardFilters uses.
const LOT_PLAN_BUCKETS = Object.values(ShipmentCusBucket);

// Card 20260926_48 — 1-click ranges for the date-range popover. Evaluated on
// click so the ranges stay anchored to "today" whenever the operator opens it.
const toISODate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const LOT_DATE_PRESETS = [
  { id: 'today', label: 'Hôm nay', range: () => { const t = new Date(); return { from: toISODate(t), to: toISODate(t) }; } },
  { id: 'yesterday', label: 'Hôm qua', range: () => { const y = new Date(); y.setDate(y.getDate() - 1); return { from: toISODate(y), to: toISODate(y) }; } },
  { id: 'last7', label: '7 ngày qua', range: () => { const from = new Date(); from.setDate(from.getDate() - 6); return { from: toISODate(from), to: toISODate(new Date()) }; } },
  { id: 'thisMonth', label: 'Tháng này', range: () => { const now = new Date(); return { from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0)) } } },
];

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
  const rawDirection = searchParams.get('direction');
  const direction = rawDirection === 'IMPORT' || rawDirection === 'EXPORT' ? rawDirection : '';
  // Card 20260926_47: the status tabs are URL state. Values are the
  // pageSummary keys — the same vocabulary the API reports counts in.
  const rawStatus = searchParams.get('status');
  const statusTab = LOT_STATUS_TABS.find((tab) => tab.id === rawStatus)?.id ?? '';
  // Card 20260926_48: Kế hoạch is a multi-select combobox. The API keeps a
  // single-valued bucket, so exactly one selection filters server-side while
  // two or more ride the same client-side lens as the status tabs.
  const selectedBuckets = searchParams.getAll('bucket').filter((value) => (
    LOT_PLAN_BUCKETS.includes(value as ShipmentCusBucket)
  ));
  // Column sort lives in the URL like every other workboard param. Unknown
  // keys fall back to the backend's default operational queue order.
  const rawSortBy = searchParams.get('sortBy');
  const sortKey = SHIPMENT_CUS_WORKSPACE_SORT_KEYS.includes(rawSortBy as ShipmentCusWorkspaceSortKey)
    ? rawSortBy as ShipmentCusWorkspaceSortKey
    : null;
  const sortDir = searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc';
  const sort: TableSortState | null = useMemo(() => sortKey ? { by: sortKey, dir: sortDir } : null, [sortKey, sortDir]);

  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [drawerCloseConfirmId, setDrawerCloseConfirmId] = useState<number | null>(null);
  // Card 20260923_1: the drawer's Xóa lô stays reachable at every state and
  // answers with a reason instead of vanishing. The stored value is the BLOCK
  // KIND (not a message) so the banner self-heals: once the blocking condition
  // stops holding, the derived message is empty without an extra effect.
  const [deleteLotBlock, setDeleteLotBlock] = useState<{ shipmentId: number; kind: 'containers' | 'dispatched' } | null>(null);
  const [exporting, setExporting] = useState(false);
  const containerLedgerRef = useRef<ContainerLedgerHandle | null>(null);
  // Card 20260922_42: the toolbar's draft state moved page-side — search
  // applies on the same 350ms debounce with the same silent pattern-skip;
  // dateResetKey clears the buffered date drafts; the export gate validates
  // the same two date inputs by id inside the bar container.
  const [searchInput, setSearchInput] = useState(suffixParam);
  // Card 20260926_49: '/' focus + Esc clear target.
  const searchFieldRef = useRef<HTMLInputElement>(null);

  const ws = useCusWorkspaceState({
    page, pageSize, searchSuffix: suffixParam, transportDateFrom: dateFrom, transportDateTo: dateTo,
    direction, bucket: selectedBuckets.length === 1 ? (selectedBuckets[0] as ShipmentCusBucket) : '', adHoc, sortKey, sortDir,
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
      if (!value) next.delete(key);
      else next.set(key, value);
      if (key !== 'page') next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Card 20260926_48: the date-range popover writes both params in one pass
  // (it guarantees from <= to), and Kế hoạch writes its bucket set in one
  // pass — repeated `bucket` params, one per selection.
  const applyDateRange = useCallback((range: { from: string; to: string }) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (range.from) next.set('transportDateFrom', range.from); else next.delete('transportDateFrom');
      if (range.to) next.set('transportDateTo', range.to); else next.delete('transportDateTo');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const updateBuckets = useCallback((values: string[]) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('bucket');
      for (const value of values) next.append('bucket', value);
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // One apply model for the whole bar (2026-09-18): every control applies as
  // it changes — the text search on a short debounce. Pattern-violating text
  // never reaches the URL (silent skip, same as the pre-cutover debounce).
  useEffect(() => {
    const value = searchInput.trim();
    if (value === suffixParam) return;
    if (value && !CUS_SEARCH_PATTERN.test(value)) return;
    const timer = setTimeout(() => {
      updateParam('searchSuffix', value || null);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput, suffixParam, updateParam]);

  // Card 20260926_49 — grid keyboard nav: '/' focuses the search field,
  // Escape clears its draft (or blurs when empty), Alt+N opens Tạo lô mới.
  // Keys stay quiet while typing in any field and while the drawer or a
  // modal owns the screen — a stray hotkey must never navigate away from a
  // dirty edit.
  useEffect(() => {
    // Capture phase: closed-popover Escape guards used to stopPropagation at
    // document level before a bubble listener could see the key. The overlay
    // registry keeps the house contract — while any overlay is open, its own
    // Escape owns the press and these shortcuts yield.
    const onKeyDown = (event: KeyboardEvent) => {
      if (isOverlayOpen()) return;
      if (drawerId != null || quickEditDraft != null || deleteLotBlock != null) return;
      const target = event.target as HTMLElement | null;
      const isTextField = Boolean(target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]'));
      if (event.key === '/' && !isTextField) {
        event.preventDefault();
        searchFieldRef.current?.focus();
        return;
      }
      if (event.altKey && (event.key === 'n' || event.code === 'KeyN') && !isTextField) {
        event.preventDefault();
        navigate(routes.shipmentNew);
        return;
      }
      if (event.key === 'Escape' && document.activeElement === searchFieldRef.current) {
        event.preventDefault();
        if (searchInput.trim() !== '') setSearchInput('');
        else searchFieldRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [drawerId, quickEditDraft, deleteLotBlock, navigate, searchInput]);

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
    setDeleteLotBlock(null);
    void loadDetail(shipmentId);
  }, [loadDetail]);

  // Card 20260923_1: Xóa lô lives in the drawer header — blocked with an
  // inline error while any container remains (ruling: clear the containers
  // first), and with the lifecycle guard's own reason when a trip already left
  // the lot (deletable=false). Only the clear case routes into the existing
  // confirmed delete flow with its API guards (đã điều xe / đã phát sinh).
  const requestDeleteLot = useCallback((item: ShipmentCusWorkspaceListItem) => {
    if ((ws.details[item.id]?.containers.length ?? 0) > 0) {
      setDeleteLotBlock({ shipmentId: item.id, kind: 'containers' });
      return;
    }
    if (!item.operational.deletable) {
      setDeleteLotBlock({ shipmentId: item.id, kind: 'dispatched' });
      return;
    }
    setDeleteLotBlock(null);
    actions.openAction(item, 'delete');
  }, [actions, ws.details]);

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




  const clearFiltersUrl = () => {
    setSearchInput('');
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      ['searchSuffix', 'transportDateFrom', 'transportDateTo', 'direction', 'bucket', 'adHoc', 'status', 'page'].forEach((key) => next.delete(key));
      return next;
    }, { replace: true });
  };

  const items = ws.data?.items ?? [];
  const total = ws.data?.total ?? 0;
  // Card 20260926_47: the active status tab is a lens over the loaded page —
  // the list endpoint has no server-side status param, so the tab slices the
  // current page locally and its counts are the pageSummary numbers the old
  // summary rail displayed.
  const statusTabDef = LOT_STATUS_TABS.find((tab) => tab.id === statusTab) ?? LOT_STATUS_TABS[0];
  // Plain filter, not useMemo: `items` is rebuilt every render (ws.data?.items
  // ?? []) so a memo here both buys nothing and trips exhaustive-deps.
  // Kế hoạch lens (card _48): with two or more buckets the API keeps the
  // unfiltered page and this predicate slices it, same as the status tabs.
  const bucketLens = selectedBuckets.length >= 2 ? (item: ShipmentCusWorkspaceListItem) => selectedBuckets.includes(item.bucket) : null;
  const visibleItems = items.filter(statusTabDef.matches).filter((item) => (bucketLens ? bucketLens(item) : true));
  const totalPages = Math.max(1, ws.data?.totalPages ?? Math.ceil(total / pageSize));
  const drawerItem = items.find((item) => item.id === drawerId) ?? (drawerId != null ? ws.details[drawerId]?.summary : null) ?? null;
  // Derived, not stored: the banner clears itself the moment the blocking
  // condition stops holding (e.g. the last container is removed).
  const drawerContainerCount = drawerId != null ? ws.details[drawerId]?.containers.length ?? 0 : 0;
  const lotDeleteBlockKind = deleteLotBlock != null && deleteLotBlock.shipmentId === drawerItem?.id ? deleteLotBlock.kind : null;
  const lotDeleteMessage = lotDeleteBlockKind === 'containers' && drawerContainerCount > 0
    ? LOT_DELETE_BLOCK_MESSAGES.containers
    : lotDeleteBlockKind === 'dispatched' && drawerItem != null && !drawerItem.operational.deletable
      ? LOT_DELETE_BLOCK_MESSAGES.dispatched
      : null;
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
  const hasFilters = Boolean(suffixParam || dateFrom || dateTo || direction || selectedBuckets.length > 0 || adHoc || statusTab);
  const exportWorksheet = async () => {
    setExporting(true);
    ws.setError(null);
    try {
      const current = latestSearchParams.current;
      await exportCusWorksheet({
        searchSuffix: current.get('searchSuffix') ?? '',
        transportDateFrom: current.get('transportDateFrom') ?? '',
        transportDateTo: current.get('transportDateTo') ?? '',
        direction: current.get('direction') === 'IMPORT' ? 'IMPORT' : current.get('direction') === 'EXPORT' ? 'EXPORT' : undefined,
        bucket: LOT_PLAN_BUCKETS.includes(current.get('bucket') as ShipmentCusBucket) ? current.get('bucket') as ShipmentCusBucket : undefined,
      });
      ws.setNotice('Đã tải bảng XLSX.');
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
      {/* Card 20260926_47 — the control surface: Row 1 locks to one 36px
          baseline carrying title + segmented status tabs + the action cluster
          (Tải XLSX ghost before + Tạo lô mới primary). The old header chrome and
          the summary rail are gone — the rail's four numbers became the tab
          counts, and export moved up here from the rail. */}
      <header className="shipments-control">
        <div className="shipments-control__row shipments-control__row--primary">
          <h1 className="shipments-control__title">Tổng quan lô hàng</h1>
          {ws.data ? (
            <Tabs
              className="shipments-control__tabs"
              variant="boxed"
              ariaLabel="Trạng thái lô hàng"
              value={statusTab || 'all'}
              onChange={(id) => updateParam('status', id === 'all' ? null : id)}
              tabs={LOT_STATUS_TABS.map((tab) => ({
                id: tab.id,
                label: tab.label,
                count: tab.countOf(ws.data!.pageSummary, total),
                countTone: tab.countTone,
              }))}
            />
          ) : null}
          <div className="shipments-control__actions">
            <UUIButton
              size="sm"
              color="tertiary"
              isDisabled={exporting || ws.loading}
              isLoading={exporting}
              showTextWhileLoading
              className="shipment-uui-button shipment-uui-button--tertiary shipments-control__export"
              onPress={() => void exportWorksheet()}
              iconLeading={<FileSpreadsheet size={16} aria-hidden="true" />}
            >
              Tải XLSX
            </UUIButton>
            {canCreateShipment && (
              <UUIButton
                size="sm"
                color="primary"
                className="shipment-uui-button shipment-uui-button--primary cus-create-shipment"
                iconLeading={<Plus size={17} aria-hidden="true" />}
                onPress={() => navigate(routes.shipmentNew)}
              >
                Tạo lô mới
              </UUIButton>
            )}
          </div>
        </div>
        {/* Row 2 (filters) lands with card 20260926_48. */}
      </header>

      <section
        className="cus-workspace cus-workspace--worksheet"
        aria-labelledby="cus-workspace-title"
        aria-busy={ws.loading}
        aria-hidden={drawerId != null ? true : false}
        inert={drawerId != null ? true : false}
      >
        <h2 id="cus-workspace-title" className="sr-only">Bảng kế hoạch lô hàng</h2>
        {/* Card 20260926_48 — Row 2: one uniform 32px toolbar. Search carries
            the ⌘K badge (hotkeys land with card _49); the date-range popover
            replaces the two Từ/Đến inputs; Hướng/Loại are label-inside chips;
            Kế hoạch is a multi-select combobox. Xóa lọc rides the row end and
            shows only when a filter deviates from default. */}
        <div className="shipments-control__row shipments-control__row--filters">
          <div className="shipments-control__search">
            <Search size={14} aria-hidden="true" />
            <input
              ref={searchFieldRef}
              type="text"
              aria-label="Tìm lô hàng"
              placeholder="Bill, Book, Cont, Tờ khai..."
              title="Nhấn / để tìm kiếm · Esc để xóa"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            <kbd className="shipments-control__kbd" title="Nhấn / để tìm kiếm · Esc để xóa · Alt+N để tạo lô mới" aria-hidden="true">⌘K</kbd>
          </div>
          <DateRangePopover
            className="shipments-control__range"
            id="lot-date-range"
            size="sm"
            ariaLabel="Khoảng ngày giao"
            value={{ from: dateFrom, to: dateTo }}
            presets={LOT_DATE_PRESETS}
            onChange={applyDateRange}
          />
          <InlineLabelSelect
            className="shipments-control__chip"
            id="lot-direction-filter"
            label="Hướng"
            ariaLabel="Hướng vận chuyển"
            items={[{ id: '', label: 'Tất cả' }, { id: 'EXPORT', label: 'Xuất' }, { id: 'IMPORT', label: 'Nhập' }]}
            selectedKey={direction}
            onSelectionChange={(key) => updateParam('direction', key || null)}
          />
          <InlineLabelSelect
            className="shipments-control__chip"
            id="lot-kind-filter"
            label="Loại"
            ariaLabel="Loại lô"
            items={[{ id: '', label: 'Tất cả' }, { id: 'true', label: 'Lệnh chạy ngoài' }, { id: 'false', label: 'Thường' }]}
            selectedKey={adHoc}
            onSelectionChange={(key) => updateParam('adHoc', key || null)}
          />
          <SearchableMultiSelect
            className="shipments-control__plan"
            id="lot-plan-filter"
            size="sm"
            values={selectedBuckets}
            onChange={updateBuckets}
            options={LOT_PLAN_BUCKETS.map((value) => ({ value, label: SHIPMENT_CUS_BUCKET_LABELS[value] }))}
            placeholder="Kế hoạch"
            selectionLabel="kế hoạch"
            countSuffix="đã chọn"
            clearAllLabel="Bỏ chọn"
          />
          {hasFilters && (
            <UUIButton
              type="button"
              size="sm"
              color="tertiary"
              className="shipment-uui-button shipment-uui-button--tertiary shipments-control__reset"
              onPress={clearFiltersUrl}
              iconLeading={<RotateCcw size={15} aria-hidden="true" />}
            >
              Xóa lọc
            </UUIButton>
          )}
        </div>


        {ws.notice && <div className="cus-notice cus-notice--success" role="status">{ws.notice}</div>}
        {ws.error && (
          <div className="cus-notice cus-notice--error" role="alert">
            <span>{ws.error}</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void loadList()}>Thử lại</button>
          </div>
        )}

        {ws.loading && !ws.data ? (
          <div className="cus-loading"><Loader2 className="spin" aria-hidden="true" /> Đang tải lô hàng…</div>
        ) : visibleItems.length === 0 ? (
          <EmptyState
            icon={Search}
            title={hasFilters ? 'Không có lô hàng phù hợp' : 'Chưa có lô hàng'}
            description={hasFilters ? 'Điều chỉnh hoặc xóa bộ lọc để xem lại danh sách.' : 'Dữ liệu lô hàng sẽ xuất hiện tại đây.'}
            action={hasFilters ? <button type="button" className="btn btn--secondary" onClick={clearFiltersUrl}><RotateCcw size={17} aria-hidden="true" /> Xóa bộ lọc</button> : undefined}
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
                  {visibleItems.map((item) => (
                    <CusShipmentRow
                      key={item.id}
                      item={item}
                      dateFrom={dateFrom}
                      dateTo={dateTo}
                      editing={quickEditDraft?.shipmentId === item.id}
                      quickEditOpen={Boolean(quickEditDraft)}
                      savingQuickEdit={savingQuickEdit}
                      onStartQuickEdit={(item, field) => {
                        // Card 20260923_1: the cargo cell returns to quick-edit
                        // for every cargo mode — container composition is
                        // managed in the drawer now. FCL identity keeps the
                        // per-container factory workspace (rest of _41).
                        if (item.cargoMode === 'FCL' && field === 'identity') return navigate(factoryDetailPath(item));
                        startQuickEdit(item, field);
                      }}
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
              {/* Card 20260923_1: the lot-delete affordance lives in the drawer
                  header — topmost row of the drawer body. It stays reachable in
                  every state and answers with a reason (containers first, then
                  the lifecycle guard) instead of disappearing. */}
              <div className="cus-drawer-lot-bar">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm cus-drawer-lot-delete"
                  onClick={() => requestDeleteLot(drawerItem)}
                >
                  Xóa lô
                </button>
                {lotDeleteMessage && <p className="cus-drawer-lot-error" role="alert">{lotDeleteMessage}</p>}
              </div>
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

      <ShipmentActionModal actions={actions} />
    </div>
  );
}
