import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { CalendarOff, Clock3 } from 'lucide-react';
import { DISPATCH_CLASSIFICATION_LABELS } from '@tingting/shared';
import type {
  ShipmentCusContainerFlatRow,
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { displayNote } from '../cus/cusUtils';
import { StatusStrip } from '../../../components/shared/StatusStrip';
import { Badge, BadgeWithDot } from '../../../components/untitled-ui/base/badges/badges';
import { TextArea as UUITextArea } from '../../../components/untitled-ui/base/textarea/textarea';
import { SearchableSelect, SummaryRail } from '../../../design-system';
import { UuiSelectField } from '../../../design-system/forms/UuiSelectField';
import { USearchableField } from '../create/uui-fields';
import { EditActions } from './ShipmentContainerEditActions';
import { ScheduleEditorBody } from './ShipmentContainerScheduleEditor';
import { ShipmentMissingFieldsSummary } from './ShipmentMissingFieldsSummary';
import { ShipmentIdentityEditor } from './ShipmentIdentityEditor';
import { formatVietnamDateTimeInput } from '../../../lib/shipment-operations';
import type { TableSortState } from '../../../lib/table-sort';
import { SortHeader } from '../../../components/shared/SortHeader';
import { formatISODate } from '../../../lib/format';
import '../../../styles/table-sort.css';

export type ShipmentDetailEditMode = 'identity' | 'documents' | 'container' | 'route' | 'schedule' | 'vehicle' | 'notes';

export interface ActiveShipmentDetailEdit {
  row: ShipmentCusContainerFlatRow;
  detail: ShipmentCusWorkspaceDetail;
  line: ShipmentCusWorkspaceContainerLine;
  mode: ShipmentDetailEditMode;
  recoveryMessage?: string;
}

export interface ShipmentRouteDraft {
  routeId: number | null;
  liftSiteId: number | null;
  dropoffSiteId: number | null;
}

export interface ShipmentIdentityDraft {
  operationalSiteId?: number | null;
  factoryName: string | null;
  routeId: number | null;
  deliveryLocation: string | null;
}

export interface ShipmentDocumentsDraft {
  blNumber: string | null;
  bookingRef: string | null;
  tradeDirection: 'IMPORT' | 'EXPORT' | null;
  shippingLineName: string | null;
}

export interface ShipmentContainerDraft {
  containerNumber: string | null;
  containerTypeId: number | null;
  cargoWeightKg: string | null;
  cargoVolumeCbm: string | null;
}

export interface ShipmentVehicleDraft {
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId: number | null;
  externalCarrierVehicleId: number | null;
  plateNumber: string | null;
  newExternalCarrier: { name: string; plateNumber: string } | null;
  /** Explicit removal: an emptied plate alone is NOT a clear on EXTERNAL
   *  rows (the service falls back to the carrier vehicle's stored plate). */
  clearVehicle?: boolean;
}

export interface ShipmentScheduleDraft {
  transportDate: string | null;
  customerAppointmentAt: string | null;
}

export interface ShipmentNotesDraft {
  customerNotes: string | null;
  operationalNotes: string | null;
}

type DispatchStatus = ShipmentCusContainerFlatRow['dispatchStatus'];
 
export const DISPATCH_STATUS: Record<DispatchStatus, { label: string; color: 'warning' | 'brand' | 'blue' | 'indigo' | 'purple' | 'success' }> = {
  AWAITING_VEHICLE: { label: 'Chờ phân xe', color: 'warning' },
  PLANNED: { label: 'Đã điều xe', color: 'blue' },
  CREATED: { label: 'Đã tạo chuyến', color: 'indigo' },
  IN_TRANSIT: { label: 'Đang chạy', color: 'purple' },
  COMPLETED: { label: 'Hoàn thành', color: 'success' },
};

/* Row markers follow the status-signal contract: semantic tones only, mirroring
   the workboard's StatusStrip lane — the badge column carries the precise
   five-state label. */
const DISPATCH_STRIP_COLORS: Record<DispatchStatus, string> = {
  AWAITING_VEHICLE: 'var(--warning)',
  PLANNED: 'var(--info)',
  CREATED: 'var(--info)',
  IN_TRANSIT: 'var(--info)',
  COMPLETED: 'var(--success)',
};

// Shared with the missing-fields summary control, whose jump-to-editor
// buttons reuse the same cell vocabulary.
 
export function modeLabelForTrigger(mode: ShipmentDetailEditMode): string {
  if (mode === 'identity') return 'khách hàng và lộ trình';
  if (mode === 'documents') return 'chứng từ và hãng tàu';
  if (mode === 'container') return 'thông số container';
  if (mode === 'route') return 'điểm nâng hạ';
  if (mode === 'vehicle') return 'phân xe';
  if (mode === 'schedule') return 'lịch trình';
  return 'ghi chú';
}

function directionLabel(direction: ShipmentCusContainerFlatRow['direction']): string {
  if (direction === 'IMPORT') return 'Nhập';
  if (direction === 'EXPORT') return 'Xuất';
  return 'Chưa xác định';
}

function formatDate(value: string | null): string {
  // Delegates to the shared ISO-date formatter; only the empty-state text is
  // this surface's own.
  if (!value) return 'Chưa có ngày';
  return formatISODate(value);
}

function formatScheduleTime(row: ShipmentCusContainerFlatRow): string | null {
  const value = row.customerAppointmentAt;
  const input = formatVietnamDateTimeInput(value);
  return input ? input.slice(11, 16) : null;
}

function fallback(value: string | null, label: string) {
  return value || <span className="shipment-container-ledger__missing">{label}</span>;
}

function InlineEditor({
  id,
  edit,
  onCancel,
  onSaveRoute,
  onSaveVehicle,
  onSaveSchedule,
  onSaveNotes,
  onSaveIdentity,
  onSaveDocuments,
  onSaveContainer,
  routeOptions,
}: {
  id: string;
  edit: ActiveShipmentDetailEdit;
  onCancel: () => void;
  onSaveRoute: (line: ShipmentCusWorkspaceContainerLine, draft: ShipmentRouteDraft) => Promise<void>;
  onSaveVehicle: (line: ShipmentCusWorkspaceContainerLine, draft: ShipmentVehicleDraft) => Promise<void>;
  onSaveSchedule: (line: ShipmentCusWorkspaceContainerLine, row: ShipmentCusContainerFlatRow, draft: ShipmentScheduleDraft) => Promise<void>;
  onSaveNotes: (row: ShipmentCusContainerFlatRow, draft: ShipmentNotesDraft) => Promise<void>;
  onSaveIdentity: (row: ShipmentCusContainerFlatRow, draft: ShipmentIdentityDraft) => Promise<void>;
  onSaveDocuments: (row: ShipmentCusContainerFlatRow, draft: ShipmentDocumentsDraft) => Promise<void>;
  onSaveContainer: (line: ShipmentCusWorkspaceContainerLine, draft: ShipmentContainerDraft) => Promise<void>;
  routeOptions: Array<{ value: string; label: string; searchText?: string }>;
}) {
  const { detail, line, mode, row } = edit;
  // 2026-09-10: the container/route edit approval flow (REQUEST mode +
  // "gửi yêu cầu để Điều vận xem xét") is removed — edits save directly.
  const [liftSiteId, setLiftSiteId] = useState(line.liftSiteId ? String(line.liftSiteId) : '');
  const [dropoffSiteId, setDropoffSiteId] = useState(line.dropoffSiteId ? String(line.dropoffSiteId) : '');
  const [containerRouteId, setContainerRouteId] = useState(line.routeId ? String(line.routeId) : '');
  const initialCarrier = line.carrierType === 'OWN'
    ? 'OWN'
    : line.externalCarrierId ? String(line.externalCarrierId) : '';
  const [carrierId, setCarrierId] = useState(initialCarrier);
  const [newCarrierName, setNewCarrierName] = useState('');
  const [plateNumber, setPlateNumber] = useState(line.plateNumber ?? '');
  // 20260916_6: an explicit clear action — an emptied plate alone is NOT a
  // clear on EXTERNAL rows (the service falls back to the carrier vehicle's
  // stored plate), so the save must carry the clearVehicle flag.
  const [clearVehicleRequested, setClearVehicleRequested] = useState(false);
  const appointmentInput = formatVietnamDateTimeInput(row.customerAppointmentAt);
  const [appointmentDate, setAppointmentDate] = useState(appointmentInput?.slice(0, 10) ?? '');
  const [scheduleTime, setScheduleTime] = useState(formatScheduleTime(row) ?? '');
  // Non-FCL transport date (shipments.expectedDeliveryDate) — the lot-level
  // schedule field the schedule editor also owns; FCL never edits it (its
  // transport date derives from the container appointments).
  const [transportDate, setTransportDate] = useState(row.transportDate ?? '');
  const [customerNotes, setCustomerNotes] = useState(row.customerNotes ?? '');
  const [operationalNotes, setOperationalNotes] = useState(row.operationalNotes ?? '');
  const [factoryName, setFactoryName] = useState(detail.summary.raw.factoryName ?? '');
  const [operationalSiteId, setOperationalSiteId] = useState(line.operationalSiteId ? String(line.operationalSiteId) : '');
  const [routeId, setRouteId] = useState(detail.summary.raw.routeId ? String(detail.summary.raw.routeId) : '');
  const [deliveryLocation, setDeliveryLocation] = useState(detail.summary.raw.deliveryLocation ?? '');
  const [blNumber, setBlNumber] = useState(detail.summary.raw.blNumber ?? '');
  const [bookingRef, setBookingRef] = useState(detail.summary.raw.bookingRef ?? '');
  const [tradeDirection, setTradeDirection] = useState(detail.summary.raw.tradeDirection ?? '');
  const [shippingLineName, setShippingLineName] = useState(detail.summary.raw.shippingLineName ?? '');
  const [containerNumber, setContainerNumber] = useState(line.raw.containerNumber ?? '');
  const [containerTypeId, setContainerTypeId] = useState(line.raw.containerTypeId ? String(line.raw.containerTypeId) : '');
  const [cargoWeightKg, setCargoWeightKg] = useState(line.raw.cargoWeightKg ?? '');
  const [cargoVolumeCbm, setCargoVolumeCbm] = useState(line.raw.cargoVolumeCbm ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  // Outside pointerdown / global Escape dismisses the editor, matching the CUS
  // appointment popover; paused while a portaled select popover (SearchableSelect
  // / UuiSelectField) is open so picking an option never cancels the draft.
  useClickOutside(editorRef, () => {
    if (!saving) onCancel();
  }, {
    escapeKey: true,
    ignoreSelector: '.searchable-select__popover, .searchable-select__backdrop, .react-aria-Popover, [data-time-picker-overlay], .time-picker__popup, [data-date-picker]',
  });
  const siteOptions = useMemo(() => detail.selectors.ports.map((port) => ({
    value: String(port.id), label: port.label, searchText: `${port.code ?? ''} ${port.name}`,
  })), [detail.selectors.ports]);
  const carrierOptions = useMemo(() => [
    { value: 'OWN', label: 'Đội xe SilverSea', searchText: 'đội xe nội bộ silversea' },
    ...detail.selectors.externalCarriers.map((carrier) => ({
      value: String(carrier.id), label: carrier.label, searchText: `${carrier.name} ${carrier.shortName ?? ''}`,
    })),
    { value: 'NEW_EXTERNAL', label: 'Nhập nhà xe mới', searchText: 'nhà xe mới' },
  ], [detail.selectors.externalCarriers]);
  const vehicleOptions = useMemo(() => detail.selectors.carrierVehicles
    .filter((vehicle) => vehicle.carrierId === Number(carrierId))
    .map((vehicle) => ({ value: String(vehicle.id), label: vehicle.label, searchText: vehicle.licensePlate })),
  [carrierId, detail.selectors.carrierVehicles]);
  const matchedVehicle = detail.selectors.carrierVehicles.find((vehicle) => (
    vehicle.carrierId === Number(carrierId)
    && vehicle.licensePlate.localeCompare(plateNumber.trim(), 'vi', { sensitivity: 'base' }) === 0
  ));
  const appointmentScheduleDirty = appointmentDate !== (appointmentInput?.slice(0, 10) ?? '')
    || scheduleTime !== (formatScheduleTime(row) ?? '');
  const dirty = mode === 'identity'
    ? detail.summary.cargoMode === 'FCL'
      ? operationalSiteId !== (line.operationalSiteId ? String(line.operationalSiteId) : '')
      : factoryName.trim() !== (detail.summary.raw.factoryName ?? '')
      || routeId !== (detail.summary.raw.routeId ? String(detail.summary.raw.routeId) : '')
      || deliveryLocation.trim() !== (detail.summary.raw.deliveryLocation ?? '')
    : mode === 'documents'
      ? blNumber.trim() !== (detail.summary.raw.blNumber ?? '')
        || bookingRef.trim() !== (detail.summary.raw.bookingRef ?? '')
        || tradeDirection !== (detail.summary.raw.tradeDirection ?? '')
        || shippingLineName.trim() !== (detail.summary.raw.shippingLineName ?? '')
    : mode === 'container'
      ? containerNumber.trim() !== (line.raw.containerNumber ?? '')
        || containerTypeId !== (line.raw.containerTypeId ? String(line.raw.containerTypeId) : '')
        || cargoWeightKg.trim() !== (line.raw.cargoWeightKg ?? '')
        || cargoVolumeCbm.trim() !== (line.raw.cargoVolumeCbm ?? '')
    : mode === 'route'
    ? containerRouteId !== (line.routeId ? String(line.routeId) : '')
      || liftSiteId !== (line.liftSiteId ? String(line.liftSiteId) : '')
      || dropoffSiteId !== (line.dropoffSiteId ? String(line.dropoffSiteId) : '')
    : mode === 'vehicle'
      ? carrierId !== initialCarrier || plateNumber.trim() !== (line.plateNumber ?? '') || newCarrierName.trim() !== ''
    : mode === 'schedule'
        ? appointmentScheduleDirty || transportDate !== (row.transportDate ?? '')
        : customerNotes.trim() !== (row.customerNotes ?? '').trim()
          || operationalNotes.trim() !== (row.operationalNotes ?? '').trim();
  const modeLabel = mode === 'identity' ? 'khách hàng và lộ trình'
    : mode === 'documents' ? 'chứng từ và hãng tàu'
      : mode === 'container' ? 'thông số container'
        : mode === 'route' ? 'hành trình'
          : mode === 'vehicle' ? 'phân xe'
            : mode === 'schedule' ? 'lịch trình'
              : 'ghi chú';
  const label = `${modeLabel} ${row.containerNumber || `container số ${row.ordinal}`}`;

  useEffect(() => {
    editorRef.current?.focus();
  }, []);

  const save = async () => {
    const invalidInput = Array.from(editorRef.current?.querySelectorAll<HTMLInputElement>('input') ?? [])
      .find((input) => !input.validity.valid);
    if (invalidInput) {
      setSaveError(invalidInput.validationMessage || 'Kiểm tra thông tin chưa hợp lệ trước khi lưu.');
      invalidInput.focus();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      if (mode === 'identity') {
        await onSaveIdentity(row, {
          operationalSiteId: operationalSiteId ? Number(operationalSiteId) : null,
          factoryName: factoryName.trim() || null,
          routeId: routeId ? Number(routeId) : null,
          deliveryLocation: deliveryLocation.trim() || null,
        });
      } else if (mode === 'documents') {
        await onSaveDocuments(row, {
          blNumber: tradeDirection === 'EXPORT' ? null : blNumber.trim() || null,
          bookingRef: tradeDirection === 'IMPORT' ? null : bookingRef.trim() || null,
          tradeDirection: tradeDirection === 'IMPORT' || tradeDirection === 'EXPORT' ? tradeDirection : null,
          shippingLineName: shippingLineName.trim() || null,
        });
      } else if (mode === 'container') {
        await onSaveContainer(line, {
          containerNumber: containerNumber.trim().toUpperCase() || null,
          containerTypeId: containerTypeId ? Number(containerTypeId) : null,
          cargoWeightKg: cargoWeightKg.trim() || null,
          cargoVolumeCbm: cargoVolumeCbm.trim() || null,
        });
      } else if (mode === 'route') {
        await onSaveRoute(line, {
          routeId: containerRouteId ? Number(containerRouteId) : null,
          liftSiteId: liftSiteId ? Number(liftSiteId) : null,
          dropoffSiteId: dropoffSiteId ? Number(dropoffSiteId) : null,
        });
      } else if (mode === 'vehicle') {
        if (carrierId === 'OWN') {
          await onSaveVehicle(line, {
            carrierType: 'OWN',
            externalCarrierId: null,
            externalCarrierVehicleId: null,
            plateNumber: plateNumber.trim() || null,
            newExternalCarrier: null,
          });
          return;
        }
        if (carrierId === 'NEW_EXTERNAL' && (!newCarrierName.trim() || !plateNumber.trim())) {
          throw new Error('Nhập đủ tên nhà xe mới và biển số xe.');
        }
        if (!carrierId) throw new Error('Chọn nhà xe trước khi lưu.');
        if (clearVehicleRequested) {
          // The explicit clear beats any draft plate text: the user asked to
          // remove the assignment, so drop the vehicle selection too.
          await onSaveVehicle(line, {
            carrierType: 'EXTERNAL',
            externalCarrierId: carrierId === 'NEW_EXTERNAL' ? null : Number(carrierId),
            externalCarrierVehicleId: null,
            plateNumber: null,
            newExternalCarrier: null,
            clearVehicle: true,
          });
          return;
        }
        await onSaveVehicle(line, {
          carrierType: 'EXTERNAL',
          externalCarrierId: carrierId === 'NEW_EXTERNAL' ? null : Number(carrierId),
          externalCarrierVehicleId: matchedVehicle?.id ?? null,
          plateNumber: plateNumber.trim() || null,
          newExternalCarrier: carrierId === 'NEW_EXTERNAL'
            ? { name: newCarrierName.trim(), plateNumber: plateNumber.trim() }
            : null,
        });
      } else if (mode === 'schedule') {
        if (scheduleTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduleTime)) throw new Error('Nhập giờ từ 00:00 đến 23:59 (HH:mm).');
        if (scheduleTime && !appointmentDate) throw new Error('Chọn ngày đóng/trả trước khi nhập giờ.');
        if (appointmentDate && !scheduleTime) throw new Error('Vui lòng nhập đầy đủ cả Ngày và Giờ giao hàng.');
        await onSaveSchedule(line, row, {
          transportDate: transportDate || null,
          customerAppointmentAt: appointmentDate ? `${appointmentDate}T${scheduleTime || '12:00'}` : null,
        });
      } else {
        await onSaveNotes(row, {
          customerNotes: customerNotes.trim() || null,
          operationalNotes: operationalNotes.trim() || null,
        });
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Không thể lưu thay đổi.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      id={id}
      ref={editorRef}
      className="shipment-container-ledger__inline-editor"
      data-mode={mode}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        if ((event.target as HTMLElement).closest('[data-date-picker], .time-picker__popup, [data-time-picker-overlay]')) return;
        if (event.key === 'Escape' && !saving) {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
          return;
        }
        if (event.key !== 'Enter' || event.nativeEvent.isComposing || !dirty || saving) return;
        const target = event.target as HTMLElement;
        if (target.isContentEditable || target.tagName === 'SELECT' || target.tagName === 'BUTTON' || target.closest('.searchable-select, [role="listbox"], [role="option"]')) return;
        // Multiline notes: bare Enter inserts a newline; the modified
        // Enter combo (Ctrl+Enter / Cmd+Enter) is what saves instead.
        if (target.tagName === 'TEXTAREA' && !event.ctrlKey && !event.metaKey) return;
        if (event.shiftKey) return;
        event.preventDefault();
        void save();
      }}
    >
      {mode === 'schedule' ? (
        <ScheduleEditorBody
          row={row}
          appointmentDate={appointmentDate}
          scheduleTime={scheduleTime}
          saving={saving}
          canEdit={line.permissions.customerAppointmentEditable}
          onAppointmentDateChange={setAppointmentDate}
          onScheduleTimeChange={setScheduleTime}
          onClose={onCancel}
          cargoMode={detail.summary.cargoMode}
          transportDate={transportDate}
          canEditTransport={row.shipmentScheduleEditable}
          onTransportDateChange={setTransportDate}
        />
      ) : (
        <div className="shipment-container-ledger__editor-heading">
          <strong>Chỉnh sửa {modeLabel}</strong>
          <span>{row.containerNumber || `Container số ${row.ordinal}`}</span>
        </div>
      )}
      {mode === 'identity' && (
        <ShipmentIdentityEditor detail={detail} line={line} customerName={row.customerName} currentFactoryName={row.factoryName} saving={saving}
          factoryName={factoryName} setFactoryName={setFactoryName} operationalSiteId={operationalSiteId} setOperationalSiteId={setOperationalSiteId}
          routeId={routeId} setRouteId={setRouteId} deliveryLocation={deliveryLocation} setDeliveryLocation={setDeliveryLocation} routeOptions={routeOptions} />
      )}
      {mode === 'documents' && (
        <div className="shipment-container-ledger__editor-grid">
          <label><span>Nhập / Xuất</span><UuiSelectField
            label="Nhập / Xuất"
            hideLabel
            value={tradeDirection}
            onChange={(event) => {
              const direction = event.target.value;
              setTradeDirection(direction);
              if (direction === 'IMPORT') setBookingRef('');
              if (direction === 'EXPORT') setBlNumber('');
            }}
            disabled={saving || detail.summary.fieldAccess.tradeDirection.mode === 'READ_ONLY'}
            options={[
              { value: '', label: 'Chưa xác định' },
              { value: 'IMPORT', label: 'Nhập' },
              { value: 'EXPORT', label: 'Xuất' },
            ]}
          /></label>
          {tradeDirection === 'IMPORT' && <label><span>Số Bill</span><input autoFocus value={blNumber} onChange={(event) => setBlNumber(event.target.value)} maxLength={100} disabled={saving || detail.summary.fieldAccess.blNumber.mode === 'READ_ONLY'} /></label>}
          {tradeDirection === 'EXPORT' && <label><span>Số Booking</span><input autoFocus value={bookingRef} onChange={(event) => setBookingRef(event.target.value)} maxLength={100} disabled={saving || detail.summary.fieldAccess.bookingRef.mode === 'READ_ONLY'} /></label>}
          {!tradeDirection && <small>Chọn Nhập hoặc Xuất trước khi cập nhật số chứng từ.</small>}
          <label><span>Hãng tàu</span><input value={shippingLineName} onChange={(event) => setShippingLineName(event.target.value)} maxLength={255} disabled={saving || detail.summary.fieldAccess.shippingLineName.mode === 'READ_ONLY'} /></label>
          <small>Tờ khai dùng luồng chứng từ có kiểm soát riêng: {detail.summary.fieldAccess.declarationNumber.reason}</small>
        </div>
      )}
      {mode === 'container' && (
        <div className="shipment-container-ledger__editor-grid">
          <label><span>Số container</span><input autoFocus value={containerNumber} onChange={(event) => setContainerNumber(event.target.value.toUpperCase())} maxLength={20} disabled={saving || line.fieldAccess.containerNumber.mode === 'READ_ONLY'} /></label>
          <label><span>Loại container</span><SearchableSelect id={`shipment-detail-container-type-${line.id}`} value={containerTypeId} onChange={setContainerTypeId} options={detail.selectors.containerTypes.map((item) => ({ value: String(item.id), label: item.label, searchText: `${item.code} ${item.name}` }))} placeholder="Chọn loại container" searchPlaceholder="Tìm loại container" disabled={saving || line.fieldAccess.containerTypeId.mode === 'READ_ONLY'} /></label>
          <label><span>Trọng lượng (kg)</span><input type="number" min="0" step="0.01" value={cargoWeightKg} onChange={(event) => setCargoWeightKg(event.target.value)} disabled={saving || line.fieldAccess.cargoWeightKg.mode === 'READ_ONLY'} /></label>
          <label><span>Thể tích (CBM)</span><input type="number" min="0" step="0.001" value={cargoVolumeCbm} onChange={(event) => setCargoVolumeCbm(event.target.value)} disabled={saving || line.fieldAccess.cargoVolumeCbm.mode === 'READ_ONLY'} /></label>
        </div>
      )}
      {mode === 'route' && (
        <div className="shipment-container-ledger__editor-grid">
          <label><span>Tuyến đường</span><SearchableSelect id={`shipment-detail-container-route-${line.id}`} value={containerRouteId} onChange={setContainerRouteId} options={routeOptions} placeholder="Chọn tuyến đường" searchPlaceholder="Tìm tuyến đường" disabled={saving || line.fieldAccess.routeId.mode === 'READ_ONLY'} /></label>
          <label><span>Cảng nâng</span><SearchableSelect id={`shipment-detail-lift-${line.id}`} value={liftSiteId} onChange={setLiftSiteId} options={siteOptions} placeholder="Chọn cảng nâng" searchPlaceholder="Tìm cảng nâng" disabled={saving || line.fieldAccess.liftSiteId.mode === 'READ_ONLY'} /></label>
          <label><span>Cảng hạ</span><SearchableSelect id={`shipment-detail-dropoff-${line.id}`} value={dropoffSiteId} onChange={setDropoffSiteId} options={siteOptions} placeholder="Chọn cảng hạ" searchPlaceholder="Tìm cảng hạ" disabled={saving || line.fieldAccess.dropoffSiteId.mode === 'READ_ONLY'} /></label>
        </div>
      )}
      {mode === 'vehicle' && (
        <div className="shipment-container-ledger__editor-grid">
          <label><span>Nhà xe</span><SearchableSelect id={`shipment-detail-carrier-${line.id}`} value={carrierId} onChange={(value) => { setCarrierId(value); setPlateNumber(''); }} options={carrierOptions} placeholder="Chọn nhà xe" searchPlaceholder="Tìm nhà xe" disabled={saving || !line.permissions.carrierEditable} /></label>
          {carrierId === 'NEW_EXTERNAL' && <label><span>Tên nhà xe mới</span><input value={newCarrierName} onChange={(event) => setNewCarrierName(event.target.value)} maxLength={255} disabled={saving} /></label>}
          {carrierId && carrierId !== 'NEW_EXTERNAL' && <label><span>Biển số xe</span><USearchableField id={`shipment-detail-vehicle-${line.id}`} label="Biển số xe" hideLabel value={plateNumber} onChange={(plate) => setPlateNumber(plate.toUpperCase())} onCustomValue={(text) => setPlateNumber(text.toUpperCase().slice(0, 20))} options={vehicleOptions.map((vehicle) => ({ value: vehicle.label, label: vehicle.label, searchText: vehicle.searchText }))} placeholder="Chọn hoặc nhập biển số" disabled={saving || !line.permissions.plateEditable} allowsCustomValue searchable /></label>}
          {carrierId && carrierId !== 'NEW_EXTERNAL' && line.plateNumber && line.permissions.plateEditable && (
            <small className="shipment-container-ledger__plate-clear">
              <button type="button" disabled={saving} onClick={() => { setPlateNumber(''); setClearVehicleRequested(true); }}>Xóa biển số</button>
            </small>
          )}
          {carrierId === 'OWN' && <small>Biển số nội bộ nhập ở đây là kế hoạch (dự kiến); lệnh điều xe chính thức vẫn là nguồn xác nhận cuối.</small>}
          {carrierId !== 'OWN' && carrierId && <small>Biển số nhập ở đây là kế hoạch (dự kiến) cho nhà xe thuê; lệnh điều xe chính thức vẫn là nguồn xác nhận cuối.</small>}
        </div>
      )}
      {mode === 'notes' && (
        <div className="shipment-container-ledger__editor-grid">
          <UUITextArea label="Ghi chú cho khách hàng" size="sm" rows={2} maxLength={2000} value={customerNotes} onChange={setCustomerNotes} isDisabled={saving} />
          <UUITextArea label="Ghi chú cho lái xe" size="sm" rows={2} maxLength={2000} value={operationalNotes} onChange={setOperationalNotes} isDisabled={saving} />
          <small>Thay đổi áp dụng cho toàn bộ container trong lô hàng này.</small>
        </div>
      )}
      <div className="shipment-container-ledger__editor-footer">
        {mode === 'schedule' ? (
          (appointmentDate || scheduleTime) ? (
            <button
              type="button"
              className="shipment-container-ledger__schedule-clear"
              onClick={() => {
                setAppointmentDate('');
                setScheduleTime('');
              }}
              title="Xóa giờ hẹn đã chọn, nhấn Lưu để áp dụng"
            >
              Xóa hẹn
            </button>
          ) : <span aria-hidden="true" />
        ) : (
          <span className="shipment-container-ledger__keyboard-hint">Enter để lưu · Esc để hủy</span>
        )}
        <EditActions saving={saving} saveDisabled={!dirty || (mode === 'schedule' && appointmentScheduleDirty && ((!!appointmentDate && !scheduleTime) || (!appointmentDate && !!scheduleTime)))} label={label} onSave={() => void save()} onCancel={onCancel} />
      </div>
      {edit.recoveryMessage && <span className="shipment-container-ledger__recovery" role="status">{edit.recoveryMessage}</span>}
      {saveError && <span className="shipment-container-ledger__edit-error" role="alert">{saveError}</span>}
    </div>
  );
}

interface ShipmentContainerLedgerProps {
  rows: ShipmentCusContainerFlatRow[];
  totalContainers: number;
  today: string;
  footer?: ReactNode;
  sort: TableSortState | null;
  onSortChange: (key: string) => void;
  activeEdit: ActiveShipmentDetailEdit | null;
  editLoadingRowId: number | null;
  editError: { rowId: number; message: string } | null;
  onStartEdit: (row: ShipmentCusContainerFlatRow, mode: ShipmentDetailEditMode, triggerId: string) => void;
  onCancelEdit: () => void;
  onSaveRoute: (line: ShipmentCusWorkspaceContainerLine, draft: ShipmentRouteDraft) => Promise<void>;
  onSaveVehicle: (line: ShipmentCusWorkspaceContainerLine, draft: ShipmentVehicleDraft) => Promise<void>;
  onSaveSchedule: (line: ShipmentCusWorkspaceContainerLine, row: ShipmentCusContainerFlatRow, draft: ShipmentScheduleDraft) => Promise<void>;
  onSaveNotes: (row: ShipmentCusContainerFlatRow, draft: ShipmentNotesDraft) => Promise<void>;
  onSaveIdentity: (row: ShipmentCusContainerFlatRow, draft: ShipmentIdentityDraft) => Promise<void>;
  onSaveDocuments: (row: ShipmentCusContainerFlatRow, draft: ShipmentDocumentsDraft) => Promise<void>;
  onSaveContainer: (line: ShipmentCusWorkspaceContainerLine, draft: ShipmentContainerDraft) => Promise<void>;
  /** Cột bị ẩn theo tuỳ chỉnh người dùng (20260917_4) — khoá theo nhãn cột. */
}

export function ShipmentContainerLedger({
  rows,
  totalContainers,
  today,
  footer,
  sort,
  onSortChange,
  activeEdit,
  editLoadingRowId,
  editError,
  onStartEdit,
  onCancelEdit,
  onSaveRoute,
  onSaveVehicle,
  onSaveSchedule,
  onSaveNotes,
  onSaveIdentity,
  onSaveDocuments,
  onSaveContainer,
}: ShipmentContainerLedgerProps) {
  const missingDateCount = rows.filter((row) => row.transportDate == null).length;
  const missingVehicleTodayCount = rows.filter((row) => row.transportDate === today && (!row.carrierName || !row.plateNumber)).length;
  const renderInlineEditor = (edit: ActiveShipmentDetailEdit, editorId: string) => (
    <InlineEditor
      key={`${edit.mode}-${edit.detail.summary.version}-${edit.line.shipmentVersion}`}
      id={editorId}
      edit={edit}
      onCancel={onCancelEdit}
      onSaveIdentity={onSaveIdentity}
      onSaveDocuments={onSaveDocuments}
      onSaveContainer={onSaveContainer}
      onSaveRoute={onSaveRoute}
      onSaveVehicle={onSaveVehicle}
      onSaveSchedule={onSaveSchedule}
      onSaveNotes={onSaveNotes}
      routeOptions={edit.detail.selectors.routes.map((item) => ({ value: String(item.id), label: item.label, searchText: item.name }))}
    />
  );
  const editableCell = (
    row: ShipmentCusContainerFlatRow,
    mode: ShipmentDetailEditMode,
    enabled: boolean,
    children: ReactNode,
  ) => {
    const triggerId = `shipment-detail-edit-${mode}-${row.id}`;
    const editorId = `${triggerId}-editor`;
    const busy = editLoadingRowId === row.id;
    const expanded = activeEdit?.row.id === row.id && activeEdit.mode === mode;
    const className = `shipment-container-ledger__cell-trigger${enabled ? '' : ' shipment-container-ledger__cell-trigger--read-only'}`;
    if (!enabled) return <div className={className}>{children}</div>;
    return (
      <div className={`shipment-container-ledger__cell-editor${expanded ? ' shipment-container-ledger__cell-editor--expanded' : ''}`} data-mode={mode}>
        <AriaButton
          id={triggerId}
          className={`${className}${expanded ? ' shipment-container-ledger__cell-trigger--expanded' : ''}`}
          onPress={() => onStartEdit(row, mode, triggerId)}
          isDisabled={busy || activeEdit != null}
          aria-busy={busy || undefined}
          aria-controls={expanded ? editorId : undefined}
          aria-expanded={expanded}
          data-cell-label={modeLabelForTrigger(mode)}
        >
          <span className="shipment-container-ledger__edit-purpose">Chỉnh sửa {mode === 'identity' || mode === 'documents' || mode === 'container' ? 'ô ' : ''}{modeLabelForTrigger(mode)} {row.containerNumber || `container số ${row.ordinal}`}: </span>
          {children}
        </AriaButton>
        {expanded && activeEdit && renderInlineEditor(activeEdit, editorId)}
      </div>
    );
  };

  return (
    <>
      <SummaryRail
        ariaLabel="Tóm tắt container trên trang"
        items={[
          { label: 'Container trên trang', value: rows.length },
          { label: 'Tổng container phù hợp', value: totalContainers },
          { label: 'Thiếu ngày vận chuyển', value: missingDateCount, tone: missingDateCount > 0 ? 'warning' : undefined },
          { label: 'Hôm nay chờ phân xe', value: missingVehicleTodayCount, tone: missingVehicleTodayCount > 0 ? 'warning' : undefined },
        ]}
      />
      <div className="shipment-container-ledger" role="region" aria-label="Bảng chi tiết container theo lô hàng" tabIndex={0}>
        <table>
          <caption>Chi tiết container theo tám nhóm thông tin nghiệp vụ</caption>
          <colgroup>
            <col className="shipment-container-ledger__col--customer" />
            <col className="shipment-container-ledger__col--documents" />
            <col className="shipment-container-ledger__col--container" />
            <col className="shipment-container-ledger__col--route" />
            <col className="shipment-container-ledger__col--schedule" />
            <col className="shipment-container-ledger__col--vehicle" />
            <col className="shipment-container-ledger__col--notes" />
            <col className="shipment-container-ledger__col--status" />
          </colgroup>
          <thead><tr>
            <SortHeader label="Khách hàng &amp; lộ trình" sortKey="customerName" sort={sort} onSortChange={onSortChange} />
            <SortHeader label="Chứng từ &amp; hãng tàu" sortKey="billOrBookNumber" sort={sort} onSortChange={onSortChange} />
            <SortHeader label="Thông số container" sortKey="containerNumber" sort={sort} onSortChange={onSortChange} />
            <SortHeader label="Địa điểm nâng / hạ" sortKey="liftSite" sort={sort} onSortChange={onSortChange} />
            <SortHeader label="Lịch trình" sortKey="transportDate" sort={sort} onSortChange={onSortChange} />
            <SortHeader label="Phân xe" sortKey="carrierName" sort={sort} onSortChange={onSortChange} />
            <SortHeader label="Ghi chú" sortKey="customerNotes" sort={sort} onSortChange={onSortChange} />
            <SortHeader label="Trạng thái" sortKey="dispatchStatus" sort={sort} onSortChange={onSortChange} />
          </tr></thead>
          <tbody>
            {rows.map((row) => {
              const edit = activeEdit?.row.id === row.id ? activeEdit : null;
              const missingDate = row.transportDate == null;
              const missingVehicleToday = row.transportDate === today && (!row.carrierName || !row.plateNumber);
              const appointmentInput = formatVietnamDateTimeInput(row.customerAppointmentAt);
              const scheduleTime = formatScheduleTime(row);
              const identityEditable = row.fieldAccess.operationalSiteId?.mode === 'DIRECT';
              const documentsEditable = ['blNumber', 'bookingRef', 'tradeDirection', 'shippingLineName'].some((field) => row.shipmentFieldAccess[field as 'blNumber'].mode !== 'READ_ONLY');
              const containerEditable = row.fieldAccess.containerNumber.mode !== 'READ_ONLY' || row.fieldAccess.containerTypeId.mode !== 'READ_ONLY' || row.fieldAccess.cargoWeightKg.mode !== 'READ_ONLY' || row.fieldAccess.cargoVolumeCbm.mode !== 'READ_ONLY';
              const routeEditable = row.fieldAccess.routeId.mode !== 'READ_ONLY' || row.fieldAccess.liftSiteId.mode !== 'READ_ONLY' || row.fieldAccess.dropoffSiteId.mode !== 'READ_ONLY';
              const vehicleEditable = row.carrierEditable || row.plateEditable;
              const cellClassName = (editable: boolean, mode: ShipmentDetailEditMode, extraClassName?: string) => [
                extraClassName,
                editable && 'shipment-container-ledger__editable-cell',
                edit?.mode === mode && 'shipment-container-ledger__editing-cell',
              ].filter(Boolean).join(' ') || undefined;
              return (
                <tr key={row.id} className={`${missingDate ? 'shipment-container-ledger__row--missing-date' : ''}${edit ? ' shipment-container-ledger__row--editing' : ''}`.trim() || undefined}>
                  <th scope="row" data-label="Khách hàng & lộ trình" className={cellClassName(identityEditable, 'identity')}>
                    <StatusStrip color={DISPATCH_STRIP_COLORS[row.dispatchStatus]} />
                    {editableCell(row, 'identity', identityEditable, <div className="shipment-container-ledger__multiline">
                      <strong>{fallback(row.customerName, 'Chưa có khách hàng')}</strong>
                      <span>{fallback(row.factoryName, 'Chưa có nhà máy')}</span>
                      <em>{fallback(row.routeName, 'Chưa có tuyến đường')}</em>
                    </div>)}
                  </th>
                  <td data-label="Chứng từ & hãng tàu" className={cellClassName(documentsEditable, 'documents')}>
                    {editableCell(row, 'documents', documentsEditable, <div className="shipment-container-ledger__cell-stack">
                      <div className="shipment-container-ledger__multiline">
                        <strong className="shipment-container-ledger__code">{fallback(row.billOrBookNumber, 'Chưa có Bill/Booking')}</strong>
                        <span className="shipment-container-ledger__code">{fallback(row.declarationNumber, 'Chưa có tờ khai')}</span>
                      </div>
                      <span className="shipment-container-ledger__classification"><b className={`shipment-container-ledger__direction shipment-container-ledger__direction--${row.direction?.toLowerCase() ?? 'unknown'}`}>{directionLabel(row.direction)}</b><span>· {fallback(row.shippingLineName, 'Chưa có hãng tàu')}</span></span>
                    </div>)}
                  </td>
                  <td data-label="Thông số container" className={cellClassName(containerEditable, 'container')}>
                    {editableCell(row, 'container', containerEditable, <div className="shipment-container-ledger__multiline">
                      <strong className="shipment-container-ledger__code">{fallback(row.containerNumber, `Container số ${row.ordinal}`)}</strong>
                      <span>{fallback(row.containerTypeLabel, 'Chưa rõ loại container')}</span>
                      <span className="shipment-container-ledger__container-classification">{DISPATCH_CLASSIFICATION_LABELS[row.classification]}</span>
                      {row.isCombined && <span className="shipment-container-ledger__combined">Đóng kết hợp</span>}
                    </div>)}
                  </td>
<td data-label="Địa điểm nâng / hạ" className={cellClassName(routeEditable, 'route')}>
                    {editableCell(row, 'route', routeEditable, <div className="shipment-container-ledger__route"><span><small>Nâng</small>{fallback(row.liftSite, 'Chưa cập nhật')}</span><span><small>Hạ</small>{fallback(row.dropoffSite, 'Chưa cập nhật')}</span></div>)}
                    {editError?.rowId === row.id && <span className="shipment-container-ledger__edit-error" role="alert">{editError.message}</span>}
                  </td>
<td data-label="Lịch trình" className={cellClassName(row.customerAppointmentEditable, 'schedule')}>
                    {editableCell(row, 'schedule', row.customerAppointmentEditable, <div className="shipment-container-ledger__multiline shipment-container-ledger__schedule ops-schedule">
                      {missingDate && <Badge size="sm" color="warning" className="shipment-container-ledger__schedule-gap"><CalendarOff aria-hidden="true" />Thiếu ngày vận chuyển</Badge>}
                      <strong className={appointmentInput ? 'ops-schedule__datetime' : undefined}>{appointmentInput ? [scheduleTime, formatDate(appointmentInput.slice(0, 10))].filter(Boolean).join(' ') : 'Chưa có lịch hẹn'}</strong><span>{appointmentInput ? (row.direction === 'IMPORT' ? 'trả hàng' : 'đóng hàng') : 'Cập nhật theo từng container'}</span></div>)}
                  </td>
<td data-label="Phân xe" className={cellClassName(vehicleEditable, 'vehicle', missingVehicleToday ? 'shipment-container-ledger__vehicle-pending' : undefined)}>
                    {editableCell(row, 'vehicle', vehicleEditable, <div className="shipment-container-ledger__multiline shipment-container-ledger__vehicle">
                      {missingVehicleToday && <Badge size="sm" color="warning" className="shipment-container-ledger__vehicle-state"><Clock3 aria-hidden="true" />Chờ phân xe</Badge>}
                      <strong>{row.carrierName || <span className="shipment-container-ledger__missing">Chưa phân nhà xe</span>}</strong>
                      {row.plateNumber
                        ? <span className="shipment-container-ledger__plate">{row.plateNumber}</span>
                        : <BadgeWithDot size="sm" color="warning" className="shipment-container-ledger__plate--missing">Chưa gán biển số</BadgeWithDot>}
                    </div>)}
                  </td>
<td data-label="Ghi chú" className={cellClassName(row.shipmentNotesEditable, 'notes')}>
                    {editableCell(row, 'notes', row.shipmentNotesEditable, <div className="shipment-container-ledger__multiline shipment-container-ledger__notes">
                      {row.customerNotes && <strong>{displayNote(row.customerNotes)}</strong>}
                      {row.operationalNotes && <span>{displayNote(row.operationalNotes)}</span>}
                      {!row.customerNotes && !row.operationalNotes && <span className="shipment-container-ledger__missing">—</span>}
                    </div>)}
                  </td>
<td data-label="Trạng thái" className="shipment-container-ledger__cell--status">
                    <div className="shipment-container-ledger__multiline">
                      <span className={`shipment-container-ledger__dispatch-badge shipment-container-ledger__dispatch-badge--${row.dispatchStatus.toLowerCase()}`}>{DISPATCH_STATUS[row.dispatchStatus].label}</span>
                      {row.informationStatus === 'MISSING' && (
                        <ShipmentMissingFieldsSummary
                          row={row}
                          missingFields={row.missingFields}
                          editableModes={{
                            documents: documentsEditable,
                            container: containerEditable,
                            route: routeEditable,
                            schedule: row.customerAppointmentEditable,
                            vehicle: vehicleEditable,
                          }}
                          editLocked={activeEdit != null || editLoadingRowId === row.id}
                          onStartEdit={onStartEdit}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {footer}
      </div>
    </>
  );
}
