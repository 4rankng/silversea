import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, X } from 'lucide-react';
import {
  type ShipmentCusWorkspaceContainerLine,
  type ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import { formatDateTimeShort } from '../../../lib/format';
import { localDateTimeToIso } from '../../../lib/shipment-operations';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { SearchableSelect } from '../../../design-system';
import { updateCusShipmentContainerLine } from '../../../api/shipmentClient';
import { completeDispatchExternalTrip } from '../../../api/dispatchPlanningClient';
import { ConfirmDialog } from '../../../components/UI';
import { useToast } from '../../../components/shared/Toast';
import { ShipmentContainerCell } from '../create/ShipmentContainerCell';
import { CusAppointmentPopover } from './CusAppointmentPopover';
import {
  dispatchStatusLabel,
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
    ...(permissions.containerTypeEditable && draft.containerTypeId !== base.containerTypeId ? { containerTypeId: draft.containerTypeId ? Number(draft.containerTypeId) : null } : {}),
    ...(permissions.routeEditable && draft.routeId !== base.routeId ? { routeId: draft.routeId ? Number(draft.routeId) : null } : {}),
    ...(permissions.liftSiteEditable && draft.liftSiteId !== base.liftSiteId ? { liftSiteId: draft.liftSiteId ? Number(draft.liftSiteId) : null } : {}),
    ...(permissions.dropoffSiteEditable && draft.dropoffSiteId !== base.dropoffSiteId ? { dropoffSiteId: draft.dropoffSiteId ? Number(draft.dropoffSiteId) : null } : {}),
    ...(appointmentChanged ? { customerAppointmentAt: parsedAppointment } : {}),
  };
}

function ContainerLineRow({
  detail,
  line,
  draft,
  dirty,
  onDraftChange,
  idPrefix,
  editing,
  onCompleteExternalTrip,
  completing,
}: {
  detail: ShipmentCusWorkspaceDetail;
  line: ShipmentCusWorkspaceContainerLine;
  draft: ContainerLineDraft;
  dirty: boolean;
  onDraftChange: (patch: Partial<ContainerLineDraft>) => void;
  idPrefix: string;
  editing: boolean;
  /** Staff close for external-carrier trips (external drivers don't use the
   *  app) — absent when the line has no completable external trip. */
  onCompleteExternalTrip?: (line: ShipmentCusWorkspaceContainerLine) => void;
  completing?: boolean;
}) {
  const [, setSelectOpen] = useState(false);
  const [appointmentOpen, setAppointmentOpen] = useState(false);
  const appointmentTriggerRef = useRef<HTMLButtonElement>(null);
  const p = line.permissions;
  const carrierEditable = editing && p.carrierEditable, plateEditable = editing && p.plateEditable;
  const containerTypeEditable = editing && p.containerTypeEditable;
  const routeEditable = editing && p.routeEditable;
  const liftSiteEditable = editing && p.liftSiteEditable, dropoffSiteEditable = editing && p.dropoffSiteEditable;
  const customerAppointmentEditable = editing && p.customerAppointmentEditable;

  const carrierOptions = [
    { value: 'OWN', label: 'Đội xe nội bộ SilverSea' },
    ...detail.selectors.externalCarriers.map((carrier) => ({
      value: `EXTERNAL:${carrier.id}`,
      label: carrier.label,
      searchText: carrier.shortName ?? undefined,
    })),
  ];
  const selectedContainerType = detail.selectors.containerTypes.find((option) => String(option.id) === draft.containerTypeId);
  const selectedRoute = detail.selectors.routes.find((option) => String(option.id) === draft.routeId);
  const selectedCarrier = carrierOptions.find((option) => option.value === draft.carrierKey);
  const selectedLiftPort = detail.selectors.ports.find((option) => String(option.id) === draft.liftSiteId);
  const selectedDropoffPort = detail.selectors.ports.find((option) => String(option.id) === draft.dropoffSiteId);

  return (
    <tr
      className={`cus-container-row${dirty ? ' cus-container-row--dirty' : ''}`}
      aria-labelledby={`${idPrefix}-container-${line.id}`}
    >
      <th scope="row" data-label="Container" className="cus-container-cell cus-container-cell--identity">
        <div className="cus-container-cell__identity-inner">
          <span className="cus-container-row__ordinal">{line.ordinal}</span>
          <strong id={`${idPrefix}-container-${line.id}`}>{line.containerNumber || 'Chưa có số container'}</strong>
        </div>
      </th>
      {containerTypeEditable ? (
        <ShipmentContainerCell
          label="Loại cont"
          value={selectedContainerType?.code ?? ''}
          placeholder="Chọn loại cont"
          displayTitle={selectedContainerType ? `${selectedContainerType.code} — ${selectedContainerType.name}` : undefined}
          className="cus-container-cell"
        >
          <label className="sr-only" htmlFor={`${idPrefix}-container-type-${line.id}`}>Loại container {line.containerNumber || line.ordinal}</label>
          <SearchableSelect id={`${idPrefix}-container-type-${line.id}`} size="sm" value={draft.containerTypeId} onChange={(value) => onDraftChange({ containerTypeId: value })} onOpenChange={setSelectOpen} options={detail.selectors.containerTypes.map((option) => ({ value: String(option.id), label: option.code, searchText: `${option.code} ${option.name}` }))} placeholder="Chọn loại cont" />
        </ShipmentContainerCell>
      ) : <td data-label="Loại cont" className="cus-container-cell"><strong>{line.containerTypeLabel || '—'}</strong></td>}
      {routeEditable ? (
        <ShipmentContainerCell
          label="Tuyến"
          value={selectedRoute?.label ?? ''}
          placeholder="Chọn tuyến"
          className="cus-container-cell"
        >
          <label className="sr-only" htmlFor={`${idPrefix}-route-${line.id}`}>Tuyến đường của container {line.containerNumber || line.ordinal}</label>
          <SearchableSelect id={`${idPrefix}-route-${line.id}`} size="sm" value={draft.routeId} onChange={(value) => onDraftChange({ routeId: value })} onOpenChange={setSelectOpen} options={detail.selectors.routes.map((option) => ({ value: String(option.id), label: option.label, searchText: option.name }))} placeholder="Chọn tuyến" />
        </ShipmentContainerCell>
      ) : <td data-label="Tuyến" className="cus-container-cell"><strong>{line.routeName || '—'}</strong></td>}
      <td data-label="Điều vận" className="cus-container-cell">
        <div className="cus-container-dispatch-group">
          <span className={`cus-container-dispatch cus-container-dispatch--${line.dispatchStatus.toLowerCase()}`}>{dispatchStatusLabel(line.dispatchStatus)}</span>
          {onCompleteExternalTrip && (
            <button
              type="button"
              className="cus-container-dispatch-complete"
              onClick={() => onCompleteExternalTrip(line)}
              disabled={completing}
              aria-label={`Hoàn thành chuyến xe ngoài của container ${line.containerNumber || line.ordinal}`}
              title="Hoàn thành chuyến với xe ngoài — xe ngoài không dùng app nên CS/điều vận chốt thay"
            >
              {completing ? 'Đang…' : 'Hoàn thành'}
            </button>
          )}
        </div>
      </td>
      {carrierEditable ? (
        <ShipmentContainerCell
          label="Nhà xe"
          value={draft.carrierKey === 'NEW_EXTERNAL' ? draft.newCarrierName : selectedCarrier?.label ?? ''}
          placeholder={draft.carrierKey === 'NEW_EXTERNAL' ? 'Nhập nhà xe mới' : 'Chọn nhà xe'}
          className="cus-container-cell cus-container-cell--carrier"
        >
          <div className="cus-carrier-editor">
            {draft.carrierKey === 'NEW_EXTERNAL' ? (
              <>
                <label className="sr-only" htmlFor={`${idPrefix}-new-carrier-${line.id}`}>Tên nhà xe mới</label>
                <input id={`${idPrefix}-new-carrier-${line.id}`} value={draft.newCarrierName} maxLength={255} placeholder="Tên nhà xe mới" onChange={(event) => onDraftChange({ newCarrierName: event.target.value })} />
                <button type="button" className="cus-carrier-editor__switch" onClick={() => onDraftChange({ carrierKey: '', newCarrierName: '', plateNumber: '' })}>Chọn sẵn có</button>
              </>
            ) : (
              <>
                <label className="sr-only" htmlFor={`${idPrefix}-carrier-${line.id}`}>Nhà xe của container {line.containerNumber || line.ordinal}</label>
                <SearchableSelect id={`${idPrefix}-carrier-${line.id}`} size="sm" value={draft.carrierKey} onChange={(value) => onDraftChange({ carrierKey: value, newCarrierName: '' })} onOpenChange={setSelectOpen} options={carrierOptions} placeholder="Chọn nhà xe" searchPlaceholder="Tìm nhà xe" />
                {plateEditable && <button type="button" className="cus-carrier-editor__switch" onClick={() => onDraftChange({ carrierKey: 'NEW_EXTERNAL', newCarrierName: '', plateNumber: '' })}>Thêm nhà xe</button>}
              </>
            )}
          </div>
        </ShipmentContainerCell>
      ) : <td data-label="Nhà xe" className="cus-container-cell cus-container-cell--carrier"><strong>{line.carrierName || '—'}</strong></td>}
      {plateEditable ? (
        <ShipmentContainerCell label="Biển số" value={draft.plateNumber} placeholder="Nhập biển số" className="cus-container-cell">
          <label className="sr-only" htmlFor={`${idPrefix}-plate-${line.id}`}>Biển số xe của container {line.containerNumber || line.ordinal}</label>
          <input id={`${idPrefix}-plate-${line.id}`} value={draft.plateNumber} list={`${idPrefix}-plates-${line.id}`} maxLength={20} onChange={(event) => onDraftChange({ plateNumber: event.target.value })} />
          <datalist id={`${idPrefix}-plates-${line.id}`}>{detail.selectors.carrierVehicles.map((vehicle) => <option value={vehicle.licensePlate} key={vehicle.id}>{vehicle.label}</option>)}</datalist>
        </ShipmentContainerCell>
      ) : <td data-label="Biển số" className="cus-container-cell"><strong>{line.plateNumber || '—'}</strong></td>}
      {liftSiteEditable ? (
        <ShipmentContainerCell label="Nâng" value={selectedLiftPort?.name ?? ''} displayTitle={selectedLiftPort ? `${selectedLiftPort.code ?? ''} — ${selectedLiftPort.name}` : undefined} placeholder="Chọn cảng nâng" className="cus-container-cell">
          <label className="sr-only" htmlFor={`${idPrefix}-lift-site-${line.id}`}>Cảng nâng của container {line.containerNumber || line.ordinal}</label>
          <SearchableSelect id={`${idPrefix}-lift-site-${line.id}`} size="sm" value={draft.liftSiteId} onChange={(value) => onDraftChange({ liftSiteId: value })} onOpenChange={setSelectOpen} options={detail.selectors.ports.map((option) => ({ value: String(option.id), label: option.label, searchText: `${option.code ?? ''} ${option.name}` }))} placeholder="Chọn cảng nâng" />
        </ShipmentContainerCell>
      ) : <td data-label="Nâng" className="cus-container-cell"><strong>{line.liftSite || '—'}</strong></td>}
      {dropoffSiteEditable ? (
        <ShipmentContainerCell label="Hạ" value={selectedDropoffPort?.name ?? ''} displayTitle={selectedDropoffPort ? `${selectedDropoffPort.code ?? ''} — ${selectedDropoffPort.name}` : undefined} placeholder="Chọn cảng hạ" className="cus-container-cell">
          <label className="sr-only" htmlFor={`${idPrefix}-dropoff-site-${line.id}`}>Cảng hạ của container {line.containerNumber || line.ordinal}</label>
          <SearchableSelect id={`${idPrefix}-dropoff-site-${line.id}`} size="sm" value={draft.dropoffSiteId} onChange={(value) => onDraftChange({ dropoffSiteId: value })} onOpenChange={setSelectOpen} options={detail.selectors.ports.map((option) => ({ value: String(option.id), label: option.label, searchText: `${option.code ?? ''} ${option.name}` }))} placeholder="Chọn cảng hạ" />
        </ShipmentContainerCell>
      ) : <td data-label="Hạ" className="cus-container-cell"><strong>{line.dropoffSite || '—'}</strong></td>}
      {customerAppointmentEditable ? (
        <td data-label="Giờ hẹn đóng/trả" className="cus-container-cell cus-appointment-cell">
          <button
            ref={appointmentTriggerRef}
            id={`${idPrefix}-customer-appointment-${line.id}`}
            type="button"
            className={`cus-appointment-trigger${appointmentOpen ? ' cus-appointment-trigger--active' : ''}`}
            onClick={() => setAppointmentOpen((current) => !current)}
            aria-haspopup="dialog"
            aria-expanded={appointmentOpen}
            aria-label={`Giờ hẹn đóng hoặc trả tại nhà máy của container ${line.containerNumber || line.ordinal}: ${draft.customerAppointmentAt ? formatDateTimeShort(draft.customerAppointmentAt) : 'Chưa có'}`}
            title="Nhấn để chọn giờ hẹn đóng/trả"
          >
            <Calendar size={13} className="cus-appointment-trigger__icon" aria-hidden="true" />
            <span className={draft.customerAppointmentAt ? 'cus-appointment-trigger__text' : 'cus-appointment-trigger__text cus-appointment-trigger__text--empty'}>
              {draft.customerAppointmentAt ? formatDateTimeShort(draft.customerAppointmentAt) : 'Chọn ngày giờ'}
            </span>
          </button>
          <CusAppointmentPopover
            isOpen={appointmentOpen}
            value={draft.customerAppointmentAt}
            containerLabel={line.containerNumber || `Cont ${line.ordinal}`}
            onClose={() => setAppointmentOpen(false)}
            onChange={(val) => onDraftChange({ customerAppointmentAt: val })}
            idPrefix={`${idPrefix}-apt-${line.id}`}
            triggerRef={appointmentTriggerRef}
          />
        </td>
      ) : <td data-label="Giờ hẹn đóng/trả" className="cus-container-cell"><strong>{formatDateTimeShort(line.customerAppointmentAt)}</strong></td>}
    </tr>
  );
}

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
}) {
  const [drafts, setDrafts] = useState<Record<number, ContainerLineDraft>>(() => (
    Object.fromEntries(detail.containers.map((c) => [c.id, lineDraft(c)]))
  ));
  const [editing, setEditing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [completingLine, setCompletingLine] = useState<ShipmentCusWorkspaceContainerLine | null>(null);
  const [completing, setCompleting] = useState(false);
  const { toast } = useToast();

  // Reset drafts whenever detail.containers operational signatures change
  const signatureKey = detail.containers.map(lineOperationalSignature).join('|');
  useEffect(() => {
    setDrafts(Object.fromEntries(detail.containers.map((c) => [c.id, lineDraft(c)])));
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
            if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
              event.preventDefault();
              void saveAll();
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
