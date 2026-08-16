import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  CircleCheck,
  CircleDollarSign,
  Download,
  FileLock2,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Search,
  Truck,
  X,
} from 'lucide-react';
import {
  SHIPMENT_CUS_BUCKET_LABELS,
  SHIPMENT_DOCUMENT_CUSTODY_LABELS,
  ShipmentCusBucket,
  ShipmentDocumentCustody,
  Role,
  type ShipmentCusWorkspaceContainerLine,
  type ShipmentCusWorkspaceDetail,
  type ShipmentCusWorkspaceListItem,
  type ShipmentCusWorkspaceListResponse,
} from '@tingting/shared';
import { ApiError } from '../lib/api';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { StatusStrip, StatusSwatch } from '../components/shared/StatusStrip';
import { Drawer, Modal, PageHeader } from '../components/UI';
import { Button as UUIButton } from '../components/untitled-ui/base/buttons/button';
import { Input as UUIInput } from '../components/untitled-ui/base/input/input';
import { NativeSelect as UUINativeSelect } from '../components/untitled-ui/base/select/select-native';
import { EmptyState, Pagination, SearchableSelect } from '../design-system';
import {
  getCusShipmentWorkspaceDetail,
  confirmCusShipmentFinance,
  listCusShipmentWorkspace,
  lockCusShipment,
  requestCusShipmentReopen,
  updateCusShipmentContainerLine,
  updateCusShipmentDocumentCustody,
  updateShipment,
} from '../api/shipmentClient';
import { downloadCSV } from '../lib/csv';
import { routes } from '../lib/routes';
import { useAuth } from '../hooks/useAuth';
import '../styles/operational-table-typography.css';
import './ShipmentsPage.css';

const PAGE_SIZE = 20;
const SEARCH_PATTERN = /^[A-Za-z0-9]{4,5}$/;
const BUCKETS = Object.values(ShipmentCusBucket);
const SHIPMENT_BUCKET_COLORS: Record<ShipmentCusBucket, string> = {
  [ShipmentCusBucket.NEW]: 'var(--ink-3)',
  [ShipmentCusBucket.RUNNING]: 'var(--accent)',
  [ShipmentCusBucket.PENDING_LOCK]: 'var(--warning)',
  [ShipmentCusBucket.LOCKED]: 'var(--slate-4)',
};

function formatMoney(value: string | null): string {
  if (value == null) return '—';
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(amount)
    : '—';
}

function formatQuantity(value: string | null, maximumFractionDigits = 2): string {
  if (value == null || value === '') return '—';
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits }).format(amount)
    : value;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN');
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

function directionLabel(direction: ShipmentCusWorkspaceListItem['direction']): string {
  if (direction === 'IMPORT') return 'Nhập';
  if (direction === 'EXPORT') return 'Xuất';
  return '—';
}

function worksheetQuantity(item: ShipmentCusWorkspaceListItem): string {
  if (item.operational.totalContainers > 0) {
    return `${item.operational.totalContainers.toLocaleString('vi-VN')} cont`;
  }
  if (item.packageCount != null) {
    return `${item.packageCount.toLocaleString('vi-VN')} ${item.packageType || 'kiện'}`;
  }
  return '—';
}

function scheduleTimestamp(item: ShipmentCusWorkspaceListItem): string | null {
  return item.direction === 'IMPORT' ? item.plannedReturnAt : item.closingAt;
}

function scheduleTime(item: ShipmentCusWorkspaceListItem): string {
  const value = scheduleTimestamp(item);
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function vehicleReadinessLabel(item: ShipmentCusWorkspaceListItem): string {
  const { totalContainers, plateAssignedContainers, vehicleReadiness } = item.operational;
  if (vehicleReadiness === 'READY') return 'Đã phân xe';
  if (vehicleReadiness === 'NO_CONTAINERS') return 'Không áp dụng điều xe';
  const waiting = Math.max(0, totalContainers - plateAssignedContainers);
  if (waiting >= totalContainers) return 'Toàn bộ chưa phân xe';
  return `${waiting.toLocaleString('vi-VN')} cont chưa phân xe`;
}

function noteLines(note: string | null | undefined): string[] {
  return (note ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 2);
}

interface ShipmentQuickEditDraft {
  shipmentId: number;
  field: 'identity' | 'documents' | 'classification' | 'cargo' | 'schedule' | 'notes';
  date: string;
  time: string;
  customerNote: string;
  operationalNote: string;
  factoryName: string;
  blNumber: string;
  bookingRef: string;
  tradeDirection: '' | 'IMPORT' | 'EXPORT';
  shippingLineName: string;
  packageCount: string;
  packageType: string;
  cargoWeightKg: string;
  cargoVolumeCbm: string;
}

function quickEditTitle(field: ShipmentQuickEditDraft['field']): string {
  const labels: Record<ShipmentQuickEditDraft['field'], string> = {
    identity: 'Khách hàng & nhà máy',
    documents: 'Chứng từ',
    classification: 'Phân loại & hãng tàu',
    cargo: 'Tổng quan hàng hóa',
    schedule: 'Lịch trình',
    notes: 'Ghi chú',
  };
  return `Chỉnh sửa ${labels[field]}`;
}

function ShipmentQuickEditFields({
  draft,
  item,
  saving,
  error,
  onChange,
}: {
  draft: ShipmentQuickEditDraft;
  item: ShipmentCusWorkspaceListItem;
  saving: boolean;
  error: string | null;
  onChange: (draft: ShipmentQuickEditDraft) => void;
}) {
  const update = (patch: Partial<ShipmentQuickEditDraft>) => onChange({ ...draft, ...patch });

  return (
    <div className="cus-quick-edit-modal__fields">
      {draft.field === 'identity' && <>
        <label className="cus-quick-edit-modal__field--full"><span>Khách hàng</span><div className="cus-quick-edit-modal__readonly" title={item.customerName ?? item.fieldAccess.customerId.reason}>{item.customerName ?? '—'}</div></label>
        <label className="cus-quick-edit-modal__field--full"><span>Nhà máy</span><input autoFocus value={draft.factoryName} onChange={(event) => update({ factoryName: event.target.value })} maxLength={255} disabled={saving} /></label>
      </>}
      {draft.field === 'documents' && <>
        <label><span>Số Bill</span><input autoFocus value={draft.blNumber} onChange={(event) => update({ blNumber: event.target.value })} maxLength={100} disabled={saving} /></label>
        <label><span>Số Booking</span><input value={draft.bookingRef} onChange={(event) => update({ bookingRef: event.target.value })} maxLength={100} disabled={saving} /></label>
        <p className="cus-quick-edit-modal__help">Tờ khai được quản lý trong hồ sơ chứng từ.</p>
      </>}
      {draft.field === 'classification' && <>
        <label><span>Xuất / Nhập</span><select autoFocus value={draft.tradeDirection} onChange={(event) => update({ tradeDirection: event.target.value as ShipmentQuickEditDraft['tradeDirection'] })} disabled={saving}><option value="">Chưa xác định</option><option value="IMPORT">Nhập</option><option value="EXPORT">Xuất</option></select></label>
        <label><span>Hãng tàu</span><input value={draft.shippingLineName} onChange={(event) => update({ shippingLineName: event.target.value })} maxLength={255} disabled={saving} /></label>
      </>}
      {draft.field === 'cargo' && <>
        <label><span>Số kiện</span><input autoFocus type="number" min="1" value={draft.packageCount} onChange={(event) => update({ packageCount: event.target.value })} disabled={saving || item.fieldAccess.packageCount.mode === 'READ_ONLY'} /></label>
        <label><span>Loại kiện</span><input value={draft.packageType} onChange={(event) => update({ packageType: event.target.value })} maxLength={100} disabled={saving || item.fieldAccess.packageType.mode === 'READ_ONLY'} /></label>
        <label><span>Trọng lượng (kg)</span><input type="number" min="0" step="0.01" value={draft.cargoWeightKg} onChange={(event) => update({ cargoWeightKg: event.target.value })} disabled={saving || item.fieldAccess.cargoWeightKg.mode === 'READ_ONLY'} title={item.fieldAccess.cargoWeightKg.reason} /></label>
        <label><span>Thể tích (CBM)</span><input type="number" min="0" step="0.001" value={draft.cargoVolumeCbm} onChange={(event) => update({ cargoVolumeCbm: event.target.value })} disabled={saving || item.fieldAccess.cargoVolumeCbm.mode === 'READ_ONLY'} title={item.fieldAccess.cargoVolumeCbm.reason} /></label>
      </>}
      {draft.field === 'schedule' && <>
        <label><span>Ngày đóng/trả</span><input autoFocus disabled={saving} type="date" value={draft.date} onChange={(event) => update({ date: event.target.value })} /></label>
        <label><span>Giờ</span><input disabled={saving} type="time" value={draft.time} onChange={(event) => update({ time: event.target.value })} /></label>
        <p className="cus-quick-edit-modal__help">{vehicleReadinessLabel(item)}</p>
      </>}
      {draft.field === 'notes' && <>
        <label><span>Ghi chú cho khách</span><textarea autoFocus disabled={saving} rows={3} maxLength={2000} value={draft.customerNote} onChange={(event) => update({ customerNote: event.target.value })} /></label>
        <label><span>Ghi chú nội bộ</span><textarea disabled={saving} rows={3} maxLength={2000} value={draft.operationalNote} onChange={(event) => update({ operationalNote: event.target.value })} /></label>
        <p className="cus-quick-edit-modal__help">Shift+Enter để xuống dòng.</p>
      </>}
      {error && <p className="cus-inline-edit-error" role="alert">{error}</p>}
    </div>
  );
}

function dispatchStatusLabel(status: ShipmentCusWorkspaceContainerLine['dispatchStatus']): string {
  if (status === 'PLANNED') return 'Đã phân xe';
  if (status === 'CREATED') return 'Đã tạo chuyến';
  if (status === 'IN_TRANSIT') return 'Đang chạy';
  if (status === 'COMPLETED') return 'Hoàn thành';
  return 'Chưa điều xe';
}

function FinanceEvidence({ item }: { item: ShipmentCusWorkspaceListItem }) {
  const confirmationIsCurrent = item.accountingConfirmation.status === 'CONFIRMED';
  const revenue = Number(item.finance.customerInvoiceTotal ?? 0) + Number(item.finance.customerNoInvoiceTotal ?? 0);
  const cost = Number(item.finance.totalCost ?? 0);
  const lossAmount = item.finance.isLoss ? Math.max(0, cost - revenue) : 0;
  const reconciliationLabel = item.finance.isLoss
    ? `Lỗ ${formatMoney(String(lossAmount))} ₫`
    : item.finance.customerChargeTotalsAvailable
      ? 'Không ghi nhận lỗ'
      : 'Chưa đủ số liệu đối soát';
  return (
    <div className="cus-finance-evidence">
      <div className={item.finance.isLoss ? 'cus-finance-loss' : 'cus-finance-quiet'}>
        {item.finance.isLoss
          ? <AlertTriangle size={16} aria-hidden="true" />
          : <CircleDollarSign size={16} aria-hidden="true" />}
        <span><small>Đối soát chi phí</small><strong>{reconciliationLabel}</strong></span>
      </div>
      <div className={`cus-finance-confirmation cus-finance-confirmation--${confirmationIsCurrent ? 'confirmed' : 'attention'}`}>
        {confirmationIsCurrent
          ? <CircleCheck size={16} aria-hidden="true" />
          : <AlertTriangle size={16} aria-hidden="true" />}
        <span><small>Kế toán xác nhận</small><strong>{accountingConfirmationLabel(item.accountingConfirmation)}</strong></span>
      </div>
    </div>
  );
}

const BUCKET_ICONS = {
  [ShipmentCusBucket.NEW]: CalendarClock,
  [ShipmentCusBucket.RUNNING]: Truck,
  [ShipmentCusBucket.PENDING_LOCK]: FileLock2,
  [ShipmentCusBucket.LOCKED]: CircleCheck,
};

function WorkflowBadge({ item }: { item: ShipmentCusWorkspaceListItem }) {
  const Icon = BUCKET_ICONS[item.bucket];
  return (
    <span className={`cus-workflow-badge cus-workflow-badge--${item.bucket.toLowerCase()}`}>
      <Icon size={14} aria-hidden="true" /> {item.bucketLabel}
    </span>
  );
}

function accountingConfirmationLabel(
  confirmation: ShipmentCusWorkspaceListItem['accountingConfirmation'],
): string {
  if (confirmation.status === 'CONFIRMED') {
    return `Đã xác nhận: ${formatDateTime(confirmation.confirmedAt)}`;
  }
  if (confirmation.status === 'STALE') return 'Cần xác nhận lại';
  if (confirmation.status === 'UNAVAILABLE') return 'Chưa đủ dữ liệu xác nhận';
  return 'Chờ xác nhận';
}

function safeError(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

interface ContainerLineDraft {
  carrierKey: string;
  newCarrierName: string;
  plateNumber: string;
  containerTypeId: string;
  liftSiteId: string;
  dropoffSiteId: string;
  customerAppointmentAt: string;
}

function toLocalDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function lineDraft(line: ShipmentCusWorkspaceContainerLine): ContainerLineDraft {
  return {
    carrierKey: line.carrierType === 'OWN'
      ? 'OWN'
      : line.externalCarrierId ? `EXTERNAL:${line.externalCarrierId}` : '',
    newCarrierName: '',
    plateNumber: line.plateNumber ?? '',
    containerTypeId: line.containerTypeId ? String(line.containerTypeId) : '',
    liftSiteId: line.liftSiteId ? String(line.liftSiteId) : '',
    dropoffSiteId: line.dropoffSiteId ? String(line.dropoffSiteId) : '',
    customerAppointmentAt: toLocalDateTime(line.customerAppointmentAt),
  };
}

function lineOperationalSignature(line: ShipmentCusWorkspaceContainerLine): string {
  return JSON.stringify([
    line.containerTypeId,
    line.carrierType,
    line.externalCarrierId,
    line.externalCarrierVehicleId,
    line.plateNumber,
    line.liftSiteId,
    line.dropoffSiteId,
    line.customerAppointmentAt,
  ]);
}

function idempotencySignature(...parts: Array<string | number | boolean | null | undefined>): string {
  return parts.map((part) => (part == null ? '' : String(part))).join(':');
}

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
    <article className="cus-container-record" aria-labelledby={`${idPrefix}-container-${line.id}`}>
      <div className="cus-container-record__tier cus-container-record__tier--identity">
        <span className="cus-container-record__tier-label">Nhận diện</span>
        <dl className="cus-container-record__facts cus-container-record__facts--identity">
          <div className="cus-container-fact cus-container-fact--ordinal"><dt>STT</dt><dd>{line.ordinal}</dd></div>
          <div className="cus-container-fact cus-container-fact--number"><dt>Số cont</dt><dd id={`${idPrefix}-container-${line.id}`}>{line.containerNumber || 'Chưa có số container'}</dd></div>
          <div className="cus-container-fact"><dt>Loại cont</dt><dd>
            {containerTypeEditable ? <>
              <label className="sr-only" htmlFor={`${idPrefix}-container-type-${line.id}`}>Loại container {line.containerNumber || line.ordinal}</label>
              <SearchableSelect id={`${idPrefix}-container-type-${line.id}`} value={draft.containerTypeId} onChange={(value) => updateDraft({ containerTypeId: value })} options={detail.selectors.containerTypes.map((option) => ({ value: String(option.id), label: option.label, searchText: `${option.code} ${option.name}` }))} placeholder="Chọn loại cont" />
            </> : <strong>{line.containerTypeLabel || '—'}</strong>}
          </dd></div>
          <div className="cus-container-fact"><dt>Điều vận</dt><dd><span className={`cus-container-dispatch cus-container-dispatch--${line.dispatchStatus.toLowerCase()}`}>{dispatchStatusLabel(line.dispatchStatus)}</span></dd></div>
        </dl>
      </div>
      <div className="cus-container-record__tier cus-container-record__tier--operation">
        <span className="cus-container-record__tier-label">Vận hành</span>
        <dl className="cus-container-record__facts cus-container-record__facts--operation">
          <div className="cus-container-fact"><dt>Nhà xe</dt><dd>
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
                    <SearchableSelect id={`${idPrefix}-carrier-${line.id}`} value={draft.carrierKey} onChange={(value) => updateDraft({ carrierKey: value, newCarrierName: '' })} options={carrierOptions} placeholder="Chọn nhà xe" searchPlaceholder="Tìm nhà xe" />
                    {plateEditable && <button type="button" className="cus-carrier-editor__switch" onClick={() => updateDraft({ carrierKey: 'NEW_EXTERNAL', newCarrierName: '', plateNumber: '' })}>Thêm nhà xe</button>}
                  </>
                )}
              </div>
            ) : <strong>{line.carrierName || '—'}</strong>}
          </dd></div>
          <div className="cus-container-fact"><dt>Biển số</dt><dd>
            {plateEditable ? <><label className="sr-only" htmlFor={`${idPrefix}-plate-${line.id}`}>Biển số xe của container {line.containerNumber || line.ordinal}</label><input id={`${idPrefix}-plate-${line.id}`} value={draft.plateNumber} list={`${idPrefix}-plates-${line.id}`} maxLength={20} onChange={(event) => updateDraft({ plateNumber: event.target.value })} /></> : <strong>{line.plateNumber || '—'}</strong>}
            {plateEditable && <datalist id={`${idPrefix}-plates-${line.id}`}>{detail.selectors.carrierVehicles.map((vehicle) => <option value={vehicle.licensePlate} key={vehicle.id}>{vehicle.label}</option>)}</datalist>}
          </dd></div>
          <div className="cus-container-fact"><dt>Nâng</dt><dd>
            {liftSiteEditable ? <><label className="sr-only" htmlFor={`${idPrefix}-lift-site-${line.id}`}>Điểm nâng của container {line.containerNumber || line.ordinal}</label><SearchableSelect id={`${idPrefix}-lift-site-${line.id}`} value={draft.liftSiteId} onChange={(value) => updateDraft({ liftSiteId: value })} options={detail.selectors.operationalSites.map((option) => ({ value: String(option.id), label: option.label, searchText: `${option.code} ${option.name}` }))} placeholder="Chọn điểm nâng" /></> : <strong>{line.liftSite || '—'}</strong>}
          </dd></div>
          <div className="cus-container-fact"><dt>Hạ</dt><dd>
            {dropoffSiteEditable ? <><label className="sr-only" htmlFor={`${idPrefix}-dropoff-site-${line.id}`}>Điểm hạ của container {line.containerNumber || line.ordinal}</label><SearchableSelect id={`${idPrefix}-dropoff-site-${line.id}`} value={draft.dropoffSiteId} onChange={(value) => updateDraft({ dropoffSiteId: value })} options={detail.selectors.operationalSites.map((option) => ({ value: String(option.id), label: option.label, searchText: `${option.code} ${option.name}` }))} placeholder="Chọn điểm hạ" /></> : <strong>{line.dropoffSite || '—'}</strong>}
          </dd></div>
          <div className="cus-container-fact"><dt>Giờ hẹn đóng/trả</dt><dd>
            {customerAppointmentEditable ? <><label className="sr-only" htmlFor={`${idPrefix}-customer-appointment-${line.id}`}>Giờ hẹn đóng hoặc trả tại nhà máy của container {line.containerNumber || line.ordinal}</label><input id={`${idPrefix}-customer-appointment-${line.id}`} type="datetime-local" value={draft.customerAppointmentAt} onChange={(event) => updateDraft({ customerAppointmentAt: event.target.value })} /></> : <strong>{formatDateTime(line.customerAppointmentAt)}</strong>}
          </dd></div>
          {editing && <div className="cus-container-fact cus-container-fact--save"><dt className="sr-only">Lưu</dt><dd>
            {operationalEditable && <UUIButton
              size="sm"
              color="primary"
              className="cus-container-save"
              isDisabled={!dirty || saving}
              isLoading={saving}
              showTextWhileLoading
              onPress={() => void save()}
              aria-label={`Lưu container ${line.containerNumber || line.ordinal}`}
              iconLeading={!saving ? <Save size={16} aria-hidden="true" /> : undefined}
            >Lưu</UUIButton>}
            {saveError && <span className="cus-container-row__error" role="alert">{saveError}</span>}
          </dd></div>}
        </dl>
      </div>
    </article>
  );
}

function ContainerLedger({
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
  const [editing, setEditing] = useState(false);
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
            ? <UUIButton size="sm" color="secondary" className="cus-container-edit-action" onPress={requestFinishEditing} isDisabled={savingLineIds.size > 0}>Hoàn tất</UUIButton>
            : <UUIButton size="sm" color="secondary" className="cus-container-edit-action" onPress={() => setEditing(true)}>Chỉnh sửa</UUIButton>)}
          {onCollapse && <button type="button" className="cus-detail-collapse" onClick={requestCollapse} disabled={savingLineIds.size > 0} aria-label={savingLineIds.size > 0 ? 'Đang lưu dữ liệu container' : 'Thu gọn chi tiết container'}><X size={16} aria-hidden="true" /><span>{savingLineIds.size > 0 ? 'Đang lưu' : 'Thu gọn'}</span></button>}
        </div>
      </header>
      {detail.containers.length === 0 ? <p className="cus-detail-empty">Lô hàng chưa có dữ liệu container.</p> : (
        <div className="cus-container-records">
          {detail.containers.map((line) => <ContainerLineRow key={`${line.id}:${resetRevision}`} detail={detail} line={line} onSaved={onLineSaved} getIdempotencyKey={getIdempotencyKey} clearIdempotencyKey={clearIdempotencyKey} idPrefix={idPrefix} onDirtyChange={setLineDirty} onSavingChange={setLineSaving} editing={editing} />)}
        </div>
      )}
      {discardAction && <div className="cus-discard-confirmation" role="alert"><span>{savingLineIds.size > 0 ? 'Đang lưu dữ liệu container.' : 'Có thay đổi container chưa lưu.'}</span><button type="button" className="btn btn--ghost btn--sm" onClick={() => setDiscardAction(null)} disabled={savingLineIds.size > 0}>Tiếp tục chỉnh sửa</button><button type="button" className="btn btn--secondary btn--sm" onClick={discardChanges} disabled={savingLineIds.size > 0}>{discardAction === 'collapse' ? 'Bỏ thay đổi và thu gọn' : 'Bỏ thay đổi và hoàn tất'}</button></div>}
    </section>
  );
}

type ShipmentSignalTone = 'danger' | 'warning' | 'info';

interface ShipmentSignal {
  key: string;
  label: string;
  tone: ShipmentSignalTone;
  icon: typeof AlertTriangle;
}

function deriveShipmentSignals(item: ShipmentCusWorkspaceListItem): ShipmentSignal[] {
  const signals: ShipmentSignal[] = [];
  if (item.operational.scheduleReadiness === 'WAITING_DATE') {
    signals.push({ key: 'schedule', label: 'Chờ chốt lịch', tone: 'warning', icon: CalendarClock });
  } else if (item.operational.scheduleReadiness === 'OVERDUE') {
    signals.push({ key: 'schedule-overdue', label: 'Lịch đã quá hạn', tone: 'danger', icon: CalendarClock });
  }
  if (item.operational.vehicleReadiness === 'WAITING_CARRIER') {
    signals.push({ key: 'carrier', label: `Thiếu nhà xe ${item.operational.missingCarrierContainers} cont`, tone: 'warning', icon: Truck });
  } else if (item.operational.vehicleReadiness === 'WAITING_PLATE') {
    signals.push({ key: 'plate', label: `Thiếu BKS ${item.operational.missingPlateContainers} cont`, tone: 'warning', icon: Truck });
  }
  if (item.finance.isLoss) {
    signals.push({ key: 'loss', label: 'Lỗ', tone: 'danger', icon: AlertTriangle });
  }
  if (item.finance.hasPendingRecovery) {
    signals.push({ key: 'recovery', label: 'Chờ thu hồi', tone: 'warning', icon: CircleDollarSign });
  }
  if (item.documentCustody.status === ShipmentDocumentCustody.OPS_HOLDING) {
    signals.push({ key: 'custody', label: 'Phơi phiếu', tone: 'warning', icon: FileLock2 });
  }
  if (item.accountingConfirmation.status === 'STALE') {
    signals.push({ key: 'confirmation', label: 'Xác nhận hết hạn', tone: 'warning', icon: AlertTriangle });
  }
  if (item.action.kind === 'CONFIRM_FINANCE' && !item.debitNote.available) {
    signals.push({ key: 'debit-note', label: 'Chưa có Debit Note', tone: 'info', icon: FileLock2 });
  }
  if (!item.action.enabled && item.action.kind !== 'NONE' && !signals.some((signal) => signal.key === 'confirmation' || signal.key === 'debit-note')) {
    const label = item.action.kind === 'LOCK'
      ? 'Chờ Kế toán'
      : item.action.kind === 'CONFIRM_FINANCE'
        ? 'Chưa thể xác nhận'
        : 'Chưa thể điều chỉnh';
    signals.push({ key: 'blocked-action', label, tone: 'info', icon: FileLock2 });
  }
  return signals;
}

const SHIPMENT_SIGNAL_TONE_PRIORITY: Record<ShipmentSignalTone, number> = {
  danger: 0,
  warning: 1,
  info: 2,
};

function derivePrimaryShipmentSignal(item: ShipmentCusWorkspaceListItem): ShipmentSignal | null {
  return deriveShipmentSignals(item).reduce<ShipmentSignal | null>((primary, signal) => {
    if (!primary) return signal;
    return SHIPMENT_SIGNAL_TONE_PRIORITY[signal.tone] < SHIPMENT_SIGNAL_TONE_PRIORITY[primary.tone]
      ? signal
      : primary;
  }, null);
}

function ShipmentSignals({ item }: { item: ShipmentCusWorkspaceListItem }) {
  const signals = deriveShipmentSignals(item);
  if (signals.length === 0) return null;
  return (
    <div className="cus-signals" aria-label="Ngoại lệ cần xử lý">
      {signals.map((signal) => {
        const Icon = signal.icon;
        return (
          <span key={signal.key} className={`cus-signal cus-signal--${signal.tone}`}>
            <Icon size={14} aria-hidden="true" /> {signal.label}
          </span>
        );
      })}
    </div>
  );
}

function ShipmentDetailContent({
  detail,
  loading,
  error,
  onRetry,
  onLineSaved,
  getIdempotencyKey,
  clearIdempotencyKey,
  idPrefix,
  onCollapse,
  onDirtyChange,
  onSavingChange,
}: {
  detail?: ShipmentCusWorkspaceDetail;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onLineSaved: (line: ShipmentCusWorkspaceContainerLine) => Promise<void>;
  getIdempotencyKey: (signature: string) => string;
  clearIdempotencyKey: (signature: string) => void;
  idPrefix: string;
  onCollapse?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
}) {
  return (
    <div className="cus-detail-content">
      {loading && !detail ? (
        <div className="cus-detail-loading"><Loader2 className="spin" aria-hidden="true" /> Đang tải dữ liệu container…</div>
      ) : error ? (
        <div className="cus-inline-error" role="alert"><span>{error}</span><button type="button" onClick={onRetry}>Thử lại</button></div>
      ) : detail ? (
        <ContainerLedger
          detail={detail}
          onLineSaved={onLineSaved}
          getIdempotencyKey={getIdempotencyKey}
          clearIdempotencyKey={clearIdempotencyKey}
          idPrefix={idPrefix}
          onCollapse={onCollapse}
          onDirtyChange={onDirtyChange}
          onSavingChange={onSavingChange}
        />
      ) : null}
    </div>
  );
}

export default function ShipmentsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canCreateShipment = user?.role === Role.ADMIN || user?.role === Role.CUS || user?.role === Role.MANAGER;
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get('page') || 1) || 1);
  const suffixParam = searchParams.get('searchSuffix') ?? '';
  const dateFrom = searchParams.get('transportDateFrom') ?? '';
  const dateTo = searchParams.get('transportDateTo') ?? '';
  const rawBucket = searchParams.get('bucket');
  const bucket = BUCKETS.includes(rawBucket as ShipmentCusBucket)
    ? rawBucket as ShipmentCusBucket
    : '';
  const rawDirection = searchParams.get('direction');
  const direction = rawDirection === 'IMPORT' || rawDirection === 'EXPORT' ? rawDirection : '';

  const [searchInput, setSearchInput] = useState(suffixParam);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [data, setData] = useState<ShipmentCusWorkspaceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [drawerCloseConfirmId, setDrawerCloseConfirmId] = useState<number | null>(null);
  const [dirtyDetailIds, setDirtyDetailIds] = useState<Set<number>>(() => new Set());
  const [savingDetailIds, setSavingDetailIds] = useState<Set<number>>(() => new Set());
  const [details, setDetails] = useState<Record<number, ShipmentCusWorkspaceDetail>>({});
  const [detailLoadingIds, setDetailLoadingIds] = useState<Set<number>>(() => new Set());
  const [detailErrors, setDetailErrors] = useState<Record<number, string>>({});
  const [actionItem, setActionItem] = useState<ShipmentCusWorkspaceListItem | null>(null);
  const [actionMode, setActionMode] = useState<'confirm' | 'lock' | 'reopen' | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [transportDateDrafts, setTransportDateDrafts] = useState<Record<number, string>>({});
  const [savingTransportDateIds, setSavingTransportDateIds] = useState<Set<number>>(() => new Set());
  const [quickEditDraft, setQuickEditDraft] = useState<ShipmentQuickEditDraft | null>(null);
  const [savingQuickEdit, setSavingQuickEdit] = useState(false);
  const [quickEditError, setQuickEditError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const requestSequence = useRef(0);
  const detailRequestSequence = useRef<Record<number, number>>({});
  const idempotencyKeysRef = useRef<Record<string, string>>({});
  const quickEditSaveRef = useRef<string | null>(null);
  const quickEditFocusTargetRef = useRef<string | null>(null);

  const getIdempotencyKey = useCallback((signature: string) => {
    const existing = idempotencyKeysRef.current[signature];
    if (existing) return existing;
    const next = crypto.randomUUID();
    idempotencyKeysRef.current[signature] = next;
    return next;
  }, []);

  const clearIdempotencyKey = useCallback((signature: string) => {
    delete idempotencyKeysRef.current[signature];
  }, []);

  const updateParam = useCallback((key: string, value: string | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (!value) next.delete(key);
      else next.set(key, value);
      if (key !== 'page') next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => setSearchInput(suffixParam), [suffixParam]);

  useEffect(() => {
    if (quickEditDraft || !quickEditFocusTargetRef.current) return;
    const targetId = quickEditFocusTargetRef.current;
    const target = document.getElementById(targetId);
    if (!(target instanceof HTMLButtonElement) || target.disabled) return;
    quickEditFocusTargetRef.current = null;
    target.focus();
  }, [quickEditDraft, savingQuickEdit]);

  const loadList = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await listCusShipmentWorkspace({
        page,
        limit: PAGE_SIZE,
        searchSuffix: suffixParam || undefined,
        transportDateFrom: dateFrom || undefined,
        transportDateTo: dateTo || undefined,
        direction: direction || undefined,
        bucket: bucket || undefined,
      });
      if (requestId === requestSequence.current) setData(response);
    } catch (loadError) {
      if (requestId === requestSequence.current) {
        setError(safeError(loadError, 'Không thể tải danh sách lô hàng.'));
      }
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [bucket, dateFrom, dateTo, direction, page, suffixParam]);

  useEffect(() => { void loadList(); }, [loadList]);

  const loadDetail = useCallback(async (shipmentId: number, force = false) => {
    if (!force && details[shipmentId]) return;
    const requestId = (detailRequestSequence.current[shipmentId] ?? 0) + 1;
    detailRequestSequence.current[shipmentId] = requestId;
    setDetailLoadingIds((current) => new Set(current).add(shipmentId));
    setDetailErrors((current) => ({ ...current, [shipmentId]: '' }));
    try {
      const detail = await getCusShipmentWorkspaceDetail(shipmentId);
      if (detailRequestSequence.current[shipmentId] === requestId) {
        setDetails((current) => ({ ...current, [shipmentId]: detail }));
      }
    } catch (detailError) {
      if (detailRequestSequence.current[shipmentId] === requestId) {
        setDetailErrors((current) => ({
          ...current,
          [shipmentId]: safeError(detailError, 'Không thể tải chi tiết container.'),
        }));
      }
    } finally {
      if (detailRequestSequence.current[shipmentId] === requestId) {
        setDetailLoadingIds((current) => {
          const next = new Set(current);
          next.delete(shipmentId);
          return next;
        });
      }
    }
  }, [details]);

  const applySavedContainerLine = useCallback(async (shipmentId: number, line: ShipmentCusWorkspaceContainerLine) => {
    setDetails((current) => {
      const detail = current[shipmentId];
      if (!detail) return current;
      const externalCarriers = line.externalCarrierId && line.carrierName && !detail.selectors.externalCarriers.some((carrier) => carrier.id === line.externalCarrierId)
        ? [...detail.selectors.externalCarriers, { id: line.externalCarrierId, name: line.carrierName, shortName: null, label: line.carrierName }]
        : detail.selectors.externalCarriers;
      const carrierVehicles = line.externalCarrierId && line.externalCarrierVehicleId && line.plateNumber && !detail.selectors.carrierVehicles.some((vehicle) => vehicle.id === line.externalCarrierVehicleId)
        ? [...detail.selectors.carrierVehicles, { id: line.externalCarrierVehicleId, carrierId: line.externalCarrierId, licensePlate: line.plateNumber, label: line.plateNumber }]
        : detail.selectors.carrierVehicles;
      return {
        ...current,
        [shipmentId]: {
          ...detail,
          summary: { ...detail.summary, version: line.shipmentVersion },
          selectors: { ...detail.selectors, externalCarriers, carrierVehicles },
          containers: detail.containers.map((currentLine) => (
            currentLine.id === line.id
              ? line
              : { ...currentLine, shipmentVersion: line.shipmentVersion }
          )),
        },
      };
    });
    setNotice('Đã lưu dữ liệu container. Xác nhận Kế toán cũ (nếu có) sẽ được kiểm tra lại theo nguồn mới.');
    await loadList();
  }, [loadList]);

  const setDetailDirty = useCallback((shipmentId: number, dirty: boolean) => {
    setDirtyDetailIds((current) => {
      const next = new Set(current);
      if (dirty) next.add(shipmentId);
      else next.delete(shipmentId);
      return next;
    });
  }, []);

  const setDetailSaving = useCallback((shipmentId: number, saving: boolean) => {
    setSavingDetailIds((current) => {
      const next = new Set(current);
      if (saving) next.add(shipmentId);
      else next.delete(shipmentId);
      return next;
    });
  }, []);

  const openShipmentDetail = useCallback((shipmentId: number) => {
    setDrawerId(shipmentId);
    void loadDetail(shipmentId);
  }, [loadDetail]);

  const requestCloseMobileDetail = useCallback(() => {
    if (drawerId != null && savingDetailIds.has(drawerId)) {
      setError('Đang lưu dữ liệu container. Vui lòng chờ hoàn tất.');
      return;
    }
    if (drawerId != null && dirtyDetailIds.has(drawerId)) {
      setDrawerCloseConfirmId(drawerId);
      return;
    }
    setDrawerId(null);
  }, [dirtyDetailIds, drawerId, savingDetailIds]);

  const discardMobileDetailChanges = useCallback(() => {
    if (drawerCloseConfirmId != null) setDetailDirty(drawerCloseConfirmId, false);
    setDrawerCloseConfirmId(null);
    setDrawerId(null);
  }, [drawerCloseConfirmId, setDetailDirty]);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const value = searchInput.trim();
    if (value && !SEARCH_PATTERN.test(value)) {
      setSearchError('Nhập đúng 4-5 ký tự chữ hoặc số cuối của Bill/Book hoặc số tờ khai.');
      return;
    }
    setSearchError(null);
    updateParam('searchSuffix', value || null);
  };

  const clearFilters = () => {
    setSearchInput('');
    setSearchError(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      ['searchSuffix', 'transportDateFrom', 'transportDateTo', 'direction', 'bucket', 'page'].forEach((key) => next.delete(key));
      return next;
    }, { replace: true });
  };

  const updateCustody = async (item: ShipmentCusWorkspaceListItem, status: ShipmentDocumentCustody) => {
    if (dirtyDetailIds.has(item.id)) {
      setError('Hãy lưu hoặc bỏ thay đổi container trước khi cập nhật phơi phiếu.');
      return;
    }
    setNotice(null);
    try {
      const signature = idempotencySignature('custody', item.id, item.version, status);
      await updateCusShipmentDocumentCustody(
        item.id,
        { expectedShipmentVersion: item.version, status },
        getIdempotencyKey(signature),
      );
      clearIdempotencyKey(signature);
      setNotice('Đã cập nhật trạng thái phơi phiếu.');
      await Promise.all([loadList(), loadDetail(item.id, true)]);
    } catch (custodyError) {
      setError(safeError(custodyError, 'Không thể cập nhật trạng thái phơi phiếu.'));
    }
  };

  const saveTransportDate = async (item: ShipmentCusWorkspaceListItem) => {
    if (dirtyDetailIds.has(item.id)) {
      setError('Hãy lưu hoặc bỏ thay đổi container trước khi chốt ngày vận chuyển.');
      return;
    }
    const transportDateDraft = transportDateDrafts[item.id] ?? item.transportDate ?? '';
    if (!transportDateDraft || transportDateDraft === item.transportDate) return;
    setSavingTransportDateIds((current) => new Set(current).add(item.id));
    setError(null);
    try {
      await updateShipment(item.id, {
        expectedVersion: item.version,
        expectedDeliveryDate: transportDateDraft,
      });
      setNotice('Đã chốt ngày vận chuyển và cập nhật trạng thái sẵn sàng điều xe.');
      setDetails((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      if (drawerId === item.id) void loadDetail(item.id, true);
      await loadList();
    } catch (transportDateError) {
      setError(safeError(transportDateError, 'Không thể cập nhật ngày vận chuyển.'));
    } finally {
      setSavingTransportDateIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  };

  const startQuickEdit = (item: ShipmentCusWorkspaceListItem, field: ShipmentQuickEditDraft['field']) => {
    if (quickEditSaveRef.current || quickEditDraft) return;
    const accessKeys = field === 'identity' ? ['factoryName'] as const
      : field === 'documents' ? ['blNumber', 'bookingRef'] as const
        : field === 'classification' ? ['tradeDirection', 'shippingLineName'] as const
          : field === 'cargo' ? ['packageCount', 'packageType', 'cargoWeightKg', 'cargoVolumeCbm'] as const
            : field === 'schedule' ? ['closingAt', 'plannedReturnAt'] as const
              : ['customerNotes', 'operationalNotes'] as const;
    if (!accessKeys.some((key) => item.fieldAccess[key].mode !== 'READ_ONLY')) {
      setError(item.fieldAccess[accessKeys[0]].reason);
      return;
    }
    setError(null);
    setQuickEditError(null);
    setQuickEditDraft({
      shipmentId: item.id,
      field,
      date: item.transportDate ?? '',
      time: scheduleTime(item),
      customerNote: item.customerNotes ?? '',
      operationalNote: item.operationalNotes ?? '',
      factoryName: item.raw.factoryName ?? '',
      blNumber: item.raw.blNumber ?? '',
      bookingRef: item.raw.bookingRef ?? '',
      tradeDirection: item.raw.tradeDirection ?? '',
      shippingLineName: item.raw.shippingLineName ?? '',
      packageCount: item.raw.packageCount == null ? '' : String(item.raw.packageCount),
      packageType: item.raw.packageType ?? '',
      cargoWeightKg: item.raw.cargoWeightKg ?? '',
      cargoVolumeCbm: item.raw.cargoVolumeCbm ?? '',
    });
  };

  const closeQuickEdit = () => {
    if (!quickEditDraft || quickEditSaveRef.current) return;
    quickEditFocusTargetRef.current = `cus-inline-${quickEditDraft.field}-${quickEditDraft.shipmentId}`;
    setQuickEditError(null);
    setQuickEditDraft(null);
  };

  const saveQuickEdit = async (
    item: ShipmentCusWorkspaceListItem,
    { restoreFocus = true }: { restoreFocus?: boolean } = {},
  ) => {
    const draft = quickEditDraft;
    if (!draft || draft.shipmentId !== item.id || quickEditSaveRef.current) return;
    if (draft.field === 'schedule' && draft.time && !draft.date) {
      setQuickEditError('Chọn ngày đóng/trả trước khi nhập giờ.');
      return;
    }
    const unchanged = draft.field === 'identity'
      ? draft.factoryName.trim() === (item.raw.factoryName ?? '')
      : draft.field === 'documents'
        ? draft.blNumber.trim() === (item.raw.blNumber ?? '') && draft.bookingRef.trim() === (item.raw.bookingRef ?? '')
        : draft.field === 'classification'
          ? draft.tradeDirection === (item.raw.tradeDirection ?? '') && draft.shippingLineName.trim() === (item.raw.shippingLineName ?? '')
          : draft.field === 'cargo'
            ? draft.packageCount === (item.raw.packageCount == null ? '' : String(item.raw.packageCount))
              && draft.packageType.trim() === (item.raw.packageType ?? '')
              && draft.cargoWeightKg === (item.raw.cargoWeightKg ?? '')
              && draft.cargoVolumeCbm === (item.raw.cargoVolumeCbm ?? '')
            : draft.field === 'schedule'
              ? draft.date === (item.transportDate ?? '') && draft.time === scheduleTime(item)
              : draft.customerNote.trim() === (item.customerNotes ?? '').trim()
                && draft.operationalNote.trim() === (item.operationalNotes ?? '').trim();
    if (unchanged) {
      if (restoreFocus) {
        quickEditFocusTargetRef.current = `cus-inline-${draft.field}-${draft.shipmentId}`;
      }
      setQuickEditError(null);
      setQuickEditDraft(null);
      return;
    }
    const saveIdentity = `${draft.field}:${draft.shipmentId}:${item.version}`;
    quickEditSaveRef.current = saveIdentity;
    setSavingQuickEdit(true);
    setError(null);
    setQuickEditError(null);
    try {
      const scheduleValue = draft.date && draft.time
        ? new Date(`${draft.date}T${draft.time}:00`).toISOString()
        : null;
      const payload = draft.field === 'identity' ? {
        expectedVersion: item.version,
        factoryName: draft.factoryName.trim() || null,
      } : draft.field === 'documents' ? {
        expectedVersion: item.version,
        blNumber: draft.blNumber.trim() || null,
        bookingRef: draft.bookingRef.trim() || null,
      } : draft.field === 'classification' ? {
        expectedVersion: item.version,
        tradeDirection: draft.tradeDirection || null,
        shippingLineName: draft.shippingLineName.trim() || null,
      } : draft.field === 'cargo' ? {
        expectedVersion: item.version,
        packageCount: draft.packageCount ? Number(draft.packageCount) : null,
        packageType: draft.packageType.trim() || null,
        ...(item.fieldAccess.cargoWeightKg.mode !== 'READ_ONLY' ? { cargoWeightKg: draft.cargoWeightKg || null } : {}),
        ...(item.fieldAccess.cargoVolumeCbm.mode !== 'READ_ONLY' ? { cargoVolumeCbm: draft.cargoVolumeCbm || null } : {}),
      } : draft.field === 'schedule' ? {
            expectedVersion: item.version,
            expectedDeliveryDate: draft.date || null,
            ...(item.direction === 'IMPORT'
              ? { plannedReturnAt: scheduleValue }
              : { closingAt: scheduleValue }),
          } : {
            expectedVersion: item.version,
            operationalNotes: draft.operationalNote.trim() || null,
            customerNotes: draft.customerNote.trim() || null,
          };
      const response = await updateShipment(item.id, payload);
      if (restoreFocus) {
        quickEditFocusTargetRef.current = `cus-inline-${draft.field}-${draft.shipmentId}`;
      }
      setQuickEditDraft((current) => current?.shipmentId === draft.shipmentId && current.field === draft.field ? null : current);
      setNotice(response.changeMode === 'REQUESTED'
        ? response.message ?? 'Đã gửi yêu cầu thay đổi để phê duyệt.'
        : draft.field === 'schedule' ? 'Đã cập nhật lịch đóng/trả.'
          : draft.field === 'notes' ? 'Đã cập nhật ghi chú lô hàng.'
            : 'Đã lưu ô dữ liệu lô hàng.');
      setDetails((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      await loadList();
    } catch (quickEditError) {
      if (quickEditSaveRef.current === saveIdentity) {
        if (quickEditError instanceof ApiError && quickEditError.status === 409) {
          quickEditFocusTargetRef.current = `cus-inline-${draft.field}-${draft.shipmentId}`;
          setQuickEditDraft(null);
          setQuickEditError(null);
          setNotice('Dữ liệu hoặc quyền chỉnh sửa vừa thay đổi. Đã tải bản mới nhất và bỏ bản nháp cũ để tránh ghi đè.');
          await loadList();
        } else {
          setQuickEditError(safeError(quickEditError, 'Không thể lưu ô đang chỉnh sửa.'));
        }
      }
    } finally {
      if (quickEditSaveRef.current === saveIdentity) {
        quickEditSaveRef.current = null;
        setSavingQuickEdit(false);
      }
    }
  };

  const openAction = (item: ShipmentCusWorkspaceListItem, mode: 'confirm' | 'lock' | 'reopen') => {
    if (dirtyDetailIds.has(item.id)) {
      setError('Hãy lưu hoặc bỏ thay đổi container trước khi thực hiện thao tác này.');
      return;
    }
    setActionItem(item);
    setActionMode(mode);
    setDrawerId(null);
    setReason(
      mode === 'confirm'
        ? 'Kế toán xác nhận nguồn chi phí hiện hành của lô.'
        : mode === 'lock'
          ? 'CUS xác nhận khóa lô sau khi Kế toán duyệt.'
          : '',
    );
  };

  const shipmentActionButton = (item: ShipmentCusWorkspaceListItem) => {
    if (item.action.kind === 'NONE') return null;
    const mode = item.action.kind === 'CONFIRM_FINANCE'
      ? 'confirm'
      : item.action.kind === 'LOCK'
        ? 'lock'
        : 'reopen';
    return (
      <UUIButton
        size="sm"
        color="primary"
        className="cus-drawer-primary-action"
        isDisabled={!item.action.enabled}
        aria-label={item.action.label}
        onPress={() => openAction(item, mode)}
        iconLeading={item.action.kind === 'LOCK' ? <FileLock2 size={16} aria-hidden="true" /> : undefined}
      >
        {item.action.label}
      </UUIButton>
    );
  };

  const closeAction = () => {
    if (submitting) return;
    setActionItem(null);
    setActionMode(null);
    setReason('');
  };

  const submitAction = async () => {
    if (!actionItem || !actionMode || !reason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const signature = idempotencySignature('action', actionItem.id, actionMode, actionItem.version);
      const idempotencyKey = getIdempotencyKey(signature);
      if (actionMode === 'confirm') {
        if (!actionItem.debitNote.billingDocumentId) {
          throw new Error(actionItem.debitNote.disabledReason || 'Chưa có Debit Note đủ điều kiện để xác nhận.');
        }
        await confirmCusShipmentFinance(actionItem.id, {
          expectedVersion: actionItem.version,
          billingDocumentId: actionItem.debitNote.billingDocumentId,
          reason: reason.trim(),
        }, idempotencyKey);
        setNotice('Đã xác nhận nguồn chi phí của lô hàng.');
      } else if (actionMode === 'lock') {
        const confirmation = actionItem.accountingConfirmation;
        if (!confirmation.confirmationId || !confirmation.checksum) {
          throw new Error('Xác nhận Kế toán không còn hợp lệ. Vui lòng tải lại dữ liệu.');
        }
        await lockCusShipment(actionItem.id, {
          expectedVersion: actionItem.version,
          confirmationId: confirmation.confirmationId,
          confirmationChecksum: confirmation.checksum,
          reason: reason.trim(),
          acknowledged: true,
        }, idempotencyKey);
        setNotice('Đã khóa lô hàng. Mọi trường nhập và tệp tải lên hiện ở chế độ chỉ đọc.');
      } else {
        if (!actionItem.activeLock?.id) {
          throw new Error('Không tìm thấy khóa lô hiện hành. Vui lòng tải lại dữ liệu.');
        }
        await requestCusShipmentReopen(actionItem.id, {
          expectedShipmentVersion: actionItem.version,
          activeLockId: actionItem.activeLock.id,
          reason: reason.trim(),
        }, idempotencyKey);
        setNotice('Đã gửi đề nghị điều chỉnh tới Quản trị viên.');
      }
      clearIdempotencyKey(signature);
      setActionItem(null);
      setActionMode(null);
      setReason('');
      setDetails((current) => {
        const next = { ...current };
        delete next[actionItem.id];
        return next;
      });
      if (drawerId === actionItem.id) void loadDetail(actionItem.id, true);
      await loadList();
    } catch (actionError) {
      setError(safeError(actionError, 'Không thể hoàn tất thao tác.'));
    } finally {
      setSubmitting(false);
    }
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, data?.totalPages ?? Math.ceil(total / PAGE_SIZE));
  const drawerItem = items.find((item) => item.id === drawerId) ?? null;
  const quickEditItem = quickEditDraft
    ? items.find((item) => item.id === quickEditDraft.shipmentId) ?? null
    : null;
  const hasFilters = Boolean(suffixParam || dateFrom || dateTo || direction || bucket);
  const activeFilterCount = [dateFrom, dateTo, direction, bucket].filter(Boolean).length;

  const resultLabel = useMemo(() => {
    if (loading) return 'Đang cập nhật danh sách…';
    if (error && !data) return 'Không thể tải dữ liệu';
    return `${total.toLocaleString('vi-VN')} lô hàng`;
  }, [data, error, loading, total]);
  const filterChips = useMemo(() => [
    suffixParam ? { key: 'searchSuffix', label: `Mã: ${suffixParam}` } : null,
    dateFrom ? { key: 'transportDateFrom', label: `Từ ${formatDate(dateFrom)}` } : null,
    dateTo ? { key: 'transportDateTo', label: `Đến ${formatDate(dateTo)}` } : null,
    direction ? { key: 'direction', label: directionLabel(direction) } : null,
    bucket ? { key: 'bucket', label: SHIPMENT_CUS_BUCKET_LABELS[bucket] } : null,
  ].filter((chip): chip is { key: string; label: string } => chip != null), [bucket, dateFrom, dateTo, direction, suffixParam]);

  const exportWorksheet = async () => {
    setExporting(true);
    setError(null);
    try {
      const exportItems: ShipmentCusWorkspaceListItem[] = [];
      let exportPage = 1;
      let exportTotalPages = 1;
      do {
        const response = await listCusShipmentWorkspace({
          page: exportPage,
          limit: 100,
          searchSuffix: suffixParam || undefined,
          transportDateFrom: dateFrom || undefined,
          transportDateTo: dateTo || undefined,
          direction: direction || undefined,
          bucket: bucket || undefined,
        });
        exportItems.push(...response.items);
        exportTotalPages = response.totalPages;
        exportPage += 1;
      } while (exportPage <= exportTotalPages);

      await downloadCSV(
        `ke-hoach-lo-hang-${new Date().toISOString().slice(0, 10)}.xlsx`,
        ['Khách hàng & nhà máy', 'Chứng từ', 'Phân loại & hãng tàu', 'Tổng quan hàng hóa', 'Lịch trình & điều xe', 'Ghi chú', 'Trạng thái'],
        exportItems.map((item) => [
          [item.customerName ?? '—', item.factoryName ?? '', item.routeName ?? item.deliveryLocation ?? ''].filter(Boolean).join('\n'),
          [item.billOrBookNumber ?? '', item.declarationNumber ?? ''].filter(Boolean).join('\n'),
          [directionLabel(item.direction), item.shippingLineName ?? '', item.isCombined ? 'Hàng kết hợp' : ''].filter(Boolean).join('\n'),
          [item.containerSummary || worksheetQuantity(item), item.weightKg != null ? `${formatQuantity(item.weightKg)} kg` : '', item.volumeCbm ? `${formatQuantity(item.volumeCbm)} CBM` : ''].filter(Boolean).join('\n'),
          [item.transportDate ? formatDate(item.transportDate) : 'Chưa chốt ngày', vehicleReadinessLabel(item)].filter(Boolean).join('\n'),
          [item.customerNotes ?? '', item.operationalNotes ?? ''].filter((line) => line.trim() !== '').join('\n'),
          [item.bucketLabel, derivePrimaryShipmentSignal(item)?.label ?? ''].filter(Boolean).join('\n'),
        ]),
        {
          title: 'Tổng quan lô hàng',
          subtitle: `${exportItems.length.toLocaleString('vi-VN')} lô hàng`,
          columnTypes: ['text', 'text', 'text', 'text', 'text', 'text', 'text'],
          hideTotals: true,
        },
      );
    } catch (exportError) {
      setError(safeError(exportError, 'Không thể tải bảng XLSX.'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="shipments-page shipments-page--worksheet">
      <Breadcrumbs items={[{ label: 'Tổng quan', to: '/dashboard' }, { label: 'Tổng quan lô hàng' }]} />
      <PageHeader title="Tổng quan lô hàng" iconName="cargo" description="Bảng điều hành giao nhận theo từng lô hàng" />

      <section
        className="cus-workspace cus-workspace--worksheet"
        aria-labelledby="cus-workspace-title"
        aria-busy={loading}
        aria-hidden={drawerId != null ? true : false}
        inert={drawerId != null ? true : false}
      >
        <h2 id="cus-workspace-title" className="sr-only">Bảng kế hoạch lô hàng</h2>
        <form className="cus-worksheet-toolbar" onSubmit={submitSearch} noValidate>
          <div className="cus-worksheet-toolbar__filters" aria-label={'Bộ lọc' + (activeFilterCount ? ' đang áp dụng ' + activeFilterCount : '')}>
            <div className="cus-search-field">
              <UUIInput
                label="Bill/Book hoặc tờ khai"
                size="sm"
                icon={Search}
                value={searchInput}
                onChange={(value) => {
                  setSearchInput(value);
                  setSearchError(null);
                }}
                placeholder="Nhập 4–5 ký tự cuối"
                inputProps={{
                  inputMode: 'text',
                  pattern: '[A-Za-z0-9]{4,5}',
                  autoCapitalize: 'characters',
                  autoCorrect: 'off',
                  spellCheck: false,
                }}
                isInvalid={Boolean(searchError)}
                aria-describedby={searchError ? 'cus-search-error' : undefined}
                className="shipment-uui-field"
                wrapperClassName="shipment-uui-control"
                inputClassName="shipment-uui-control__input shipment-uui-control__input--search"
                iconClassName="shipment-uui-control__icon"
              />
              {searchInput && (
                <UUIButton
                  size="xs"
                  color="tertiary"
                  className="shipment-uui-clear"
                  onPress={() => {
                    setSearchInput('');
                    setSearchError(null);
                    updateParam('searchSuffix', null);
                  }}
                  aria-label="Xóa tìm kiếm"
                  iconLeading={<X size={16} aria-hidden="true" />}
                />
              )}
              {searchError && <span id="cus-search-error" className="cus-field-error" role="alert">{searchError}</span>}
            </div>

            <UUINativeSelect
              label="Xuất / Nhập"
              size="sm"
              value={direction}
              onChange={(event) => updateParam('direction', event.target.value || null)}
              options={[
                { value: '', label: 'Tất cả' },
                { value: 'EXPORT', label: 'Xuất' },
                { value: 'IMPORT', label: 'Nhập' },
              ]}
              className="cus-filter-field shipment-uui-field"
              selectClassName="shipment-uui-select"
            />
            <UUIInput
              label="Từ ngày giao"
              size="sm"
              type="date"
              value={dateFrom}
              onChange={(value) => updateParam('transportDateFrom', value || null)}
              className="cus-filter-field shipment-uui-field"
              wrapperClassName="shipment-uui-control"
              inputClassName="shipment-uui-control__input"
            />
            <UUIInput
              label="Đến ngày giao"
              size="sm"
              type="date"
              value={dateTo}
              onChange={(value) => updateParam('transportDateTo', value || null)}
              className="cus-filter-field shipment-uui-field"
              wrapperClassName="shipment-uui-control"
              inputClassName="shipment-uui-control__input"
            />
            <UUINativeSelect
              label="Kế hoạch"
              size="sm"
              value={bucket}
              onChange={(event) => updateParam('bucket', event.target.value || null)}
              options={[
                { value: '', label: 'Tất cả trạng thái' },
                ...BUCKETS.map((value) => ({ value, label: SHIPMENT_CUS_BUCKET_LABELS[value] })),
              ]}
              className="cus-filter-field shipment-uui-field"
              selectClassName="shipment-uui-select"
            />
          </div>

          <div className="cus-worksheet-toolbar__actions" aria-label="Thao tác lô hàng">
            <div className="cus-worksheet-toolbar__action-group">
              {canCreateShipment && (
                <UUIButton
                  size="sm"
                  color="primary"
                  className="shipment-uui-button shipment-uui-button--primary cus-create-shipment"
                  onPress={() => navigate(routes.shipmentNew)}
                  iconLeading={<Plus size={17} aria-hidden="true" />}
                >
                  Tạo lô mới
                </UUIButton>
              )}
              <UUIButton
                size="sm"
                color="secondary"
                type="submit"
                className="shipment-uui-button shipment-uui-button--secondary"
                iconLeading={<Search size={16} aria-hidden="true" />}
              >
                Tìm kiếm
              </UUIButton>
            </div>
            <div className="cus-worksheet-toolbar__action-group cus-worksheet-toolbar__action-group--utility">
              {hasFilters && (
                <UUIButton
                  size="sm"
                  color="tertiary"
                  className="shipment-uui-button shipment-uui-button--tertiary"
                  onPress={clearFilters}
                  iconLeading={<RotateCcw size={16} aria-hidden="true" />}
                >
                  Xóa lọc
                </UUIButton>
              )}
              <UUIButton
                size="sm"
                color="secondary"
                isDisabled={exporting || loading}
                isLoading={exporting}
                className="shipment-uui-button shipment-uui-button--secondary"
                onPress={() => void exportWorksheet()}
                iconLeading={<Download size={16} aria-hidden="true" />}
                showTextWhileLoading
              >
                Tải XLSX
              </UUIButton>
            </div>
          </div>
        </form>

        {filterChips.length > 0 && (
          <div className="cus-active-filters" aria-label="Bộ lọc đang áp dụng">
            <span className="cus-active-filters__label">Đang lọc</span>
            {filterChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className="cus-filter-chip"
                onClick={() => {
                  if (chip.key === 'searchSuffix') setSearchInput('');
                  updateParam(chip.key, null);
                }}
                aria-label={'Xóa bộ lọc ' + chip.label}
              >
                {chip.label} <X size={13} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}


        {notice && <div className="cus-notice cus-notice--success" role="status">{notice}</div>}
        {error && (
          <div className="cus-notice cus-notice--error" role="alert">
            <span>{error}</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void loadList()}>Thử lại</button>
          </div>
        )}

        {loading && !data ? (
          <div className="cus-loading"><Loader2 className="spin" aria-hidden="true" /> Đang tải lô hàng…</div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Search}
            title={hasFilters ? 'Không có lô hàng phù hợp' : 'Chưa có lô hàng'}
            description={hasFilters ? 'Điều chỉnh hoặc xóa bộ lọc để xem lại danh sách.' : 'Dữ liệu lô hàng sẽ xuất hiện tại đây.'}
            action={hasFilters ? <button type="button" className="btn btn--secondary" onClick={clearFilters}><RotateCcw size={17} aria-hidden="true" /> Xóa bộ lọc</button> : undefined}
          />
        ) : (
          <>
            <p id="cus-worksheet-instructions" className="sr-only">
              Bảng lô hàng gồm bảy nhóm thông tin. Chọn trực tiếp ô dữ liệu được phép để sửa; nhấn Enter để lưu và Escape để hủy. Mở Chi tiết để chỉnh từng container.
            </p>
            <div className="cus-dashboard-viewport" role="region" aria-label="Bảng tổng hợp lô hàng" aria-describedby="cus-worksheet-instructions" tabIndex={0}>
              <table className="cus-dashboard-table ops-table">
                <caption className="sr-only">Tổng hợp lô hàng theo bảy nhóm thông tin</caption>
                <colgroup>
                  <col className="cus-dashboard-col--customer" />
                  <col className="cus-dashboard-col--documents" />
                  <col className="cus-dashboard-col--classification" />
                  <col className="cus-dashboard-col--cargo" />
                  <col className="cus-dashboard-col--schedule" />
                  <col className="cus-dashboard-col--notes" />
                  <col className="cus-dashboard-col--status" />
                </colgroup>
                <thead><tr>
                  <th scope="col">Khách hàng &amp; nhà máy</th>
                  <th scope="col">Chứng từ</th>
                  <th scope="col">Phân loại &amp; hãng tàu</th>
                  <th scope="col">Tổng quan hàng hóa</th>
                  <th scope="col">Lịch trình &amp; điều xe</th>
                  <th scope="col">Ghi chú</th>
                  <th scope="col">Trạng thái</th>
                </tr></thead>
                <tbody>
                  {items.map((item) => {
                    const identity = item.billOrBookNumber || item.declarationNumber || item.customerName || 'lô hàng';
                    const primarySignal = derivePrimaryShipmentSignal(item);
                    const PrimarySignalIcon = primarySignal?.icon;
                    const waitingSchedule = item.operational.scheduleReadiness === 'WAITING_DATE';
                    const editing = quickEditDraft?.shipmentId === item.id;
                    const customerNoteLines = noteLines(item.customerNotes);
                    const operationalNoteLines = noteLines(item.operationalNotes);
                    return (
                      <tr
                        key={item.id}
                        className={`cus-dashboard-row${waitingSchedule ? ' cus-dashboard-row--waiting' : ''}`}
                      >
                        <th scope="row" data-label="Khách hàng & nhà máy" className="cus-dashboard-cell--editable cus-dashboard-cell--identity">
                          <StatusStrip color={SHIPMENT_BUCKET_COLORS[item.bucket]} />
                          <button id={`cus-inline-identity-${item.id}`} type="button" className="cus-inline-trigger" data-cell-label="Khách hàng & nhà máy" disabled={item.fieldAccess.factoryName.mode === 'READ_ONLY' || Boolean(quickEditDraft) || savingQuickEdit} title={item.fieldAccess.factoryName.reason} onClick={() => startQuickEdit(item, 'identity')} aria-haspopup="dialog" aria-label={`Sửa ô khách hàng và nhà máy ${identity}`}><span className="cus-multiline-cell">
                            <strong>{item.customerName || '—'}</strong>
                            <span>{item.factoryName || 'Chưa có nhà máy'}</span>
                            <span>{item.routeName || item.deliveryLocation || 'Chưa có tuyến đường'}</span>
                          </span></button>
                        </th>
                        <td data-label="Chứng từ" className="cus-dashboard-cell--editable">
                          <button id={`cus-inline-documents-${item.id}`} type="button" className="cus-inline-trigger" data-cell-label="Chứng từ" disabled={item.fieldAccess.blNumber.mode === 'READ_ONLY' && item.fieldAccess.bookingRef.mode === 'READ_ONLY' || Boolean(quickEditDraft) || savingQuickEdit} title={item.fieldAccess.blNumber.reason} onClick={() => startQuickEdit(item, 'documents')} aria-haspopup="dialog" aria-label={`Sửa ô chứng từ ${identity}`}><span className="cus-multiline-cell cus-multiline-cell--mono">
                            <strong>{item.billOrBookNumber || 'Chưa có Bill/Book'}</strong>
                            <span>{item.declarationNumber || 'Chưa có tờ khai'}</span>
                          </span></button>
                        </td>
                        <td data-label="Phân loại & hãng tàu" className="cus-dashboard-cell--editable">
                          <button id={`cus-inline-classification-${item.id}`} type="button" className="cus-inline-trigger" data-cell-label="Phân loại & hãng tàu" disabled={item.fieldAccess.tradeDirection.mode === 'READ_ONLY' && item.fieldAccess.shippingLineName.mode === 'READ_ONLY' || Boolean(quickEditDraft) || savingQuickEdit} title={item.fieldAccess.tradeDirection.reason} onClick={() => startQuickEdit(item, 'classification')} aria-haspopup="dialog" aria-label={`Sửa ô phân loại và hãng tàu ${identity}`}><span className="cus-multiline-cell">
                            <span className={`cus-direction-badge cus-direction-badge--${item.direction?.toLowerCase() || 'unknown'}`}>{directionLabel(item.direction)}</span>
                            <span>{item.shippingLineName || 'Chưa có hãng tàu'}</span>
                            {item.isCombined && <span className="cus-combined-tag">Hàng kết hợp</span>}
                          </span></button>
                        </td>
                        <td data-label="Tổng quan hàng hóa" className="cus-dashboard-cell--editable">
                          <button id={`cus-inline-cargo-${item.id}`} type="button" className="cus-inline-trigger" data-cell-label="Tổng quan hàng hóa" disabled={['packageCount', 'packageType', 'cargoWeightKg', 'cargoVolumeCbm'].every((key) => item.fieldAccess[key as 'packageCount'].mode === 'READ_ONLY') || Boolean(quickEditDraft) || savingQuickEdit} title={item.fieldAccess.packageCount.reason} onClick={() => startQuickEdit(item, 'cargo')} aria-haspopup="dialog" aria-label={`Sửa ô tổng quan hàng hóa ${identity}`}><span className="cus-multiline-cell cus-multiline-cell--numeric cus-cargo-summary">
                            <strong className="cus-cargo-summary__containers">{item.containerSummary || worksheetQuantity(item)}</strong>
                            <span className="cus-cargo-summary__metrics">{formatQuantity(item.weightKg)} kg · {item.volumeCbm ? `${formatQuantity(item.volumeCbm)} CBM` : 'Chưa có CBM'}</span>
                          </span></button>
                        </td>
                        <td data-label="Lịch trình & điều xe" className="cus-dashboard-cell--editable">
                          <button
                            id={`cus-inline-schedule-${item.id}`}
                            type="button"
                            className="cus-inline-trigger"
                            data-cell-label="Lịch trình & điều xe"
                            disabled={!item.operational.transportDateEditable || Boolean(quickEditDraft) || savingQuickEdit}
                            aria-haspopup="dialog"
                            aria-label={`Sửa ô lịch trình lô hàng ${identity}`}
                            onClick={() => startQuickEdit(item, 'schedule')}
                          >
                            <strong className={waitingSchedule ? 'cus-schedule-missing' : undefined}>{waitingSchedule ? 'Chưa chốt ngày' : formatDate(item.transportDate)}</strong>
                            <span>{scheduleTime(item) ? `${scheduleTime(item)} · ${item.direction === 'IMPORT' ? 'trả hàng' : 'đóng hàng'}` : 'Chưa có giờ đóng/trả'}</span>
                            <span>{vehicleReadinessLabel(item)}</span>
                          </button>
                        </td>
                        <td data-label="Ghi chú" className="cus-dashboard-cell--editable">
                          <button
                            id={`cus-inline-notes-${item.id}`}
                            type="button"
                            className="cus-inline-trigger cus-note-preview"
                            data-cell-label="Ghi chú"
                            title={item.customerNotes || item.operationalNotes || undefined}
                            disabled={!item.operational.transportDateEditable || Boolean(quickEditDraft) || savingQuickEdit}
                            aria-haspopup="dialog"
                            aria-label={`Sửa ô ghi chú lô hàng ${identity}`}
                            onClick={() => startQuickEdit(item, 'notes')}
                          >
                            <span className={`cus-note-preview__customer${customerNoteLines[0] ? '' : ' cus-note-preview__customer--empty'}`}>{customerNoteLines[0] || 'Chưa có ghi chú khách'}</span>
                            {customerNoteLines[1] && <span>{customerNoteLines[1]}</span>}
                            {operationalNoteLines[0] && <span className="cus-note-internal">{operationalNoteLines[0]}</span>}
                            {operationalNoteLines[1] && <span className="cus-note-internal">{operationalNoteLines[1]}</span>}
                          </button>
                        </td>
                        <td data-label="Trạng thái">
                          <div className="cus-row-actions">
                            <div className="cus-row-actions__summary">
                              <WorkflowBadge item={item} />
                              {primarySignal && PrimarySignalIcon && <span className={`cus-attention-label cus-attention-label--${primarySignal.tone}`}><PrimarySignalIcon size={13} aria-hidden="true" /> {primarySignal.label}</span>}
                            </div>
                            <UUIButton
                              id={'cus-dashboard-detail-' + item.id}
                              size="sm"
                              color="tertiary"
                              className="cus-dashboard-detail"
                              aria-haspopup="dialog"
                              aria-controls={'cus-detail-drawer-' + item.id}
                              aria-label={'Mở chi tiết lô hàng ' + identity + ', trạng thái ' + item.bucketLabel}
                              onPress={() => openShipmentDetail(item.id)}
                              isDisabled={editing}
                              iconTrailing={ChevronRight}
                            >
                              Xem chi tiết
                            </UUIButton>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <Pagination page={page} totalPages={totalPages} totalItems={total} pageSize={PAGE_SIZE} onChange={(nextPage) => updateParam('page', String(nextPage))} />
            )}
          </>
        )}
      </section>

      <Modal
        isOpen={quickEditDraft != null && quickEditItem != null}
        title={quickEditDraft ? quickEditTitle(quickEditDraft.field) : 'Chỉnh sửa lô hàng'}
        onClose={closeQuickEdit}
        maxWidth={520}
        footer={<>
          <UUIButton size="sm" color="secondary" className="cus-quick-edit-modal__action" onPress={closeQuickEdit} isDisabled={savingQuickEdit}>Hủy</UUIButton>
          <UUIButton
            size="sm"
            color="primary"
            className="cus-quick-edit-modal__action"
            isLoading={savingQuickEdit}
            showTextWhileLoading
            onPress={() => { if (quickEditItem) void saveQuickEdit(quickEditItem); }}
            iconLeading={<Save size={16} aria-hidden="true" />}
          >
            Lưu thay đổi
          </UUIButton>
        </>}
      >
        {quickEditDraft && quickEditItem && (
          <form
            className="cus-quick-edit-modal"
            aria-busy={savingQuickEdit}
            onSubmit={(event) => {
              event.preventDefault();
              void saveQuickEdit(quickEditItem);
            }}
          >
            <p className="cus-quick-edit-modal__context">{quickEditItem.billOrBookNumber || quickEditItem.declarationNumber || quickEditItem.customerName || 'Lô hàng'}</p>
            <ShipmentQuickEditFields
              draft={quickEditDraft}
              item={quickEditItem}
              saving={savingQuickEdit}
              error={quickEditError}
              onChange={setQuickEditDraft}
            />
          </form>
        )}
      </Modal>

      <Drawer
        isOpen={drawerId != null}
        onClose={requestCloseMobileDetail}
        title={drawerItem?.customerName || 'Chi tiết lô hàng'}
        subtitle={drawerItem?.billOrBookNumber || drawerItem?.declarationNumber || undefined}
        className="cus-shipment-drawer"
        headerGraphic={drawerItem ? <StatusSwatch color={SHIPMENT_BUCKET_COLORS[drawerItem.bucket]} /> : undefined}
      >
        <div id={drawerItem ? `cus-detail-drawer-${drawerItem.id}` : undefined}>
          {drawerItem && (
            <>
              <section className="cus-drawer-workflow" aria-labelledby="cus-drawer-workflow-title">
                <div className="cus-drawer-workflow__heading">
                  <div>
                    <span className="cus-drawer-eyebrow">Điều hành lô hàng</span>
                    <h3 id="cus-drawer-workflow-title">Sẵn sàng cho bước tiếp theo</h3>
                    <p>{drawerItem.factoryName || drawerItem.deliveryLocation || 'Chưa xác định điểm giao'}</p>
                  </div>
                  <WorkflowBadge item={drawerItem} />
                </div>
                <ShipmentSignals item={drawerItem} />

                <div className="cus-drawer-decision-grid" aria-label="Điều kiện xử lý lô hàng">
                  <div className="cus-drawer-decision cus-drawer-decision--schedule">
                    <span className="cus-drawer-field-label">Ngày giao hàng</span>
                    <div className="cus-drawer-inline-control">
                      <UUIInput
                        aria-label="Ngày giao hàng"
                        size="sm"
                        type="date"
                        value={transportDateDrafts[drawerItem.id] ?? drawerItem.transportDate ?? ''}
                        isDisabled={!drawerItem.operational.transportDateEditable || savingTransportDateIds.has(drawerItem.id)}
                        onChange={(value) => setTransportDateDrafts((current) => ({ ...current, [drawerItem.id]: value }))}
                        className="cus-drawer-uui-field"
                        wrapperClassName="cus-drawer-uui-control"
                        inputClassName="cus-drawer-uui-input"
                      />
                      {drawerItem.operational.transportDateEditable && (
                        <UUIButton
                          size="sm"
                          color="secondary"
                          className="cus-drawer-save-date"
                          isDisabled={!(transportDateDrafts[drawerItem.id] ?? drawerItem.transportDate ?? '') || (transportDateDrafts[drawerItem.id] ?? drawerItem.transportDate ?? '') === drawerItem.transportDate || savingTransportDateIds.has(drawerItem.id)}
                          isLoading={savingTransportDateIds.has(drawerItem.id)}
                          showTextWhileLoading
                          onPress={() => void saveTransportDate(drawerItem)}
                          iconLeading={!savingTransportDateIds.has(drawerItem.id) ? <Save size={15} aria-hidden="true" /> : undefined}
                        >
                          Chốt lịch
                        </UUIButton>
                      )}
                    </div>
                  </div>
                  <div className="cus-drawer-decision cus-drawer-decision--custody">
                    <UUINativeSelect
                      label="Phơi phiếu"
                      size="sm"
                      value={drawerItem.documentCustody.status ?? ''}
                      disabled={drawerItem.bucket === ShipmentCusBucket.LOCKED || !drawerItem.documentCustody.available || !drawerItem.documentCustody.editable}
                      onChange={(event) => void updateCustody(drawerItem, event.target.value as ShipmentDocumentCustody)}
                      options={[
                        { value: '', label: 'Chưa xác định', disabled: true },
                        ...Object.values(ShipmentDocumentCustody).map((status) => ({ value: status, label: SHIPMENT_DOCUMENT_CUSTODY_LABELS[status] })),
                      ]}
                      className="cus-drawer-uui-field"
                      selectClassName="cus-drawer-uui-select"
                    />
                  </div>
                  <div className="cus-drawer-decision cus-drawer-decision--finance"><FinanceEvidence item={drawerItem} /></div>
                </div>

                <div className="cus-drawer-workflow__action">
                  <div>
                    <span className="cus-drawer-eyebrow">Hành động tiếp theo</span>
                    <strong>{drawerItem.action.kind === 'NONE' ? 'Theo dõi tiến độ lô hàng' : drawerItem.action.label}</strong>
                    {!drawerItem.action.enabled && drawerItem.action.disabledReason && <p>{drawerItem.action.disabledReason}</p>}
                  </div>
                  {shipmentActionButton(drawerItem)}
                </div>
              </section>

              <ShipmentDetailContent detail={details[drawerItem.id]} loading={detailLoadingIds.has(drawerItem.id)} error={detailErrors[drawerItem.id]} onRetry={() => void loadDetail(drawerItem.id, true)} onLineSaved={(line) => applySavedContainerLine(drawerItem.id, line)} getIdempotencyKey={getIdempotencyKey} clearIdempotencyKey={clearIdempotencyKey} idPrefix="cus-drawer-detail" onDirtyChange={(dirty) => setDetailDirty(drawerItem.id, dirty)} onSavingChange={(saving) => setDetailSaving(drawerItem.id, saving)} />
            </>
          )}
        </div>
      </Drawer>

      <Modal
        isOpen={drawerCloseConfirmId != null}
        title="Bỏ thay đổi container?"
        onClose={() => setDrawerCloseConfirmId(null)}
        footer={(
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setDrawerCloseConfirmId(null)}>Tiếp tục chỉnh sửa</button>
            <button type="button" className="btn btn--secondary" onClick={discardMobileDetailChanges}>Bỏ thay đổi và đóng</button>
          </>
        )}
      >
        <p>Có thay đổi container chưa lưu. Hãy lưu dữ liệu hoặc xác nhận bỏ thay đổi trước khi đóng.</p>
      </Modal>

      <Modal
        isOpen={Boolean(actionItem && actionMode)}
        title={actionMode === 'confirm' ? 'Xác nhận nguồn chi phí' : actionMode === 'lock' ? 'Xác nhận khóa lô' : 'Đề nghị điều chỉnh'}
        onClose={closeAction}
        onConfirm={() => void submitAction()}
        footer={(
          <>
            <button type="button" className="btn btn--ghost" onClick={closeAction} disabled={submitting}>Hủy</button>
            <button type="button" className="btn btn--primary" onClick={() => void submitAction()} disabled={submitting || !reason.trim()}>
              {submitting ? <Loader2 className="spin" size={17} aria-hidden="true" /> : null}
              {actionMode === 'confirm' ? 'Xác nhận chi phí' : actionMode === 'lock' ? 'Khóa lô' : 'Gửi đề nghị'}
            </button>
          </>
        )}
      >
        {actionMode === 'confirm' ? (
          <p>Xác nhận này chụp lại phiên bản Debit Note, chuyến xe và chi phí hiện hành. Nếu nguồn thay đổi, xác nhận sẽ hết hiệu lực.</p>
        ) : actionMode === 'lock' ? (
          <p>Khóa lô sẽ chuyển toàn bộ trường nhập và tệp tải lên sang chế độ chỉ đọc. Dữ liệu chỉ được mở lại qua yêu cầu được Quản trị viên duyệt.</p>
        ) : (
          <p>Ghi rõ nội dung cần sửa để Quản trị viên có đủ căn cứ xem xét mở lại lô hàng.</p>
        )}
        <label className="cus-action-reason">
          <span>{actionMode === 'confirm' ? 'Lý do xác nhận' : actionMode === 'lock' ? 'Lý do khóa' : 'Lý do điều chỉnh'}</span>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} maxLength={500} required autoFocus />
          <small>{reason.length}/500 ký tự</small>
        </label>
      </Modal>
    </div>
  );
}
