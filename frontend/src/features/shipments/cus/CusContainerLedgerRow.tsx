import { useMemo, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import {
  type ShipmentCusWorkspaceContainerLine,
  type ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import { formatDateTime24, formatWeight } from '../../../lib/format';
import { formatVietnamDateTimeInput } from '../../../lib/shipment-operations';
import { SearchableSelect } from '../../../design-system';
import { CopyCodeButton } from '../../../components/trip/CopyCodeButton';
import { externalVendorPlateOptions } from '../external-plate-options';
import { ShipmentContainerCell } from '../create/ShipmentContainerCell';
import { CusAppointmentPopover } from './CusAppointmentPopover';
import {
  dispatchStatusLabel,
  type ContainerLineDraft,
} from './cusUtils';

/** Card 261022095235a (CUS-05): the per-container tờ khai cell — click the
 *  value to edit it IN PLACE (no tab/section switch). Enter commits an
 *  immediate per-row save (the server's FB-109 auto-copy law fills the lot's
 *  still-empty siblings in the same transaction); Esc/outside dismisses and
 *  reverts, matching the appointment popover's dismissal contract (_34). */
function DeclarationCell({
  line,
  editable,
  onCommit,
  showCopy,
  onCopy,
  copying,
}: {
  line: ShipmentCusWorkspaceContainerLine;
  editable: boolean;
  /** Enter/✓: persist this row's number. Resolves false to keep the editor
   *  open (commit failed — the error rides the host toast). */
  onCommit: (value: string) => Promise<boolean>;
  /** Explicit copy affordance (card 261013200312 "(hoặc nút copy)"): shown
   *  only when the PERSISTED number is non-empty and the lot still has
   *  empty siblings — a retyped-but-unsaved value is never copyable. */
  showCopy: boolean;
  onCopy: () => void;
  copying: boolean;
}) {
  const persisted = (line.declarationNumber ?? '').trim();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(persisted);
  const [busy, setBusy] = useState(false);
  const identity = line.containerNumber || `container số ${line.ordinal}`;

  const close = () => {
    // _34-style dismissal: revert to the persisted value so a dismissed
    // draft never leaks back on reopen. NEVER while a commit is in flight —
    // Chrome/Safari move focus to <body> when the input is disabled and the
    // resulting blur (relatedTarget=null) must not discard the in-flight
    // draft (review 22/10 medium #2).
    if (busy) return;
    setOpen(false);
    setDraft(persisted);
  };

  const commit = async () => {
    const next = draft.trim();
    if (next === persisted) { close(); return; }
    setBusy(true);
    let ok = false;
    try {
      ok = await onCommit(next);
    } finally {
      setBusy(false);
    }
    if (ok) close();
  };

  if (!editable) {
    return (
      <td data-label="Số tờ khai" className="cus-container-cell cus-container-cell--declaration">
        <strong>{persisted || '—'}</strong>
      </td>
    );
  }
  return (
    <td data-label="Số tờ khai" className="cus-container-cell cus-container-cell--declaration">
      {open ? (
        <span className="cus-declaration-editor" onBlur={(event) => {
          // Outside blur dismisses (revert) unless the click landed on the
          // commit/copy controls inside this cell.
          if (!event.currentTarget.contains(event.relatedTarget as Node)) close();
        }}>
          <label className="sr-only" htmlFor={`declaration-input-${line.id}`}>Số tờ khai của container {identity}</label>
          <input
            id={`declaration-input-${line.id}`}
            value={draft}
            maxLength={50}
            // readOnly (not disabled) while busy: disabling a focused input
            // moves focus to <body> in real browsers, firing the blur that
            // used to close the editor mid-commit. readOnly keeps focus and
            // still blocks edits.
            readOnly={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Escape') { event.preventDefault(); close(); }
              if (event.key === 'Enter') { event.preventDefault(); void commit(); }
            }}
            autoFocus
          />
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={busy || draft.trim() === persisted}
            onClick={() => void commit()}
          >
            {busy ? 'Đang lưu…' : 'Lưu'}
          </button>
        </span>
      ) : (
        <button
          type="button"
          className={`cus-declaration-trigger${persisted ? '' : ' cus-declaration-trigger--empty'}`}
          onClick={() => { setDraft(persisted); setOpen(true); }}
          disabled={busy}
          aria-label={`Số tờ khai của container ${identity}: ${persisted || 'Chưa có'}. Nhấn để sửa.`}
          title="Nhấn để sửa số tờ khai của container này"
        >
          {persisted || 'Nhập tờ khai'}
        </button>
      )}
      {showCopy && !open && (
        <button
          type="button"
          className="cus-declaration-copy"
          onClick={onCopy}
          disabled={copying || busy}
          title="Copy số tờ khai này sang các container còn trống của lô"
          aria-label={`Copy số tờ khai ${persisted} sang các container chưa có số của lô`}
        >
          <Copy size={13} aria-hidden="true" />
          Copy
        </button>
      )}
    </td>
  );
}

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
  showCopyAppointment,
  onCopyAppointmentToEmpty,
  onAppointmentCopied,
  declarationEditable,
  onDeclarationCommit,
  showCopyDeclaration,
  onCopyDeclaration,
  copyingDeclaration,
  onRemove,
  removing,
}: {
  detail: ShipmentCusWorkspaceDetail;
  line: ShipmentCusWorkspaceContainerLine;
  draft: ContainerLineDraft;
  dirty: boolean;
  onDraftChange: (patch: Partial<ContainerLineDraft>) => void;
  idPrefix: string;
  editing: boolean;
  /** Card 20260923_1: lot-level remove — the drawer manages container
   *  composition; absent when no refetch path is wired or the viewer lacks
   *  the remove permission (CUS-10). CUS-10 (ruling 21/10): the action is a
   *  labeled danger button that opens the confirm dialog — the bare icon it
   *  replaces deleted immediately on a mis-click with no undo. */
  onRemove?: () => void;
  removing?: boolean;
  /** Staff close for external-carrier trips (external drivers don't use the
   *  app) — absent when the line has no completable external trip. */
  onCompleteExternalTrip?: (line: ShipmentCusWorkspaceContainerLine) => void;
  completing?: boolean;
  /** Enter inside the appointment popover: validate and persist the value.
   *  Return false to keep the popover open on failure. */
  onAppointmentCommit?: (val: string) => Promise<boolean> | boolean | void;
  onAppointmentCancel?: () => void;
  /** Bulk entry: this row's appointment can be copied to every line whose
   *  appointment is still empty (shown while hovering set rows when the
   *  table still has empties to fill). */
  showCopyAppointment?: boolean;
  onCopyAppointmentToEmpty?: () => void;
  /** FB-009: the row's giờ hẹn itself lands in the OS clipboard; the
   *  mounting surface raises the "Đã copy" toast with this callback. */
  onAppointmentCopied?: (formatted: string) => void;
  /** Card 261022095235a (CUS-05): per-container tờ khai inline edit. The
   *  cell renders click-to-edit when `declarationEditable` and a commit
   *  handler are both present; the commit is an immediate per-row save that
   *  carries the server's auto-copy-to-empty-siblings law. */
  declarationEditable?: boolean;
  onDeclarationCommit?: (value: string) => Promise<boolean>;
  /** Explicit copy affordance — only when the PERSISTED number is non-empty
   *  and the lot still has an empty sibling (host computes the count). */
  showCopyDeclaration?: boolean;
  onCopyDeclaration?: () => void;
  copyingDeclaration?: boolean;
}) {
  const [, setSelectOpen] = useState(false);

  // Card 20260925_6 sweep: the plate datalist follows the picked vendor — an
  // existing carrier offers its own plates; a typed NEW_EXTERNAL name matches
  // that vendor's used plates; nothing picked keeps the full list.
  const plateOptions = useMemo<Array<{ id: number | string; licensePlate: string; label: string }>>(() => {
    const vehicles = detail.selectors.carrierVehicles;
    if (draft.carrierKey === 'NEW_EXTERNAL') {
      return externalVendorPlateOptions(detail.selectors.externalCarriers, vehicles, draft.newCarrierName)
        .map((option) => ({ id: option.value, licensePlate: option.value, label: option.label }));
    }
    if (draft.carrierKey === 'OWN') return [];
    if (draft.carrierKey) {
      const raw = draft.carrierKey.startsWith('EXTERNAL:') ? draft.carrierKey.slice('EXTERNAL:'.length) : draft.carrierKey;
      const id = Number(raw);
      if (!Number.isFinite(id)) return [];
      return vehicles.filter((vehicle) => vehicle.carrierId === id);
    }
    return vehicles;
  }, [detail.selectors.carrierVehicles, detail.selectors.externalCarriers, draft.carrierKey, draft.newCarrierName]);
  const [appointmentOpen, setAppointmentOpen] = useState(false);
  const appointmentTriggerRef = useRef<HTMLButtonElement>(null);
  const p = line.permissions;
  const carrierEditable = editing && p.carrierEditable, plateEditable = editing && p.plateEditable;
  const containerTypeEditable = editing && p.containerTypeEditable;
  const routeEditable = editing && p.routeEditable;
  const liftSiteEditable = editing && p.liftSiteEditable, dropoffSiteEditable = editing && p.dropoffSiteEditable;
  const customerAppointmentEditable = editing && p.customerAppointmentEditable;
  // Mirrors the backend's findActiveTripForContainer: a trip on THIS row blocks
  // its removal unless it was CANCELED. The 409 stays authoritative — this only
  // keeps the affordance from inviting a doomed click.
  const activeTrip = line.tripId != null && line.tripStatus !== 'CANCELED';

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
          <strong id={`${idPrefix}-container-${line.id}`} data-missing-container={line.containerNumber ? undefined : 'true'}>{line.containerNumber || 'Chưa có số container'}</strong>
          {showCopyAppointment && (
            <button
              type="button"
              className="cus-container-row__copy"
              onClick={onCopyAppointmentToEmpty}
              title={`Copy giờ hẹn ${formatDateTime24(draft.customerAppointmentAt)} sang các cont chưa có lịch`}
              aria-label={`Copy giờ hẹn ${formatDateTime24(draft.customerAppointmentAt)} sang các container chưa có lịch`}
            >
              <Copy size={13} aria-hidden="true" />
            </button>
          )}
        </div>
      </th>
      {/* Card 261022095235a (CUS-05): tờ khai per-container, sửa ngay tại
           chỗ hiển thị — documents stay one click away, no tab switch. */}
      <DeclarationCell
        line={line}
        editable={Boolean(declarationEditable && onDeclarationCommit)}
        onCommit={onDeclarationCommit ?? (async () => false)}
        showCopy={Boolean(showCopyDeclaration && onCopyDeclaration)}
        onCopy={onCopyDeclaration ?? (() => {})}
        copying={Boolean(copyingDeclaration)}
      />
      {containerTypeEditable ? (
        <ShipmentContainerCell
          label="Loại cont"
          value={selectedContainerType?.code ?? ''}
          placeholder="Chọn loại cont"
          displayTitle={selectedContainerType ? `${selectedContainerType.code} — ${selectedContainerType.name}` : undefined}
          className="cus-container-cell"
          picker
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
          picker
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
          <datalist id={`${idPrefix}-plates-${line.id}`}>{plateOptions.map((vehicle) => <option value={vehicle.licensePlate} key={vehicle.id}>{vehicle.label}</option>)}</datalist>
          {line.plateNumber && (
            <button type="button" className="cus-carrier-editor__switch" onClick={() => onDraftChange({ plateNumber: '' })}>Xóa biển số</button>
          )}
        </ShipmentContainerCell>
      ) : <td data-label="Biển số" className="cus-container-cell"><strong>{line.plateNumber || '—'}</strong></td>}
      {liftSiteEditable ? (
        <ShipmentContainerCell label="Nâng" value={selectedLiftPort?.name ?? ''} displayTitle={selectedLiftPort ? `${selectedLiftPort.code ?? ''} — ${selectedLiftPort.name}` : undefined} placeholder="Chọn cảng nâng" className="cus-container-cell" picker>
          <label className="sr-only" htmlFor={`${idPrefix}-lift-site-${line.id}`}>Cảng nâng của container {line.containerNumber || line.ordinal}</label>
          <SearchableSelect id={`${idPrefix}-lift-site-${line.id}`} size="sm" value={draft.liftSiteId} onChange={(value) => onDraftChange({ liftSiteId: value })} onOpenChange={setSelectOpen} options={detail.selectors.ports.map((option) => ({ value: String(option.id), label: option.label, searchText: `${option.code ?? ''} ${option.name}` }))} placeholder="Chọn cảng nâng" />
        </ShipmentContainerCell>
      ) : <td data-label="Nâng" className="cus-container-cell"><strong>{line.liftSite || '—'}</strong></td>}
      {dropoffSiteEditable ? (
        <ShipmentContainerCell label="Hạ" value={selectedDropoffPort?.name ?? ''} displayTitle={selectedDropoffPort ? `${selectedDropoffPort.code ?? ''} — ${selectedDropoffPort.name}` : undefined} placeholder="Chọn cảng hạ" className="cus-container-cell" picker>
          <label className="sr-only" htmlFor={`${idPrefix}-dropoff-site-${line.id}`}>Cảng hạ của container {line.containerNumber || line.ordinal}</label>
          <SearchableSelect id={`${idPrefix}-dropoff-site-${line.id}`} size="sm" value={draft.dropoffSiteId} onChange={(value) => onDraftChange({ dropoffSiteId: value })} onOpenChange={setSelectOpen} options={detail.selectors.ports.map((option) => ({ value: String(option.id), label: option.label, searchText: `${option.code ?? ''} ${option.name}` }))} placeholder="Chọn cảng hạ" />
        </ShipmentContainerCell>
      ) : <td data-label="Hạ" className="cus-container-cell"><strong>{line.dropoffSite || '—'}</strong></td>}
      {/* Card 20260923_9: the line's own weight, and the remove action in its
          own column — the drawer's add row sits under both. The cell reads
          tấn through the shared formatWeight (CUS-08); the add-row input
          below keeps its kg entry unit, so its labels stay "(kg)". */}
      <td data-label="Trọng lượng" className="cus-container-cell">
        <strong>{formatWeight(line.raw.cargoWeightKg)}</strong>
      </td>
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
          {draft.customerAppointmentAt && (
            <CopyCodeButton
              className="cus-appointment-cell__copy"
              value={formatDateTime24(draft.customerAppointmentAt)}
              label="Giờ hẹn đóng trả"
              onCopied={() => onAppointmentCopied?.(formatDateTime24(draft.customerAppointmentAt))}
            />
          )}
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
      ) : (
        <td data-label="Giờ hẹn đóng/trả" className="cus-container-cell cus-appointment-cell">
          <strong>{formatDateTime24(formatVietnamDateTimeInput(line.customerAppointmentAt)) || '—'}</strong>
          {line.customerAppointmentAt && (
            <CopyCodeButton
              className="cus-appointment-cell__copy"
              value={formatDateTime24(formatVietnamDateTimeInput(line.customerAppointmentAt))}
              label="Giờ hẹn đóng trả"
              onCopied={() => onAppointmentCopied?.(formatDateTime24(formatVietnamDateTimeInput(line.customerAppointmentAt)))}
            />
          )}
        </td>
      )}
      <td data-label="Thao tác" className="cus-container-cell cus-container-cell--actions">
        {onRemove && (
          <button
            type="button"
            className="btn btn--danger-outline btn--sm cus-container-row__remove"
            onClick={onRemove}
            disabled={removing || activeTrip}
            title={activeTrip ? 'Không thể xóa container đã gắn chuyến xe' : 'Xóa container khỏi lô'}
            aria-label={`Xóa container ${line.containerNumber || line.ordinal}`}
          >
            Xóa container
          </button>
        )}
      </td>
    </tr>
  );
}
