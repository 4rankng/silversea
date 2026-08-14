import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarClock,
  CircleCheck,
  CircleDollarSign,
  Download,
  FileLock2,
  Loader2,
  ReceiptText,
  Route,
  RotateCcw,
  Save,
  Search,
  Warehouse,
  Truck,
  X,
} from 'lucide-react';
import {
  SHIPMENT_CUS_BUCKET_LABELS,
  SHIPMENT_DOCUMENT_CUSTODY_LABELS,
  ShipmentCusBucket,
  ShipmentDocumentCustody,
  type ShipmentCusWorkspaceContainerLine,
  type ShipmentCusWorkspaceDetail,
  type ShipmentCusWorkspaceListItem,
  type ShipmentCusWorkspaceListResponse,
} from '@tingting/shared';
import { ApiError } from '../lib/api';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { StatusStrip } from '../components/shared/StatusStrip';
import { Drawer, Modal, PageHeader } from '../components/UI';
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

function summarizeWorksheetValues(values: Array<string | null | undefined>): { display: string; full: string } {
  const unique = [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
  if (unique.length === 0) return { display: '—', full: 'Chưa có dữ liệu' };
  if (unique.length === 1) return { display: unique[0], full: unique[0] };
  return { display: 'Nhiều giá trị', full: unique.join('; ') };
}

function worksheetClosingValue(item: ShipmentCusWorkspaceListItem): { display: string; full: string } {
  const appointmentValues = item.customerAppointmentAts.map((value) => formatDateTime(value));
  if (appointmentValues.length > 0) return summarizeWorksheetValues(appointmentValues);
  return summarizeWorksheetValues([
    formatDateTime(item.direction === 'EXPORT' ? item.closingAt : item.plannedReturnAt),
  ].filter((value) => value !== '—'));
}

function worksheetCarrierValues(item: ShipmentCusWorkspaceListItem): { display: string; full: string } {
  return summarizeWorksheetValues(item.carrierAssignments.map(({ carrierName, plateNumber }) => (
    [carrierName, plateNumber].filter(Boolean).join(' · ')
  )));
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
  return (
    <div className="cus-finance-evidence">
      {item.finance.isLoss ? (
        <span className="cus-finance-loss" aria-label={`Lỗ ${formatMoney(String(lossAmount))} đồng`}>
          <AlertTriangle size={15} aria-hidden="true" />
          <strong>Lỗ {formatMoney(String(lossAmount))} ₫</strong>
        </span>
      ) : (
        <span className="cus-finance-quiet" aria-label={item.finance.customerChargeTotalsAvailable ? 'Đối soát không lỗ' : 'Chưa có dữ liệu đối soát'}>
          <CircleDollarSign size={15} aria-hidden="true" />
        </span>
      )}
      <span
        className={`cus-finance-confirmation cus-finance-confirmation--${confirmationIsCurrent ? 'confirmed' : 'attention'}`}
        aria-label={accountingConfirmationLabel(item.accountingConfirmation)}
        title={accountingConfirmationLabel(item.accountingConfirmation)}
      >
        {confirmationIsCurrent
          ? <CircleCheck size={15} aria-hidden="true" />
          : <AlertTriangle size={15} aria-hidden="true" />}
      </span>
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

function ScheduleEvidence({ item }: { item: ShipmentCusWorkspaceListItem }) {
  const waiting = item.operational.scheduleReadiness === 'WAITING_DATE';
  const overdue = item.operational.scheduleReadiness === 'OVERDUE';
  return (
    <div className={`cus-operational-evidence${waiting || overdue ? ' cus-operational-evidence--warning' : ''}`}>
      <strong>{waiting ? 'Chưa chốt' : formatDate(item.transportDate)}</strong>
      <span>{item.containerSummary} · {directionLabel(item.direction)}</span>
    </div>
  );
}

function isInteractiveRowTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    'a, button, input, select, textarea, label, summary, [contenteditable="true"], [role="button"], [role="link"], [role^="menuitem"], [role="option"], [data-row-interactive]',
  ));
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
            {operationalEditable && <button type="button" className="btn btn--primary btn--sm" disabled={!dirty || saving} onClick={() => void save()} aria-label={`Lưu container ${line.containerNumber || line.ordinal}`}>
              {saving ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
              <span>Lưu</span>
            </button>}
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
          {hasEditableLine && (editing ? <button type="button" className="btn btn--secondary btn--sm" onClick={requestFinishEditing} disabled={savingLineIds.size > 0}>Hoàn tất</button> : <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditing(true)}>Chỉnh sửa</button>)}
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
  const [exporting, setExporting] = useState(false);
  const requestSequence = useRef(0);
  const detailRequestSequence = useRef<Record<number, number>>({});
  const idempotencyKeysRef = useRef<Record<string, string>>({});

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

  const shipmentActionButton = (item: ShipmentCusWorkspaceListItem, className: string) => {
    if (item.action.kind === 'NONE') return null;
    const mode = item.action.kind === 'CONFIRM_FINANCE'
      ? 'confirm'
      : item.action.kind === 'LOCK'
        ? 'lock'
        : 'reopen';
    return (
      <button
        type="button"
        className={className}
        disabled={!item.action.enabled}
        aria-label={item.action.label}
        title={!item.action.enabled ? item.action.disabledReason || undefined : undefined}
        onClick={() => openAction(item, mode)}
      >
        {item.action.kind === 'LOCK' && <FileLock2 size={16} aria-hidden="true" />}
        {item.action.label}
      </button>
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
        ['Ngày giao hàng', 'Khách hàng', 'Nhà máy', 'Số Bill/Book', 'Hãng tàu', 'Tổng số lượng', 'Trọng lượng tổng', 'Xuất/Nhập', 'Cutoff', 'Nâng', 'Hạ', 'Điểm trả', 'Loại cont', 'Giờ đóng/trả', 'Ghi chú lưu ý', 'Nhà xe'],
        exportItems.map((item) => [
          item.transportDate ?? '', item.customerName ?? '', item.factoryName ?? '', item.billOrBookNumber ?? '',
          item.shippingLineName ?? '', worksheetQuantity(item), item.weightKg == null ? '' : Number(item.weightKg), directionLabel(item.direction),
          item.customsCutoffAt ?? '', item.liftSiteNames.join('; '), item.dropoffSiteNames.join('; '), item.deliveryLocation ?? '',
          item.containerSummary, worksheetClosingValue(item).full, item.note ?? '', worksheetCarrierValues(item).full,
        ]),
        {
          title: 'Kế hoạch lô hàng',
          subtitle: `${exportItems.length.toLocaleString('vi-VN')} lô hàng`,
          columnTypes: ['date', 'text', 'text', 'text', 'text', 'text', 'number', 'text', 'date', 'text', 'text', 'text', 'text', 'text', 'text', 'text'],
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
      <Breadcrumbs items={[{ label: 'Tổng quan', to: '/dashboard' }, { label: 'Kế hoạch lô hàng' }]} />
      <PageHeader title="Kế hoạch lô hàng" iconName="cargo" description="Bảng điều hành giao nhận theo từng lô hàng" />

      <section
        className="cus-workspace cus-workspace--worksheet"
        aria-labelledby="cus-workspace-title"
        aria-busy={loading}
        aria-hidden={drawerId != null ? true : undefined}
        inert={drawerId != null ? true : undefined}
      >
        <h2 id="cus-workspace-title" className="sr-only">Bảng kế hoạch lô hàng</h2>
        <form className="cus-worksheet-toolbar" onSubmit={submitSearch} noValidate>
          <div className="cus-search-field">
            <label htmlFor="cus-shipment-search">Bill/Book hoặc tờ khai</label>
            <div className="cus-search-field__control">
              <Search size={18} aria-hidden="true" />
              <input
                id="cus-shipment-search"
                inputMode="text"
                pattern="[A-Za-z0-9]{4,5}"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                value={searchInput}
                onChange={(event) => {
                  setSearchInput(event.target.value);
                  setSearchError(null);
                }}
                placeholder="Nhập 4–5 ký tự cuối"
                aria-invalid={Boolean(searchError)}
                aria-describedby={searchError ? 'cus-search-error' : undefined}
              />
              {searchInput && (
                <button
                  type="button"
                  className="cus-icon-button"
                  onClick={() => {
                    setSearchInput('');
                    setSearchError(null);
                    updateParam('searchSuffix', null);
                  }}
                  aria-label="Xóa tìm kiếm"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              )}
            </div>
            {searchError && <span id="cus-search-error" className="cus-field-error" role="alert">{searchError}</span>}
          </div>

          <details className="cus-worksheet-filter-disclosure">
            <summary>
              Bộ lọc{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              <span aria-hidden="true">▾</span>
            </summary>
            <div className="cus-worksheet-toolbar__filters" aria-label={'Bộ lọc' + (activeFilterCount ? ' đang áp dụng ' + activeFilterCount : '')}>
              <label className="cus-filter-field">
              <span>Xuất / Nhập</span>
              <select value={direction} onChange={(event) => updateParam('direction', event.target.value || null)}>
                <option value="">Tất cả</option>
                <option value="EXPORT">Xuất</option>
                <option value="IMPORT">Nhập</option>
              </select>
              </label>
              <label className="cus-filter-field">
              <span>Từ ngày giao</span>
              <input type="date" value={dateFrom} onChange={(event) => updateParam('transportDateFrom', event.target.value || null)} />
              </label>
              <label className="cus-filter-field">
              <span>Đến ngày giao</span>
              <input type="date" value={dateTo} onChange={(event) => updateParam('transportDateTo', event.target.value || null)} />
              </label>
              <label className="cus-filter-field">
              <span>Trạng thái</span>
              <select value={bucket} onChange={(event) => updateParam('bucket', event.target.value || null)}>
                <option value="">Tất cả trạng thái</option>
                {BUCKETS.map((value) => <option key={value} value={value}>{SHIPMENT_CUS_BUCKET_LABELS[value]}</option>)}
              </select>
              </label>
            </div>
          </details>

          <div className="cus-worksheet-toolbar__actions">
            <button className="btn btn--primary" type="submit"><Search size={17} aria-hidden="true" /> Tìm kiếm</button>
            {hasFilters && <button className="btn btn--ghost" type="button" onClick={clearFilters}><RotateCcw size={17} aria-hidden="true" /> Xóa lọc</button>}
            <button className="btn btn--secondary" type="button" disabled={exporting || loading} onClick={() => void exportWorksheet()}>
              {exporting ? <Loader2 className="spin" size={17} aria-hidden="true" /> : <Download size={17} aria-hidden="true" />}
              Tải XLSX
            </button>
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

        <div className="cus-worksheet-meta" role="status" aria-live="polite">
          <strong>{resultLabel}</strong>
          <span>Cuộn ngang trong bảng để xem đủ 16 cột nghiệp vụ.</span>
        </div>

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
              Bảng có thể cuộn ngang và dọc. Dùng phím mũi tên hoặc Shift cộng con lăn để di chuyển, rồi mở nút chi tiết ở đầu mỗi dòng để chỉnh sửa.
            </p>
            <div className="cus-worksheet-viewport" role="region" aria-label="Bảng kế hoạch lô hàng" aria-describedby="cus-worksheet-instructions" tabIndex={0}>
              <table className="cus-worksheet-table">
                <caption className="sr-only">Kế hoạch giao nhận lô hàng theo 16 cột nghiệp vụ</caption>
                <colgroup>
                  <col className="cus-worksheet-col--control" /><col className="cus-worksheet-col--date" />
                  <col className="cus-worksheet-col--customer" /><col className="cus-worksheet-col--factory" />
                  <col className="cus-worksheet-col--bill" /><col className="cus-worksheet-col--line" />
                  <col className="cus-worksheet-col--count" /><col className="cus-worksheet-col--weight" />
                  <col className="cus-worksheet-col--direction" /><col className="cus-worksheet-col--cutoff" />
                  <col className="cus-worksheet-col--lift" /><col className="cus-worksheet-col--drop" />
                  <col className="cus-worksheet-col--destination" /><col className="cus-worksheet-col--container" />
                  <col className="cus-worksheet-col--closing" /><col className="cus-worksheet-col--note" />
                  <col className="cus-worksheet-col--carrier" />
                </colgroup>
                <thead>
                  <tr className="cus-worksheet-groups">
                    <th className="cus-worksheet-sticky-control" scope="col" rowSpan={2}>Lô hàng / chi tiết</th>
                    <th scope="colgroup" colSpan={5}>Thông tin lô hàng</th>
                    <th scope="colgroup" colSpan={3}>Hàng hóa</th>
                    <th scope="colgroup" colSpan={2}>Kế hoạch</th>
                    <th scope="colgroup" colSpan={6}>Điều vận</th>
                  </tr>
                  <tr>
                    <th scope="col">Ngày giao hàng</th><th scope="col">Khách hàng</th>
                    <th scope="col">Nhà máy</th><th scope="col">Số Bill/Book</th>
                    <th scope="col">Hãng tàu</th><th scope="col">Tổng số lượng</th>
                    <th scope="col">Trọng lượng tổng</th><th scope="col">Xuất / Nhập</th>
                    <th scope="col">Cutoff</th><th scope="col">Nâng</th><th scope="col">Hạ</th>
                    <th scope="col">Điểm trả</th><th scope="col">Loại cont</th>
                    <th scope="col">Giờ đóng / trả</th><th scope="col">Ghi chú lưu ý</th><th scope="col">Nhà xe</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const lift = summarizeWorksheetValues(item.liftSiteNames);
                    const dropoff = summarizeWorksheetValues(item.dropoffSiteNames);
                    const closing = worksheetClosingValue(item);
                    const carriers = worksheetCarrierValues(item);
                    const identity = item.billOrBookNumber || item.declarationNumber || item.customerName || 'lô hàng';
                    const needsAttention = Boolean(item.finance.isLoss || item.finance.hasPendingRecovery || !item.action.enabled);
                    return (
                      <tr
                        key={item.id}
                        className="cus-worksheet-row"
                        onClick={(event) => {
                          if (isInteractiveRowTarget(event.target)) return;
                          openShipmentDetail(item.id);
                        }}
                      >
                        <th className="cus-worksheet-sticky-control" scope="row">
                          <StatusStrip color={SHIPMENT_BUCKET_COLORS[item.bucket]} />
                          <button
                            id={'cus-row-disclosure-' + item.id}
                            type="button"
                            className="cus-row-disclosure cus-row-disclosure--worksheet"
                            aria-haspopup="dialog"
                            aria-controls={'cus-detail-drawer-' + item.id}
                            aria-label={'Mở chi tiết lô hàng ' + identity + ', trạng thái ' + item.bucketLabel}
                            onClick={() => openShipmentDetail(item.id)}
                          >
                            <span className="cus-row-disclosure__identity" aria-hidden="true">{identity}</span>
                            <span className="cus-row-disclosure__status" aria-hidden="true">{item.bucketLabel}</span>
                            {needsAttention && <AlertTriangle size={13} aria-hidden="true" />}
                          </button>
                          <span className="sr-only">{item.bucketLabel}{needsAttention ? ', cần kiểm tra' : ''}</span>
                        </th>
                        <td className="cus-worksheet-cell--date">{formatDate(item.transportDate)}</td>
                        <td><strong>{item.customerName || '—'}</strong></td>
                        <td>{item.factoryName || '—'}</td>
                        <td className="cus-worksheet-cell--mono"><strong>{item.billOrBookNumber || '—'}</strong></td>
                        <td>{item.shippingLineName || '—'}</td>
                        <td className="cus-worksheet-cell--number">{worksheetQuantity(item)}</td>
                        <td className="cus-worksheet-cell--number">{formatQuantity(item.weightKg)} kg</td>
                        <td>{directionLabel(item.direction)}</td>
                        <td>{formatDateTime(item.customsCutoffAt)}</td>
                        <td aria-label={lift.full} className={lift.display === 'Nhiều giá trị' ? 'cus-worksheet-cell--mixed' : undefined}>{lift.display}</td>
                        <td aria-label={dropoff.full} className={dropoff.display === 'Nhiều giá trị' ? 'cus-worksheet-cell--mixed' : undefined}>{dropoff.display}</td>
                        <td>{item.deliveryLocation || item.factoryName || '—'}</td>
                        <td>{item.containerSummary || '—'}</td>
                        <td aria-label={closing.full} className={closing.display === 'Nhiều giá trị' ? 'cus-worksheet-cell--mixed' : undefined}>{closing.display}</td>
                        <td>{item.note || '—'}</td>
                        <td aria-label={carriers.full} className={carriers.display === 'Nhiều giá trị' ? 'cus-worksheet-cell--mixed' : undefined}>{carriers.display}</td>
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

      <Drawer
        isOpen={drawerId != null}
        onClose={requestCloseMobileDetail}
        title={drawerItem?.customerName || 'Chi tiết lô hàng'}
        subtitle={drawerItem?.billOrBookNumber || drawerItem?.declarationNumber || undefined}
        className="cus-shipment-drawer"
      >
        <div id={drawerItem ? `cus-detail-drawer-${drawerItem.id}` : undefined}>
          {drawerItem && (
            <>
              <section className="cus-drawer-workflow" aria-labelledby="cus-drawer-workflow-title">
                <div className="cus-drawer-workflow__heading">
                  <div>
                    <h3 id="cus-drawer-workflow-title">Điều hành lô hàng</h3>
                    <p>{drawerItem.factoryName || drawerItem.deliveryLocation || 'Chưa xác định điểm giao'}</p>
                  </div>
                  <WorkflowBadge item={drawerItem} />
                </div>
                <ShipmentSignals item={drawerItem} />
                <FinanceEvidence item={drawerItem} />

                <div className="cus-drawer-workflow__grid">
                  <label>
                    <span>Ngày giao hàng</span>
                    <div className="cus-drawer-inline-control">
                      <input
                        type="date"
                        value={transportDateDrafts[drawerItem.id] ?? drawerItem.transportDate ?? ''}
                        disabled={!drawerItem.operational.transportDateEditable || savingTransportDateIds.has(drawerItem.id)}
                        onChange={(event) => setTransportDateDrafts((current) => ({ ...current, [drawerItem.id]: event.target.value }))}
                      />
                      {drawerItem.operational.transportDateEditable && (
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={!(transportDateDrafts[drawerItem.id] ?? drawerItem.transportDate ?? '') || (transportDateDrafts[drawerItem.id] ?? drawerItem.transportDate ?? '') === drawerItem.transportDate || savingTransportDateIds.has(drawerItem.id)}
                          onClick={() => void saveTransportDate(drawerItem)}
                        >
                          {savingTransportDateIds.has(drawerItem.id) ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
                          Chốt lịch
                        </button>
                      )}
                    </div>
                  </label>
                  <label>
                    <span>Phơi phiếu</span>
                    <select
                      className="cus-custody-select"
                      value={drawerItem.documentCustody.status ?? ''}
                      disabled={drawerItem.bucket === ShipmentCusBucket.LOCKED || !drawerItem.documentCustody.available || !drawerItem.documentCustody.editable}
                      onChange={(event) => void updateCustody(drawerItem, event.target.value as ShipmentDocumentCustody)}
                    >
                      <option value="" disabled>Chưa xác định</option>
                      {Object.values(ShipmentDocumentCustody).map((status) => <option value={status} key={status}>{SHIPMENT_DOCUMENT_CUSTODY_LABELS[status]}</option>)}
                    </select>
                  </label>
                  <div>
                    <span>Kế toán xác nhận</span>
                    <strong>{accountingConfirmationLabel(drawerItem.accountingConfirmation)}</strong>
                  </div>
                </div>

                <div className="cus-drawer-workflow__action">
                  {shipmentActionButton(drawerItem, 'btn btn--primary')}
                  {!drawerItem.action.enabled && drawerItem.action.disabledReason && <p>{drawerItem.action.disabledReason}</p>}
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
