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
  copyCusShipmentContainerAppointment,
  copyCusShipmentContainerDeclaration,
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
  type ShipmentDocumentsSaveOutcome,
  type ShipmentContainerDraft,
  type ShipmentRouteDraft,
  type ShipmentScheduleDraft,
  type ShipmentVehicleDraft,
} from '../detail/ShipmentContainerLedger';
import type { ShipmentDetailEditMode } from '../detail/edit-mode';
import { canEditMode, isOptimisticShipmentConflict, type DispatchStatusFilter } from './cusDetailModel';
import { safeError } from './cusUtils';

export interface CusDetailListParams {
  page: number;
  /** Rows per page — one of SHIPMENT_CUS_PAGE_SIZES (20 by default). */
  pageSize: number;
  searchSuffix: string;
  transportDateFrom: string;
  transportDateTo: string;
  customerId: number;
  direction: '' | 'IMPORT' | 'EXPORT';
  dispatchStatus: '' | DispatchStatusFilter;
  /** 'MISSING' = chỉ các dòng thiếu trường bắt buộc (Trạng thái dữ liệu). */
  informationStatus: '' | 'MISSING';
  sortKey: ShipmentCusContainerSortKey | null;
  sortDir: 'asc' | 'desc' | undefined;
}

export function useCusDetail(params: CusDetailListParams) {
  const { page, pageSize, searchSuffix, transportDateFrom, transportDateTo, customerId, direction, dispatchStatus, informationStatus, sortKey, sortDir } = params;
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
  }, [customerId, direction, dispatchStatus, informationStatus, page, sortDir, sortKey, searchSuffix, transportDateFrom, transportDateTo]);

  const loadRows = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const response = await listCusShipmentContainers({
        page,
        limit: pageSize,
        searchSuffix: searchSuffix || undefined,
        transportDateFrom: transportDateFrom || undefined,
        transportDateTo: transportDateTo || undefined,
        customerId: customerId || undefined,
        direction: direction || undefined,
        dispatchStatus: dispatchStatus || undefined,
        informationStatus: informationStatus || undefined,
        sortBy: sortKey ?? undefined,
        sortDir,
      });
      if (requestId === requestSequence.current) setData(response);
    } catch (loadError) {
      if (requestId === requestSequence.current) setError(safeError(loadError, 'Không thể tải danh sách container.'));
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [customerId, direction, dispatchStatus, informationStatus, page, pageSize, searchSuffix, sortDir, sortKey, transportDateFrom, transportDateTo]);

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
    const isFcl = activeEdit.detail.summary.cargoMode === 'FCL';
    const line = activeEdit.line;
    if (isFcl && line.fieldAccess.operationalSiteId?.mode !== 'DIRECT') {
      throw new Error(line.fieldAccess.operationalSiteId?.reason || 'Không thể chỉnh nhà máy của container này.');
    }
    const signature = JSON.stringify(['identity', row.shipmentId, line.id, line.shipmentVersion, draft.operationalSiteId]);
    const key = editIdempotencyKeys.current[signature] ?? crypto.randomUUID();
    if (isFcl) editIdempotencyKeys.current[signature] = key;
    try {
      if (isFcl) {
        await updateCusShipmentContainerLine(row.shipmentId, line.id, {
          expectedShipmentVersion: line.shipmentVersion,
          operationalSiteId: draft.operationalSiteId ?? null,
        }, key);
      } else {
        await updateShipment(row.shipmentId, {
          expectedVersion: activeEdit.detail.summary.version,
          factoryName: draft.factoryName,
          routeId: draft.routeId,
          deliveryLocation: draft.deliveryLocation,
        });
      }
    } catch (error) {
      if (!isOptimisticShipmentConflict(error)) throw error;
      delete editIdempotencyKeys.current[signature];
      await recoverConflict(row, 'identity');
      return;
    }
    delete editIdempotencyKeys.current[signature];
    await finishSave();
  }, [activeEdit, finishSave, recoverConflict]);

  const saveDocuments = useCallback(async (row: ShipmentCusContainerFlatRow, draft: ShipmentDocumentsDraft): Promise<ShipmentDocumentsSaveOutcome | void> => {
    if (!activeEdit) throw new Error('Phiên chỉnh sửa không còn hiệu lực.');
    const raw = activeEdit.detail.summary.raw;
    // Two write authorities, one Save (mirrors saveSchedule): the lot-level
    // document fields PATCH the shipment; the tờ khai number is PER-CONT
    // (card 261013200312) and rides the container-line command on whatever
    // version the PATCH returned. A number-only save skips the PATCH — an
    // echo would bump the lot version for nothing.
    const shipmentChanged = (draft.blNumber ?? '') !== (raw.blNumber ?? '')
      || (draft.bookingRef ?? '') !== (raw.bookingRef ?? '')
      || draft.tradeDirection !== (raw.tradeDirection ?? '')
      || (draft.shippingLineName ?? '') !== (raw.shippingLineName ?? '');
    const numberChanged = (draft.declarationNumber ?? '') !== (activeEdit.line.declarationNumber ?? '').trim();
    if (!shipmentChanged && !numberChanged) return;
    // Card 171026180010 (superseding the FB-085 first-number auto-copy): the
    // container-line command itself syncs a non-empty tờ khai update onto
    // every OTHER container of the lot in the same transaction and reports
    // the written siblings as `declarationSync`. No second call from the FE —
    // the save IS the sync, so it can never diverge from the persisted state.
    let syncOutcome: ShipmentDocumentsSaveOutcome | undefined;
    const signature = JSON.stringify(['documents', row.shipmentId, activeEdit.line.id, activeEdit.detail.summary.version, draft]);
    const key = editIdempotencyKeys.current[signature] ?? crypto.randomUUID();
    if (numberChanged) editIdempotencyKeys.current[signature] = key;
    try {
      let expectedShipmentVersion = activeEdit.detail.summary.version;
      if (shipmentChanged) {
        const updated = await updateShipment(row.shipmentId, {
          expectedVersion: expectedShipmentVersion,
          blNumber: draft.blNumber,
          bookingRef: draft.bookingRef,
          tradeDirection: draft.tradeDirection,
          shippingLineName: draft.shippingLineName,
        });
        expectedShipmentVersion = updated.version;
      }
      if (numberChanged && activeEdit.detail.summary.fieldAccess.declarationNumber.mode !== 'READ_ONLY') {
        const result = await updateCusShipmentContainerLine(row.shipmentId, activeEdit.line.id, {
          expectedShipmentVersion,
          declarationNumber: draft.declarationNumber,
        }, key);
        if (result.declarationSync) {
          syncOutcome = { sync: { written: result.declarationSync.updatedContainerIds.length } };
        }
      }
    } catch (error) {
      if (!isOptimisticShipmentConflict(error)) throw error;
      delete editIdempotencyKeys.current[signature];
      await recoverConflict(row, 'documents');
      return;
    }
    delete editIdempotencyKeys.current[signature];
    await finishSave();
    return syncOutcome;
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

  // Card 20260921_2 shipped add/remove container here; card 171026182554
  // moved the lot's container composition to the Tổng quan drawer alone, so
  // the workboard hook no longer carries those writes.

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
              ...(draft.clearVehicle ? { clearVehicle: true } : {}),
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
    // Normalize empty-vs-null: an appointment-less row drafts null while the
    // formatter reads '' — without this, a transport-only save would look
    // like a two-group change and rewrite the appointment with its own value.
    const appointmentChanged = (draft.customerAppointmentAt || null) !== (currentAppointmentInput || null);
    const signature = JSON.stringify(['schedule', activeEdit.detail.summary.id, line.id, line.shipmentVersion, draft.transportDate, appointmentAt]);
    const key = editIdempotencyKeys.current[signature] ?? crypto.randomUUID();
    editIdempotencyKeys.current[signature] = key;
    try {
      // Two version authorities, one Save: commit the lot date first, then the
      // container appointment on the version the shipment write returned.
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

  /** Bulk appointment copy: ONE call writes this line's appointment onto
   *  every container line of the lot still without one. Returns how many
   *  lines the server actually wrote, so the caller can report the real
   *  number — the row set is the WHOLE lot, never just the loaded page. */
  const copyAppointment = useCallback(async (row: ShipmentCusContainerFlatRow): Promise<number> => {
    const signature = JSON.stringify(['appointment-copy', row.shipmentId, row.id, row.shipmentVersion]);
    const key = editIdempotencyKeys.current[signature] ?? crypto.randomUUID();
    editIdempotencyKeys.current[signature] = key;
    let written = 0;
    try {
      const result = await copyCusShipmentContainerAppointment(row.shipmentId, row.id, {
        expectedShipmentVersion: row.shipmentVersion,
      }, key);
      written = result.updatedContainerIds.length;
    } catch (error) {
      delete editIdempotencyKeys.current[signature];
      if (!isOptimisticShipmentConflict(error)) throw error;
      await recoverConflict(row, 'schedule');
      return 0;
    }
    delete editIdempotencyKeys.current[signature];
    await finishSave();
    return written;
  }, [finishSave, recoverConflict]);

  /** Card 261013200312: copy one container's tờ khai number onto every
   *  container line of the lot still without one — ONE server call for the
   *  whole lot (never a per-row write loop), never overwriting a container
   *  that already carries its own number. Returns how many lines the server
   *  actually wrote, so the caller can report the real number — the row set
   *  is the WHOLE lot, never just the loaded page. */
  const copyDeclaration = useCallback(async (row: ShipmentCusContainerFlatRow): Promise<number> => {
    const signature = JSON.stringify(['declaration-copy', row.shipmentId, row.id, row.shipmentVersion]);
    const key = editIdempotencyKeys.current[signature] ?? crypto.randomUUID();
    editIdempotencyKeys.current[signature] = key;
    let written = 0;
    try {
      const result = await copyCusShipmentContainerDeclaration(row.shipmentId, row.id, {
        expectedShipmentVersion: row.shipmentVersion,
      }, key);
      written = result.updatedContainerIds.length;
    } catch (error) {
      delete editIdempotencyKeys.current[signature];
      if (!isOptimisticShipmentConflict(error)) throw error;
      await recoverConflict(row, 'documents');
      return 0;
    }
    delete editIdempotencyKeys.current[signature];
    await finishSave();
    return written;
  }, [finishSave, recoverConflict]);

  return {
    data, loading, error, loadRows, setError,
    activeEdit, editLoadingRowId, editError, editNotice,
    startEdit, cancelEdit, saveIdentity, saveDocuments, saveContainer,
    saveRoute, saveVehicle, saveSchedule, saveNotes,
    copyAppointment, copyDeclaration,
  };
}
