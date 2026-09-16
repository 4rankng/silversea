import { useRef, useState } from 'react';
import {
  type ShipmentCusWorkspaceContainerLine,
  type ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import { formatDateTime24 } from '../../../lib/format';
import { formatVietnamDateTimeInput } from '../../../lib/shipment-operations';
import { SearchableSelect } from '../../../design-system';
import { ShipmentContainerCell } from '../create/ShipmentContainerCell';
import { CusAppointmentPopover } from './CusAppointmentPopover';
import {
  dispatchStatusLabel,
  type ContainerLineDraft,
} from './cusUtils';

export function ContainerLineRow({
  detail,
  line,
  draft,
  dirty,
  onDraftChange,
  idPrefix,
  editing,
  onCompleteExternalTrip,
  completing,
  onAppointmentCommit,
  onAppointmentCancel,
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
  /** Enter inside the appointment popover: validate and persist the value.
   *  Return false to keep the popover open on failure. */
  onAppointmentCommit?: (val: string) => Promise<boolean> | boolean | void;
  onAppointmentCancel?: () => void;
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
            aria-label={`Giờ hẹn đóng hoặc trả tại nhà máy của container ${line.containerNumber || line.ordinal}: ${draft.customerAppointmentAt ? formatDateTime24(draft.customerAppointmentAt) : 'Chưa có'}`}
            title="Nhấn để chọn giờ hẹn đóng/trả"
          >
            <span className={draft.customerAppointmentAt ? 'cus-appointment-trigger__text' : 'cus-appointment-trigger__text cus-appointment-trigger__text--empty'}>
              {draft.customerAppointmentAt ? formatDateTime24(draft.customerAppointmentAt) : 'Chọn ngày giờ'}
            </span>
          </button>
          <CusAppointmentPopover
            isOpen={appointmentOpen}
            value={draft.customerAppointmentAt}
            containerLabel={line.containerNumber || `Cont ${line.ordinal}`}
            onClose={() => setAppointmentOpen(false)}
            onChange={(val) => onDraftChange({ customerAppointmentAt: val })}
            onCommit={onAppointmentCommit}
            onCancel={onAppointmentCancel}
            idPrefix={`${idPrefix}-apt-${line.id}`}
            triggerRef={appointmentTriggerRef}
          />
        </td>
      ) : <td data-label="Giờ hẹn đóng/trả" className="cus-container-cell"><strong>{formatDateTime24(formatVietnamDateTimeInput(line.customerAppointmentAt)) || '—'}</strong></td>}
    </tr>
  );
}
