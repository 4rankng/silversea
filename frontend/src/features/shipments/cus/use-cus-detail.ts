// Server-state + inline-edit hook for the CUS container-detail workboard.
//
// Extracted verbatim from pages/ShipmentsDetailPage.tsx (since renamed
// ShipmentContainersPage) in the 2026-09-01
// structural split: paginated row fetching, the per-mode edit sessions
// (fetch workspace detail, gate on canEditMode), signature-keyed idempotency,
// and optimistic-conflict recovery that swaps in fresh data instead of
// surfacing a 409.

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ShipmentCusContainerFlatResponse,
  ShipmentCusContainerFlatRow,
  ShipmentCusContainerSortKey,
  ShipmentCusWorkspaceContainerLine,
} from '@tingting/shared';
import {
  getCusShipmentWorkspaceDetail,
  listCusShipmentContainers,
  updateCusShipmentContainerLine,
  updateShipment,
} from '../../../api/shipmentClient';
import {
  formatVietnamDateTimeInput,
  localDateTimeToIso,
} from '../../../lib/shipment-operations';
import {
  type ActiveShipmentDetailEdit,
  type ShipmentNotesDraft,
  type ShipmentIdentityDraft,
  type ShipmentDocumentsDraft,
  type ShipmentContainerDraft,
  type ShipmentRouteDraft,
  type ShipmentScheduleDraft,
  type ShipmentVehicleDraft,
  type ShipmentDetailEditMode,
} from '../detail/ShipmentContainerLedger';
import { canEditMode, isOptimisticShipmentConflict, CUS_DETAIL_PAGE_SIZE, type DispatchStatusFilter } from './cusDetailModel';
import { safeError } from './cusUtils';

export interface CusDetailListParams {
  page: number;
  searchSuffix: string;
  transportDateFrom: string;
  transportDateTo: string;
  customerId: number;
  direction: '' | 'IMPORT' | 'EXPORT';
  dispatchStatus: '' | DispatchStatusFilter;
  sortKey: ShipmentCusContainerSortKey | null;
  sortDir: 'asc' | 'desc' | undefined;
}

export function useCusDetail(params: CusDetailListParams) {
  const { page, searchSuffix, transportDateFrom, transportDateTo, customerId, direction, dispatchStatus, sortKey, sortDir } = params;
  const [data, setData] = useState<ShipmentCusContainerFlatResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeEdit, setActiveEdit] = useState<ActiveShipmentDetailEdit | null>(null);
  const [editLoadingRowId, setEditLoadingRowId] = useState<number | null>(null);
  const [editError, setEditError] = useState<{ rowId: number; message: string } | null>(null);
  const [editNotice, setEditNotice] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const editRequestSequence = useRef(0);
  const editIdempotencyKeys = useRef<Record<string, string>>({});
  const restoreFocusId = useRef<string | null>(null);
  const loadRowsRef = useRef<() => Promise<void>>(async () => {});

  // Any filter/page/sort change invalidates an open edit session wholesale.
  useEffect(() => {
    editRequestSequence.current += 1;
    setActiveEdit(null);
    setEditLoadingRowId(null);
    setEditError(null);
    setEditNotice(null);
  }, [customerId, direction, dispatchStatus, page, sortDir, sortKey, searchSuffix, transportDateFrom, transportDateTo]);

  const loadRows = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const response = await listCusShipmentContainers({
        page,
        limit: CUS_DETAIL_PAGE_SIZE,
        searchSuffix: searchSuffix || undefined,
        transportDateFrom: transportDateFrom || undefined,
        transportDateTo: transportDateTo || undefined,
        customerId: customerId || undefined,
        direction: direction || undefined,
        dispatchStatus: dispatchStatus || undefined,
        sortBy: sortKey ?? undefined,
        sortDir,
      });
      if (requestId === requestSequence.current) setData(response);
    } catch (loadError) {
      if (requestId === requestSequence.current) setError(safeError(loadError, 'Không thể tải danh sách container.'));
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [customerId, direction, dispatchStatus, page, searchSuffix, sortDir, sortKey, transportDateFrom, transportDateTo]);

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
        ...(line.permissions.routeEditable ? { routeId: draft.routeId } : {}),
        ...(line.permissions.liftSiteEditable ? { liftSiteId: draft.liftSiteId } : {}),
        ...(line.permissions.dropoffSiteEditable ? { dropoffSiteId: draft.dropoffSiteId } : {}),
      }, key);
    } catch (error) {
      if (!isOptimisticShipmentConflict(error)) throw error;
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
        ...(activeEdit.detail.summary.cargoMode !== 'FCL' ? { routeId: draft.routeId } : {}),
        deliveryLocation: draft.deliveryLocation,
      });
      if (response.changeMode === 'REQUESTED') setEditNotice(response.message ?? 'Đã gửi yêu cầu thay đổi để phê duyệt.');
    } catch (error) {
      if (!isOptimisticShipmentConflict(error)) throw error;
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
      if (!isOptimisticShipmentConflict(error)) throw error;
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
      if (!isOptimisticShipmentConflict(error)) throw error;
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
      if (!isOptimisticShipmentConflict(error)) throw error;
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
    // FCL transportDate is a derived earliest-container projection. Its only
    // editable scheduling authority is customerAppointmentAt on this line.
    const transportChanged = activeEdit.detail.summary.cargoMode !== 'FCL'
      && draft.transportDate !== row.transportDate;
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
      if (!isOptimisticShipmentConflict(error)) throw error;
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
      if (!isOptimisticShipmentConflict(error)) throw error;
      await recoverConflict(row, 'notes');
      return;
    }
    await finishSave();
  }, [finishSave, recoverConflict]);

  return {
    data, loading, error, loadRows, setError,
    activeEdit, editLoadingRowId, editError, editNotice,
    startEdit, cancelEdit, saveIdentity, saveDocuments, saveContainer,
    saveRoute, saveVehicle, saveSchedule, saveNotes,
  };
}
