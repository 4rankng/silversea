import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, LoaderCircle, PencilLine, Save, X } from 'lucide-react';
import type {
  ShipmentCusContainerFlatRow,
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import { BadgeWithDot } from '../../../components/untitled-ui/base/badges/badges';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { TextArea as UUITextArea } from '../../../components/untitled-ui/base/textarea/textarea';
import { SearchableSelect } from '../../../design-system';
import { formatVietnamDateTimeInput } from '../../../lib/shipment-operations';

export type ShipmentDetailEditMode = 'route' | 'schedule' | 'vehicle' | 'notes';

export interface ActiveShipmentDetailEdit {
  row: ShipmentCusContainerFlatRow;
  detail: ShipmentCusWorkspaceDetail;
  line: ShipmentCusWorkspaceContainerLine;
  mode: ShipmentDetailEditMode;
  recoveryMessage?: string;
}

export interface ShipmentRouteDraft {
  liftSiteId: number | null;
  dropoffSiteId: number | null;
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
  scheduleAt: string | null;
  customerAppointmentAt: string | null;
}

export interface ShipmentNotesDraft {
  customerNotes: string | null;
  operationalNotes: string | null;
}

type DispatchStatus = ShipmentCusContainerFlatRow['dispatchStatus'];
const DISPATCH_STATUS: Record<DispatchStatus, { label: string; color: 'warning' | 'brand' | 'blue' | 'success' }> = {
  UNASSIGNED: { label: 'Chưa điều xe', color: 'warning' },
  PLANNED: { label: 'Đã phân xe', color: 'brand' },
  CREATED: { label: 'Đã tạo chuyến', color: 'blue' },
  IN_TRANSIT: { label: 'Đang vận chuyển', color: 'blue' },
  COMPLETED: { label: 'Hoàn thành', color: 'success' },
};

function directionLabel(direction: ShipmentCusContainerFlatRow['direction']): string {
  if (direction === 'IMPORT') return 'Nhập';
  if (direction === 'EXPORT') return 'Xuất';
  return 'Chưa xác định';
}

function formatDate(value: string | null): string {
  if (!value) return 'Chưa có ngày';
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatScheduleTime(row: ShipmentCusContainerFlatRow): string | null {
  const value = row.direction === 'IMPORT' ? row.plannedReturnAt : row.closingAt;
  const input = formatVietnamDateTimeInput(value);
  return input ? input.slice(11, 16) : null;
}

function formatAppointment(value: string | null): string | null {
  const input = formatVietnamDateTimeInput(value);
  if (!input) return null;
  const [date, time] = input.split('T');
  const [year, month, day] = date?.split('-') ?? [];
  return year && month && day && time ? `${day}/${month}/${year} ${time}` : input;
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
        size="sm"
        color="primary"
        onPress={onSave}
        isDisabled={saveDisabled || saving}
        isLoading={saving}
        showTextWhileLoading
        iconLeading={!saving ? <Save aria-hidden="true" /> : undefined}
        aria-label={`Lưu ${label}`}
      >Lưu</UUIButton>
      <UUIButton
        size="sm"
        color="secondary"
        onPress={onCancel}
        isDisabled={saving}
        iconLeading={<X aria-hidden="true" />}
        aria-label={`Hủy ${label}`}
      >Hủy</UUIButton>
    </div>
  );
}

function InlineEditor({
  edit,
  onCancel,
  onSaveRoute,
  onSaveVehicle,
  onSaveSchedule,
  onSaveNotes,
}: {
  edit: ActiveShipmentDetailEdit;
  onCancel: () => void;
  onSaveRoute: (line: ShipmentCusWorkspaceContainerLine, draft: ShipmentRouteDraft) => Promise<void>;
  onSaveVehicle: (line: ShipmentCusWorkspaceContainerLine, draft: ShipmentVehicleDraft) => Promise<void>;
  onSaveSchedule: (line: ShipmentCusWorkspaceContainerLine, row: ShipmentCusContainerFlatRow, draft: ShipmentScheduleDraft) => Promise<void>;
  onSaveNotes: (row: ShipmentCusContainerFlatRow, draft: ShipmentNotesDraft) => Promise<void>;
}) {
  const { detail, line, mode, row } = edit;
  const [liftSiteId, setLiftSiteId] = useState(line.liftSiteId ? String(line.liftSiteId) : '');
  const [dropoffSiteId, setDropoffSiteId] = useState(line.dropoffSiteId ? String(line.dropoffSiteId) : '');
  const initialCarrier = line.carrierType === 'OWN'
    ? 'OWN'
    : line.externalCarrierId ? String(line.externalCarrierId) : '';
  const [carrierId, setCarrierId] = useState(initialCarrier);
  const [newCarrierName, setNewCarrierName] = useState('');
  const [plateNumber, setPlateNumber] = useState(line.plateNumber ?? '');
  const [transportDate, setTransportDate] = useState(row.transportDate ?? '');
  const [scheduleTime, setScheduleTime] = useState(formatScheduleTime(row) ?? '');
  const [customerAppointmentAt, setCustomerAppointmentAt] = useState(formatVietnamDateTimeInput(line.customerAppointmentAt));
  const [customerNotes, setCustomerNotes] = useState(row.customerNotes ?? '');
  const [operationalNotes, setOperationalNotes] = useState(row.operationalNotes ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const siteOptions = useMemo(() => detail.selectors.operationalSites.map((site) => ({
    value: String(site.id), label: site.label, searchText: `${site.code} ${site.name}`,
  })), [detail.selectors.operationalSites]);
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
  const dirty = mode === 'route'
    ? liftSiteId !== (line.liftSiteId ? String(line.liftSiteId) : '')
      || dropoffSiteId !== (line.dropoffSiteId ? String(line.dropoffSiteId) : '')
    : mode === 'vehicle'
      ? carrierId !== initialCarrier || plateNumber.trim() !== (line.plateNumber ?? '') || newCarrierName.trim() !== ''
      : mode === 'schedule'
        ? transportDate !== (row.transportDate ?? '')
          || scheduleTime !== (formatScheduleTime(row) ?? '')
          || customerAppointmentAt !== formatVietnamDateTimeInput(line.customerAppointmentAt)
        : customerNotes.trim() !== (row.customerNotes ?? '').trim()
          || operationalNotes.trim() !== (row.operationalNotes ?? '').trim();
  const label = `${mode === 'route' ? 'hành trình' : mode === 'vehicle' ? 'phân xe' : mode === 'schedule' ? 'lịch trình' : 'ghi chú'} ${row.containerNumber || `container số ${row.ordinal}`}`;

  useEffect(() => {
    editorRef.current?.focus();
  }, []);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      if (mode === 'route') {
        await onSaveRoute(line, {
          liftSiteId: liftSiteId ? Number(liftSiteId) : null,
          dropoffSiteId: dropoffSiteId ? Number(dropoffSiteId) : null,
        });
      } else if (mode === 'vehicle') {
        if (carrierId === 'OWN') {
          await onSaveVehicle(line, {
            carrierType: 'OWN',
            externalCarrierId: null,
            externalCarrierVehicleId: null,
            plateNumber: null,
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
        if (scheduleTime && !transportDate) throw new Error('Chọn ngày vận chuyển trước khi nhập giờ.');
        await onSaveSchedule(line, row, {
          transportDate: transportDate || null,
          scheduleAt: transportDate && scheduleTime ? `${transportDate}T${scheduleTime}` : null,
          customerAppointmentAt: customerAppointmentAt || null,
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
      ref={editorRef}
      className="shipment-container-ledger__inline-editor"
      tabIndex={-1}
      onKeyDown={(event) => { if (event.key === 'Escape' && !saving) onCancel(); }}
    >
      {mode === 'route' && (
        <div className="shipment-container-ledger__editor-grid">
          <label><span>Điểm nâng</span><SearchableSelect id={`shipment-detail-lift-${line.id}`} value={liftSiteId} onChange={setLiftSiteId} options={siteOptions} placeholder="Chọn điểm nâng" searchPlaceholder="Tìm điểm nâng" disabled={saving || !line.permissions.liftSiteEditable} /></label>
          <label><span>Điểm hạ</span><SearchableSelect id={`shipment-detail-dropoff-${line.id}`} value={dropoffSiteId} onChange={setDropoffSiteId} options={siteOptions} placeholder="Chọn điểm hạ" searchPlaceholder="Tìm điểm hạ" disabled={saving || !line.permissions.dropoffSiteEditable} /></label>
        </div>
      )}
      {mode === 'vehicle' && (
        <div className="shipment-container-ledger__editor-grid">
          <label><span>Nhà xe</span><SearchableSelect id={`shipment-detail-carrier-${line.id}`} value={carrierId} onChange={(value) => { setCarrierId(value); setPlateNumber(''); }} options={carrierOptions} placeholder="Chọn nhà xe" searchPlaceholder="Tìm nhà xe" disabled={saving || !line.permissions.carrierEditable} /></label>
          {carrierId === 'NEW_EXTERNAL' && <label><span>Tên nhà xe mới</span><input value={newCarrierName} onChange={(event) => setNewCarrierName(event.target.value)} maxLength={255} disabled={saving} /></label>}
          {carrierId && carrierId !== 'OWN' && carrierId !== 'NEW_EXTERNAL' && vehicleOptions.length > 0 && <label><span>Biển số đã lưu</span><SearchableSelect id={`shipment-detail-vehicle-${line.id}`} value={matchedVehicle ? String(matchedVehicle.id) : ''} onChange={(value) => { const vehicle = detail.selectors.carrierVehicles.find((item) => item.id === Number(value)); setPlateNumber(vehicle?.licensePlate ?? ''); }} options={vehicleOptions} placeholder="Chọn biển số" searchPlaceholder="Tìm biển số" disabled={saving || !line.permissions.plateEditable} /></label>}
          {carrierId !== 'OWN' && <label><span>Biển số xe</span><input value={plateNumber} onChange={(event) => setPlateNumber(event.target.value.toUpperCase())} maxLength={20} disabled={saving || !line.permissions.plateEditable} /></label>}
          {carrierId === 'OWN' && <small>Biển số xe nội bộ được xác định từ lệnh điều xe chính thức.</small>}
        </div>
      )}
      {mode === 'schedule' && (
        <div className="shipment-container-ledger__editor-grid shipment-container-ledger__editor-grid--schedule">
          <label><span>Ngày vận chuyển</span><input type="date" value={transportDate} onChange={(event) => setTransportDate(event.target.value)} disabled={saving || !row.shipmentScheduleEditable} /></label>
          <label><span>{row.direction === 'IMPORT' ? 'Giờ trả hàng' : 'Giờ đóng hàng'}</span><input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} disabled={saving || !row.shipmentScheduleEditable} /></label>
          <label><span>Giờ hẹn khách</span><input type="datetime-local" value={customerAppointmentAt} onChange={(event) => setCustomerAppointmentAt(event.target.value)} disabled={saving || !line.permissions.customerAppointmentEditable} /></label>
          <small>Thay đổi áp dụng cho toàn bộ container trong lô hàng này.</small>
        </div>
      )}
      {mode === 'notes' && (
        <div className="shipment-container-ledger__editor-grid">
          <UUITextArea label="Ghi chú thu khách" size="sm" rows={2} maxLength={2000} value={customerNotes} onChange={setCustomerNotes} isDisabled={saving} />
          <UUITextArea label="Ghi chú điều xe" size="sm" rows={2} maxLength={2000} value={operationalNotes} onChange={setOperationalNotes} isDisabled={saving} />
          <small>Thay đổi áp dụng cho toàn bộ container trong lô hàng này.</small>
        </div>
      )}
      <EditActions saving={saving} saveDisabled={!dirty} label={label} onSave={() => void save()} onCancel={onCancel} />
      <small className="shipment-container-ledger__escape-hint">Nhấn Escape để hủy.</small>
      {edit.recoveryMessage && <span className="shipment-container-ledger__recovery" role="status">{edit.recoveryMessage}</span>}
      {saveError && <span className="shipment-container-ledger__edit-error" role="alert">{saveError}</span>}
    </div>
  );
}

interface ShipmentContainerLedgerProps {
  rows: ShipmentCusContainerFlatRow[];
  totalContainers: number;
  today: string;
  activeEdit: ActiveShipmentDetailEdit | null;
  editLoadingRowId: number | null;
  editError: { rowId: number; message: string } | null;
  onStartEdit: (row: ShipmentCusContainerFlatRow, mode: ShipmentDetailEditMode, triggerId: string) => void;
  onCancelEdit: () => void;
  onSaveRoute: (line: ShipmentCusWorkspaceContainerLine, draft: ShipmentRouteDraft) => Promise<void>;
  onSaveVehicle: (line: ShipmentCusWorkspaceContainerLine, draft: ShipmentVehicleDraft) => Promise<void>;
  onSaveSchedule: (line: ShipmentCusWorkspaceContainerLine, row: ShipmentCusContainerFlatRow, draft: ShipmentScheduleDraft) => Promise<void>;
  onSaveNotes: (row: ShipmentCusContainerFlatRow, draft: ShipmentNotesDraft) => Promise<void>;
}

export function ShipmentContainerLedger({
  rows,
  totalContainers,
  today,
  activeEdit,
  editLoadingRowId,
  editError,
  onStartEdit,
  onCancelEdit,
  onSaveRoute,
  onSaveVehicle,
  onSaveSchedule,
  onSaveNotes,
}: ShipmentContainerLedgerProps) {
  const missingDateCount = rows.filter((row) => row.transportDate == null).length;
  const missingVehicleTodayCount = rows.filter((row) => row.transportDate === today && (!row.carrierName || !row.plateNumber)).length;
  const editButton = (row: ShipmentCusContainerFlatRow, mode: ShipmentDetailEditMode, enabled: boolean) => {
    if (!enabled) return null;
    const triggerId = `shipment-detail-edit-${mode}-${row.id}`;
    const busy = editLoadingRowId === row.id;
    return (
      <UUIButton
        id={triggerId}
        size="sm"
        color="tertiary"
        className="shipment-container-ledger__edit-trigger"
        onPress={() => onStartEdit(row, mode, triggerId)}
        isDisabled={busy || activeEdit != null}
        iconLeading={busy ? <LoaderCircle className="shipment-container-ledger__spinner" aria-hidden="true" /> : <PencilLine aria-hidden="true" />}
        aria-label={`Chỉnh sửa ${mode === 'route' ? 'điểm nâng hạ' : mode === 'vehicle' ? 'phân xe' : mode === 'schedule' ? 'lịch trình' : 'ghi chú'} ${row.containerNumber || `container số ${row.ordinal}`}`}
      >{busy ? 'Đang mở' : 'Sửa'}</UUIButton>
    );
  };

  return (
    <>
      <dl className="shipment-container-summary" aria-label="Tóm tắt container trên trang">
        <div><dt>Container trên trang</dt><dd>{rows.length.toLocaleString('vi-VN')}</dd></div>
        <div><dt>Tổng container phù hợp</dt><dd>{totalContainers.toLocaleString('vi-VN')}</dd></div>
        <div className={missingDateCount ? 'shipment-container-summary__attention' : ''}><dt>Thiếu ngày vận chuyển</dt><dd>{missingDateCount.toLocaleString('vi-VN')}</dd></div>
        <div className={missingVehicleTodayCount ? 'shipment-container-summary__danger' : ''}><dt>Hôm nay thiếu xe</dt><dd>{missingVehicleTodayCount.toLocaleString('vi-VN')}</dd></div>
      </dl>
      <div className="shipment-container-ledger" role="region" aria-label="Bảng chi tiết container theo lô hàng" tabIndex={0}>
        <table>
          <caption>Chi tiết container theo bảy nhóm thông tin nghiệp vụ</caption>
          <colgroup>
            <col className="shipment-container-ledger__col--customer" />
            <col className="shipment-container-ledger__col--documents" />
            <col className="shipment-container-ledger__col--container" />
            <col className="shipment-container-ledger__col--route" />
            <col className="shipment-container-ledger__col--schedule" />
            <col className="shipment-container-ledger__col--vehicle" />
            <col className="shipment-container-ledger__col--notes" />
          </colgroup>
          <thead><tr>
            <th scope="col">Khách hàng &amp; lộ trình</th>
            <th scope="col">Chứng từ &amp; hãng tàu</th>
            <th scope="col">Thông số container</th>
            <th scope="col">Địa điểm nâng / hạ</th>
            <th scope="col">Lịch trình</th>
            <th scope="col">Phân xe</th>
            <th scope="col">Ghi chú</th>
          </tr></thead>
          <tbody>
            {rows.map((row) => {
              const edit = activeEdit?.row.id === row.id ? activeEdit : null;
              const missingDate = row.transportDate == null;
              const missingVehicleToday = row.transportDate === today && (!row.carrierName || !row.plateNumber);
              const scheduleTime = formatScheduleTime(row);
              const appointment = formatAppointment(row.customerAppointmentAt);
              return (
                <tr key={row.id} className={missingDate ? 'shipment-container-ledger__row--missing-date' : undefined}>
                  <th scope="row" data-label="Khách hàng & lộ trình">
                    {missingDate && <span className="shipment-container-ledger__row-warning"><AlertTriangle aria-hidden="true" /> Thiếu ngày vận chuyển</span>}
                    <div className="shipment-container-ledger__multiline">
                      <strong>{fallback(row.customerName, 'Chưa có khách hàng')}</strong>
                      <span>{fallback(row.factoryName, 'Chưa có nhà máy')}</span>
                      <em>{fallback(row.routeName, 'Chưa có tuyến đường')}</em>
                    </div>
                  </th>
                  <td data-label="Chứng từ & hãng tàu">
                    <div className="shipment-container-ledger__multiline">
                      <strong className="shipment-container-ledger__code">{fallback(row.billOrBookNumber, 'Chưa có Bill/Booking')}</strong>
                      <span className="shipment-container-ledger__code">{fallback(row.declarationNumber, 'Chưa có tờ khai')}</span>
                      <span><b className={`shipment-container-ledger__direction shipment-container-ledger__direction--${row.direction?.toLowerCase() ?? 'unknown'}`}>{directionLabel(row.direction)}</b> · {fallback(row.shippingLineName, 'Chưa có hãng tàu')}</span>
                    </div>
                  </td>
                  <td data-label="Thông số container">
                    <div className="shipment-container-ledger__multiline">
                      <strong className="shipment-container-ledger__code">{fallback(row.containerNumber, `Container số ${row.ordinal}`)}</strong>
                      <span>{fallback(row.containerTypeLabel, 'Chưa rõ loại container')}</span>
                      {row.isCombined && <span className="shipment-container-ledger__combined">Hàng kết hợp</span>}
                      <BadgeWithDot size="sm" color={DISPATCH_STATUS[row.dispatchStatus].color}>{DISPATCH_STATUS[row.dispatchStatus].label}</BadgeWithDot>
                    </div>
                  </td>
                  <td data-label="Địa điểm nâng / hạ" className={edit?.mode === 'route' ? 'shipment-container-ledger__editing-cell' : undefined}>
                    {edit?.mode === 'route' ? <InlineEditor key={`${edit.mode}-${edit.detail.summary.version}-${edit.line.shipmentVersion}`} edit={edit} onCancel={onCancelEdit} onSaveRoute={onSaveRoute} onSaveVehicle={onSaveVehicle} onSaveSchedule={onSaveSchedule} onSaveNotes={onSaveNotes} /> : <>
                      <div className="shipment-container-ledger__route"><span><small>Nâng</small>{fallback(row.liftSite, 'Chưa cập nhật')}</span><i aria-hidden="true">→</i><span><small>Hạ</small>{fallback(row.dropoffSite, 'Chưa cập nhật')}</span></div>
                      {editButton(row, 'route', row.liftSiteEditable || row.dropoffSiteEditable)}
                    </>}
                    {editError?.rowId === row.id && <span className="shipment-container-ledger__edit-error" role="alert">{editError.message}</span>}
                  </td>
                  <td data-label="Lịch trình" className={edit?.mode === 'schedule' ? 'shipment-container-ledger__editing-cell' : undefined}>
                    {edit?.mode === 'schedule' ? <InlineEditor key={`${edit.mode}-${edit.detail.summary.version}-${edit.line.shipmentVersion}`} edit={edit} onCancel={onCancelEdit} onSaveRoute={onSaveRoute} onSaveVehicle={onSaveVehicle} onSaveSchedule={onSaveSchedule} onSaveNotes={onSaveNotes} /> : <>
                      <div className="shipment-container-ledger__multiline shipment-container-ledger__schedule"><strong>{formatDate(row.transportDate)}</strong><span>{scheduleTime ? `${scheduleTime} · ${row.direction === 'IMPORT' ? 'trả hàng' : 'đóng hàng'}` : 'Chưa có giờ đóng/trả'}</span><span>{appointment ? `Hẹn khách · ${appointment}` : 'Chưa có giờ hẹn khách'}</span></div>
                      {editButton(row, 'schedule', row.shipmentScheduleEditable || row.customerAppointmentEditable)}
                    </>}
                  </td>
                  <td data-label="Phân xe" className={`${missingVehicleToday ? 'shipment-container-ledger__vehicle-alert' : ''}${edit?.mode === 'vehicle' ? ' shipment-container-ledger__editing-cell' : ''}`}>
                    {edit?.mode === 'vehicle' ? <InlineEditor key={`${edit.mode}-${edit.detail.summary.version}-${edit.line.shipmentVersion}`} edit={edit} onCancel={onCancelEdit} onSaveRoute={onSaveRoute} onSaveVehicle={onSaveVehicle} onSaveSchedule={onSaveSchedule} onSaveNotes={onSaveNotes} /> : <>
                      <div className="shipment-container-ledger__multiline"><strong>{fallback(row.carrierName, 'Chưa có nhà xe')}</strong><span className="shipment-container-ledger__plate">{fallback(row.plateNumber, 'Chưa có biển số')}</span>{missingVehicleToday && <small className="shipment-container-ledger__vehicle-guidance">Cần phối hợp Điều vận hoặc tự điền xe trước giờ chạy.</small>}</div>
                      {editButton(row, 'vehicle', row.carrierEditable || row.plateEditable)}
                    </>}
                  </td>
                  <td data-label="Ghi chú" className={edit?.mode === 'notes' ? 'shipment-container-ledger__editing-cell' : undefined}>
                    {edit?.mode === 'notes' ? <InlineEditor key={`${edit.mode}-${edit.detail.summary.version}-${edit.line.shipmentVersion}`} edit={edit} onCancel={onCancelEdit} onSaveRoute={onSaveRoute} onSaveVehicle={onSaveVehicle} onSaveSchedule={onSaveSchedule} onSaveNotes={onSaveNotes} /> : <>
                      <div className="shipment-container-ledger__multiline"><strong>{fallback(row.customerNotes, 'Chưa có ghi chú thu khách')}</strong><span>{fallback(row.operationalNotes, 'Chưa có ghi chú điều xe')}</span></div>
                      {editButton(row, 'notes', row.shipmentNotesEditable)}
                    </>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
