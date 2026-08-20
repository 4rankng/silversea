import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  type ShipmentCusWorkspaceContainerLine,
  type ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import { formatDateTimeShort } from '../../../lib/format';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { SearchableSelect } from '../../../design-system';
import { updateCusShipmentContainerLine } from '../../../api/shipmentClient';
import {
  dispatchStatusLabel,
  idempotencySignature,
  lineDraft,
  lineOperationalSignature,
  safeError,
  type ContainerLineDraft,
} from './cusUtils';

function ContainerLineRow({
  detail,
  line,
  onSaved,
  getIdempotencyKey,
  clearIdempotencyKey,
  idPrefix,
  onDirtyChange,
  editing,
  onSavingChange,
}: {
  detail: ShipmentCusWorkspaceDetail;
  line: ShipmentCusWorkspaceContainerLine;
  onSaved: (line: ShipmentCusWorkspaceContainerLine) => Promise<void>;
  getIdempotencyKey: (signature: string) => string;
  clearIdempotencyKey: (signature: string) => void;
  idPrefix: string;
  onDirtyChange: (lineId: number, dirty: boolean) => void;
  editing: boolean;
  onSavingChange: (lineId: number, saving: boolean) => void;
}) {
  const [draft, setDraft] = useState<ContainerLineDraft>(() => lineDraft(line));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectOpen, setSelectOpen] = useState(false);
  const operationalSignatureRef = useRef(lineOperationalSignature(line));
  const permissions = line.permissions;
  const carrierEditable = editing && permissions.carrierEditable;
  const plateEditable = editing && permissions.plateEditable;
  const containerTypeEditable = editing && permissions.containerTypeEditable;
  const liftSiteEditable = editing && permissions.liftSiteEditable;
  const dropoffSiteEditable = editing && permissions.dropoffSiteEditable;
  const customerAppointmentEditable = editing && permissions.customerAppointmentEditable;
  const operationalEditable = carrierEditable || plateEditable || containerTypeEditable || liftSiteEditable || dropoffSiteEditable || customerAppointmentEditable;

  useEffect(() => {
    const nextSignature = lineOperationalSignature(line);
    if (operationalSignatureRef.current === nextSignature) return;
    operationalSignatureRef.current = nextSignature;
    setDraft(lineDraft(line));
    setDirty(false);
  }, [line]);

  useEffect(() => {
    onDirtyChange(line.id, dirty);
    return () => onDirtyChange(line.id, false);
  }, [dirty, line.id, onDirtyChange]);

  useEffect(() => {
    onSavingChange(line.id, saving);
    return () => onSavingChange(line.id, false);
  }, [line.id, onSavingChange, saving]);

  const updateDraft = (patch: Partial<ContainerLineDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
    setSaveError(null);
  };

  const discardDraft = () => {
    setDraft(lineDraft(line));
    setDirty(false);
    setSaveError(null);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const signature = idempotencySignature('container', detail.summary.id, line.id, line.shipmentVersion);
      const idempotencyKey = getIdempotencyKey(signature);
      const carrierType = draft.carrierKey === 'OWN' ? 'OWN' : 'EXTERNAL';
      const externalCarrierId = draft.carrierKey.startsWith('EXTERNAL:')
        ? Number(draft.carrierKey.slice('EXTERNAL:'.length))
        : null;
      const isNewExternalCarrier = draft.carrierKey === 'NEW_EXTERNAL';
      if (isNewExternalCarrier && (!draft.newCarrierName.trim() || !draft.plateNumber.trim())) {
        throw new Error('Vui lòng nhập đủ tên nhà xe mới và biển số xe.');
      }
      const matchedVehicle = detail.selectors.carrierVehicles.find((vehicle) => (
        vehicle.carrierId === externalCarrierId
        && vehicle.licensePlate.localeCompare(draft.plateNumber.trim(), 'vi', { sensitivity: 'base' }) === 0
      ));
      const result = await updateCusShipmentContainerLine(detail.summary.id, line.id, {
        expectedShipmentVersion: line.shipmentVersion,
        ...(permissions.carrierEditable && isNewExternalCarrier ? {
          carrierType: 'EXTERNAL' as const,
          newExternalCarrier: {
            name: draft.newCarrierName.trim(),
            plateNumber: draft.plateNumber.trim(),
          },
        } : permissions.carrierEditable && draft.carrierKey ? {
          carrierType,
          externalCarrierId,
          externalCarrierVehicleId: matchedVehicle?.id ?? null,
        } : {}),
        ...(permissions.plateEditable && !isNewExternalCarrier && draft.carrierKey.startsWith('EXTERNAL:')
          ? { plateNumber: draft.plateNumber.trim() || null }
          : {}),
        ...(permissions.containerTypeEditable ? { containerTypeId: draft.containerTypeId ? Number(draft.containerTypeId) : null } : {}),
        ...(permissions.liftSiteEditable ? { liftSiteId: draft.liftSiteId ? Number(draft.liftSiteId) : null } : {}),
        ...(permissions.dropoffSiteEditable ? { dropoffSiteId: draft.dropoffSiteId ? Number(draft.dropoffSiteId) : null } : {}),
        ...(permissions.customerAppointmentEditable ? {
          customerAppointmentAt: draft.customerAppointmentAt ? new Date(draft.customerAppointmentAt).toISOString() : null,
        } : {}),
      }, idempotencyKey);
      await onSaved(result.line);
      clearIdempotencyKey(signature);
      setDirty(false);
    } catch (error) {
      setSaveError(safeError(error, 'Không thể lưu dữ liệu container.'));
    } finally {
      setSaving(false);
    }
  };

  const carrierOptions = [
    { value: 'OWN', label: 'Đội xe nội bộ SilverSea' },
    ...detail.selectors.externalCarriers.map((carrier) => ({
      value: `EXTERNAL:${carrier.id}`,
      label: carrier.label,
      searchText: carrier.shortName ?? undefined,
    })),
  ];

  return (
    <tr
      className="cus-container-row"
      aria-labelledby={`${idPrefix}-container-${line.id}`}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || selectOpen || saving || !dirty || !operationalEditable) return;
        if (event.key === 'Enter') {
          if (event.target instanceof HTMLButtonElement) return;
          event.preventDefault();
          void save();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          discardDraft();
        }
      }}
    >
      <th scope="row" data-label="Container" className="cus-container-cell cus-container-cell--identity">
        <span className="cus-container-row__ordinal">{line.ordinal}</span>
        <strong id={`${idPrefix}-container-${line.id}`}>{line.containerNumber || 'Chưa có số container'}</strong>
      </th>
      <td data-label="Loại cont" className="cus-container-cell">
        {containerTypeEditable ? <>
          <label className="sr-only" htmlFor={`${idPrefix}-container-type-${line.id}`}>Loại container {line.containerNumber || line.ordinal}</label>
          <SearchableSelect id={`${idPrefix}-container-type-${line.id}`} size="sm" value={draft.containerTypeId} onChange={(value) => updateDraft({ containerTypeId: value })} onOpenChange={setSelectOpen} options={detail.selectors.containerTypes.map((option) => ({ value: String(option.id), label: option.code, searchText: `${option.code} ${option.name}` }))} placeholder="Chọn loại cont" />
        </> : <strong>{line.containerTypeLabel || '—'}</strong>}
      </td>
      <td data-label="Điều vận" className="cus-container-cell">
        <span className={`cus-container-dispatch cus-container-dispatch--${line.dispatchStatus.toLowerCase()}`}>{dispatchStatusLabel(line.dispatchStatus)}</span>
      </td>
      <td data-label="Nhà xe" className="cus-container-cell cus-container-cell--carrier">
        {carrierEditable ? (
          <div className="cus-carrier-editor">
            {draft.carrierKey === 'NEW_EXTERNAL' ? (
              <>
                <label className="sr-only" htmlFor={`${idPrefix}-new-carrier-${line.id}`}>Tên nhà xe mới</label>
                <input id={`${idPrefix}-new-carrier-${line.id}`} value={draft.newCarrierName} maxLength={255} placeholder="Tên nhà xe mới" onChange={(event) => updateDraft({ newCarrierName: event.target.value })} />
                <button type="button" className="cus-carrier-editor__switch" onClick={() => updateDraft({ carrierKey: '', newCarrierName: '', plateNumber: '' })}>Chọn sẵn có</button>
              </>
            ) : (
              <>
                <label className="sr-only" htmlFor={`${idPrefix}-carrier-${line.id}`}>Nhà xe của container {line.containerNumber || line.ordinal}</label>
                <SearchableSelect id={`${idPrefix}-carrier-${line.id}`} size="sm" value={draft.carrierKey} onChange={(value) => updateDraft({ carrierKey: value, newCarrierName: '' })} onOpenChange={setSelectOpen} options={carrierOptions} placeholder="Chọn nhà xe" searchPlaceholder="Tìm nhà xe" />
                {plateEditable && <button type="button" className="cus-carrier-editor__switch" onClick={() => updateDraft({ carrierKey: 'NEW_EXTERNAL', newCarrierName: '', plateNumber: '' })}>Thêm nhà xe</button>}
              </>
            )}
          </div>
        ) : <strong>{line.carrierName || '—'}</strong>}
      </td>
      <td data-label="Biển số" className="cus-container-cell">
        {plateEditable ? <><label className="sr-only" htmlFor={`${idPrefix}-plate-${line.id}`}>Biển số xe của container {line.containerNumber || line.ordinal}</label><input id={`${idPrefix}-plate-${line.id}`} value={draft.plateNumber} list={`${idPrefix}-plates-${line.id}`} maxLength={20} onChange={(event) => updateDraft({ plateNumber: event.target.value })} /></> : <strong>{line.plateNumber || '—'}</strong>}
        {plateEditable && <datalist id={`${idPrefix}-plates-${line.id}`}>{detail.selectors.carrierVehicles.map((vehicle) => <option value={vehicle.licensePlate} key={vehicle.id}>{vehicle.label}</option>)}</datalist>}
      </td>
      <td data-label="Nâng" className="cus-container-cell">
        {liftSiteEditable ? <><label className="sr-only" htmlFor={`${idPrefix}-lift-site-${line.id}`}>Điểm nâng của container {line.containerNumber || line.ordinal}</label><SearchableSelect id={`${idPrefix}-lift-site-${line.id}`} size="sm" value={draft.liftSiteId} onChange={(value) => updateDraft({ liftSiteId: value })} onOpenChange={setSelectOpen} options={detail.selectors.operationalSites.map((option) => ({ value: String(option.id), label: option.label, searchText: `${option.code} ${option.name}` }))} placeholder="Chọn điểm nâng" /></> : <strong>{line.liftSite || '—'}</strong>}
      </td>
      <td data-label="Hạ" className="cus-container-cell">
        {dropoffSiteEditable ? <><label className="sr-only" htmlFor={`${idPrefix}-dropoff-site-${line.id}`}>Điểm hạ của container {line.containerNumber || line.ordinal}</label><SearchableSelect id={`${idPrefix}-dropoff-site-${line.id}`} size="sm" value={draft.dropoffSiteId} onChange={(value) => updateDraft({ dropoffSiteId: value })} onOpenChange={setSelectOpen} options={detail.selectors.operationalSites.map((option) => ({ value: String(option.id), label: option.label, searchText: `${option.code} ${option.name}` }))} placeholder="Chọn điểm hạ" /></> : <strong>{line.dropoffSite || '—'}</strong>}
      </td>
      <td data-label="Giờ hẹn đóng/trả" className="cus-container-cell">
        {customerAppointmentEditable ? <><label className="sr-only" htmlFor={`${idPrefix}-customer-appointment-${line.id}`}>Giờ hẹn đóng hoặc trả tại nhà máy của container {line.containerNumber || line.ordinal}</label><input id={`${idPrefix}-customer-appointment-${line.id}`} type="datetime-local" value={draft.customerAppointmentAt} onChange={(event) => updateDraft({ customerAppointmentAt: event.target.value })} /></> : <strong>{formatDateTimeShort(line.customerAppointmentAt)}</strong>}
        {saveError && <span className="cus-container-row__error" role="alert">{saveError}</span>}
      </td>
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
}: {
  detail: ShipmentCusWorkspaceDetail;
  onLineSaved: (line: ShipmentCusWorkspaceContainerLine) => Promise<void>;
  getIdempotencyKey: (signature: string) => string;
  clearIdempotencyKey: (signature: string) => void;
  idPrefix: string;
  onCollapse?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
}) {
  const [dirtyLineIds, setDirtyLineIds] = useState<Set<number>>(() => new Set());
  const [editing, setEditing] = useState(true);
  const [discardAction, setDiscardAction] = useState<'collapse' | 'finish-edit' | null>(null);
  const [resetRevision, setResetRevision] = useState(0);
  const [savingLineIds, setSavingLineIds] = useState<Set<number>>(() => new Set());
  const dirtyChangeRef = useRef(onDirtyChange);
  const savingChangeRef = useRef(onSavingChange);
  useEffect(() => { dirtyChangeRef.current = onDirtyChange; }, [onDirtyChange]);
  useEffect(() => { savingChangeRef.current = onSavingChange; }, [onSavingChange]);
  const setLineDirty = useCallback((lineId: number, dirty: boolean) => {
    setDirtyLineIds((current) => {
      const next = new Set(current);
      if (dirty) next.add(lineId);
      else next.delete(lineId);
      return next;
    });
  }, []);
  const requestCollapse = () => {
    if (!onCollapse) return;
    if (savingLineIds.size > 0) return;
    if (dirtyLineIds.size > 0) {
      setDiscardAction('collapse');
      return;
    }
    onCollapse();
  };
  const requestFinishEditing = () => {
    if (savingLineIds.size > 0) return;
    if (dirtyLineIds.size > 0) {
      setDiscardAction('finish-edit');
      return;
    }
    setEditing(false);
  };
  const discardChanges = () => {
    if (savingLineIds.size > 0) return;
    setResetRevision((current) => current + 1);
    if (discardAction === 'collapse') onCollapse?.();
    else setEditing(false);
    setDiscardAction(null);
  };
  const hasEditableLine = detail.containers.some((line) => (
    line.permissions.carrierEditable
    || line.permissions.plateEditable
    || line.permissions.containerTypeEditable
    || line.permissions.liftSiteEditable
    || line.permissions.dropoffSiteEditable
    || line.permissions.customerAppointmentEditable
  ));
  useEffect(() => { dirtyChangeRef.current?.(dirtyLineIds.size > 0); }, [dirtyLineIds]);
  useEffect(() => { savingChangeRef.current?.(savingLineIds.size > 0); }, [savingLineIds]);
  const setLineSaving = useCallback((lineId: number, saving: boolean) => {
    setSavingLineIds((current) => {
      const next = new Set(current);
      if (saving) next.add(lineId);
      else next.delete(lineId);
      return next;
    });
  }, []);
  return (
    <section className="cus-container-ledger" aria-label="Chi tiết container">
      <header className="cus-container-ledger__head">
        <div><strong>Chi tiết container</strong><span>{detail.containers.length} cont</span></div>
        <div className="cus-container-ledger__actions">
          {hasEditableLine && (editing
            ? <UUIButton size="sm" color="tertiary" className="cus-container-edit-action" onPress={requestFinishEditing} isDisabled={savingLineIds.size > 0}>Hoàn tất</UUIButton>
            : <UUIButton size="sm" color="secondary" className="cus-container-edit-action" onPress={() => setEditing(true)}>Chỉnh sửa</UUIButton>)}
          {onCollapse && <button type="button" className="cus-detail-collapse" onClick={requestCollapse} disabled={savingLineIds.size > 0} aria-label={savingLineIds.size > 0 ? 'Đang lưu dữ liệu container' : 'Thu gọn chi tiết container'}><X size={16} aria-hidden="true" /><span>{savingLineIds.size > 0 ? 'Đang lưu' : 'Thu gọn'}</span></button>}
        </div>
      </header>
      {detail.containers.length === 0 ? <p className="cus-detail-empty">Lô hàng chưa có dữ liệu container.</p> : (
        <div className="cus-container-table-scroll">
          <table className="cus-container-table">
            <caption className="sr-only">Danh sách container và điều vận</caption>
            <colgroup>
              <col className="cus-container-col__identity" />
              <col className="cus-container-col__type" />
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
              <th scope="col">Điều vận</th>
              <th scope="col">Nhà xe</th>
              <th scope="col">Biển số</th>
              <th scope="col">Nâng</th>
              <th scope="col">Hạ</th>
              <th scope="col">Giờ hẹn đóng/trả</th>
            </tr></thead>
            <tbody>{detail.containers.map((line) => <ContainerLineRow key={`${line.id}:${resetRevision}`} detail={detail} line={line} onSaved={onLineSaved} getIdempotencyKey={getIdempotencyKey} clearIdempotencyKey={clearIdempotencyKey} idPrefix={idPrefix} onDirtyChange={setLineDirty} onSavingChange={setLineSaving} editing={editing} />)}</tbody>
          </table>
        </div>
      )}
      {discardAction && <div className="cus-discard-confirmation" role="alert"><span>{savingLineIds.size > 0 ? 'Đang lưu dữ liệu container.' : 'Có thay đổi container chưa lưu.'}</span><button type="button" className="btn btn--ghost btn--sm" onClick={() => setDiscardAction(null)} disabled={savingLineIds.size > 0}>Tiếp tục chỉnh sửa</button><button type="button" className="btn btn--secondary btn--sm" onClick={discardChanges} disabled={savingLineIds.size > 0}>{discardAction === 'collapse' ? 'Bỏ thay đổi và thu gọn' : 'Bỏ thay đổi và hoàn tất'}</button></div>}
    </section>
  );
}
