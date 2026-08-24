import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ChevronRight,
  Download,
  FileLock2,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  SHIPMENT_CUS_BUCKET_LABELS,
  SHIPMENT_CUS_WORKSPACE_SORT_KEYS,
  SHIPMENT_DOCUMENT_CUSTODY_LABELS,
  SHIPMENT_STATUS_LABELS,
  ShipmentCusBucket,
  ShipmentDocumentCustody,
  Role,
  type ShipmentCusWorkspaceContainerLine,
  type ShipmentCusWorkspaceDetail,
  type ShipmentCusWorkspaceListItem,
  type ShipmentCusWorkspaceListResponse,
  type ShipmentCusWorkspaceSortKey,
} from '@tingting/shared';
import { ApiError } from '../lib/api';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { StatusStrip, StatusSwatch } from '../components/shared/StatusStrip';
import { Drawer, Modal, PageHeader } from '../components/UI';
import { Button as UUIButton } from '../components/untitled-ui/base/buttons/button';
import { Input as UUIInput } from '../components/untitled-ui/base/input/input';
import { EmptyState, Pagination, BufferedUuiDateInput, UuiSelectField } from '../design-system';
import {
  createShipmentDeclaration,
  getCusShipmentWorkspaceDetail,
  confirmCusShipmentFinance,
  listCusShipmentWorkspace,
  lockCusShipment,
  requestCusShipmentReopen,
  requestShipmentDelete,
  updateCusShipmentDocumentCustody,
  updateShipment,
  updateShipmentDeclaration,
} from '../api/shipmentClient';
import { downloadCSV } from '../lib/csv';
import { nextTableSort, type TableSortState } from '../lib/table-sort';
import { SortHeader } from '../components/shared/SortHeader';
import { routes } from '../lib/routes';
import { useAuth } from '../hooks/useAuth';
import { FinanceEvidence, WorkflowBadge, ShipmentSignals } from '../features/shipments/cus/CusBadges';
import { ShipmentQuickEditFields } from '../features/shipments/cus/CusQuickEdit';
import { ShipmentDetailContent } from '../features/shipments/cus/CusDetailContent';
import {
  derivePrimaryShipmentSignal,
  directionLabel,
  cargoModeLabel,
  formatAppointmentGroupLine,
  appointmentGroupFactorySegment,
  formatDate,
  formatQuantity,
  idempotencySignature,
  noteLines,
  quickEditTitle,
  safeError,
  scheduleTime,
  vehicleReadinessLabel,
  worksheetQuantity,
  type ShipmentQuickEditDraft,
} from '../features/shipments/cus/cusUtils';
import '../styles/operational-table-typography.css';
import '../styles/table-sort.css';
import './ShipmentsPage.css';

const PAGE_SIZE = 20;
const SEARCH_PATTERN = /^[A-Za-z0-9]{4,5}$/;
const BUCKETS = Object.values(ShipmentCusBucket);

/**
 * Split a joined container summary ("1x40HC + 1x20DC") into one line per
 * container type — the customer-requested layout for the "Tổng quan hàng hóa"
 * column when one book/bill carries mixed container types. Mirrors the
 * dispatch master-plan's formatContainerSummaryLines splitter.
 */
function splitContainerSummaryLines(summary: string | null | undefined): string[] {
  if (!summary) return [];
  return summary
    .split(/\s*\+\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const SHIPMENT_BUCKET_COLORS: Record<ShipmentCusBucket, string> = {
  [ShipmentCusBucket.NEW]: 'var(--ink-3)',
  [ShipmentCusBucket.RUNNING]: 'var(--accent)',
  [ShipmentCusBucket.PENDING_LOCK]: 'var(--warning)',
  [ShipmentCusBucket.LOCKED]: 'var(--slate-4)',
};

export default function ShipmentsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canCreateShipment = user?.role === Role.ADMIN || user?.role === Role.CUS || user?.role === Role.MANAGER;
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get('page') || 1) || 1);
  const suffixParam = searchParams.get('searchSuffix') ?? '';
  const dateFrom = searchParams.get('transportDateFrom') ?? '';
  const dateTo = searchParams.get('transportDateTo') ?? '';
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
  const sort: TableSortState | null = sortKey ? { by: sortKey, dir: sortDir } : null;

  const [searchInput, setSearchInput] = useState(suffixParam);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [data, setData] = useState<ShipmentCusWorkspaceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [drawerCloseConfirmId, setDrawerCloseConfirmId] = useState<number | null>(null);
  const [dirtyDetailIds, setDirtyDetailIds] = useState<Set<number>>(() => new Set());
  const [savingDetailIds, setSavingDetailIds] = useState<Set<number>>(() => new Set());
  const [details, setDetails] = useState<Record<number, ShipmentCusWorkspaceDetail>>({});
  const [detailLoadingIds, setDetailLoadingIds] = useState<Set<number>>(() => new Set());
  const [detailErrors, setDetailErrors] = useState<Record<number, string>>({});
  const [actionItem, setActionItem] = useState<ShipmentCusWorkspaceListItem | null>(null);
  const [actionMode, setActionMode] = useState<'confirm' | 'lock' | 'reopen' | 'delete' | null>(null);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<number>>(() => new Set());
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [quickEditDraft, setQuickEditDraft] = useState<ShipmentQuickEditDraft | null>(null);
  const [savingQuickEdit, setSavingQuickEdit] = useState(false);
  const [quickEditError, setQuickEditError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const requestSequence = useRef(0);
  const detailRequestSequence = useRef<Record<number, number>>({});
  const idempotencyKeysRef = useRef<Record<string, string>>({});
  const quickEditSaveRef = useRef<string | null>(null);
  const quickEditFocusTargetRef = useRef<string | null>(null);

  const getIdempotencyKey = useCallback((signature: string) => {
    const existing = idempotencyKeysRef.current[signature];
    if (existing) return existing;
    const next = crypto.randomUUID();
    idempotencyKeysRef.current[signature] = next;
    return next;
  }, []);

  const clearIdempotencyKey = useCallback((signature: string) => {
    delete idempotencyKeysRef.current[signature];
  }, []);

  const updateParam = useCallback((key: string, value: string | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
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
    const next = nextTableSort(sort, key);
    setSearchParams((current) => {
      const nextParams = new URLSearchParams(current);
      nextParams.set('sortBy', next.by);
      nextParams.set('sortDir', next.dir);
      nextParams.delete('page');
      return nextParams;
    }, { replace: true });
  }, [sort, setSearchParams]);

  useEffect(() => {
    if (quickEditDraft || !quickEditFocusTargetRef.current) return;
    const targetId = quickEditFocusTargetRef.current;
    const target = document.getElementById(targetId);
    if (!(target instanceof HTMLButtonElement) || target.disabled) return;
    quickEditFocusTargetRef.current = null;
    target.focus();
  }, [quickEditDraft, savingQuickEdit]);

  const loadList = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await listCusShipmentWorkspace({
        page,
        limit: PAGE_SIZE,
        searchSuffix: suffixParam || undefined,
        transportDateFrom: dateFrom || undefined,
        transportDateTo: dateTo || undefined,
        direction: direction || undefined,
        bucket: bucket || undefined,
        sortBy: sortKey ?? undefined,
        sortDir: sortKey ? sortDir : undefined,
      });
      if (requestId === requestSequence.current) setData(response);
    } catch (loadError) {
      if (requestId === requestSequence.current) {
        setError(safeError(loadError, 'Không thể tải danh sách lô hàng.'));
      }
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [bucket, dateFrom, dateTo, direction, page, sortDir, sortKey, suffixParam]);

  useEffect(() => { void loadList(); }, [loadList]);

  const loadDetail = useCallback(async (shipmentId: number, force = false) => {
    if (!force && details[shipmentId]) return;
    const requestId = (detailRequestSequence.current[shipmentId] ?? 0) + 1;
    detailRequestSequence.current[shipmentId] = requestId;
    setDetailLoadingIds((current) => new Set(current).add(shipmentId));
    setDetailErrors((current) => ({ ...current, [shipmentId]: '' }));
    try {
      const detail = await getCusShipmentWorkspaceDetail(shipmentId);
      if (detailRequestSequence.current[shipmentId] === requestId) {
        setDetails((current) => ({ ...current, [shipmentId]: detail }));
      }
    } catch (detailError) {
      if (detailRequestSequence.current[shipmentId] === requestId) {
        setDetailErrors((current) => ({
          ...current,
          [shipmentId]: safeError(detailError, 'Không thể tải chi tiết container.'),
        }));
      }
    } finally {
      if (detailRequestSequence.current[shipmentId] === requestId) {
        setDetailLoadingIds((current) => {
          const next = new Set(current);
          next.delete(shipmentId);
          return next;
        });
      }
    }
  }, [details]);

  const applySavedContainerLine = useCallback(async (shipmentId: number, line: ShipmentCusWorkspaceContainerLine) => {
    setDetails((current) => {
      const detail = current[shipmentId];
      if (!detail) return current;
      const externalCarriers = line.externalCarrierId && line.carrierName && !detail.selectors.externalCarriers.some((carrier) => carrier.id === line.externalCarrierId)
        ? [...detail.selectors.externalCarriers, { id: line.externalCarrierId, name: line.carrierName, shortName: null, label: line.carrierName }]
        : detail.selectors.externalCarriers;
      const carrierVehicles = line.externalCarrierId && line.externalCarrierVehicleId && line.plateNumber && !detail.selectors.carrierVehicles.some((vehicle) => vehicle.id === line.externalCarrierVehicleId)
        ? [...detail.selectors.carrierVehicles, { id: line.externalCarrierVehicleId, carrierId: line.externalCarrierId, licensePlate: line.plateNumber, label: line.plateNumber }]
        : detail.selectors.carrierVehicles;
      return {
        ...current,
        [shipmentId]: {
          ...detail,
          summary: { ...detail.summary, version: line.shipmentVersion },
          selectors: { ...detail.selectors, externalCarriers, carrierVehicles },
          containers: detail.containers.map((currentLine) => (
            currentLine.id === line.id
              ? line
              : { ...currentLine, shipmentVersion: line.shipmentVersion }
          )),
        },
      };
    });
    setNotice('Đã lưu dữ liệu container. Xác nhận Kế toán cũ (nếu có) sẽ được kiểm tra lại theo nguồn mới.');
    await loadList();
  }, [loadList]);

  const setDetailDirty = useCallback((shipmentId: number, dirty: boolean) => {
    setDirtyDetailIds((current) => {
      const next = new Set(current);
      if (dirty) next.add(shipmentId);
      else next.delete(shipmentId);
      return next;
    });
  }, []);

  const setDetailSaving = useCallback((shipmentId: number, saving: boolean) => {
    setSavingDetailIds((current) => {
      const next = new Set(current);
      if (saving) next.add(shipmentId);
      else next.delete(shipmentId);
      return next;
    });
  }, []);

  const openShipmentDetail = useCallback((shipmentId: number) => {
    setDrawerId(shipmentId);
    void loadDetail(shipmentId);
  }, [loadDetail]);

  const requestCloseMobileDetail = useCallback(() => {
    if (drawerId != null && savingDetailIds.has(drawerId)) {
      setError('Đang lưu dữ liệu container. Vui lòng chờ hoàn tất.');
      return;
    }
    if (drawerId != null && dirtyDetailIds.has(drawerId)) {
      setDrawerCloseConfirmId(drawerId);
      return;
    }
    setDrawerId(null);
  }, [dirtyDetailIds, drawerId, savingDetailIds]);

  const discardMobileDetailChanges = useCallback(() => {
    if (drawerCloseConfirmId != null) setDetailDirty(drawerCloseConfirmId, false);
    setDrawerCloseConfirmId(null);
    setDrawerId(null);
  }, [drawerCloseConfirmId, setDetailDirty]);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const value = searchInput.trim();
    if (value && !SEARCH_PATTERN.test(value)) {
      setSearchError('Nhập đúng 4-5 ký tự chữ hoặc số cuối của Bill/Book hoặc số tờ khai.');
      return;
    }
    setSearchError(null);
    updateParam('searchSuffix', value || null);
  };

  const clearFilters = () => {
    setSearchInput('');
    setSearchError(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      ['searchSuffix', 'transportDateFrom', 'transportDateTo', 'direction', 'bucket', 'page'].forEach((key) => next.delete(key));
      return next;
    }, { replace: true });
  };

  const updateCustody = async (item: ShipmentCusWorkspaceListItem, status: ShipmentDocumentCustody) => {
    if (dirtyDetailIds.has(item.id)) {
      setError('Hãy lưu hoặc bỏ thay đổi container trước khi cập nhật phơi phiếu.');
      return;
    }
    setNotice(null);
    try {
      const signature = idempotencySignature('custody', item.id, item.version, status);
      await updateCusShipmentDocumentCustody(
        item.id,
        { expectedShipmentVersion: item.version, status },
        getIdempotencyKey(signature),
      );
      clearIdempotencyKey(signature);
      setNotice('Đã cập nhật trạng thái phơi phiếu.');
      await Promise.all([loadList(), loadDetail(item.id, true)]);
    } catch (custodyError) {
      setError(safeError(custodyError, 'Không thể cập nhật trạng thái phơi phiếu.'));
    }
  };

  const startQuickEdit = (item: ShipmentCusWorkspaceListItem, field: ShipmentQuickEditDraft['field']) => {
    if (field === 'schedule' && item.cargoMode === 'FCL') {
      setError('Lịch FCL được cập nhật theo từng container.');
      return;
    }
    if (quickEditSaveRef.current || quickEditDraft) return;
    const accessKeys = field === 'identity' ? ['factoryName'] as const
      : field === 'documents' ? ['blNumber', 'bookingRef', 'declarationNumber'] as const
        : field === 'classification' ? ['tradeDirection', 'shippingLineName'] as const
          : field === 'cargo' ? ['packageCount', 'packageType', 'cargoWeightKg', 'cargoVolumeCbm'] as const
            : field === 'schedule' ? ['closingAt', 'plannedReturnAt'] as const
              : ['customerNotes', 'operationalNotes'] as const;
    if (!accessKeys.some((key) => item.fieldAccess[key].mode !== 'READ_ONLY')) {
      setError(item.fieldAccess[accessKeys[0]].reason);
      return;
    }
    setError(null);
    setQuickEditError(null);
    setQuickEditDraft({
      shipmentId: item.id,
      field,
      date: item.transportDate ?? '',
      time: scheduleTime(item),
      customerNote: item.customerNotes ?? '',
      operationalNote: item.operationalNotes ?? '',
      factoryName: item.raw.factoryName ?? '',
      blNumber: item.raw.blNumber ?? '',
      bookingRef: item.raw.bookingRef ?? '',
      declarationNumber: item.raw.declarationNumber ?? '',
      declarationId: item.raw.declarationId,
      declarationIssuedAt: item.raw.declarationIssuedAt,
      declarationScope: item.raw.declarationScope,
      declarationNote: item.raw.declarationNote,
      tradeDirection: item.raw.tradeDirection ?? '',
      shippingLineName: item.raw.shippingLineName ?? '',
      packageCount: item.raw.packageCount == null ? '' : String(item.raw.packageCount),
      packageType: item.raw.packageType ?? '',
      cargoWeightKg: item.raw.cargoWeightKg ?? '',
      cargoVolumeCbm: item.raw.cargoVolumeCbm ?? '',
    });
  };

  const closeQuickEdit = () => {
    if (!quickEditDraft || quickEditSaveRef.current) return;
    quickEditFocusTargetRef.current = `cus-inline-${quickEditDraft.field}-${quickEditDraft.shipmentId}`;
    setQuickEditError(null);
    setQuickEditDraft(null);
  };

  const saveQuickEdit = async (
    item: ShipmentCusWorkspaceListItem,
    { restoreFocus = true }: { restoreFocus?: boolean } = {},
  ) => {
    const draft = quickEditDraft;
    if (!draft || draft.shipmentId !== item.id || quickEditSaveRef.current) return;
    if (draft.field === 'schedule' && draft.time && !draft.date) {
      setQuickEditError('Chọn ngày đóng/trả trước khi nhập giờ.');
      return;
    }
    const unchanged = draft.field === 'identity'
      ? draft.factoryName.trim() === (item.raw.factoryName ?? '')
      : draft.field === 'documents'
        ? draft.blNumber.trim() === (item.raw.blNumber ?? '') && draft.bookingRef.trim() === (item.raw.bookingRef ?? '')
          && (item.fieldAccess.declarationNumber.mode === 'READ_ONLY'
            || draft.declarationNumber.trim() === (item.raw.declarationNumber ?? ''))
        : draft.field === 'classification'
          ? draft.tradeDirection === (item.raw.tradeDirection ?? '') && draft.shippingLineName.trim() === (item.raw.shippingLineName ?? '')
          : draft.field === 'cargo'
            ? draft.packageCount === (item.raw.packageCount == null ? '' : String(item.raw.packageCount))
              && draft.packageType.trim() === (item.raw.packageType ?? '')
              && draft.cargoWeightKg === (item.raw.cargoWeightKg ?? '')
              && draft.cargoVolumeCbm === (item.raw.cargoVolumeCbm ?? '')
            : draft.field === 'schedule'
              ? draft.date === (item.transportDate ?? '') && draft.time === scheduleTime(item)
              : draft.customerNote.trim() === (item.customerNotes ?? '').trim()
                && draft.operationalNote.trim() === (item.operationalNotes ?? '').trim();
    if (unchanged) {
      if (restoreFocus) {
        quickEditFocusTargetRef.current = `cus-inline-${draft.field}-${draft.shipmentId}`;
      }
      setQuickEditError(null);
      setQuickEditDraft(null);
      return;
    }
    const saveIdentity = `${draft.field}:${draft.shipmentId}:${item.version}`;
    quickEditSaveRef.current = saveIdentity;
    setSavingQuickEdit(true);
    setError(null);
    setQuickEditError(null);
    try {
      const scheduleValue = draft.date && draft.time
        ? new Date(`${draft.date}T${draft.time}:00`).toISOString()
        : null;
      const payload = draft.field === 'identity' ? {
        expectedVersion: item.version,
        factoryName: draft.factoryName.trim() || null,
      } : draft.field === 'documents' ? {
        expectedVersion: item.version,
        ...(draft.tradeDirection === 'IMPORT' && item.fieldAccess.blNumber.mode !== 'READ_ONLY' ? {
          blNumber: draft.blNumber.trim() || null,
          bookingRef: null,
        } : draft.tradeDirection === 'EXPORT' && item.fieldAccess.bookingRef.mode !== 'READ_ONLY' ? {
          bookingRef: draft.bookingRef.trim() || null,
          blNumber: null,
        } : {}),
      } : draft.field === 'classification' ? {
        expectedVersion: item.version,
        tradeDirection: draft.tradeDirection || null,
        shippingLineName: draft.shippingLineName.trim() || null,
      } : draft.field === 'cargo' ? {
        expectedVersion: item.version,
        packageCount: draft.packageCount ? Number(draft.packageCount) : null,
        packageType: draft.packageType.trim() || null,
        ...(item.fieldAccess.cargoWeightKg.mode !== 'READ_ONLY' ? { cargoWeightKg: draft.cargoWeightKg || null } : {}),
        ...(item.fieldAccess.cargoVolumeCbm.mode !== 'READ_ONLY' ? { cargoVolumeCbm: draft.cargoVolumeCbm || null } : {}),
      } : draft.field === 'schedule' ? {
            expectedVersion: item.version,
            expectedDeliveryDate: draft.date || null,
            ...(item.direction === 'IMPORT'
              ? { plannedReturnAt: scheduleValue }
              : { closingAt: scheduleValue }),
          } : {
            expectedVersion: item.version,
            driverNotes: draft.operationalNote.trim() || null,
            customerNotes: draft.customerNote.trim() || null,
          };
      // Declaration lives in its own table behind its own endpoints; when the
      // number changed and the actor may write it, upsert alongside the
      // shipment save. PUT replaces the whole row, so resend issuedAt/scope/
      // note verbatim to keep the existing metadata.
      const declarationChanged = draft.field === 'documents'
        && item.fieldAccess.declarationNumber.mode !== 'READ_ONLY'
        && draft.declarationNumber.trim() !== (item.raw.declarationNumber ?? '');
      // When only the declaration changed (bill/booking read-only), skip the
      // shipment PATCH entirely — an empty body would still bump the version
      // and fire change-request bookkeeping for nothing.
      const shipmentKeys = Object.keys(payload).filter((key) => key !== 'expectedVersion');
      const response = shipmentKeys.length > 0
        ? await updateShipment(item.id, payload)
        : { changeMode: 'DIRECT', message: null };
      if (declarationChanged) {
        const declarationBody = {
          declarationNumber: draft.declarationNumber.trim() || null,
          issuedAt: draft.declarationIssuedAt,
          scope: draft.declarationScope ?? undefined,
          note: draft.declarationNote,
        };
        if (draft.declarationId != null) {
          await updateShipmentDeclaration(item.id, draft.declarationId, declarationBody);
        } else {
          await createShipmentDeclaration(item.id, declarationBody);
        }
      }
      if (restoreFocus) {
        quickEditFocusTargetRef.current = `cus-inline-${draft.field}-${draft.shipmentId}`;
      }
      setQuickEditDraft((current) => current?.shipmentId === draft.shipmentId && current.field === draft.field ? null : current);
      setNotice(response.changeMode === 'REQUESTED'
        ? response.message ?? 'Đã gửi yêu cầu thay đổi để phê duyệt.'
        : draft.field === 'schedule' ? 'Đã cập nhật lịch đóng/trả.'
          : draft.field === 'notes' ? 'Đã cập nhật ghi chú lô hàng.'
            : draft.field === 'documents' && declarationChanged ? 'Đã cập nhật chứng từ lô hàng.'
              : 'Đã lưu ô dữ liệu lô hàng.');
      setDetails((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      await loadList();
    } catch (quickEditError) {
      if (quickEditSaveRef.current === saveIdentity) {
        if (quickEditError instanceof ApiError && quickEditError.status === 409) {
          quickEditFocusTargetRef.current = `cus-inline-${draft.field}-${draft.shipmentId}`;
          setQuickEditDraft(null);
          setQuickEditError(null);
          setNotice('Dữ liệu hoặc quyền chỉnh sửa vừa thay đổi. Đã tải bản mới nhất và bỏ bản nháp cũ để tránh ghi đè.');
          await loadList();
        } else {
          setQuickEditError(safeError(quickEditError, 'Không thể lưu ô đang chỉnh sửa.'));
        }
      }
    } finally {
      if (quickEditSaveRef.current === saveIdentity) {
        quickEditSaveRef.current = null;
        setSavingQuickEdit(false);
      }
    }
  };

  const openAction = (item: ShipmentCusWorkspaceListItem, mode: 'confirm' | 'lock' | 'reopen' | 'delete') => {
    if (dirtyDetailIds.has(item.id)) {
      setError('Hãy lưu hoặc bỏ thay đổi container trước khi thực hiện thao tác này.');
      return;
    }
    setActionItem(item);
    setActionMode(mode);
    setDrawerId(null);
    setReason(
      mode === 'confirm'
        ? 'Kế toán xác nhận nguồn chi phí hiện hành của lô.'
        : mode === 'lock'
          ? 'CUS xác nhận khóa lô sau khi Kế toán duyệt.'
          : mode === 'delete'
            ? ''
            : '',
    );
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
        onPress={() => openAction(item, mode)}
        iconLeading={item.action.kind === 'LOCK' ? <FileLock2 size={16} aria-hidden="true" /> : undefined}
      >
        {item.action.label}
      </UUIButton>
    );
  };

  const closeAction = () => {
    if (submitting) return;
    setActionItem(null);
    setActionMode(null);
    setReason('');
  };

  const submitAction = async () => {
    if (!actionItem || !actionMode || !reason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const signature = idempotencySignature('action', actionItem.id, actionMode, actionItem.version);
      const idempotencyKey = getIdempotencyKey(signature);
      if (actionMode === 'confirm') {
        if (!actionItem.debitNote.billingDocumentId) {
          throw new Error(actionItem.debitNote.disabledReason || 'Chưa có Debit Note đủ điều kiện để xác nhận.');
        }
        await confirmCusShipmentFinance(actionItem.id, {
          expectedVersion: actionItem.version,
          billingDocumentId: actionItem.debitNote.billingDocumentId,
          reason: reason.trim(),
        }, idempotencyKey);
        setNotice('Đã xác nhận nguồn chi phí của lô hàng.');
      } else if (actionMode === 'lock') {
        const confirmation = actionItem.accountingConfirmation;
        if (!confirmation.confirmationId || !confirmation.checksum) {
          throw new Error('Xác nhận Kế toán không còn hợp lệ. Vui lòng tải lại dữ liệu.');
        }
        await lockCusShipment(actionItem.id, {
          expectedVersion: actionItem.version,
          confirmationId: confirmation.confirmationId,
          confirmationChecksum: confirmation.checksum,
          reason: reason.trim(),
          acknowledged: true,
        }, idempotencyKey);
        setNotice('Đã khóa lô hàng. Mọi trường nhập và tệp tải lên hiện ở chế độ chỉ đọc.');
      } else if (actionMode === 'delete') {
        const result = await requestShipmentDelete(actionItem.id, actionItem.version, reason.trim());
        if (result.pendingApproval) {
          setPendingDeleteIds((prev) => new Set(prev).add(actionItem.id));
          setNotice('Yêu cầu xóa đã gửi ADMIN phê duyệt.');
        } else {
          setNotice('Đã xóa lô hàng.');
        }
      } else {
        if (!actionItem.activeLock?.id) {
          throw new Error('Không tìm thấy khóa lô hiện hành. Vui lòng tải lại dữ liệu.');
        }
        await requestCusShipmentReopen(actionItem.id, {
          expectedShipmentVersion: actionItem.version,
          activeLockId: actionItem.activeLock.id,
          reason: reason.trim(),
        }, idempotencyKey);
        setNotice('Đã gửi đề nghị điều chỉnh tới Quản trị viên.');
      }
      clearIdempotencyKey(signature);
      setActionItem(null);
      setActionMode(null);
      setReason('');
      setDetails((current) => {
        const next = { ...current };
        delete next[actionItem.id];
        return next;
      });
      if (drawerId === actionItem.id) void loadDetail(actionItem.id, true);
      await loadList();
    } catch (actionError) {
      setError(safeError(actionError, 'Không thể hoàn tất thao tác.'));
    } finally {
      setSubmitting(false);
    }
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, data?.totalPages ?? Math.ceil(total / PAGE_SIZE));
  const drawerItem = items.find((item) => item.id === drawerId) ?? null;
  const quickEditItem = quickEditDraft
    ? items.find((item) => item.id === quickEditDraft.shipmentId) ?? null
    : null;
  const hasFilters = Boolean(suffixParam || dateFrom || dateTo || direction || bucket);
  const activeFilterCount = [dateFrom, dateTo, direction, bucket].filter(Boolean).length;

  const exportWorksheet = async () => {
    setExporting(true);
    setError(null);
    try {
      const exportItems: ShipmentCusWorkspaceListItem[] = [];
      let exportPage = 1;
      let exportTotalPages = 1;
      do {
        const response = await listCusShipmentWorkspace({
          page: exportPage,
          limit: 100,
          searchSuffix: suffixParam || undefined,
          transportDateFrom: dateFrom || undefined,
          transportDateTo: dateTo || undefined,
          direction: direction || undefined,
          bucket: bucket || undefined,
        });
        exportItems.push(...response.items);
        exportTotalPages = response.totalPages;
        exportPage += 1;
      } while (exportPage <= exportTotalPages);

      await downloadCSV(
        `ke-hoach-lo-hang-${new Date().toISOString().slice(0, 10)}.xlsx`,
        ['Khách hàng & nhà máy', 'Chứng từ', 'Phân loại & hãng tàu', 'Tổng quan hàng hóa', 'Lịch trình & điều xe', 'Ghi chú', 'Trạng thái'],
        exportItems.map((item) => [
          [item.customerName ?? '—', item.effectiveFactoryNames.length > 0 ? item.effectiveFactoryNames.join(' + ') : item.factoryName ?? '', item.routeName ?? item.deliveryLocation ?? ''].filter(Boolean).join('\n'),
          [item.billOrBookNumber ?? '', item.declarationNumber ?? ''].filter(Boolean).join('\n'),
          [directionLabel(item.direction), item.shippingLineName ?? '', item.isCombined ? 'Đóng kết hợp' : ''].filter(Boolean).join('\n'),
          [cargoModeLabel(item.cargoMode), item.containerSummary || worksheetQuantity(item), item.weightKg != null ? `${formatQuantity(item.weightKg)} kg` : '', item.volumeCbm ? `${formatQuantity(item.volumeCbm)} CBM` : ''].filter(Boolean).join('\n'),
          [item.transportDate ? formatDate(item.transportDate) : 'Chưa chốt ngày', vehicleReadinessLabel(item)].filter(Boolean).join('\n'),
          [item.customerNotes ?? '', item.operationalNotes ?? ''].filter((line) => line.trim() !== '').join('\n'),
          [item.bucket === ShipmentCusBucket.NEW ? SHIPMENT_STATUS_LABELS[item.status] : item.bucketLabel, derivePrimaryShipmentSignal(item)?.label ?? ''].filter(Boolean).join('\n'),
        ]),
        {
          title: 'Tổng quan lô hàng',
          subtitle: `${exportItems.length.toLocaleString('vi-VN')} lô hàng`,
          columnTypes: ['text', 'text', 'text', 'text', 'text', 'text', 'text'],
          hideTotals: true,
        },
      );
    } catch (exportError) {
      setError(safeError(exportError, 'Không thể tải bảng XLSX.'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="shipments-page shipments-page--worksheet">
      <Breadcrumbs items={[{ label: 'Tổng quan', to: '/dashboard' }, { label: 'Tổng quan lô hàng' }]} />
      <PageHeader title="Tổng quan lô hàng" iconName="cargo" description="Bảng điều hành giao nhận theo từng lô hàng" />

      <section
        className="cus-workspace cus-workspace--worksheet"
        aria-labelledby="cus-workspace-title"
        aria-busy={loading}
        aria-hidden={drawerId != null ? true : false}
        inert={drawerId != null ? true : false}
      >
        <h2 id="cus-workspace-title" className="sr-only">Bảng kế hoạch lô hàng</h2>
        <form className="cus-worksheet-toolbar" onSubmit={submitSearch} noValidate>
          <div className="cus-worksheet-toolbar__filters" aria-label={'Bộ lọc' + (activeFilterCount ? ' đang áp dụng ' + activeFilterCount : '')}>
            <div className="cus-search-field">
              <UUIInput
                label="Bill/Book hoặc tờ khai"
                size="sm"
                icon={Search}
                value={searchInput}
                onChange={(value) => {
                  setSearchInput(value);
                  setSearchError(null);
                }}
                placeholder="Nhập 4–5 ký tự cuối"
                inputProps={{
                  inputMode: 'text',
                  pattern: '[A-Za-z0-9]{4,5}',
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
              />
              {searchInput && (
                <UUIButton
                  size="xs"
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
              {searchError && <span id="cus-search-error" className="cus-field-error" role="alert">{searchError}</span>}
            </div>

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
            <BufferedUuiDateInput
              label="Từ ngày giao"
              size="sm"
              value={dateFrom}
              onChange={(value) => updateParam('transportDateFrom', value || null)}
              className="shipment-uui-field"
              wrapperClassName="shipment-uui-control"
              inputClassName="shipment-uui-control__input"
            />
            <BufferedUuiDateInput
              label="Đến ngày giao"
              size="sm"
              value={dateTo}
              onChange={(value) => updateParam('transportDateTo', value || null)}
              className="shipment-uui-field"
              wrapperClassName="shipment-uui-control"
              inputClassName="shipment-uui-control__input"
            />
            <UuiSelectField
              label="Kế hoạch"
              value={bucket}
              onChange={(event) => updateParam('bucket', event.target.value || null)}
              options={[
                { value: '', label: 'Tất cả trạng thái' },
                ...BUCKETS.map((value) => ({ value, label: SHIPMENT_CUS_BUCKET_LABELS[value] })),
              ]}
              wrapperClassName="shipment-uui-field cus-plan-status-filter"
              controlClassName="shipment-uui-select"
            />
          </div>

          <div className="cus-worksheet-toolbar__actions" aria-label="Thao tác lô hàng">
            <div className="cus-worksheet-toolbar__action-group">
              {canCreateShipment && (
                <UUIButton
                  size="sm"
                  color="primary"
                  className="shipment-uui-button shipment-uui-button--primary cus-create-shipment"
                  onPress={() => navigate(routes.shipmentNew)}
                  iconLeading={<Plus size={17} aria-hidden="true" />}
                >
                  Tạo lô mới
                </UUIButton>
              )}
              <UUIButton
                size="sm"
                color="secondary"
                type="submit"
                className="shipment-uui-button shipment-uui-button--secondary"
                iconLeading={<Search size={16} aria-hidden="true" />}
              >
                Tìm kiếm
              </UUIButton>
            </div>
            <div className="cus-worksheet-toolbar__action-group cus-worksheet-toolbar__action-group--utility">
              {hasFilters && (
                <UUIButton
                  size="sm"
                  color="tertiary"
                  className="shipment-uui-button shipment-uui-button--tertiary"
                  onPress={clearFilters}
                  iconLeading={<RotateCcw size={16} aria-hidden="true" />}
                >
                  Xóa lọc
                </UUIButton>
              )}
              <UUIButton
                size="sm"
                color="secondary"
                isDisabled={exporting || loading}
                isLoading={exporting}
                className="shipment-uui-button shipment-uui-button--secondary"
                onPress={() => void exportWorksheet()}
                iconLeading={<Download size={16} aria-hidden="true" />}
                showTextWhileLoading
              >
                Tải XLSX
              </UUIButton>
            </div>
          </div>
        </form>

        {data && (
          <section className="cus-workspace-summary" aria-label="Tóm tắt ưu tiên xử lý">
            <dl>
              <div className="cus-workspace-summary__item">
                <dt>Lô phù hợp</dt>
                <dd>{total.toLocaleString('vi-VN')}</dd>
              </div>
              <div className="cus-workspace-summary__item cus-workspace-summary__item--warning">
                <dt>Chưa chốt lịch</dt>
                <dd>{data.pageSummary.needsSchedule.toLocaleString('vi-VN')}</dd>
              </div>
              <div className="cus-workspace-summary__item cus-workspace-summary__item--warning">
                <dt>Chờ điều xe</dt>
                <dd>{data.pageSummary.needsVehicle.toLocaleString('vi-VN')}</dd>
              </div>
              <div className="cus-workspace-summary__item cus-workspace-summary__item--info">
                <dt>Chờ Kế toán</dt>
                <dd>{data.pageSummary.waitingAccounting.toLocaleString('vi-VN')}</dd>
              </div>
            </dl>
          </section>
        )}

        {notice && <div className="cus-notice cus-notice--success" role="status">{notice}</div>}
        {error && (
          <div className="cus-notice cus-notice--error" role="alert">
            <span>{error}</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void loadList()}>Thử lại</button>
          </div>
        )}

        {loading && !data ? (
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
                  {items.map((item) => {
                    const identity = item.billOrBookNumber || item.declarationNumber || item.customerName || 'lô hàng';
                    const primarySignal = derivePrimaryShipmentSignal(item);
                    const PrimarySignalIcon = primarySignal?.icon;
                    const waitingSchedule = item.operational.scheduleReadiness === 'WAITING_DATE';
                    const editing = quickEditDraft?.shipmentId === item.id;
                    const customerNoteLines = noteLines(item.customerNotes);
                    const operationalNoteLines = noteLines(item.operationalNotes);
                    const scheduleContent = <>
                      {waitingSchedule && <strong className="cus-schedule-missing">Chưa chốt ngày</strong>}
                      {item.appointmentGroups.map((group) => (
                        <span key={group.at}>{formatAppointmentGroupLine(group.at, group.localDate)}{appointmentGroupFactorySegment(group.factoryName)} · {group.containerSummary}</span>
                      ))}
                      <span>{vehicleReadinessLabel(item)}</span>
                    </>;
                    return (
                      <tr
                        key={item.id}
                        className={`cus-dashboard-row${waitingSchedule ? ' cus-dashboard-row--waiting' : ''}`}
                      >
                        <th scope="row" data-label="Khách hàng & nhà máy" className="cus-dashboard-cell--editable cus-dashboard-cell--identity">
                          <StatusStrip color={SHIPMENT_BUCKET_COLORS[item.bucket]} />
                          <button id={`cus-inline-identity-${item.id}`} type="button" className="cus-inline-trigger" data-cell-label="Khách hàng & nhà máy" disabled={item.fieldAccess.factoryName.mode === 'READ_ONLY' || Boolean(quickEditDraft) || savingQuickEdit} title={item.fieldAccess.factoryName.reason} onClick={() => startQuickEdit(item, 'identity')} aria-haspopup="dialog" aria-label={`Sửa ô khách hàng và nhà máy ${identity}`}><span className="cus-multiline-cell">
                            <strong className={`cus-customer-name${item.customerName ? '' : ' cus-empty'}`}>{item.customerName || '—'}</strong>
                            <span className={item.effectiveFactoryNames.length > 0 || item.factoryName ? undefined : 'cus-empty'}>{item.effectiveFactoryNames.length > 0
                              ? item.effectiveFactoryNames.join(' + ')
                              : item.factoryName || 'Chưa có nhà máy'}</span>
                            <span className={item.routeName || item.deliveryLocation ? undefined : 'cus-empty'}>{item.routeName || item.deliveryLocation || 'Chưa có tuyến đường'}</span>
                          </span></button>
                        </th>
                        <td data-label="Chứng từ" className="cus-dashboard-cell--editable">
                          <button id={`cus-inline-documents-${item.id}`} type="button" className="cus-inline-trigger" data-cell-label="Chứng từ" disabled={item.fieldAccess.blNumber.mode === 'READ_ONLY' && item.fieldAccess.bookingRef.mode === 'READ_ONLY' && item.fieldAccess.declarationNumber.mode === 'READ_ONLY' || Boolean(quickEditDraft) || savingQuickEdit} title={item.fieldAccess.blNumber.reason} onClick={() => startQuickEdit(item, 'documents')} aria-haspopup="dialog" aria-label={`Sửa ô chứng từ ${identity}`}><span className="cus-multiline-cell cus-multiline-cell--mono">
                            <strong className={item.billOrBookNumber ? undefined : 'cus-empty'}>{item.billOrBookNumber || 'Chưa có Bill/Book'}</strong>
                            <span className={item.declarationNumber ? undefined : 'cus-empty'}>{item.declarationNumber || 'Chưa có tờ khai'}</span>
                          </span></button>
                        </td>
                        <td data-label="Phân loại & hãng tàu" className="cus-dashboard-cell--editable">
                          <button id={`cus-inline-classification-${item.id}`} type="button" className="cus-inline-trigger" data-cell-label="Phân loại & hãng tàu" disabled={item.fieldAccess.tradeDirection.mode === 'READ_ONLY' && item.fieldAccess.shippingLineName.mode === 'READ_ONLY' || Boolean(quickEditDraft) || savingQuickEdit} title={item.fieldAccess.tradeDirection.reason} onClick={() => startQuickEdit(item, 'classification')} aria-haspopup="dialog" aria-label={`Sửa ô phân loại và hãng tàu ${identity}`}><span className="cus-multiline-cell cus-classification">
                            <span className={item.shippingLineName ? 'cus-classification__shipping-line' : 'cus-classification__shipping-line cus-empty'}>{item.shippingLineName || 'Chưa có hãng tàu'}</span>
                            {item.isCombined && <span className="cus-combined-tag">Đóng kết hợp</span>}
                            <span className={`cus-direction-badge cus-direction-badge--${item.direction?.toLowerCase() || 'unknown'}`}>{directionLabel(item.direction)}</span>
                          </span></button>
                        </td>
                        <td data-label="Tổng quan hàng hóa" className="cus-dashboard-cell--editable">
                          <button id={`cus-inline-cargo-${item.id}`} type="button" className="cus-inline-trigger" data-cell-label="Tổng quan hàng hóa" disabled={['packageCount', 'packageType', 'cargoWeightKg', 'cargoVolumeCbm'].every((key) => item.fieldAccess[key as 'packageCount'].mode === 'READ_ONLY') || Boolean(quickEditDraft) || savingQuickEdit} title={item.fieldAccess.packageCount.reason} onClick={() => startQuickEdit(item, 'cargo')} aria-haspopup="dialog" aria-label={`Sửa ô tổng quan hàng hóa ${identity}`}><span className="cus-multiline-cell cus-multiline-cell--numeric cus-cargo-summary">
                            {splitContainerSummaryLines(item.containerSummary).length > 0
                              ? splitContainerSummaryLines(item.containerSummary).map((summaryLine) => (
                                <strong key={summaryLine} className="cus-cargo-summary__containers">{summaryLine}</strong>
                              ))
                              : <strong className="cus-cargo-summary__containers">{worksheetQuantity(item)}</strong>}
                            <span className={item.weightKg == null && (item.cargoMode !== 'LCL' || !item.volumeCbm) ? 'cus-cargo-summary__metrics cus-empty' : 'cus-cargo-summary__metrics'}>
                              <span className="cus-cargo-summary__weight">
                                {item.cargoMode === 'LCL'
                                  ? `${formatQuantity(item.weightKg)} kg · ${item.volumeCbm ? `${formatQuantity(item.volumeCbm)} CBM` : '— CBM'}`
                                  : `${formatQuantity(item.weightKg)} kg`}
                              </span>
                              <span className={`cus-direction-badge cus-direction-badge--${item.cargoMode?.toLowerCase() || 'unknown'} cus-cargo-mode-tag`}>{cargoModeLabel(item.cargoMode)}</span>
                            </span>
                          </span></button>
                        </td>
                        <td data-label="Lịch trình & điều xe" className={item.cargoMode === 'LCL' ? 'cus-dashboard-cell--editable' : 'cus-dashboard-cell--readonly'}>
                          {item.cargoMode === 'LCL' ? (
                            <button
                              id={`cus-inline-schedule-${item.id}`}
                              type="button"
                              className="cus-inline-trigger"
                              data-cell-label="Lịch trình & điều xe"
                              disabled={!item.operational.transportDateEditable || Boolean(quickEditDraft) || savingQuickEdit}
                              aria-haspopup="dialog"
                              aria-label={`Sửa ô lịch trình lô hàng ${identity}`}
                              onClick={() => startQuickEdit(item, 'schedule')}
                            >{scheduleContent}</button>
                          ) : <div className="cus-inline-trigger cus-inline-trigger--readonly">{scheduleContent}</div>}
                        </td>
                        <td data-label="Ghi chú" className="cus-dashboard-cell--editable">
                          <button
                            id={`cus-inline-notes-${item.id}`}
                            type="button"
                            className="cus-inline-trigger cus-note-preview"
                            data-cell-label="Ghi chú"
                            title={[item.customerNotes, item.operationalNotes].filter(Boolean).join('\n') || undefined}
                            disabled={!item.operational.transportDateEditable || Boolean(quickEditDraft) || savingQuickEdit}
                            aria-haspopup="dialog"
                            aria-label={`Sửa ô ghi chú lô hàng ${identity}`}
                            onClick={() => startQuickEdit(item, 'notes')}
                          >
                            {customerNoteLines.length > 0 && <span className="cus-note-preview__customer">{customerNoteLines.join(' ')}</span>}
                            {operationalNoteLines.length > 0 && <span className="cus-note-internal">{operationalNoteLines.join(' ')}</span>}
                            {customerNoteLines.length === 0 && operationalNoteLines.length === 0 && <span className="cus-note-preview__customer cus-note-preview__customer--empty">—</span>}
                          </button>
                        </td>
                        <td data-label="Trạng thái">
                          <div className="cus-row-actions">
                            <div className="cus-row-actions__summary">
                              <WorkflowBadge item={item} />
                              {pendingDeleteIds.has(item.id) && <span className="cus-workflow-badge cus-workflow-badge--pending-delete">Chờ phê duyệt xóa</span>}
                              {primarySignal && PrimarySignalIcon && <span className={`cus-attention-label cus-attention-label--${primarySignal.tone}`}><PrimarySignalIcon size={13} aria-hidden="true" /> {primarySignal.label}</span>}
                            </div>
                            <div className="cus-row-actions__buttons">
                              <UUIButton
                                size="sm"
                                color="secondary"
                                className="cus-dashboard-delete"
                                aria-label={`Yêu cầu xóa lô hàng ${identity}`}
                                onPress={() => openAction(item, 'delete')}
                                isDisabled={editing || pendingDeleteIds.has(item.id)}
                                iconLeading={<Trash2 size={16} aria-hidden="true" />}
                              >
                                Xóa
                              </UUIButton>
                              <UUIButton
                                id={'cus-dashboard-detail-' + item.id}
                                size="sm"
                                color="tertiary"
                                className="cus-dashboard-detail"
                                aria-haspopup="dialog"
                                aria-controls={'cus-detail-drawer-' + item.id}
                                aria-label={'Mở chi tiết lô hàng ' + identity + ', trạng thái ' + (item.bucket === ShipmentCusBucket.NEW ? SHIPMENT_STATUS_LABELS[item.status] : item.bucketLabel)}
                                onPress={() => openShipmentDetail(item.id)}
                                isDisabled={editing}
                                iconTrailing={ChevronRight}
                              >
                                Xem chi tiết
                              </UUIButton>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {totalPages > 1 && (
                <Pagination page={page} totalPages={totalPages} totalItems={total} pageSize={PAGE_SIZE} onChange={(nextPage) => updateParam('page', String(nextPage))} />
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
            onPress={() => { if (quickEditItem) void saveQuickEdit(quickEditItem); }}
            iconLeading={<Save size={16} aria-hidden="true" />}
          >
            Lưu thay đổi
          </UUIButton>
        </>}
      >
        {quickEditDraft && quickEditItem && (
          <form
            className="cus-quick-edit-modal"
            aria-busy={savingQuickEdit}
            onSubmit={(event) => {
              event.preventDefault();
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
      >
        <div id={drawerItem ? `cus-detail-drawer-${drawerItem.id}` : undefined}>
          {drawerItem && (
            <>
              <section className="cus-drawer-workflow" aria-labelledby="cus-drawer-workflow-title">
                <div className="cus-drawer-workflow__heading">
                  <h3 id="cus-drawer-workflow-title">Trạng thái lô</h3>
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
                      onChange={(event) => void updateCustody(drawerItem, event.target.value as ShipmentDocumentCustody)}
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

              <ShipmentDetailContent detail={details[drawerItem.id]} loading={detailLoadingIds.has(drawerItem.id)} error={detailErrors[drawerItem.id]} onRetry={() => void loadDetail(drawerItem.id, true)} onLineSaved={(line) => applySavedContainerLine(drawerItem.id, line)} getIdempotencyKey={getIdempotencyKey} clearIdempotencyKey={clearIdempotencyKey} idPrefix="cus-drawer-detail" onDirtyChange={(dirty) => setDetailDirty(drawerItem.id, dirty)} onSavingChange={(saving) => setDetailSaving(drawerItem.id, saving)} />
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
        isOpen={Boolean(actionItem && actionMode)}
        title={actionMode === 'confirm' ? 'Xác nhận nguồn chi phí' : actionMode === 'lock' ? 'Xác nhận khóa lô' : actionMode === 'delete' ? 'Yêu cầu xóa lô hàng' : 'Đề nghị điều chỉnh'}
        onClose={closeAction}
        onConfirm={() => void submitAction()}
        footer={(
          <>
            <button type="button" className="btn btn--ghost" onClick={closeAction} disabled={submitting}>Hủy</button>
            <button type="button" className="btn btn--primary" onClick={() => void submitAction()} disabled={submitting || !reason.trim()}>
              {submitting ? <Loader2 className="spin" size={17} aria-hidden="true" /> : null}
              {actionMode === 'confirm' ? 'Xác nhận chi phí' : actionMode === 'lock' ? 'Khóa lô' : actionMode === 'delete' ? 'Gửi yêu cầu xóa' : 'Gửi đề nghị'}
            </button>
          </>
        )}
      >
        {actionMode === 'confirm' ? (
          <p>Xác nhận này chụp lại phiên bản Debit Note, chuyến xe và chi phí hiện hành. Nếu nguồn thay đổi, xác nhận sẽ hết hiệu lực.</p>
        ) : actionMode === 'lock' ? (
          <p>Khóa lô sẽ chuyển toàn bộ trường nhập và tệp tải lên sang chế độ chỉ đọc. Dữ liệu chỉ được mở lại qua yêu cầu được Quản trị viên duyệt.</p>
        ) : actionMode === 'delete' ? (
          <p>Yêu cầu xóa lô hàng sẽ gửi đến Quản trị viên để phê duyệt. Nếu lô hàng chưa phát sinh nghiệp vụ, có thể xóa ngay lập tức.</p>
        ) : (
          <p>Ghi rõ nội dung cần sửa để Quản trị viên có đủ căn cứ xem xét mở lại lô hàng.</p>
        )}
        <label className="cus-action-reason">
          <span>{actionMode === 'confirm' ? 'Lý do xác nhận' : actionMode === 'lock' ? 'Lý do khóa' : actionMode === 'delete' ? 'Lý do xóa' : 'Lý do điều chỉnh'}</span>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} maxLength={500} required autoFocus />
          <small>{reason.length}/500 ký tự</small>
        </label>
      </Modal>
    </div>
  );
}
