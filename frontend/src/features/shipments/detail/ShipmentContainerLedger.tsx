import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { Save01, XClose } from '@untitledui/icons';
import { AlertTriangle, CalendarOff, Clock3 } from 'lucide-react';
import { DISPATCH_CLASSIFICATION_LABELS } from '@tingting/shared';
import type {
  ShipmentCusContainerFlatRow,
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import { requestContainerEdit } from '../../../api/shipmentClient';
import { StatusStrip } from '../../../components/shared/StatusStrip';
import { Badge, BadgeWithDot } from '../../../components/untitled-ui/base/badges/badges';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { TextArea as UUITextArea } from '../../../components/untitled-ui/base/textarea/textarea';
import { SearchableSelect, DateInput, SummaryRail } from '../../../design-system';
import { UuiSelectField } from '../../../design-system/forms/UuiSelectField';
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
// eslint-disable-next-line react-refresh/only-export-components -- shared badge vocabulary consumed by the page's Trạng thái filter
export const DISPATCH_STATUS: Record<DispatchStatus, { label: string; color: 'warning' | 'brand' | 'blue' | 'indigo' | 'purple' | 'success' }> = {
  UNASSIGNED: { label: 'Chưa điều xe', color: 'warning' },
  PLANNED: { label: 'Đã phân xe', color: 'blue' },
  CREATED: { label: 'Đã tạo chuyến', color: 'indigo' },
  IN_TRANSIT: { label: 'Đang chạy', color: 'purple' },
  COMPLETED: { label: 'Hoàn thành', color: 'success' },
};

/* Row markers follow the status-signal contract: semantic tones only, mirroring
   the workboard's StatusStrip lane — the badge column carries the precise
   five-state label. */
const DISPATCH_STRIP_COLORS: Record<DispatchStatus, string> = {
  UNASSIGNED: 'var(--warning)',
  PLANNED: 'var(--info)',
  CREATED: 'var(--info)',
  IN_TRANSIT: 'var(--info)',
  COMPLETED: 'var(--success)',
};

function modeLabelForTrigger(mode: ShipmentDetailEditMode): string {
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

function EditActions({
  saving,
  saveDisabled,
  label,
  onSave,
  onCancel,
}: {
  saving: boolean;
  saveDisabled: boolean;
  label: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="shipment-container-ledger__edit-actions">
      <UUIButton
        size="xs"
        color="primary"
        className="shipment-container-ledger__edit-action"
        onPress={onSave}
        isDisabled={saveDisabled || saving}
        isLoading={saving}
        iconLeading={!saving ? Save01 : undefined}
        aria-label={`Lưu ${label}`}
      >Lưu</UUIButton>
      <UUIButton
        size="xs"
        color="secondary"
        className="shipment-container-ledger__edit-action"
        onPress={onCancel}
        isDisabled={saving}
        iconLeading={XClose}
        aria-label={`Hủy ${label}`}
      >Hủy</UUIButton>
    </div>
  );
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
  const containerRequestMode = mode === 'container' && (
    line.fieldAccess.containerNumber.mode === 'REQUEST'
    || line.fieldAccess.containerTypeId.mode === 'REQUEST'
    || line.fieldAccess.cargoWeightKg.mode === 'REQUEST'
    || line.fieldAccess.cargoVolumeCbm.mode === 'REQUEST'
  );
  const routeRequestMode = mode === 'route' && (
    line.fieldAccess.routeId.mode === 'REQUEST'
    || line.fieldAccess.liftSiteId.mode === 'REQUEST'
    || line.fieldAccess.dropoffSiteId.mode === 'REQUEST'
  );
  const [requestReason, setRequestReason] = useState('');
  const [liftSiteId, setLiftSiteId] = useState(line.liftSiteId ? String(line.liftSiteId) : '');
  const [dropoffSiteId, setDropoffSiteId] = useState(line.dropoffSiteId ? String(line.dropoffSiteId) : '');
  const [containerRouteId, setContainerRouteId] = useState(line.routeId ? String(line.routeId) : '');
  const initialCarrier = line.carrierType === 'OWN'
    ? 'OWN'
    : line.externalCarrierId ? String(line.externalCarrierId) : '';
  const [carrierId, setCarrierId] = useState(initialCarrier);
  const [newCarrierName, setNewCarrierName] = useState('');
  const [plateNumber, setPlateNumber] = useState(line.plateNumber ?? '');
  const appointmentInput = formatVietnamDateTimeInput(row.customerAppointmentAt);
  const [appointmentDate, setAppointmentDate] = useState(appointmentInput?.slice(0, 10) ?? '');
  const [scheduleTime, setScheduleTime] = useState(formatScheduleTime(row) ?? '');
  const [customerNotes, setCustomerNotes] = useState(row.customerNotes ?? '');
  const [operationalNotes, setOperationalNotes] = useState(row.operationalNotes ?? '');
  const [factoryName, setFactoryName] = useState(detail.summary.raw.factoryName ?? '');
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
  const [requestSuccess, setRequestSuccess] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
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
    ? factoryName.trim() !== (detail.summary.raw.factoryName ?? '')
      || (detail.summary.cargoMode !== 'FCL' && routeId !== (detail.summary.raw.routeId ? String(detail.summary.raw.routeId) : ''))
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
        || (containerRequestMode && requestReason.trim().length > 0)
    : mode === 'route'
    ? containerRouteId !== (line.routeId ? String(line.routeId) : '')
      || liftSiteId !== (line.liftSiteId ? String(line.liftSiteId) : '')
      || dropoffSiteId !== (line.dropoffSiteId ? String(line.dropoffSiteId) : '')
      || (routeRequestMode && requestReason.trim().length > 0)
    : mode === 'vehicle'
      ? carrierId !== initialCarrier || plateNumber.trim() !== (line.plateNumber ?? '') || newCarrierName.trim() !== ''
    : mode === 'schedule'
        ? appointmentScheduleDirty
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
    setSaving(true);
    setSaveError(null);
    try {
      if (mode === 'identity') {
        await onSaveIdentity(row, {
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
        if (containerRequestMode) {
          if (!requestReason.trim()) throw new Error('Vui lòng nhập lý do yêu cầu chỉnh sửa.');
          const fields: Record<string, unknown> = {};
          if (containerNumber.trim().toUpperCase() !== (line.raw.containerNumber ?? '')) {
            fields.containerNumber = containerNumber.trim().toUpperCase() || null;
          }
          if (containerTypeId !== (line.raw.containerTypeId ? String(line.raw.containerTypeId) : '')) {
            fields.containerTypeId = containerTypeId ? Number(containerTypeId) : null;
          }
          if (cargoWeightKg.trim() !== (line.raw.cargoWeightKg ?? '')) {
            fields.cargoWeightKg = cargoWeightKg.trim() || null;
          }
          if (cargoVolumeCbm.trim() !== (line.raw.cargoVolumeCbm ?? '')) {
            fields.cargoVolumeCbm = cargoVolumeCbm.trim() || null;
          }
          if (Object.keys(fields).length === 0) throw new Error('Không có thay đổi nào để gửi yêu cầu.');
          await requestContainerEdit(detail.summary.id, line.id, fields, requestReason.trim());
          setRequestSuccess('Đã gửi yêu cầu chỉnh sửa container. Điều vận sẽ xem xét và phê duyệt.');
          setRequestReason('');
          return;
        } else {
          await onSaveContainer(line, {
            containerNumber: containerNumber.trim().toUpperCase() || null,
            containerTypeId: containerTypeId ? Number(containerTypeId) : null,
            cargoWeightKg: cargoWeightKg.trim() || null,
            cargoVolumeCbm: cargoVolumeCbm.trim() || null,
          });
        }
      } else if (mode === 'route') {
        if (routeRequestMode) {
          if (!requestReason.trim()) throw new Error('Vui lòng nhập lý do yêu cầu chỉnh sửa.');
          const fields: Record<string, unknown> = {};
          if (containerRouteId !== (line.routeId ? String(line.routeId) : '')) {
            fields.routeId = containerRouteId ? Number(containerRouteId) : null;
          }
          if (liftSiteId !== (line.liftSiteId ? String(line.liftSiteId) : '')) {
            fields.liftSiteId = liftSiteId ? Number(liftSiteId) : null;
          }
          if (dropoffSiteId !== (line.dropoffSiteId ? String(line.dropoffSiteId) : '')) {
            fields.dropoffSiteId = dropoffSiteId ? Number(dropoffSiteId) : null;
          }
          if (Object.keys(fields).length === 0) throw new Error('Không có thay đổi nào để gửi yêu cầu.');
          await requestContainerEdit(detail.summary.id, line.id, fields, requestReason.trim());
          setRequestSuccess('Đã gửi yêu cầu chỉnh sửa tuyến đường/địa điểm. Điều vận sẽ xem xét và phê duyệt.');
          setRequestReason('');
          return;
        }
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
        if (scheduleTime && !appointmentDate) throw new Error('Chọn ngày đóng/trả trước khi nhập giờ.');
        if (appointmentDate && !scheduleTime) throw new Error('Vui lòng nhập đầy đủ cả Ngày và Giờ giao hàng.');
        await onSaveSchedule(line, row, {
          transportDate: row.transportDate,
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
        if (event.key === 'Escape' && !saving) {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
          return;
        }
        if (event.key !== 'Enter' || event.nativeEvent.isComposing || !dirty || saving) return;
        const target = event.target as HTMLElement;
        if (target.isContentEditable || target.tagName === 'SELECT' || target.closest('.searchable-select, [role="listbox"], [role="option"]')) return;
        if (event.shiftKey && target.tagName === 'TEXTAREA') return;
        if (event.shiftKey) return;
        event.preventDefault();
        void save();
      }}
    >
      <div className="shipment-container-ledger__editor-heading">
        <strong>Chỉnh sửa {modeLabel}</strong>
        <span>{row.containerNumber || `Container số ${row.ordinal}`}</span>
      </div>
      {mode === 'identity' && (
        <div className="shipment-container-ledger__editor-grid">
          <label><span>Khách hàng</span><input value={row.customerName ?? ''} disabled title={detail.summary.fieldAccess.customerId.reason} /></label>
          <label><span>Nhà máy</span><input autoFocus value={factoryName} onChange={(event) => setFactoryName(event.target.value)} maxLength={255} disabled={saving || detail.summary.fieldAccess.factoryName.mode === 'READ_ONLY'} /></label>
          {detail.summary.cargoMode !== 'FCL' && <label><span>Tuyến đường</span><SearchableSelect id={`shipment-detail-route-${line.id}`} value={routeId} onChange={setRouteId} options={routeOptions} placeholder="Chọn tuyến đường" searchPlaceholder="Tìm tuyến đường" disabled={saving || detail.summary.fieldAccess.routeId.mode === 'READ_ONLY'} /></label>}
          <label><span>Điểm giao</span><input value={deliveryLocation} onChange={(event) => setDeliveryLocation(event.target.value)} maxLength={255} disabled={saving || detail.summary.fieldAccess.deliveryLocation.mode === 'READ_ONLY'} /></label>
        </div>
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
          {containerRequestMode && <small className="shipment-container-ledger__request-notice">Chỉnh sửa sau điều xe — thay đổi sẽ gửi yêu cầu để Điều vận xem xét.</small>}
          <label className={line.fieldAccess.containerNumber.mode === 'REQUEST' ? 'shipment-container-ledger__field--request' : undefined}><span>Số container</span><input autoFocus value={containerNumber} onChange={(event) => setContainerNumber(event.target.value.toUpperCase())} maxLength={20} disabled={saving || line.fieldAccess.containerNumber.mode === 'READ_ONLY'} /></label>
          <label className={line.fieldAccess.containerTypeId.mode === 'REQUEST' ? 'shipment-container-ledger__field--request' : undefined}><span>Loại container</span><SearchableSelect id={`shipment-detail-container-type-${line.id}`} value={containerTypeId} onChange={setContainerTypeId} options={detail.selectors.containerTypes.map((item) => ({ value: String(item.id), label: item.label, searchText: `${item.code} ${item.name}` }))} placeholder="Chọn loại container" searchPlaceholder="Tìm loại container" disabled={saving || line.fieldAccess.containerTypeId.mode === 'READ_ONLY'} /></label>
          <label className={line.fieldAccess.cargoWeightKg.mode === 'REQUEST' ? 'shipment-container-ledger__field--request' : undefined}><span>Trọng lượng (kg)</span><input type="number" min="0" step="0.01" value={cargoWeightKg} onChange={(event) => setCargoWeightKg(event.target.value)} disabled={saving || line.fieldAccess.cargoWeightKg.mode === 'READ_ONLY'} /></label>
          <label className={line.fieldAccess.cargoVolumeCbm.mode === 'REQUEST' ? 'shipment-container-ledger__field--request' : undefined}><span>Thể tích (CBM)</span><input type="number" min="0" step="0.001" value={cargoVolumeCbm} onChange={(event) => setCargoVolumeCbm(event.target.value)} disabled={saving || line.fieldAccess.cargoVolumeCbm.mode === 'READ_ONLY'} /></label>
          {containerRequestMode && (
            <label className="shipment-container-ledger__request-reason"><span>Lý do yêu cầu</span><textarea value={requestReason} onChange={(event) => setRequestReason(event.target.value)} rows={3} maxLength={500} required disabled={saving} placeholder="Nhập lý do cần chỉnh sửa container sau điều xe" /></label>
          )}
        </div>
      )}
      {mode === 'route' && (
        <div className="shipment-container-ledger__editor-grid">
          {routeRequestMode && <small className="shipment-container-ledger__request-notice">Đã qua ngày chạy container hoặc đã có chuyến — thay đổi sẽ gửi yêu cầu để Điều vận xem xét.</small>}
          <label className={line.fieldAccess.routeId.mode === 'REQUEST' ? 'shipment-container-ledger__field--request' : undefined}><span>Tuyến đường</span><SearchableSelect id={`shipment-detail-container-route-${line.id}`} value={containerRouteId} onChange={setContainerRouteId} options={routeOptions} placeholder="Chọn tuyến đường" searchPlaceholder="Tìm tuyến đường" disabled={saving || line.fieldAccess.routeId.mode === 'READ_ONLY'} /></label>
          <label className={line.fieldAccess.liftSiteId.mode === 'REQUEST' ? 'shipment-container-ledger__field--request' : undefined}><span>Cảng nâng</span><SearchableSelect id={`shipment-detail-lift-${line.id}`} value={liftSiteId} onChange={setLiftSiteId} options={siteOptions} placeholder="Chọn cảng nâng" searchPlaceholder="Tìm cảng nâng" disabled={saving || line.fieldAccess.liftSiteId.mode === 'READ_ONLY'} /></label>
          <label className={line.fieldAccess.dropoffSiteId.mode === 'REQUEST' ? 'shipment-container-ledger__field--request' : undefined}><span>Cảng hạ</span><SearchableSelect id={`shipment-detail-dropoff-${line.id}`} value={dropoffSiteId} onChange={setDropoffSiteId} options={siteOptions} placeholder="Chọn cảng hạ" searchPlaceholder="Tìm cảng hạ" disabled={saving || line.fieldAccess.dropoffSiteId.mode === 'READ_ONLY'} /></label>
          {routeRequestMode && (
            <label className="shipment-container-ledger__request-reason"><span>Lý do yêu cầu</span><textarea value={requestReason} onChange={(event) => setRequestReason(event.target.value)} rows={3} maxLength={500} required disabled={saving} placeholder="Nhập lý do cần chỉnh sửa tuyến đường/địa điểm sau ngày chạy" /></label>
          )}
        </div>
      )}
      {mode === 'vehicle' && (
        <div className="shipment-container-ledger__editor-grid">
          <label><span>Nhà xe</span><SearchableSelect id={`shipment-detail-carrier-${line.id}`} value={carrierId} onChange={(value) => { setCarrierId(value); setPlateNumber(''); }} options={carrierOptions} placeholder="Chọn nhà xe" searchPlaceholder="Tìm nhà xe" disabled={saving || !line.permissions.carrierEditable} /></label>
          {carrierId === 'NEW_EXTERNAL' && <label><span>Tên nhà xe mới</span><input value={newCarrierName} onChange={(event) => setNewCarrierName(event.target.value)} maxLength={255} disabled={saving} /></label>}
          {carrierId && carrierId !== 'OWN' && carrierId !== 'NEW_EXTERNAL' && vehicleOptions.length > 0 && <label><span>Biển số đã lưu</span><SearchableSelect id={`shipment-detail-vehicle-${line.id}`} value={matchedVehicle ? String(matchedVehicle.id) : ''} onChange={(value) => { const vehicle = detail.selectors.carrierVehicles.find((item) => item.id === Number(value)); setPlateNumber(vehicle?.licensePlate ?? ''); }} options={vehicleOptions} placeholder="Chọn biển số" searchPlaceholder="Tìm biển số" disabled={saving || !line.permissions.plateEditable} /></label>}
          <label><span>Biển số xe</span><input value={plateNumber} onChange={(event) => setPlateNumber(event.target.value.toUpperCase())} maxLength={20} disabled={saving || !line.permissions.plateEditable} /></label>
          {carrierId === 'OWN' && <small>Biển số nội bộ nhập ở đây là kế hoạch (dự kiến); lệnh điều xe chính thức vẫn là nguồn xác nhận cuối.</small>}
          {carrierId !== 'OWN' && carrierId && <small>Biển số nhập ở đây là kế hoạch (dự kiến) cho nhà xe thuê; lệnh điều xe chính thức vẫn là nguồn xác nhận cuối.</small>}
        </div>
      )}
      {mode === 'schedule' && (
        <div className="shipment-container-ledger__editor-grid shipment-container-ledger__editor-grid--schedule">
          <label><span>{row.direction === 'IMPORT' ? 'Ngày trả hàng' : 'Ngày đóng hàng'}</span><DateInput value={appointmentDate} onChange={setAppointmentDate} disabled={saving || !line.permissions.customerAppointmentEditable} /></label>
          <label><span>{row.direction === 'IMPORT' ? 'Giờ trả hàng' : 'Giờ đóng hàng'}</span><input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} disabled={saving || !line.permissions.customerAppointmentEditable} /></label>
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
        <span className="shipment-container-ledger__keyboard-hint">Enter để lưu · Esc để hủy</span>
        <EditActions saving={saving} saveDisabled={!dirty || (containerRequestMode && !requestReason.trim()) || (routeRequestMode && !requestReason.trim()) || (mode === 'schedule' && appointmentScheduleDirty && ((!!appointmentDate && !scheduleTime) || (!appointmentDate && !!scheduleTime)))} label={label} onSave={() => void save()} onCancel={onCancel} />
      </div>
      {edit.recoveryMessage && <span className="shipment-container-ledger__recovery" role="status">{edit.recoveryMessage}</span>}
      {saveError && <span className="shipment-container-ledger__edit-error" role="alert">{saveError}</span>}
      {requestSuccess && <span className="shipment-container-ledger__request-success" role="status">{requestSuccess}</span>}
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
              const identityEditable = ['factoryName', 'routeId', 'deliveryLocation'].some((field) => row.shipmentFieldAccess[field as 'factoryName'].mode !== 'READ_ONLY');
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
                    {editableCell(row, 'schedule', row.customerAppointmentEditable, <div className="shipment-container-ledger__multiline shipment-container-ledger__schedule">
                      {missingDate && <Badge size="sm" color="warning" className="shipment-container-ledger__schedule-gap"><CalendarOff aria-hidden="true" />Thiếu ngày vận chuyển</Badge>}
                      <strong>{appointmentInput ? formatDate(appointmentInput.slice(0, 10)) : 'Chưa có lịch hẹn'}</strong><span>{appointmentInput ? `${scheduleTime ? `${scheduleTime} · ` : ''}${row.direction === 'IMPORT' ? 'trả hàng' : 'đóng hàng'}` : 'Cập nhật theo từng container'}</span></div>)}
                  </td>
                  <td data-label="Phân xe" className={cellClassName(vehicleEditable, 'vehicle', missingVehicleToday ? 'shipment-container-ledger__vehicle-pending' : undefined)}>
                    {editableCell(row, 'vehicle', vehicleEditable, <div className="shipment-container-ledger__multiline shipment-container-ledger__vehicle">
                      {missingVehicleToday && <Badge size="sm" color="warning" className="shipment-container-ledger__vehicle-state"><Clock3 aria-hidden="true" />Chưa điều xe</Badge>}
                      <strong>{row.carrierName || <span className="shipment-container-ledger__missing">Chưa phân nhà xe</span>}</strong>
                      {row.plateNumber
                        ? <span className="shipment-container-ledger__plate">{row.plateNumber}</span>
                        : <BadgeWithDot size="sm" color="warning" className="shipment-container-ledger__plate--missing">Chưa gán biển số</BadgeWithDot>}
                      {missingVehicleToday && <small className="shipment-container-ledger__vehicle-guidance">Phối hợp Điều vận hoặc tự phân xe trước giờ chạy.</small>}
                    </div>)}
                  </td>
                  <td data-label="Ghi chú" className={cellClassName(row.shipmentNotesEditable, 'notes')}>
                    {editableCell(row, 'notes', row.shipmentNotesEditable, <div className="shipment-container-ledger__multiline shipment-container-ledger__notes">
                      {row.customerNotes && <strong>{row.customerNotes}</strong>}
                      {row.operationalNotes && <span>{row.operationalNotes}</span>}
                      {!row.customerNotes && !row.operationalNotes && <span className="shipment-container-ledger__missing">—</span>}
                    </div>)}
                  </td>
                  <td data-label="Trạng thái" className="shipment-container-ledger__cell--status">
                    <div className="shipment-container-ledger__multiline">
                      <span className={`shipment-container-ledger__dispatch-badge shipment-container-ledger__dispatch-badge--${row.dispatchStatus.toLowerCase()}`}>{DISPATCH_STATUS[row.dispatchStatus].label}</span>
                      {row.informationStatus === 'MISSING' && (
                        <span className="shipment-container-ledger__row-warning shipment-container-ledger__missing-fields">
                          <AlertTriangle aria-hidden="true" />
                          <span className="shipment-container-ledger__missing-fields-text">
                            <span className="shipment-container-ledger__missing-fields-label">Chưa cập nhật:</span>
                            <span className="shipment-container-ledger__missing-fields-list" role="list" aria-label="Thông tin còn thiếu">
                              {row.missingFields.map((field) => <span key={field.code} role="listitem">{field.label}</span>)}
                            </span>
                          </span>
                        </span>
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
