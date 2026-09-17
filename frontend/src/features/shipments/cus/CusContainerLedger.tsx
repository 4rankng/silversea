import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  type ShipmentCusWorkspaceContainerLine,
  type ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import { localDateTimeToIso } from '../../../lib/shipment-operations';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { updateCusShipmentContainerLine } from '../../../api/shipmentClient';
import { completeDispatchExternalTrip } from '../../../api/dispatchPlanningClient';
import { ConfirmDialog } from '../../../components/UI';
import { useToast } from '../../../components/shared/Toast';
import {
  idempotencySignature,
  lineDraft,
  lineOperationalSignature,
  safeError,
  type ContainerLineDraft,
} from './cusUtils';

export interface ContainerLedgerHandle {
  saveAll: () => Promise<boolean>;
  discardAll: () => void;
}

function parseCarrierKey(carrierKey: string): ['OWN' | 'EXTERNAL', number | null] {
  if (carrierKey === 'OWN') return ['OWN', null];
  if (carrierKey.startsWith('EXTERNAL:')) {
    const id = Number(carrierKey.slice('EXTERNAL:'.length));
    return ['EXTERNAL', Number.isNaN(id) ? null : id];
  }
  return ['EXTERNAL', null];
}

function buildContainerPatch(
  line: ShipmentCusWorkspaceContainerLine,
  draft: ContainerLineDraft,
  detail: ShipmentCusWorkspaceDetail,
  expectedVersion: number,
) {
  const permissions = line.permissions;
  const isNewExternalCarrier = permissions.carrierEditable && draft.carrierKey === 'NEW_EXTERNAL';
  if (isNewExternalCarrier && (!draft.newCarrierName.trim() || !draft.plateNumber.trim())) {
    throw new Error('Vui lòng nhập đủ tên nhà xe mới và biển số xe.');
  }
  const base = lineDraft(line);
  const carrierChanged = draft.carrierKey !== base.carrierKey;
  const [carrierType, externalCarrierId] = parseCarrierKey(draft.carrierKey);
  const matchedVehicle = detail.selectors.carrierVehicles.find((vehicle) => (
    vehicle.carrierId === externalCarrierId
    && vehicle.licensePlate.localeCompare(draft.plateNumber.trim(), 'vi', { sensitivity: 'base' }) === 0
  ));
  const appointmentChanged = permissions.customerAppointmentEditable && draft.customerAppointmentAt !== base.customerAppointmentAt;
  // Popover drafts are naive "YYYY-MM-DDTHH:mm" — persist as Vietnam wall-clock
  // (+07:00), matching saveSchedule's localDateTimeToIso wire format.
  const parsedAppointment = appointmentChanged && draft.customerAppointmentAt
    ? localDateTimeToIso(draft.customerAppointmentAt)
    : null;

  return {
    expectedShipmentVersion: expectedVersion,
    ...(permissions.carrierEditable && isNewExternalCarrier && carrierChanged ? {
      carrierType: 'EXTERNAL' as const,
      newExternalCarrier: { name: draft.newCarrierName.trim(), plateNumber: draft.plateNumber.trim() },
    } : permissions.carrierEditable && draft.carrierKey && carrierChanged ? {
      carrierType, externalCarrierId, externalCarrierVehicleId: matchedVehicle?.id ?? null,
    } : {}),
    ...(permissions.plateEditable && !isNewExternalCarrier && draft.plateNumber !== base.plateNumber ? { plateNumber: draft.plateNumber.trim() || null } : {}),
    // Clear parity with the detail-table editor (20260916_6): an emptied
    // plate alone is NOT a clear on EXTERNAL rows with a selected vehicle —
    // the service falls back to the vehicle's stored plate. Emptied from an
    // assigned plate ⇒ send the explicit flag.
    ...(permissions.plateEditable && !isNewExternalCarrier && draft.plateNumber.trim() === '' && (base.plateNumber ?? '') !== ''
      ? { clearVehicle: true as const }
      : {}),
    ...(permissions.containerTypeEditable && draft.containerTypeId !== base.containerTypeId ? { containerTypeId: draft.containerTypeId ? Number(draft.containerTypeId) : null } : {}),
    ...(permissions.routeEditable && draft.routeId !== base.routeId ? { routeId: draft.routeId ? Number(draft.routeId) : null } : {}),
    ...(permissions.liftSiteEditable && draft.liftSiteId !== base.liftSiteId ? { liftSiteId: draft.liftSiteId ? Number(draft.liftSiteId) : null } : {}),
    ...(permissions.dropoffSiteEditable && draft.dropoffSiteId !== base.dropoffSiteId ? { dropoffSiteId: draft.dropoffSiteId ? Number(draft.dropoffSiteId) : null } : {}),
    ...(appointmentChanged ? { customerAppointmentAt: parsedAppointment } : {}),
  };
}

// ContainerLineRow lives in CusContainerLedgerRow.tsx (ceiling extraction).
import { ContainerLineRow } from './CusContainerLedgerRow';
import { useAppointmentSaveExit } from './use-appointment-save-exit';
export function ContainerLedger({
  detail,
  onLineSaved,
  getIdempotencyKey,
  clearIdempotencyKey,
  idPrefix,
  onCollapse,
  onDirtyChange,
  onSavingChange,
  actionsRef,
  onExternalTripCompleted,
  onAppointmentSavedAndExit,
}: {
  detail: ShipmentCusWorkspaceDetail;
  onLineSaved: (line: ShipmentCusWorkspaceContainerLine) => Promise<void>;
  getIdempotencyKey: (signature: string) => string;
  clearIdempotencyKey: (signature: string) => void;
  idPrefix: string;
  onCollapse?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
  actionsRef?: React.MutableRefObject<ContainerLedgerHandle | null>;
  /** Detail refetch after a staff close — completion advances the shipment. */
  onExternalTripCompleted?: () => void;
  /** Fires once after an appointment commit settles successfully — the host
   *  closes the detail surface so Enter returns the user to the list, matching
   *  the drawer footer's save-then-close behavior. */
  onAppointmentSavedAndExit?: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<number, ContainerLineDraft>>(() => (
    Object.fromEntries(detail.containers.map((c) => [c.id, lineDraft(c)]))
  ));
  const [editing, setEditing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [completingLine, setCompletingLine] = useState<ShipmentCusWorkspaceContainerLine | null>(null);
  const [completing, setCompleting] = useState(false);
  const { toast } = useToast();

  // Re-sync drafts only for lines whose server-side operational truth actually
  // changed — a wholesale reset on every detail refresh wiped unsaved edits on
  // rows the save loop had not reached yet: row 1's success refreshed the
  // detail, the signature join changed, and row 2's in-progress draft silently
  // reverted (and a failed row-2 save then lost it for good).
  const signatureKey = detail.containers.map(lineOperationalSignature).join('|');
  const lineSignaturesRef = useRef<Map<number, string>>(new Map());
  useEffect(() => {
    const previous = lineSignaturesRef.current;
    const signatures = new Map<number, string>();
    for (const line of detail.containers) signatures.set(line.id, lineOperationalSignature(line));
    lineSignaturesRef.current = signatures;
    setDrafts((prev) => {
      const next: Record<number, ContainerLineDraft> = {};
      for (const line of detail.containers) {
        next[line.id] = previous.get(line.id) === signatures.get(line.id) && prev[line.id]
          ? prev[line.id]
          : lineDraft(line);
      }
      return next;
    });
  }, [signatureKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirtyLineIds = useMemo(() => {
    const dirty = new Set<number>();
    for (const line of detail.containers) {
      const draft = drafts[line.id];
      if (!draft) continue;
      const base = lineDraft(line);
      const isDirty = draft.carrierKey !== base.carrierKey
        || draft.newCarrierName !== base.newCarrierName
        || draft.plateNumber !== base.plateNumber
        || draft.containerTypeId !== base.containerTypeId
        || draft.routeId !== base.routeId
        || draft.liftSiteId !== base.liftSiteId
        || draft.dropoffSiteId !== base.dropoffSiteId
        || draft.customerAppointmentAt !== base.customerAppointmentAt;
      if (isDirty) dirty.add(line.id);
    }
    return dirty;
  }, [detail.containers, drafts]);

  const isDirty = dirtyLineIds.size > 0;

  const onDirtyChangeRef = useRef(onDirtyChange);
  const onSavingChangeRef = useRef(onSavingChange);
  useEffect(() => { onDirtyChangeRef.current = onDirtyChange; }, [onDirtyChange]);
  useEffect(() => { onSavingChangeRef.current = onSavingChange; }, [onSavingChange]);

  const prevDirtyRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevDirtyRef.current !== isDirty) {
      prevDirtyRef.current = isDirty;
      onDirtyChangeRef.current?.(isDirty);
    }
  }, [isDirty]);

  const prevSavingRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevSavingRef.current !== saving) {
      prevSavingRef.current = saving;
      onSavingChangeRef.current?.(saving);
    }
  }, [saving]);

  // Staff close for external-carrier trips — the external driver never uses
  // the app, so CS (or dispatch) confirm the completion from this ledger.
  const completeExternalTrip = useCallback(async (line: ShipmentCusWorkspaceContainerLine) => {
    if (line.tripId == null || completing) return;
    setCompleting(true);
    try {
      await completeDispatchExternalTrip(line.tripId);
      toast({ kind: 'success', message: 'Đã hoàn thành chuyến xe ngoài.' });
      setCompletingLine(null);
      onExternalTripCompleted?.();
    } catch (error) {
      toast({ kind: 'error', message: safeError(error, 'Không thể hoàn thành chuyến xe ngoài.') });
    } finally {
      setCompleting(false);
    }
  }, [completing, onExternalTripCompleted, toast]);

  /** Gate the row action: only live external trips (not yet completed) are
   *  closable from CUS — own-fleet trips close through the driver app flow.
   *  The action opens the confirm dialog; the dialog fires the close. */
  const externalCloseForLine = useCallback((line: ShipmentCusWorkspaceContainerLine) => (
    line.tripId != null && line.carrierType === 'EXTERNAL' && line.tripStatus !== 'COMPLETED'
      ? setCompletingLine
      : undefined
  ), []);

  const updateLineDraft = useCallback((lineId: number, patch: Partial<ContainerLineDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [lineId]: { ...(prev[lineId] || lineDraft(detail.containers.find((c) => c.id === lineId)!)), ...patch },
    }));
  }, [detail.containers]);

  const discardAll = useCallback(() => {
    setDrafts(Object.fromEntries(detail.containers.map((c) => [c.id, lineDraft(c)])));
  }, [detail.containers]);

  const saveAll = useCallback(async (): Promise<boolean> => {
    if (saving || dirtyLineIds.size === 0) return false;
    setSaving(true);
    try {
      const dirtyLines = detail.containers.filter((c) => dirtyLineIds.has(c.id));
      let currentVersion = detail.summary.version ?? (dirtyLines[0]?.shipmentVersion ?? 1);
      for (const line of dirtyLines) {
        const draft = drafts[line.id];
        if (!draft) continue;
        const patch = buildContainerPatch(line, draft, detail, currentVersion);
        const signature = idempotencySignature('container', detail.summary.id, line.id, currentVersion);
        const idempotencyKey = getIdempotencyKey(signature);
        const result = await updateCusShipmentContainerLine(detail.summary.id, line.id, patch, idempotencyKey);
        clearIdempotencyKey(signature);
        if (result?.line) {
          currentVersion = result.line.shipmentVersion;
          await onLineSaved(result.line);
        }
      }
      toast({ kind: 'success', message: 'Cập nhật dữ liệu container thành công!' });
      return true;
    } catch (error) {
      toast({ kind: 'error', message: safeError(error, 'Không thể lưu dữ liệu container.') });
      return false;
    } finally {
      setSaving(false);
    }
  }, [clearIdempotencyKey, detail, dirtyLineIds, drafts, getIdempotencyKey, onLineSaved, saving, toast]);

  const scheduleExit = useAppointmentSaveExit(isDirty, saving, onAppointmentSavedAndExit);

  /** _34: dismissal without commit — revert the line's appointment draft to
   *  its base so Escape/outside never leak the abandoned value on reopen. */
  const revertAppointmentDraft = useCallback((lineId: number) => {
    const line = detail.containers.find((c) => c.id === lineId);
    if (!line) return;
    updateLineDraft(lineId, { customerAppointmentAt: lineDraft(line).customerAppointmentAt });
  }, [detail.containers, updateLineDraft]);

  const commitAppointment = useCallback(async (lineId: number, value: string): Promise<boolean> => {
    const line = detail.containers.find((c) => c.id === lineId);
    // _34: a non-saveable line is an error the popover must show — a silent
    // false made the popover close as if saved, with zero POSTs.
    if (!line || !line.permissions.customerAppointmentEditable) throw new Error('Không thể lưu giờ hẹn cho container này.');
    setSaving(true);
    let saved = false;
    try {
      const expectedVersion = detail.summary.version ?? (line.shipmentVersion ?? 1);
      const patch = {
        expectedShipmentVersion: expectedVersion,
        customerAppointmentAt: value ? localDateTimeToIso(value) : null,
      };
      const signature = idempotencySignature('container', detail.summary.id, line.id, expectedVersion);
      const idempotencyKey = getIdempotencyKey(signature);
      const result = await updateCusShipmentContainerLine(detail.summary.id, line.id, patch, idempotencyKey);
      clearIdempotencyKey(signature);
      if (result?.line) {
        await onLineSaved(result.line);
      }
      toast({ kind: 'success', message: 'Đã lưu giờ hẹn.' });
      saved = true;
    } catch (error) {
      toast({ kind: 'error', message: safeError(error, 'Không thể lưu giờ hẹn.') });
    } finally {
      setSaving(false);
    }
    if (saved) scheduleExit();
    return saved;
  }, [clearIdempotencyKey, detail, getIdempotencyKey, onLineSaved, scheduleExit, toast]);


  useEffect(() => {
    if (actionsRef) actionsRef.current = { saveAll, discardAll };
    return () => {
      if (actionsRef) actionsRef.current = null;
    };
  }, [actionsRef, discardAll, saveAll]);

  const hasEditableLine = detail.containers.some((line) => (
    line.permissions.carrierEditable
    || line.permissions.plateEditable
    || line.permissions.containerTypeEditable
    || line.permissions.routeEditable
    || line.permissions.liftSiteEditable
    || line.permissions.dropoffSiteEditable
    || line.permissions.customerAppointmentEditable
  ));

  return (
    <section className="cus-container-ledger" aria-label="Chi tiết container">
      <header className="cus-container-ledger__head">
        <div><strong>Chi tiết container</strong><span>{detail.containers.length} cont</span></div>
        <div className="cus-container-ledger__actions">
          {hasEditableLine && (editing
            ? <UUIButton size="sm" color="tertiary" className="cus-container-edit-action" onPress={() => setEditing(false)} isDisabled={saving}>Hoàn tất</UUIButton>
            : <UUIButton size="sm" color="secondary" className="cus-container-edit-action" onPress={() => setEditing(true)}>Chỉnh sửa</UUIButton>)}
          {onCollapse && <button type="button" className="cus-detail-collapse" onClick={onCollapse} disabled={saving} aria-label={saving ? 'Đang lưu dữ liệu container' : 'Thu gọn chi tiết container'}><X size={16} aria-hidden="true" /><span>{saving ? 'Đang lưu' : 'Thu gọn'}</span></button>}
        </div>
      </header>
      {detail.containers.length === 0 ? <p className="cus-detail-empty">Lô hàng chưa có dữ liệu container.</p> : (
        <div
          className="cus-container-table-scroll"
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || saving || !isDirty) return;
            // _34: the appointment popover owns its own Enter (commit path);
            // table-level Enter only saves TABLE drafts.
            if ((event.target as HTMLElement).closest('.cus-appointment-popover, .cus-appointment-backdrop')) return;
            // Bare Enter inside a multiline notes textarea must insert a
            // newline, not submit the ledger — same contract as the inline
            // editor (ShipmentContainerLedger). Ctrl/Cmd+Enter still saves.
            if (event.target instanceof HTMLTextAreaElement && !event.ctrlKey && !event.metaKey) return;
            if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
              event.preventDefault();
              void saveAll().then((saved) => { if (saved) scheduleExit(); });
            } else if (event.key === 'Escape') {
              event.preventDefault();
              discardAll();
            }
          }}
        >
          <table className="cus-container-table">
            <caption className="sr-only">Danh sách container và điều vận</caption>
            <colgroup>
              <col className="cus-container-col__identity" />
              <col className="cus-container-col__type" />
              <col className="cus-container-col__route" />
              <col className="cus-container-col__dispatch" />
              <col className="cus-container-col__carrier" />
              <col className="cus-container-col__plate" />
              <col className="cus-container-col__site" />
              <col className="cus-container-col__site" />
              <col className="cus-container-col__appointment" />
            </colgroup>
            <thead><tr>
              <th scope="col">Container</th>
              <th scope="col">Loại cont</th>
              <th scope="col">Tuyến</th>
              <th scope="col">Điều vận</th>
              <th scope="col">Nhà xe</th>
              <th scope="col">Biển số</th>
              <th scope="col">Nâng</th>
              <th scope="col">Hạ</th>
              <th scope="col">Giờ hẹn đóng/trả</th>
            </tr></thead>
            <tbody>
              {detail.containers.map((line) => (
                <ContainerLineRow
                  key={line.id}
                  detail={detail}
                  line={line}
                  draft={drafts[line.id] || lineDraft(line)}
                  dirty={dirtyLineIds.has(line.id)}
                  onDraftChange={(patch) => updateLineDraft(line.id, patch)}
                  idPrefix={idPrefix}
                  editing={editing}
                  onCompleteExternalTrip={externalCloseForLine(line)}
                  completing={completing}
                  onAppointmentCommit={(val) => commitAppointment(line.id, val)}
                  onAppointmentCancel={() => revertAppointmentDraft(line.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* Staff-close confirmation — closes the external driver's trip on their behalf */}
      <ConfirmDialog
        isOpen={completingLine != null}
        message={`Hoàn thành chuyến với xe ngoài ${
          completingLine?.containerNumber ?? `cont ${completingLine?.ordinal ?? ''}`
        }? Xe ngoài không dùng app nên CS/điều vận chốt chuyến thay tài xế.`}
        confirmLabel={completing ? 'Đang hoàn thành…' : 'Hoàn thành chuyến'}
        onConfirm={() => { if (completingLine) void completeExternalTrip(completingLine); }}
        onCancel={() => { if (!completing) setCompletingLine(null); }}
      />
      {/* Standalone action footer when no drawer handles actions */}
      {!actionsRef && isDirty && (
        <div className="cus-container-ledger__sticky-bar">
          <span className="cus-container-ledger__sticky-note">
            Đã chỉnh sửa <strong>{dirtyLineIds.size}</strong> container
          </span>
          <div className="cus-container-confirm-group--floating">
            <button
              type="button"
              className="btn btn--ghost btn--sm cus-container-revert"
              onClick={discardAll}
              disabled={saving}
              title="Hủy thay đổi (Esc)"
            >
              Hủy
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm cus-container-confirm"
              onClick={() => void saveAll()}
              disabled={saving}
              title="Lưu tất cả thay đổi (Enter)"
            >
              {saving ? 'Đang lưu…' : 'Lưu'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
