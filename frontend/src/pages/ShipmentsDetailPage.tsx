import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, RotateCcw, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type {
  ShipmentCusContainerFlatResponse,
  ShipmentCusContainerFlatRow,
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import { ApiError } from '../lib/api';
import {
  getCusShipmentWorkspaceDetail,
  listCusShipmentContainers,
  updateCusShipmentContainerLine,
  updateShipment,
} from '../api/shipmentClient';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { Alert } from '../components/shared/Alert';
import { Skeleton } from '../components/shared/Skeleton';
import { Button as UUIButton } from '../components/untitled-ui/base/buttons/button';
import { Input as UUIInput } from '../components/untitled-ui/base/input/input';
import { NativeSelect as UUINativeSelect } from '../components/untitled-ui/base/select/select-native';
import { EmptyState, Pagination, BufferedUuiDateInput } from '../design-system';
import { PageHeader } from '../components/UI';
import {
  ShipmentContainerLedger,
  type ActiveShipmentDetailEdit,
  type ShipmentDetailEditMode,
  type ShipmentNotesDraft,
  type ShipmentIdentityDraft,
  type ShipmentDocumentsDraft,
  type ShipmentContainerDraft,
  type ShipmentRouteDraft,
  type ShipmentScheduleDraft,
  type ShipmentVehicleDraft,
} from '../features/shipments/detail/ShipmentContainerLedger';
import { formatVietnamDateInput, formatVietnamDateTimeInput, localDateTimeToIso } from '../lib/shipment-operations';
import './ShipmentsDetailPage.css';

const PAGE_SIZE = 20;
const SEARCH_PATTERN = /^[A-Za-z0-9]{4,5}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function readIsoDate(value: string | null): string {
  if (!value || !ISO_DATE_PATTERN.test(value)) return '';
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? '' : value;
}

function readPositiveInteger(value: string | null, fallback = 0): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeError(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

function canEditMode(
  detail: ShipmentCusWorkspaceDetail,
  line: ShipmentCusWorkspaceContainerLine,
  mode: ShipmentDetailEditMode,
): boolean {
  if (mode === 'identity') return ['factoryName', 'routeId', 'deliveryLocation'].some((field) => detail.summary.fieldAccess[field as 'factoryName'].mode !== 'READ_ONLY');
  if (mode === 'documents') return ['blNumber', 'bookingRef', 'tradeDirection', 'shippingLineName'].some((field) => detail.summary.fieldAccess[field as 'blNumber'].mode !== 'READ_ONLY');
  if (mode === 'container') return ['containerNumber', 'containerTypeId', 'cargoWeightKg', 'cargoVolumeCbm'].some((field) => line.fieldAccess[field as 'containerNumber'].mode !== 'READ_ONLY');
  if (mode === 'route') return line.permissions.liftSiteEditable || line.permissions.dropoffSiteEditable;
  if (mode === 'vehicle') return line.permissions.carrierEditable || line.permissions.plateEditable;
  if (mode === 'schedule') return detail.summary.operational.transportDateEditable || line.permissions.customerAppointmentEditable;
  return ['customerNotes', 'operationalNotes'].some((field) => detail.summary.fieldAccess[field as 'customerNotes'].mode !== 'READ_ONLY');
}

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

export default function ShipmentsDetailPage() {
  const today = useMemo(() => formatVietnamDateInput(new Date()), []);
  const [searchParams, setSearchParams] = useSearchParams();
  const page = readPositiveInteger(searchParams.get('page'), 1);
  const rawSuffix = searchParams.get('searchSuffix') ?? '';
  const suffixParam = SEARCH_PATTERN.test(rawSuffix) ? rawSuffix.toUpperCase() : '';
  const parsedDateFrom = readIsoDate(searchParams.get('transportDateFrom'));
  const parsedDateTo = readIsoDate(searchParams.get('transportDateTo'));
  const allDates = searchParams.get('dateScope') === 'all';
  const datesAreOrdered = !parsedDateFrom || !parsedDateTo || parsedDateFrom <= parsedDateTo;
  const dateFrom = datesAreOrdered ? (parsedDateFrom || (!allDates && !parsedDateTo ? today : '')) : today;
  const dateTo = datesAreOrdered ? (parsedDateTo || (!allDates && !parsedDateFrom ? today : '')) : today;
  const customerId = readPositiveInteger(searchParams.get('customerId'));
  const rawDirection = searchParams.get('direction');
  const direction = rawDirection === 'IMPORT' || rawDirection === 'EXPORT' ? rawDirection : '';
  // Detail-only server-derived triage filter; the overview endpoint rejects it.
  const informationStatus = searchParams.get('informationStatus') === 'MISSING' ? 'MISSING' : '';
  const [data, setData] = useState<ShipmentCusContainerFlatResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(suffixParam);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeEdit, setActiveEdit] = useState<ActiveShipmentDetailEdit | null>(null);
  const [editLoadingRowId, setEditLoadingRowId] = useState<number | null>(null);
  const [editError, setEditError] = useState<{ rowId: number; message: string } | null>(null);
  const [editNotice, setEditNotice] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const editRequestSequence = useRef(0);
  const appliedSearchRef = useRef(suffixParam);
  const editIdempotencyKeys = useRef<Record<string, string>>({});
  const restoreFocusId = useRef<string | null>(null);
  const loadRowsRef = useRef<() => Promise<void>>(async () => {});

  const updateParam = useCallback((key: string, value: string | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (!value) next.delete(key);
      else next.set(key, value);
      if (key !== 'page') next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const updateSearch = useCallback((rawValue: string) => {
    const value = rawValue.toUpperCase();
    const isEmptyOrPartial = /^[A-Z0-9]{0,3}$/.test(value);
    const isValid = SEARCH_PATTERN.test(value);
    setSearchInput(value);
    setSearchError(isEmptyOrPartial || isValid ? null : 'Nhập đúng 4 hoặc 5 ký tự chữ và số cuối.');

    const nextSuffix = isValid ? value : '';
    if (nextSuffix === suffixParam) return;
    appliedSearchRef.current = nextSuffix;
    updateParam('searchSuffix', nextSuffix || null);
  }, [suffixParam, updateParam]);

  useEffect(() => {
    if (appliedSearchRef.current === suffixParam) return;
    appliedSearchRef.current = suffixParam;
    setSearchInput(suffixParam);
    setSearchError(null);
  }, [suffixParam]);

  useEffect(() => {
    editRequestSequence.current += 1;
    setActiveEdit(null);
    setEditLoadingRowId(null);
    setEditError(null);
    setEditNotice(null);
  }, [customerId, dateFrom, dateTo, direction, informationStatus, page, suffixParam]);

  const loadRows = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const response = await listCusShipmentContainers({
        page,
        limit: PAGE_SIZE,
        searchSuffix: suffixParam || undefined,
        transportDateFrom: dateFrom || undefined,
        transportDateTo: dateTo || undefined,
        customerId: customerId || undefined,
        direction: direction || undefined,
        informationStatus: informationStatus || undefined,
      });
      if (requestId === requestSequence.current) setData(response);
    } catch (loadError) {
      if (requestId === requestSequence.current) setError(safeError(loadError, 'Không thể tải danh sách container.'));
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [customerId, dateFrom, dateTo, direction, informationStatus, page, suffixParam]);

  useEffect(() => { void loadRows(); }, [loadRows]);

  useEffect(() => {
    loadRowsRef.current = loadRows;
  }, [loadRows]);

  useEffect(() => {
    if (activeEdit || !restoreFocusId.current) return;
    const id = restoreFocusId.current;
    restoreFocusId.current = null;
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  }, [activeEdit]);

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 0;
  const totalContainers = data?.total ?? 0;
  const customers = data?.filterOptions.customers ?? [];
  const hasFilters = Boolean(suffixParam || customerId || direction || dateFrom || dateTo || informationStatus);

  const resetFilters = () => {
    appliedSearchRef.current = '';
    setSearchInput('');
    setSearchError(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('searchSuffix');
      next.delete('customerId');
      next.delete('direction');
      next.delete('informationStatus');
      next.delete('transportDateFrom');
      next.delete('transportDateTo');
      next.set('dateScope', 'all');
      next.delete('page');
      return next;
    }, { replace: true });
  };

  const showAllDates = () => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    next.delete('transportDateFrom');
    next.delete('transportDateTo');
    next.set('dateScope', 'all');
    next.delete('page');
    return next;
  }, { replace: true });

  const showToday = () => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    next.delete('dateScope');
    next.set('transportDateFrom', today);
    next.set('transportDateTo', today);
    next.delete('page');
    return next;
  }, { replace: true });

  const cancelEdit = useCallback(() => {
    editRequestSequence.current += 1;
    setActiveEdit(null);
    setEditLoadingRowId(null);
    setEditError(null);
  }, []);

  const startEdit = useCallback(async (
    row: ShipmentCusContainerFlatRow,
    mode: ShipmentDetailEditMode,
    triggerId: string,
  ) => {
    const requestId = ++editRequestSequence.current;
    restoreFocusId.current = null;
    setActiveEdit(null);
    setEditLoadingRowId(row.id);
    setEditError(null);
    setEditNotice(null);
    try {
      const detail = await getCusShipmentWorkspaceDetail(row.shipmentId);
      if (requestId !== editRequestSequence.current) return;
      const line = detail.containers.find((candidate) => candidate.id === row.id);
      const permitted = line && canEditMode(detail, line, mode);
      if (!line || !permitted) throw new Error('Trường này không còn được phép chỉnh sửa. Tải lại trang để xem trạng thái mới nhất.');
      restoreFocusId.current = triggerId;
      setActiveEdit({ row: { ...row, shipmentVersion: detail.summary.version }, detail, line, mode });
    } catch (loadError) {
      if (requestId === editRequestSequence.current) {
        setEditError({ rowId: row.id, message: safeError(loadError, 'Không thể mở dòng chỉnh sửa.') });
        requestAnimationFrame(() => document.getElementById(triggerId)?.focus());
      }
    } finally {
      if (requestId === editRequestSequence.current) setEditLoadingRowId(null);
    }
  }, []);

  const recoverConflict = useCallback(async (
    row: ShipmentCusContainerFlatRow,
    mode: ShipmentDetailEditMode,
  ) => {
    const requestId = ++editRequestSequence.current;
    const detail = await getCusShipmentWorkspaceDetail(row.shipmentId);
    if (requestId !== editRequestSequence.current) return;
    const line = detail.containers.find((candidate) => candidate.id === row.id);
    if (!line) throw new Error('Container không còn trong lô hàng này.');
    if (!canEditMode(detail, line, mode)) {
      setActiveEdit(null);
      setEditError({ rowId: row.id, message: 'Quyền chỉnh sửa vừa thay đổi. Dòng này đã chuyển sang chỉ đọc.' });
      return;
    }
    setActiveEdit({
      row: {
        ...row,
        shipmentVersion: detail.summary.version,
        transportDate: detail.summary.transportDate,
        closingAt: detail.summary.closingAt,
        plannedReturnAt: detail.summary.plannedReturnAt,
        direction: detail.summary.direction,
        customerAppointmentAt: line.customerAppointmentAt,
        customerNotes: detail.summary.customerNotes,
        operationalNotes: detail.summary.operationalNotes,
      },
      detail,
      line,
      mode,
      recoveryMessage: 'Dữ liệu vừa thay đổi. Đã tải bản mới nhất và bỏ bản nháp cũ để tránh ghi đè; vui lòng nhập lại thay đổi.',
    });
  }, []);

  const finishSave = useCallback(async () => {
    await loadRowsRef.current();
    setActiveEdit(null);
  }, []);

  const saveRoute = useCallback(async (line: ShipmentCusWorkspaceContainerLine, draft: ShipmentRouteDraft) => {
    if (!activeEdit) throw new Error('Phiên chỉnh sửa không còn hiệu lực.');
    const signature = JSON.stringify(['route', activeEdit.detail.summary.id, line.id, line.shipmentVersion, draft]);
    const key = editIdempotencyKeys.current[signature] ?? crypto.randomUUID();
    editIdempotencyKeys.current[signature] = key;
    try {
      await updateCusShipmentContainerLine(activeEdit.detail.summary.id, line.id, {
        expectedShipmentVersion: line.shipmentVersion,
        ...(line.permissions.liftSiteEditable ? { liftSiteId: draft.liftSiteId } : {}),
        ...(line.permissions.dropoffSiteEditable ? { dropoffSiteId: draft.dropoffSiteId } : {}),
      }, key);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      delete editIdempotencyKeys.current[signature];
      await recoverConflict(activeEdit.row, 'route');
      return;
    }
    delete editIdempotencyKeys.current[signature];
    await finishSave();
  }, [activeEdit, finishSave, recoverConflict]);

  const saveIdentity = useCallback(async (row: ShipmentCusContainerFlatRow, draft: ShipmentIdentityDraft) => {
    if (!activeEdit) throw new Error('Phiên chỉnh sửa không còn hiệu lực.');
    try {
      const response = await updateShipment(row.shipmentId, {
        expectedVersion: activeEdit.detail.summary.version,
        factoryName: draft.factoryName,
        routeId: draft.routeId,
        deliveryLocation: draft.deliveryLocation,
      });
      if (response.changeMode === 'REQUESTED') setEditNotice(response.message ?? 'Đã gửi yêu cầu thay đổi để phê duyệt.');
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      await recoverConflict(row, 'identity');
      return;
    }
    await finishSave();
  }, [activeEdit, finishSave, recoverConflict]);

  const saveDocuments = useCallback(async (row: ShipmentCusContainerFlatRow, draft: ShipmentDocumentsDraft) => {
    if (!activeEdit) throw new Error('Phiên chỉnh sửa không còn hiệu lực.');
    try {
      const response = await updateShipment(row.shipmentId, {
        expectedVersion: activeEdit.detail.summary.version,
        blNumber: draft.blNumber,
        bookingRef: draft.bookingRef,
        tradeDirection: draft.tradeDirection,
        shippingLineName: draft.shippingLineName,
      });
      if (response.changeMode === 'REQUESTED') setEditNotice(response.message ?? 'Đã gửi yêu cầu thay đổi để phê duyệt.');
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      await recoverConflict(row, 'documents');
      return;
    }
    await finishSave();
  }, [activeEdit, finishSave, recoverConflict]);

  const saveContainer = useCallback(async (line: ShipmentCusWorkspaceContainerLine, draft: ShipmentContainerDraft) => {
    if (!activeEdit) throw new Error('Phiên chỉnh sửa không còn hiệu lực.');
    const signature = JSON.stringify(['container', activeEdit.detail.summary.id, line.id, line.shipmentVersion, draft]);
    const key = editIdempotencyKeys.current[signature] ?? crypto.randomUUID();
    editIdempotencyKeys.current[signature] = key;
    try {
      await updateCusShipmentContainerLine(activeEdit.detail.summary.id, line.id, {
        expectedShipmentVersion: line.shipmentVersion,
        containerNumber: draft.containerNumber,
        containerTypeId: draft.containerTypeId,
        cargoWeightKg: draft.cargoWeightKg,
        cargoVolumeCbm: draft.cargoVolumeCbm,
      }, key);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      delete editIdempotencyKeys.current[signature];
      await recoverConflict(activeEdit.row, 'container');
      return;
    }
    delete editIdempotencyKeys.current[signature];
    await finishSave();
  }, [activeEdit, finishSave, recoverConflict]);

  const saveVehicle = useCallback(async (line: ShipmentCusWorkspaceContainerLine, draft: ShipmentVehicleDraft) => {
    if (!activeEdit) throw new Error('Phiên chỉnh sửa không còn hiệu lực.');
    const signature = JSON.stringify(['vehicle', activeEdit.detail.summary.id, line.id, line.shipmentVersion, draft]);
    const key = editIdempotencyKeys.current[signature] ?? crypto.randomUUID();
    editIdempotencyKeys.current[signature] = key;
    try {
      await updateCusShipmentContainerLine(activeEdit.detail.summary.id, line.id, {
        expectedShipmentVersion: line.shipmentVersion,
        carrierType: draft.carrierType,
        ...(draft.newExternalCarrier
          ? { newExternalCarrier: draft.newExternalCarrier }
          : {
              externalCarrierId: draft.externalCarrierId,
              externalCarrierVehicleId: draft.externalCarrierVehicleId,
              plateNumber: draft.plateNumber,
            }),
      }, key);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      delete editIdempotencyKeys.current[signature];
      await recoverConflict(activeEdit.row, 'vehicle');
      return;
    }
    delete editIdempotencyKeys.current[signature];
    await finishSave();
  }, [activeEdit, finishSave, recoverConflict]);

  const saveSchedule = useCallback(async (line: ShipmentCusWorkspaceContainerLine, row: ShipmentCusContainerFlatRow, draft: ShipmentScheduleDraft) => {
    if (!activeEdit) throw new Error('Phiên chỉnh sửa không còn hiệu lực.');
    const appointmentAt = draft.customerAppointmentAt ? localDateTimeToIso(draft.customerAppointmentAt) : null;
    const currentAppointmentInput = formatVietnamDateTimeInput(row.customerAppointmentAt);
    const transportChanged = draft.transportDate !== row.transportDate;
    const appointmentChanged = draft.customerAppointmentAt !== currentAppointmentInput;
    if (transportChanged && appointmentChanged) {
      throw new Error('Ngày vận chuyển và lịch hẹn được lưu độc lập. Hãy lưu từng nhóm một.');
    }
    const signature = JSON.stringify(['schedule', activeEdit.detail.summary.id, line.id, line.shipmentVersion, draft.transportDate, appointmentAt]);
    const key = editIdempotencyKeys.current[signature] ?? crypto.randomUUID();
    editIdempotencyKeys.current[signature] = key;
    try {
      let expectedShipmentVersion = line.shipmentVersion;
      if (transportChanged) {
        const updated = await updateShipment(row.shipmentId, {
          expectedVersion: expectedShipmentVersion,
          expectedDeliveryDate: draft.transportDate,
        });
        expectedShipmentVersion = updated.version;
      }
      if (appointmentChanged) {
        await updateCusShipmentContainerLine(row.shipmentId, line.id, {
          expectedShipmentVersion,
          customerAppointmentAt: appointmentAt,
        }, key);
      }
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      delete editIdempotencyKeys.current[signature];
      await recoverConflict(row, 'schedule');
      return;
    }
    delete editIdempotencyKeys.current[signature];
    await finishSave();
  }, [activeEdit, finishSave, recoverConflict]);

  const saveNotes = useCallback(async (row: ShipmentCusContainerFlatRow, draft: ShipmentNotesDraft) => {
    try {
      await updateShipment(row.shipmentId, {
        expectedVersion: row.shipmentVersion,
        customerNotes: draft.customerNotes,
        driverNotes: draft.operationalNotes,
      });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      await recoverConflict(row, 'notes');
      return;
    }
    await finishSave();
  }, [finishSave, recoverConflict]);

  return (
    <div className="shipments-detail-page">
      <Breadcrumbs items={[{ label: 'Tổng quan lô hàng', to: '/shipments' }, { label: 'Chi tiết lô hàng' }]} />
      <PageHeader title="Chi tiết lô hàng" iconName="cargo" description="Bảng điều hành có thể chỉnh trực tiếp từng ô dữ liệu được phép của lô hàng và container." />
      {editNotice && <Alert variant="success">{editNotice}</Alert>}

      <section className="shipments-detail-workspace" aria-label="Danh sách container" aria-busy={loading}>
        <div className="shipments-detail-workspace__header">
          <div className="shipments-detail-filters">
            <UUIInput label="Container, Bill/Booking hoặc tờ khai" size="sm" icon={Search} value={searchInput} onChange={updateSearch} placeholder="Nhập 4–5 ký tự cuối" hint={searchError ?? undefined} isInvalid={Boolean(searchError)} inputProps={{ maxLength: 5, autoCapitalize: 'characters', autoCorrect: 'off', spellCheck: false }} className="shipments-detail-filter shipments-detail-filter--search" />
            <BufferedUuiDateInput label="Từ ngày vận chuyển" size="sm" value={dateFrom} onChange={(value) => updateParam('transportDateFrom', value || null)} inputProps={{ max: dateTo || undefined }} className="shipments-detail-filter" />
            <BufferedUuiDateInput label="Đến ngày vận chuyển" size="sm" value={dateTo} onChange={(value) => updateParam('transportDateTo', value || null)} inputProps={{ min: dateFrom || undefined }} className="shipments-detail-filter" />
            <UUINativeSelect label="Khách hàng" size="sm" value={customerId ? String(customerId) : ''} onChange={(event) => updateParam('customerId', event.target.value || null)} options={[{ value: '', label: 'Tất cả khách hàng' }, ...customers.map((customer) => ({ value: String(customer.id), label: customer.name }))]} className="shipments-detail-filter" />
            <UUINativeSelect label="Nhập / Xuất" size="sm" value={direction} onChange={(event) => updateParam('direction', event.target.value || null)} options={[{ value: '', label: 'Tất cả' }, { value: 'IMPORT', label: 'Nhập' }, { value: 'EXPORT', label: 'Xuất' }]} className="shipments-detail-filter" />
            <UUINativeSelect label="Trạng thái dữ liệu" size="sm" value={informationStatus} onChange={(event) => updateParam('informationStatus', event.target.value || null)} options={[{ value: '', label: 'Tất cả' }, { value: 'MISSING', label: 'Chưa cập nhật' }]} className="shipments-detail-filter" />
            <div className="shipments-detail-filters__footer">
              <div className="shipments-detail-filters__date-actions">
                {(dateFrom !== today || dateTo !== today) && <UUIButton size="sm" color="secondary" onPress={showToday}>Về hôm nay</UUIButton>}
                {!allDates && <UUIButton size="sm" color="secondary" onPress={showAllDates}>Tất cả ngày</UUIButton>}
                {hasFilters && <UUIButton size="sm" color="secondary" className="shipments-detail-filters__reset" onPress={resetFilters} iconLeading={<RotateCcw aria-hidden="true" />}>Xóa bộ lọc</UUIButton>}
              </div>
            </div>
          </div>
        </div>

        {error && <Alert variant="error" style="soft" className="shipments-detail-error" icon={<AlertCircle size={18} />} action={<UUIButton size="sm" color="secondary" onPress={() => void loadRows()}>Thử lại</UUIButton>}>{error}</Alert>}

        {loading ? <ShipmentContainerLedgerSkeleton /> : error ? null : items.length === 0 ? (
          <EmptyState illustration="/assets/illustrations/empty-container-search-v1.png" title={hasFilters ? 'Không có container phù hợp' : 'Chưa có container'} description={hasFilters ? 'Đổi hoặc xóa bộ lọc để xem lại công việc.' : 'Container của các lô hàng sẽ xuất hiện tại đây.'} action={hasFilters ? <UUIButton size="sm" color="secondary" onPress={resetFilters} iconLeading={<RotateCcw aria-hidden="true" />}>Xóa bộ lọc</UUIButton> : undefined} />
        ) : <>
          <ShipmentContainerLedger rows={items} totalContainers={totalContainers} today={today} footer={<Pagination page={page} totalPages={totalPages} summary={<span className="ds-pagination__summary">Trang này có <b>{items.length.toLocaleString('vi-VN')}</b> / <b>{totalContainers.toLocaleString('vi-VN')}</b> container phù hợp</span>} onChange={(nextPage) => updateParam('page', String(nextPage))} />} activeEdit={activeEdit} editLoadingRowId={editLoadingRowId} editError={editError} onStartEdit={(row, mode, triggerId) => void startEdit(row, mode, triggerId)} onCancelEdit={cancelEdit} onSaveIdentity={saveIdentity} onSaveDocuments={saveDocuments} onSaveContainer={saveContainer} onSaveRoute={saveRoute} onSaveVehicle={saveVehicle} onSaveSchedule={saveSchedule} onSaveNotes={saveNotes} />
        </>}
      </section>
    </div>
  );
}
