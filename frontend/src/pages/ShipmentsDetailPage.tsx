import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CalendarDays, RotateCcw, Search } from 'lucide-react';
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
import { EmptyState, Pagination } from '../design-system';
import { PageHeader } from '../components/UI';
import {
  ShipmentContainerLedger,
  type ActiveShipmentDetailEdit,
  type ShipmentDetailEditMode,
  type ShipmentNotesDraft,
  type ShipmentRouteDraft,
  type ShipmentScheduleDraft,
  type ShipmentVehicleDraft,
} from '../features/shipments/detail/ShipmentContainerLedger';
import { formatVietnamDateInput, formatVietnamDateTimeInput, localDateTimeToIso } from '../lib/shipment-operations';
import './ShipmentsDetailPage.css';

const PAGE_SIZE = 20;
const SEARCH_PATTERN = /^[A-Za-z0-9]{4,5}$/;

function safeError(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

function canEditMode(
  detail: ShipmentCusWorkspaceDetail,
  line: ShipmentCusWorkspaceContainerLine,
  mode: ShipmentDetailEditMode,
): boolean {
  if (mode === 'route') return line.permissions.liftSiteEditable || line.permissions.dropoffSiteEditable;
  if (mode === 'vehicle') return line.permissions.carrierEditable || line.permissions.plateEditable;
  if (mode === 'schedule') return detail.summary.operational.transportDateEditable || line.permissions.customerAppointmentEditable;
  return detail.summary.operational.transportDateEditable;
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
  const allDates = searchParams.get('dateScope') === 'all';
  const page = Math.max(1, Number(searchParams.get('page') || 1) || 1);
  const suffixParam = searchParams.get('searchSuffix') ?? '';
  const dateFrom = allDates ? '' : searchParams.get('transportDateFrom') ?? today;
  const dateTo = allDates ? '' : searchParams.get('transportDateTo') ?? today;
  const customerId = Math.max(0, Number(searchParams.get('customerId') || 0) || 0);
  const rawDirection = searchParams.get('direction');
  const direction = rawDirection === 'IMPORT' || rawDirection === 'EXPORT' ? rawDirection : '';
  const [data, setData] = useState<ShipmentCusContainerFlatResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(suffixParam);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [activeEdit, setActiveEdit] = useState<ActiveShipmentDetailEdit | null>(null);
  const [editLoadingRowId, setEditLoadingRowId] = useState<number | null>(null);
  const [editError, setEditError] = useState<{ rowId: number; message: string } | null>(null);
  const requestSequence = useRef(0);
  const editRequestSequence = useRef(0);
  const editIdempotencyKeys = useRef<Record<string, string>>({});
  const restoreFocusId = useRef<string | null>(null);
  const loadRowsRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (allDates || searchParams.has('transportDateFrom') || searchParams.has('transportDateTo')) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('transportDateFrom', today);
      next.set('transportDateTo', today);
      return next;
    }, { replace: true });
  }, [allDates, searchParams, setSearchParams, today]);

  const updateParam = useCallback((key: string, value: string | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (!value) next.delete(key);
      else next.set(key, value);
      if (key === 'transportDateFrom' || key === 'transportDateTo') next.delete('dateScope');
      if (key !== 'page') next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    setSearchInput(suffixParam);
    setSearchError(null);
    setDateError(null);
    editRequestSequence.current += 1;
    setActiveEdit(null);
    setEditLoadingRowId(null);
    setEditError(null);
  }, [customerId, dateFrom, dateTo, direction, page, suffixParam]);

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
      });
      if (requestId === requestSequence.current) setData(response);
    } catch (loadError) {
      if (requestId === requestSequence.current) setError(safeError(loadError, 'Không thể tải danh sách container.'));
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [customerId, dateFrom, dateTo, direction, page, suffixParam]);

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
  const hasFilters = Boolean(suffixParam || customerId || direction || allDates || dateFrom !== today || dateTo !== today);

  const resetFilters = () => {
    setSearchInput('');
    setSearchError(null);
    setDateError(null);
    setSearchParams({ transportDateFrom: today, transportDateTo: today }, { replace: true });
  };

  const showAllDates = () => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('transportDateFrom');
      next.delete('transportDateTo');
      next.delete('page');
      next.set('dateScope', 'all');
      return next;
    }, { replace: true });
  };

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
    setActiveEdit(null);
    await loadRowsRef.current();
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
    const scheduleAt = draft.scheduleAt ? localDateTimeToIso(draft.scheduleAt) : null;
    const appointmentChanged = (draft.customerAppointmentAt ?? '') !== formatVietnamDateTimeInput(line.customerAppointmentAt);
    const currentScheduleAt = formatVietnamDateTimeInput(row.direction === 'IMPORT' ? row.plannedReturnAt : row.closingAt);
    const shipmentScheduleChanged = draft.transportDate !== row.transportDate || (draft.scheduleAt ?? '') !== currentScheduleAt;
    let expectedVersion = row.shipmentVersion;
    try {
      if (appointmentChanged) {
        const signature = JSON.stringify(['appointment', row.shipmentId, line.id, line.shipmentVersion, draft.customerAppointmentAt]);
        const key = editIdempotencyKeys.current[signature] ?? crypto.randomUUID();
        editIdempotencyKeys.current[signature] = key;
        const result = await updateCusShipmentContainerLine(row.shipmentId, line.id, {
          expectedShipmentVersion: line.shipmentVersion,
          customerAppointmentAt: draft.customerAppointmentAt ? localDateTimeToIso(draft.customerAppointmentAt) : null,
        }, key);
        delete editIdempotencyKeys.current[signature];
        expectedVersion = result.line.shipmentVersion;
      }
      if (shipmentScheduleChanged) {
        await updateShipment(row.shipmentId, {
          expectedVersion,
          expectedDeliveryDate: draft.transportDate,
          ...(row.direction === 'IMPORT' ? { plannedReturnAt: scheduleAt } : { closingAt: scheduleAt }),
        });
      }
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      await recoverConflict(row, 'schedule');
      return;
    }
    await finishSave();
  }, [finishSave, recoverConflict]);

  const saveNotes = useCallback(async (row: ShipmentCusContainerFlatRow, draft: ShipmentNotesDraft) => {
    try {
      await updateShipment(row.shipmentId, {
        expectedVersion: row.shipmentVersion,
        customerNotes: draft.customerNotes,
        operationalNotes: draft.operationalNotes,
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
      <PageHeader title="Chi tiết lô hàng" iconName="cargo" description="Bảng điều hành theo từng container: lịch trình, điểm nâng hạ, phân xe và ghi chú." />

      <section className="shipments-detail-workspace" aria-labelledby="shipment-container-ledger-title" aria-busy={loading}>
        <div className="shipments-detail-workspace__header">
          <div className="shipments-detail-workspace__intro">
            <span className="shipments-detail-eyebrow">Sổ điều hành container</span>
            <h2 id="shipment-container-ledger-title">Công việc container {allDates ? 'theo toàn bộ ngày' : `ngày ${dateFrom === dateTo ? dateFrom.split('-').reverse().join('/') : `${dateFrom} – ${dateTo}`}`}</h2>
            <p>Mỗi dòng là một container. Lịch trình và ghi chú thuộc toàn lô; điểm nâng hạ và phân xe thuộc từng container.</p>
          </div>

          <form className="shipments-detail-filters" noValidate onSubmit={(event) => {
            event.preventDefault();
            const value = searchInput.trim().toUpperCase();
            if (value && !SEARCH_PATTERN.test(value)) {
              setSearchError('Nhập đúng 4 hoặc 5 ký tự chữ và số cuối.');
              return;
            }
            if (dateFrom && dateTo && dateFrom > dateTo) {
              setDateError('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
              return;
            }
            setSearchError(null);
            setDateError(null);
            updateParam('searchSuffix', value || null);
          }}>
            <UUIInput label="Container, Bill/Booking hoặc tờ khai" size="sm" icon={Search} value={searchInput} onChange={(value) => { setSearchInput(value); setSearchError(null); }} placeholder="Nhập 4–5 ký tự cuối" hint={searchError ?? 'Tìm theo 4–5 ký tự cuối.'} isInvalid={Boolean(searchError)} inputProps={{ maxLength: 5, autoCapitalize: 'characters', autoCorrect: 'off', spellCheck: false }} className="shipments-detail-filter shipments-detail-filter--search" />
            <UUIInput label="Từ ngày vận chuyển" size="sm" type="date" value={dateFrom} onChange={(value) => updateParam('transportDateFrom', value || null)} isInvalid={Boolean(dateError)} className="shipments-detail-filter" />
            <UUIInput label="Đến ngày vận chuyển" size="sm" type="date" value={dateTo} onChange={(value) => updateParam('transportDateTo', value || null)} hint={dateError ?? undefined} isInvalid={Boolean(dateError)} className="shipments-detail-filter" />
            <UUINativeSelect label="Khách hàng" size="sm" value={customerId ? String(customerId) : ''} onChange={(event) => updateParam('customerId', event.target.value || null)} options={[{ value: '', label: 'Tất cả khách hàng' }, ...customers.map((customer) => ({ value: String(customer.id), label: customer.name }))]} className="shipments-detail-filter" />
            <UUINativeSelect label="Nhập / Xuất" size="sm" value={direction} onChange={(event) => updateParam('direction', event.target.value || null)} options={[{ value: '', label: 'Tất cả' }, { value: 'IMPORT', label: 'Nhập' }, { value: 'EXPORT', label: 'Xuất' }]} className="shipments-detail-filter" />
            <div className="shipments-detail-filters__actions">
              <UUIButton size="sm" color="primary" type="submit" iconLeading={<Search aria-hidden="true" />}>Áp dụng</UUIButton>
              <UUIButton size="sm" color="secondary" onPress={showAllDates} iconLeading={<CalendarDays aria-hidden="true" />}>Tất cả ngày</UUIButton>
              {hasFilters && <UUIButton size="sm" color="tertiary" onPress={resetFilters} iconLeading={<RotateCcw aria-hidden="true" />}>Về hôm nay</UUIButton>}
            </div>
          </form>
        </div>

        {error && <Alert variant="error" style="soft" className="shipments-detail-error" icon={<AlertCircle size={18} />} action={<UUIButton size="sm" color="secondary" onPress={() => void loadRows()}>Thử lại</UUIButton>}>{error}</Alert>}

        {loading ? <ShipmentContainerLedgerSkeleton /> : error ? null : items.length === 0 ? (
          <EmptyState icon={Search} title={hasFilters ? 'Không có container phù hợp' : 'Chưa có container'} description={hasFilters ? 'Đổi bộ lọc hoặc trở về hôm nay để xem lại công việc.' : 'Container của các lô hàng sẽ xuất hiện tại đây.'} action={hasFilters ? <UUIButton size="sm" color="secondary" onPress={resetFilters} iconLeading={<RotateCcw aria-hidden="true" />}>Về hôm nay</UUIButton> : undefined} />
        ) : <>
          <ShipmentContainerLedger rows={items} totalContainers={totalContainers} today={today} activeEdit={activeEdit} editLoadingRowId={editLoadingRowId} editError={editError} onStartEdit={(row, mode, triggerId) => void startEdit(row, mode, triggerId)} onCancelEdit={cancelEdit} onSaveRoute={saveRoute} onSaveVehicle={saveVehicle} onSaveSchedule={saveSchedule} onSaveNotes={saveNotes} />
          <Pagination page={page} totalPages={totalPages} summary={<span className="ds-pagination__summary">Trang này có <b>{items.length.toLocaleString('vi-VN')}</b> / <b>{totalContainers.toLocaleString('vi-VN')}</b> container phù hợp</span>} onChange={(nextPage) => updateParam('page', String(nextPage))} />
        </>}
      </section>
    </div>
  );
}
