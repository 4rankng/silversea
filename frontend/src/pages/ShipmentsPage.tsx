import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleCheck, FileLock2, FileSpreadsheet, Loader2, LockOpen, Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  CUS_SEARCH_PATTERN, SHIPMENT_CUS_WORKSPACE_SORT_KEYS, SHIPMENT_CUS_BUCKET_LABELS,
  SHIPMENT_INTAKE_MUTATION_ROLES, ShipmentCusBucket, Role,
  type ShipmentCusWorkspaceContainerLine, type ShipmentCusWorkspaceListItem,
  type ShipmentCusContainerLineUpdateInput,
  type ShipmentCusWorkspaceListResponse, type ShipmentCusWorkspaceSortKey,
} from '@tingting/shared';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { FilterDropdown } from '../components/FilterDropdown';
import { ListFilterBar } from '../components/ListFilterBar';
import { ShipmentActionModal } from '../components/shipments/ShipmentActionModal';
import { Drawer } from '../components/UI';
import { Tooltip } from '../components/shared/Tooltip';
import { Button as UUIButton } from '../components/untitled-ui/base/buttons/button';
import { DateRangeFields, DateRangePresetSelect, DateRangePresets, EmptyState, InlineLabelSelect, Pagination, SearchableMultiSelect, Tabs } from '../design-system';
import { nextTableSort, readTableSort, type TableSortState } from '../lib/table-sort';
import { SortHeader } from '../components/shared/SortHeader';
import { routes } from '../lib/routes';
import { useAuth } from '../hooks/useAuth';
import { useQueuedSearchParams } from '../hooks/useQueuedSearchParams';
import { isOverlayOpen } from '../lib/overlayState';
import { ShipmentQuickEditModal } from '../features/shipments/cus/ShipmentQuickEditModal';
import { CusLotStatusChips, CusLotView } from '../features/shipments/cus/CusLotView';
import { copyCusShipmentContainerDeclaration, updateCusShipmentContainerLine } from '../api/shipmentClient';
import { CusShipmentRow, CUS_ROW_COLUMNS } from '../features/shipments/cus/CusShipmentRow';
import { SHIPMENT_CUS_PAGE_SIZES, readCusPageSize, useCusWorkspaceState } from '../features/shipments/cus/use-cus-workspace-state';
import { useCusQuickEdit } from '../features/shipments/cus/use-cus-quick-edit';
import { factoryDetailPath } from '../features/shipments/cus/cusQuickEditModel';
import { useCusActions } from '../features/shipments/cus/use-cus-actions';
import { exportCusWorksheet } from '../features/shipments/cus/cusExport';
import { useHiddenColumns } from '../hooks/useHiddenColumns';
import { noteLines, safeError } from '../features/shipments/cus/cusUtils';
import '../styles/operational-table-typography.css';
import '../styles/table-sort.css';
import './ShipmentsPage.css';

// Card 20260923_1 — the drawer's Xóa lô answers with a reason instead of
// vanishing. The dispatched wording is the lifecycle guard's own message
// (shipment-lifecycle softDeleteShipment), so the inline banner and the 409
// the API would raise say the same thing. Cards 351/352: eliminate the
// containers block deadlock (a lot is deleted with all its containers cascade;
// only live trips block deletion).
const LOT_DELETE_BLOCK_MESSAGES = {
  dispatched: 'Không thể xóa lô hàng đã có container được điều xe. Chỉ xóa được khi mọi container chưa phát lệnh.',
} as const;

// Card 20260926_47 — Row 1 status tabs. Each tab is a lens over the current
// page (the workspace list endpoint has no server-side status param — the
// slice is client-side over the loaded page). Card 081026093520: EVERY tab
// carries a count, and the counts are the FULL-set figures the API reports in
// `statusCounts` — the same filtered set `total` counts, status lens excluded.
// Each numeral sizes exactly the rows that tab's `matches` lens reveals across
// pages, so 'Tất cả 147' and its three siblings read as one scale (the old
// page-scoped numbers never could: 20/20/20 beside a 1206 total).
const LOT_STATUS_TABS: readonly {
  id: 'all' | 'needsSchedule' | 'needsVehicle' | 'waitingAccounting';
  label: string;
  countTone: 'warning' | 'info' | undefined;
  countOf: (counts: ShipmentCusWorkspaceListResponse['statusCounts'], total: number) => number;
  matches: (item: ShipmentCusWorkspaceListItem) => boolean;
}[] = [
  {
    id: 'all',
    label: 'Tất cả',
    countTone: undefined,
    countOf: (_counts: ShipmentCusWorkspaceListResponse['statusCounts'], total: number) => total,
    matches: () => true,
  },
  {
    id: 'needsSchedule',
    label: 'Chưa chốt lịch',
    countTone: undefined,
    countOf: (counts: ShipmentCusWorkspaceListResponse['statusCounts']) => counts.needsSchedule,
    matches: (item: ShipmentCusWorkspaceListItem) => item.operational.scheduleReadiness === 'WAITING_DATE',
  },
  {
    id: 'needsVehicle',
    label: 'Chờ điều xe',
    countTone: 'warning' as const,
    countOf: (counts: ShipmentCusWorkspaceListResponse['statusCounts']) => counts.needsVehicle,
    matches: (item: ShipmentCusWorkspaceListItem) => (
      item.operational.vehicleReadiness === 'WAITING_CARRIER' || item.operational.vehicleReadiness === 'WAITING_PLATE'
    ),
  },
  {
    id: 'waitingAccounting',
    label: 'Chờ đối soát',
    countTone: 'info' as const,
    countOf: (counts: ShipmentCusWorkspaceListResponse['statusCounts']) => counts.waitingAccounting,
    matches: (item: ShipmentCusWorkspaceListItem) => (
      item.activeLock == null
      && (item.accountingConfirmation.status === 'PENDING' || item.accountingConfirmation.status === 'STALE')
    ),
  },
];

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
  const canCreateShipment = user?.role === Role.ADMIN || user?.role === Role.CUS || user?.role === Role.MANAGER || user?.role === Role.DISPATCHER; // ADMIN/MANAGER/CUS/DISPATCHER — mirrors the shipmentCreatorOnly route guard (testplan/roles/01-cus.md)
  // CUS-10 rode the drawer's container ledger; the SIL-485 read-only drawer
  // has no container affordances left, so the remove-role gate retired with
  // the ledger.
  // Card 071026204710, then re-ruled by the lead on the same card: the lot
  // delete is now CUS **or** ADMIN (routes/shipments/cus-workspace.routes.ts:344
  // and services/shipment-governance.service.ts:36 both widened together). This
  // gate first hid the affordance from ADMIN because the route refused it — that
  // half is obsolete now, and keeping it would have left ADMIN able to delete
  // through the API but unable to reach the button. The affordance mirrors the
  // guard; when the guard moves, this moves with it.
  const canDeleteLot = user?.role === Role.CUS || user?.role === Role.ADMIN;
  // SIL-485: the drawer's "Sửa" rides the same intake-mutation authority the
  // /shipments/:id/edit route guard enforces — the host page owns useAuth and
  // decides here whether the edit affordance exists at all.
  const canEditLot = !!user?.role && SHIPMENT_INTAKE_MUTATION_ROLES.includes(user.role);
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
  // statusCounts keys — the same vocabulary the API reports counts in.
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
  // Card 20260923_1: the drawer's Xóa lô stays reachable at every state and
  // answers with a reason instead of vanishing. The stored value is the BLOCK
  // KIND (not a message) so the banner self-heals: once the blocking condition
  // stops holding, the derived message is empty without an extra effect.
  const [deleteLotBlock, setDeleteLotBlock] = useState<{ shipmentId: number; kind: 'dispatched' } | null>(null);
  // SIL-485: the header workflow icon (Khóa lô / Xác nhận đối soát / Đề nghị
  // mở lại) is always clickable; a blocked action answers with the guard's
  // own disabledReason through the same banner law as the delete block.
  const [lotActionBlock, setLotActionBlock] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
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
    drawerId, setDrawerId,
    setError: ws.setError, setNotice: ws.setNotice, loadList: ws.loadList,
    loadDetail: ws.loadDetail, invalidateDetail: ws.invalidateDetail,
    getIdempotencyKey: ws.getIdempotencyKey, clearIdempotencyKey: ws.clearIdempotencyKey,
  });

  const { loadList, loadDetail } = ws;
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
    setLotActionBlock(null);
    void loadDetail(shipmentId);
  }, [loadDetail]);

  // Cards 351 & 352: Xóa lô lives in the drawer header. It is blocked with the
  // lifecycle guard's reason when a trip already left the lot (deletable=false).
  // When deletable is true, it routes directly into confirmed delete (deleting
  // the lot cascades all its containers, resolving the 0-container deadlock).
  const requestDeleteLot = useCallback((item: ShipmentCusWorkspaceListItem) => {
    if (!item.operational.deletable) {
      setDeleteLotBlock({ shipmentId: item.id, kind: 'dispatched' });
      return;
    }
    setDeleteLotBlock(null);
    actions.openAction(item, 'delete');
  }, [actions]);

  // SIL-485: the header icon carries whatever workflow action the API derived
  // (Khóa lô / Xác nhận đối soát / Đề nghị mở lại). A blocked action never
  // opens the modal — it answers with the guard's reason (card 20260923_1
  // banner law), then self-heals once the condition clears.
  const requestLotAction = useCallback((item: ShipmentCusWorkspaceListItem) => {
    if (!item.action.enabled) {
      setLotActionBlock(item.id);
      return;
    }
    setLotActionBlock(null);
    const mode = item.action.kind === 'CONFIRM_FINANCE'
      ? 'confirm'
      : item.action.kind === 'LOCK'
        ? 'lock'
        : 'reopen';
    actions.openAction(item, mode);
  }, [actions]);

  const closeDrawer = useCallback(() => setDrawerId(null), []);




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
  // current page locally. Its COUNT is the full-set `statusCounts` figure the
  // API reports (card 081026093520): the size of this lens's slice across the
  // whole filtered set, not of the loaded page.
  const statusTabDef = LOT_STATUS_TABS.find((tab) => tab.id === statusTab) ?? LOT_STATUS_TABS[0];
  // Plain filter, not useMemo: `items` is rebuilt every render (ws.data?.items
  // ?? []) so a memo here both buys nothing and trips exhaustive-deps.
  // Kế hoạch lens (card _48): with two or more buckets the API keeps the
  // unfiltered page and this predicate slices it, same as the status tabs.
  const bucketLens = selectedBuckets.length >= 2 ? (item: ShipmentCusWorkspaceListItem) => selectedBuckets.includes(item.bucket) : null;
  const visibleItems = items.filter(statusTabDef.matches).filter((item) => (bucketLens ? bucketLens(item) : true));
  // Card 20260928_193: column visibility for the workboard. The choice is the
  // operator's, stored per surface (`localStorage`, the mechanism card
  // 20260917_4 shipped and QA verified for reload); with no stored choice the
  // default hides GHI CHÚ only while the rendered rows carry no note at all —
  // one note anywhere and the column is information, not whitespace.
  const rowColumns = useHiddenColumns({
    storageKey: 'cus-lots-hidden-cols',
    columns: CUS_ROW_COLUMNS,
    hasData: (column) => column.key !== 'notes'
      || visibleItems.some((item) => noteLines(item.customerNotes).length > 0 || noteLines(item.operationalNotes).length > 0),
  });
  const totalPages = Math.max(1, ws.data?.totalPages ?? Math.ceil(total / pageSize));
  const drawerItem = items.find((item) => item.id === drawerId) ?? (drawerId != null ? ws.details[drawerId]?.summary : null) ?? null;
  const lotDeleteBlockKind = deleteLotBlock != null && deleteLotBlock.shipmentId === drawerItem?.id ? deleteLotBlock.kind : null;
  const lotDeleteMessage = lotDeleteBlockKind === 'dispatched' && drawerItem != null && !drawerItem.operational.deletable
    ? LOT_DELETE_BLOCK_MESSAGES.dispatched
    : null;
  const lotActionMessage = lotActionBlock != null && drawerItem != null && lotActionBlock === drawerItem.id && !drawerItem.action.enabled
    ? drawerItem.action.disabledReason
    : null;
  // SIL-485: the "Sửa" affordance follows the view page's lock law — a lot
  // with an active accounting lock stays readable but refuses editing, so the
  // footer button is disabled with the reason beside it.
  const lotEditLocked = drawerItem?.activeLock != null;
  // SIL-498: the drawer's per-cont tờ khai cell is writable exactly when the
  // workspace fieldAccess publishes a non-READ_ONLY declarationNumber (role
  // CUS/Quản trị/Quản lý + no accounting lock, computed server-side), the
  // viewer holds the intake-mutation authority and the drawer detail is
  // loaded. DISPATCHER keeps the rest of the container-line command but not
  // this field — the same split the BE gate enforces.
  const drawerDetail = drawerId != null ? ws.details[drawerId] : undefined;
  const drawerDeclarationEditable = Boolean(
    canEditLot
    && !lotEditLocked
    && drawerDetail
    && drawerDetail.summary.fieldAccess.declarationNumber.mode !== 'READ_ONLY',
  );
  /** SIL-498-R1: save ONE row's tờ khai through the container-line command —
   *  the same endpoint the ledger editor rides, so the BE fan-out (still-
   *  EMPTY siblings fill only; a sibling holding ANY number — old value
   *  included — keeps it, divergent untouched; clear local — owner ruling
   *  26/10, SIL-498 lot 257) applies verbatim. The drawer detail force-
   *  reloads so the sheet always reads persisted state, and the toast names
   *  the auto-synced siblings the command reports. */
  const saveDrawerDeclaration = useCallback(async (line: ShipmentCusWorkspaceContainerLine, value: string) => {
    if (drawerId == null || drawerDetail == null) return;
    const shipmentId = drawerId;
    const next = value || null;
    const signature = `drawer-decl:${shipmentId}:${line.id}:${drawerDetail.summary.version}:${next ?? ''}`;
    const key = ws.getIdempotencyKey(signature);
    try {
      const result = await updateCusShipmentContainerLine(shipmentId, line.id, {
        expectedShipmentVersion: drawerDetail.summary.version,
        declarationNumber: next,
      }, key);
      ws.clearIdempotencyKey(signature);
      const synced = result.declarationSync?.updatedContainerIds.length ?? 0;
      const target = line.containerNumber ? `cho ${line.containerNumber}` : `cho container số ${line.ordinal}`;
      ws.setNotice(synced > 0
        ? `Đã lưu tờ khai ${target} — tự đồng bộ sang ${synced} cont.`
        : `Đã lưu tờ khai ${target}.`);
      await ws.loadDetail(shipmentId, true);
    } catch (error) {
      ws.clearIdempotencyKey(signature);
      ws.setError(safeError(error, 'Không thể lưu số tờ khai. Vui lòng thử lại.'));
      throw error;
    }
  }, [drawerDetail, drawerId, ws]);
  /** SIL-498-R2: the first row's copy affordance — ONE call fans the saved
   *  number onto every still-empty sibling (never a divergent one), the same
   *  contract as the ledger's copy button. */
  const copyDrawerDeclaration = useCallback(async (line: ShipmentCusWorkspaceContainerLine) => {
    if (drawerId == null || drawerDetail == null) return;
    const shipmentId = drawerId;
    const signature = `drawer-decl-copy:${shipmentId}:${line.id}:${drawerDetail.summary.version}`;
    const key = ws.getIdempotencyKey(signature);
    try {
      const result = await copyCusShipmentContainerDeclaration(shipmentId, line.id, {
        expectedShipmentVersion: drawerDetail.summary.version,
      }, key);
      ws.clearIdempotencyKey(signature);
      ws.setNotice(`Đã copy tờ khai sang ${result.updatedContainerIds.length} cont còn trống.`);
      await ws.loadDetail(shipmentId, true);
    } catch (error) {
      ws.clearIdempotencyKey(signature);
      ws.setError(safeError(error, 'Không thể copy tờ khai. Vui lòng thử lại.'));
      throw error;
    }
  }, [drawerDetail, drawerId, ws]);
  const drawerDeclarationActions = useMemo(() => (
    drawerDeclarationEditable ? { onSaveDeclaration: saveDrawerDeclaration, onCopyDeclaration: copyDrawerDeclaration } : undefined
  ), [copyDrawerDeclaration, drawerDeclarationEditable, saveDrawerDeclaration]);
  // SIL-508: the SỐ CONTAINER group's inline lines (số cont / loại / trọng
  // lượng) ride the SAME container-line command and gate split as tờ khai —
  // intake authority + no accounting lock from the page, the per-field
  // fieldAccess mode from the line itself (checked in ContainerGroupCell).
  const drawerCargoEditable = Boolean(canEditLot && !lotEditLocked && drawerDetail);
  const saveDrawerContainerField = useCallback(async (
    line: ShipmentCusWorkspaceContainerLine,
    field: 'containerNumber' | 'containerTypeId' | 'cargoWeightKg',
    value: string,
  ): Promise<boolean> => {
    if (drawerId == null || drawerDetail == null) return false;
    const shipmentId = drawerId;
    const version = drawerDetail.summary.version;
    const payload: ShipmentCusContainerLineUpdateInput = field === 'containerNumber'
      ? { expectedShipmentVersion: version, containerNumber: value === '' ? null : value }
      : field === 'containerTypeId'
        ? { expectedShipmentVersion: version, containerTypeId: value === '' ? null : Number(value) }
        : { expectedShipmentVersion: version, cargoWeightKg: value === '' ? null : value };
    const signature = `drawer-line:${shipmentId}:${line.id}:${version}:${field}:${value}`;
    const key = ws.getIdempotencyKey(signature);
    const fieldLabel = field === 'containerNumber' ? 'số container' : field === 'containerTypeId' ? 'loại container' : 'trọng lượng';
    try {
      await updateCusShipmentContainerLine(shipmentId, line.id, payload, key);
      ws.clearIdempotencyKey(signature);
      ws.setNotice(`Đã lưu ${fieldLabel} của dòng ${line.ordinal}.`);
      await ws.loadDetail(shipmentId, true);
      return true;
    } catch (error) {
      ws.clearIdempotencyKey(signature);
      ws.setError(safeError(error, 'Không thể lưu thay đổi container. Vui lòng thử lại.'));
      return false;
    }
  }, [drawerDetail, drawerId, ws]);
  const drawerContainerLineActions = useMemo(() => (
    drawerCargoEditable ? { onSaveField: saveDrawerContainerField } : undefined
  ), [drawerCargoEditable, saveDrawerContainerField]);
  const quickEditItem = quickEditDraft
    ? items.find((item) => item.id === quickEditDraft.shipmentId) ?? null
    : null;
  // Click-outside/Escape dismissal for the quick-edit modal lives inside
  // ShipmentQuickEditModal now (shared with the lot detail page's Sửa-lô
  // picker host).
  const hasFilters = Boolean(suffixParam || dateFrom || dateTo || direction || selectedBuckets.length > 0 || adHoc || statusTab);
  // Card 20260927_152: the three criteria behind `Bộ lọc` — the count feeds the
  // trigger badge, `Đặt lại` clears exactly those three and nothing else.
  const secondaryCount = (direction ? 1 : 0) + (adHoc ? 1 : 0) + (selectedBuckets.length ? 1 : 0) + (dateFrom || dateTo ? 1 : 0);
  // Card 20260928_161: the date range rides in the dropdown now, so its reset clears it too.
  const resetSecondary = () => { updateParam('direction', null); updateParam('adHoc', null); updateBuckets([]); applyDateRange({ from: '', to: '' }); };
  const presetNode = <DateRangePresets className="shipments-control__date-presets" presets={LOT_DATE_PRESETS} value={{ from: dateFrom, to: dateTo }} onChange={applyDateRange} ariaLabel="Khoảng ngày nhanh" />;
  const presetDialogNode = <DateRangePresetSelect presets={LOT_DATE_PRESETS} value={{ from: dateFrom, to: dateTo }} onChange={applyDateRange} ariaLabel="Khoảng ngày nhanh" />;
  // Card 20260928_161 (D). The pair used to be a DIRECT bar child, so it sat
  // outside the bar's fold ladder: with the criteria and quick ranges already
  // foldable nothing was left to move and the strip held three rows on a phone
  // (2026-09-28, 390px: search 300 · dates 348 · trigger 104). `FilterDropdown`
  // shows children inline while the bar fits two rows, in the dialog when it does not.
  const dateRangeNode = <DateRangeFields className="shipments-control__range" id="lot-date-range" size="sm" ariaLabel="Khoảng ngày giao" from={dateFrom} to={dateTo} onChange={applyDateRange} />;
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
        {/* Card 20260927_152: the shared bar. Every criterion renders INLINE while
            the strip fits two rows, collapsing into `Bộ lọc (N)` when it cannot. */}
        <ListFilterBar
          search={{
            value: searchInput,
            onChange: setSearchInput,
            placeholder: 'Bill, Book, Mã lô, Cont, Tờ khai, khách hàng...',
            ariaLabel: 'Tìm lô hàng',
            inputRef: searchFieldRef,
            inputProps: { title: 'Nhấn / để tìm kiếm · Esc để xóa' },
          }}
          presets={presetNode}
          quickFilters={ws.data ? (
            <Tabs
              className="shipments-control__tabs"
              variant="boxed"
              ariaLabel="Trạng thái lô hàng"
              value={statusTab || 'all'}
              onChange={(id) => updateParam('status', id === 'all' ? null : id)}
              tabs={LOT_STATUS_TABS.map((tab) => ({
                id: tab.id,
                label: tab.label,
                count: tab.countOf(ws.data!.statusCounts, total),
                countTone: tab.countTone,
              }))}
            />
          ) : undefined}
          quickFiltersLabel="Trạng thái lô hàng"
          columns={{
            items: CUS_ROW_COLUMNS,
            hidden: rowColumns.hidden,
            customized: rowColumns.customized,
            onToggle: rowColumns.toggle,
            onReset: rowColumns.reset,
          }}
          actions={hasFilters ? (
            <UUIButton
              type="button" size="sm" color="tertiary"
              className="shipment-uui-button shipment-uui-button--tertiary shipments-control__reset"
              onPress={clearFiltersUrl} iconLeading={<RotateCcw size={15} aria-hidden="true" />}
            >
              Xóa lọc
            </UUIButton>
          ) : undefined}
        >
          <FilterDropdown count={secondaryCount} ariaLabel="Bộ lọc" dialogLabel="Bộ lọc lô hàng" presets={presetDialogNode} onReset={resetSecondary}>
            {dateRangeNode}
            <InlineLabelSelect
              className="shipments-control__chip"
              id="lot-direction-filter"
              label="Xuất / Nhập"
              ariaLabel="Xuất / Nhập"
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
          </FilterDropdown>
        </ListFilterBar>


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
            context={hasFilters ? 'search' : 'shipments'}
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
                  {!rowColumns.isHidden('documents') && <col className="cus-dashboard-col--documents" />}
                  {!rowColumns.isHidden('classification') && <col className="cus-dashboard-col--classification" />}
                  {!rowColumns.isHidden('cargo') && <col className="cus-dashboard-col--cargo" />}
                  {!rowColumns.isHidden('schedule') && <col className="cus-dashboard-col--schedule" />}
                  {!rowColumns.isHidden('notes') && <col className="cus-dashboard-col--notes" />}
                  <col className="cus-dashboard-col--status" />
                </colgroup>
                <thead><tr>
                  <SortHeader label="Khách hàng &amp; nhà máy" sortKey="customerName" sort={sort} onSortChange={applySort} />
                  {!rowColumns.isHidden('documents') && <SortHeader label="Chứng từ" sortKey="billOrBookNumber" sort={sort} onSortChange={applySort} />}
                  {!rowColumns.isHidden('classification') && <SortHeader label="Phân loại &amp; hãng tàu" sortKey="shippingLineName" sort={sort} onSortChange={applySort} />}
                  {!rowColumns.isHidden('cargo') && <SortHeader label="Tổng quan hàng hóa" sortKey="cargoWeightKg" sort={sort} onSortChange={applySort} />}
                  {!rowColumns.isHidden('schedule') && <SortHeader label="Lịch trình &amp; điều xe" sortKey="transportDate" sort={sort} onSortChange={applySort} />}
                  {!rowColumns.isHidden('notes') && <SortHeader label="Ghi chú" sortKey="customerNotes" sort={sort} onSortChange={applySort} />}
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
                      hiddenColumns={rowColumns.hidden}
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

      {/* FB-086 R29 remainder: the modal moved verbatim into
          ShipmentQuickEditModal so the lot detail page's Sửa-lô picker opens
          the SAME editor — one shared lot-info surface, two hosts. */}
      <ShipmentQuickEditModal
        open={quickEditDraft != null && quickEditItem != null}
        draft={quickEditDraft}
        item={quickEditItem}
        saving={savingQuickEdit}
        error={quickEditError}
        onDraftChange={setQuickEditDraft}
        close={closeQuickEdit}
        save={() => { if (quickEditItem) void saveQuickEdit(quickEditItem); }}
      />

      {/* SIL-485 (owner mockup 25/10, superseding the SIL-483 custom table
          and the earlier workspace-view consult for the drawer body): the
          drawer reads as a designed review — head chips, the four-step
          stepper and the read-only cards of CusLotView. The header keeps its
          SIL-483 chrome (expand + Xóa-lô trash), the workflow icon (Khóa lô
          / Xác nhận đối soát / Đề nghị mở lại) joins it, and editing leaves
          the drawer entirely: "Sửa" navigates to /shipments/:id/edit. */}
      <Drawer
        isOpen={drawerId != null}
        onClose={closeDrawer}
        title={drawerItem?.customerName || 'Chi tiết lô hàng'}
        className="cus-shipment-drawer"
        expandable
        titleChips={drawerItem ? <CusLotStatusChips item={drawerItem} /> : undefined}
        headerAction={drawerItem ? (
          <>
            {drawerItem.action.kind !== 'NONE' && (
              <Tooltip label={drawerItem.action.enabled ? drawerItem.action.label : drawerItem.action.disabledReason ?? drawerItem.action.label} side="bottom">
                <button
                  type="button"
                  className="drawer__close cus-drawer-lot-action"
                  onClick={() => requestLotAction(drawerItem)}
                  aria-label={drawerItem.action.enabled
                    ? drawerItem.action.label
                    : `${drawerItem.action.label} — ${drawerItem.action.disabledReason ?? 'hiện không khả dụng'}`}
                  aria-disabled={!drawerItem.action.enabled}
                >
                  {drawerItem.action.kind === 'LOCK' && <FileLock2 size={16} />}
                  {drawerItem.action.kind === 'CONFIRM_FINANCE' && <CircleCheck size={16} />}
                  {drawerItem.action.kind === 'REQUEST_REOPEN' && <LockOpen size={16} />}
                </button>
              </Tooltip>
            )}
            {canDeleteLot && (
              <Tooltip label="Xóa lô" side="bottom">
                <button
                  type="button"
                  className="drawer__close cus-drawer-lot-delete"
                  onClick={() => requestDeleteLot(drawerItem)}
                  aria-label="Xóa lô"
                >
                  <Trash2 size={16} />
                </button>
              </Tooltip>
            )}
          </>
        ) : undefined}
        footer={drawerItem && canEditLot ? (
          <div className="cus-drawer-editbar">
            {lotEditLocked && <span className="cus-drawer-editbar__reason">Lô đã khóa kế toán — dữ liệu chỉ đọc.</span>}
            <UUIButton
              size="sm"
              color="primary"
              className="cus-drawer-edit"
              isDisabled={lotEditLocked}
              onPress={() => navigate(routes.shipmentDetailEdit(drawerItem.id))}
            >
              Sửa
            </UUIButton>
          </div>
        ) : undefined}
      >
        <div id={drawerItem ? `cus-detail-drawer-${drawerItem.id}` : undefined}>
          {drawerItem && (
            <>
              {/* Card 20260923_1: a blocked Xóa lô (or workflow action) still
                  answers with a reason — the banners open the body right
                  under the header. */}
              {lotDeleteMessage && <p className="cus-drawer-lot-error" role="alert">{lotDeleteMessage}</p>}
              {lotActionMessage && <p className="cus-drawer-lot-error" role="alert">{lotActionMessage}</p>}
              <CusLotView
                item={drawerItem}
                detail={ws.details[drawerItem.id]}
                loading={ws.detailLoadingIds.has(drawerItem.id)}
                error={ws.detailErrors[drawerItem.id]}
                onRetry={() => void loadDetail(drawerItem.id, true)}
                canEditDeclaration={drawerDeclarationEditable}
                declarationActions={drawerDeclarationActions}
                canEditCargoLines={drawerCargoEditable}
                containerLineActions={drawerContainerLineActions}
              />
            </>
          )}
        </div>
      </Drawer>

      <ShipmentActionModal actions={actions} />
    </div>
  );
}
