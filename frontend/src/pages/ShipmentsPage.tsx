import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  CircleCheck,
  CircleDollarSign,
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
import { StatusStrip, StatusSwatch } from '../components/shared/StatusStrip';
import { Drawer, Modal, PageHeader } from '../components/UI';
import { EmptyState, Pagination, SearchableSelect } from '../design-system';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/DropdownMenu/DropdownMenu';
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
type CusWorkspaceLayout = 'wide' | 'compact' | 'cards';
type OptionalMasterColumn = 'route' | 'type' | 'invoice' | 'nonInvoice';
type MasterColumnPreferences = Record<'wide' | 'compact', OptionalMasterColumn[]>;

const OPTIONAL_MASTER_COLUMNS: Array<{ id: OptionalMasterColumn; label: string }> = [
  { id: 'route', label: 'Hãng tàu / Tuyến' },
  { id: 'type', label: 'Loại hàng' },
  { id: 'invoice', label: 'Thu có hóa đơn' },
  { id: 'nonInvoice', label: 'Thu không hóa đơn' },
];
const DEFAULT_MASTER_COLUMNS: MasterColumnPreferences = {
  wide: OPTIONAL_MASTER_COLUMNS.map((column) => column.id),
  compact: ['route', 'invoice'],
};
const MASTER_COLUMN_PREFERENCES_KEY = 'silversea:cus-shipments:master-columns:v3';

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
  const factVersionRef = useRef(line.factVersion);
  const permissions = line.permissions;
  const carrierEditable = editing && permissions.carrierEditable;
  const plateEditable = editing && permissions.plateEditable;
  const containerTypeEditable = editing && permissions.containerTypeEditable;
  const liftSiteEditable = editing && permissions.liftSiteEditable;
  const dropoffSiteEditable = editing && permissions.dropoffSiteEditable;
  const customerAppointmentEditable = editing && permissions.customerAppointmentEditable;
  const operationalEditable = carrierEditable || plateEditable || containerTypeEditable || liftSiteEditable || dropoffSiteEditable || customerAppointmentEditable;

  useEffect(() => {
    if (factVersionRef.current === line.factVersion) return;
    factVersionRef.current = line.factVersion;
    setDraft(lineDraft(line));
    setDirty(false);
  }, [line, line.factVersion]);

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
      const signature = idempotencySignature('container', detail.summary.id, line.id, line.shipmentVersion, line.factVersion);
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
        expectedFactVersion: line.factVersion,
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
      <p className="cus-container-ledger__finance-note">Chi phí không nhập tại đây. Kế toán đối soát chi phí thực tế sau khi lô hàng hoàn thành.</p>
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
  const workspaceRef = useRef<HTMLElement>(null);
  const page = Math.max(1, Number(searchParams.get('page') || 1) || 1);
  const suffixParam = searchParams.get('searchSuffix') ?? '';
  const dateFrom = searchParams.get('transportDateFrom') ?? '';
  const dateTo = searchParams.get('transportDateTo') ?? '';
  const rawBucket = searchParams.get('bucket');
  const bucket = BUCKETS.includes(rawBucket as ShipmentCusBucket)
    ? rawBucket as ShipmentCusBucket
    : '';

  const [searchInput, setSearchInput] = useState(suffixParam);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [data, setData] = useState<ShipmentCusWorkspaceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [drawerCloseConfirmId, setDrawerCloseConfirmId] = useState<number | null>(null);
  const [expandedShipmentIds, setExpandedShipmentIds] = useState<Set<number>>(() => new Set());
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
  const [workspaceLayout, setWorkspaceLayout] = useState<CusWorkspaceLayout>('wide');
  const [masterColumnPreferences, setMasterColumnPreferences] = useState<MasterColumnPreferences>(DEFAULT_MASTER_COLUMNS);
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

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(MASTER_COLUMN_PREFERENCES_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Partial<MasterColumnPreferences>;
      const sanitize = (columns: unknown, fallback: OptionalMasterColumn[]) => (
        Array.isArray(columns)
          ? columns.filter((column): column is OptionalMasterColumn => OPTIONAL_MASTER_COLUMNS.some((candidate) => candidate.id === column))
          : fallback
      );
      setMasterColumnPreferences({
        wide: sanitize(parsed.wide, DEFAULT_MASTER_COLUMNS.wide),
        compact: sanitize(parsed.compact, DEFAULT_MASTER_COLUMNS.compact),
      });
    } catch {
      // A blocked or malformed local preference must not prevent CUS from working.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(MASTER_COLUMN_PREFERENCES_KEY, JSON.stringify(masterColumnPreferences));
    } catch {
      // Persistence is a convenience; a browser privacy setting cannot break the ledger.
    }
  }, [masterColumnPreferences]);

  // Measure before the first paint so narrow viewports never flash the wide
  // table (a 'wide'-first render momentarily expands scrollWidth on mobile).
  useLayoutEffect(() => {
    const element = workspaceRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    const updateLayout = () => {
      const availableWidth = element.getBoundingClientRect().width;
      setWorkspaceLayout(availableWidth >= 1040 ? 'wide' : availableWidth >= 760 ? 'compact' : 'cards');
    };
    const observer = new ResizeObserver(updateLayout);
    updateLayout();
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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
  }, [bucket, dateFrom, dateTo, page, suffixParam]);

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

  const openMobileDetail = useCallback((shipmentId: number) => {
    setDrawerId(shipmentId);
    void loadDetail(shipmentId);
  }, [loadDetail]);

  const toggleInlineDetail = useCallback((shipmentId: number) => {
    if (expandedShipmentIds.has(shipmentId)) return;
    setExpandedShipmentIds((current) => {
      const next = new Set(current);
      next.add(shipmentId);
      return next;
    });
    if (!details[shipmentId]) void loadDetail(shipmentId);
  }, [details, expandedShipmentIds, loadDetail]);

  const collapseInlineDetail = useCallback((shipmentId: number) => {
    setExpandedShipmentIds((current) => {
      if (!current.has(shipmentId)) return current;
      const next = new Set(current);
      next.delete(shipmentId);
      return next;
    });
    setDetailDirty(shipmentId, false);
    // Focus synchronously: the disclosure button exists before and after the
    // collapse commit, and a rAF deferral can lose the focus race under load.
    document.getElementById(`cus-row-disclosure-${shipmentId}`)?.focus();
  }, [setDetailDirty]);

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
      ['searchSuffix', 'transportDateFrom', 'transportDateTo', 'bucket', 'page'].forEach((key) => next.delete(key));
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
      if (expandedShipmentIds.has(item.id) || drawerId === item.id) void loadDetail(item.id, true);
      if (workspaceLayout === 'cards') setDrawerId(null);
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
      if (expandedShipmentIds.has(actionItem.id)) void loadDetail(actionItem.id, true);
      await loadList();
    } catch (actionError) {
      setError(safeError(actionError, 'Không thể hoàn tất thao tác.'));
    } finally {
      setSubmitting(false);
    }
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const visibleSummary = data?.pageSummary;
  const totalPages = Math.max(1, data?.totalPages ?? Math.ceil(total / PAGE_SIZE));
  const drawerItem = items.find((item) => item.id === drawerId) ?? null;
  const activeColumnMode = workspaceLayout === 'compact' ? 'compact' : 'wide';
  const visibleOptionalColumns = masterColumnPreferences[activeColumnMode];
  const visibleColumnCount = 8 + visibleOptionalColumns.length;
  const hasFilters = Boolean(suffixParam || dateFrom || dateTo || bucket);

  const resultLabel = useMemo(() => {
    if (loading) return 'Đang cập nhật danh sách…';
    if (error && !data) return 'Không thể tải dữ liệu';
    return `${total.toLocaleString('vi-VN')} lô hàng`;
  }, [data, error, loading, total]);
  const filterChips = useMemo(() => [
    suffixParam ? { key: 'searchSuffix', label: `Mã: ${suffixParam}` } : null,
    dateFrom ? { key: 'transportDateFrom', label: `Từ ${formatDate(dateFrom)}` } : null,
    dateTo ? { key: 'transportDateTo', label: `Đến ${formatDate(dateTo)}` } : null,
    bucket ? { key: 'bucket', label: SHIPMENT_CUS_BUCKET_LABELS[bucket] } : null,
  ].filter((chip): chip is { key: string; label: string } => chip != null), [bucket, dateFrom, dateTo, suffixParam]);

  useEffect(() => {
    setExpandedShipmentIds((current) => {
      const visibleIds = new Set(items.map((item) => item.id));
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [items]);

  const setOptionalColumnVisible = (column: OptionalMasterColumn, checked: boolean) => {
    setMasterColumnPreferences((current) => {
      const currentColumns = current[activeColumnMode];
      const nextColumns = checked
        ? [...currentColumns, column]
        : currentColumns.filter((candidate) => candidate !== column);
      return { ...current, [activeColumnMode]: OPTIONAL_MASTER_COLUMNS.map(({ id }) => id).filter((id) => nextColumns.includes(id)) };
    });
  };

  return (
    <div className="shipments-page">
      <Breadcrumbs items={[{ label: 'Tổng quan', to: '/dashboard' }, { label: 'Quản lý lô hàng' }]} />
      <PageHeader
        title="Quản lý lô hàng"
        iconName="cargo"
        description="Theo dõi tiến độ, xử lý ngoại lệ và hoàn tất khóa lô"
      />

      <section
        ref={workspaceRef}
        className="cus-workspace"
        data-layout={workspaceLayout}
        aria-labelledby="cus-workspace-title"
        aria-busy={loading}
        aria-hidden={drawerId != null ? true : undefined}
        inert={drawerId != null ? true : undefined}
      >
        <h2 id="cus-workspace-title" className="sr-only">Không gian quản lý lô hàng CUS</h2>
        <form className="cus-toolbar" onSubmit={submitSearch} noValidate>
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

          <label className="cus-filter-field">
            <span>Từ ngày vận chuyển</span>
            <input type="date" value={dateFrom} onChange={(event) => updateParam('transportDateFrom', event.target.value || null)} />
          </label>
          <label className="cus-filter-field">
            <span>Đến ngày vận chuyển</span>
            <input type="date" value={dateTo} onChange={(event) => updateParam('transportDateTo', event.target.value || null)} />
          </label>
          <label className="cus-filter-field">
            <span>Trạng thái</span>
            <select value={bucket} onChange={(event) => updateParam('bucket', event.target.value || null)}>
              <option value="">Tất cả trạng thái</option>
              {BUCKETS.map((value) => <option key={value} value={value}>{SHIPMENT_CUS_BUCKET_LABELS[value]}</option>)}
            </select>
          </label>

          <div className="cus-toolbar__actions">
            <button className="btn btn--primary" type="submit"><Search size={17} aria-hidden="true" /> Tìm kiếm</button>
            {workspaceLayout !== 'cards' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="btn btn--secondary cus-column-menu" aria-label="Chọn cột hiển thị">
                    Cột hiển thị <ChevronDown size={16} aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="cus-column-menu__content">
                  <DropdownMenuLabel>Cột tùy chọn</DropdownMenuLabel>
                  {OPTIONAL_MASTER_COLUMNS.map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      checked={visibleOptionalColumns.includes(column.id)}
                      onCheckedChange={(checked) => setOptionalColumnVisible(column.id, checked === true)}
                    >
                      {column.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setMasterColumnPreferences((current) => ({
                    ...current,
                    [activeColumnMode]: [...DEFAULT_MASTER_COLUMNS[activeColumnMode]],
                  }))}>
                    Khôi phục mặc định
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {hasFilters && (
              <button className="btn btn--ghost" type="button" onClick={clearFilters}><RotateCcw size={17} aria-hidden="true" /> Xóa lọc</button>
            )}
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
                aria-label={`Xóa bộ lọc ${chip.label}`}
              >
                {chip.label} <X size={13} aria-hidden="true" />
              </button>
            ))}
            {filterChips.length > 1 && <button type="button" className="cus-clear-filters" onClick={clearFilters}>Xóa tất cả</button>}
          </div>
        )}

        {visibleSummary && (
          <div className="cus-action-summary" aria-label="Tình trạng các lô đang hiển thị">
            <span className="cus-action-summary__scope">Trang này</span>
            <span><CalendarClock size={15} aria-hidden="true" /><strong>{visibleSummary.needsSchedule}</strong> chờ lịch</span>
            <span><Truck size={15} aria-hidden="true" /><strong>{visibleSummary.needsVehicle}</strong> chờ xe/BKS</span>
            <span><ReceiptText size={15} aria-hidden="true" /><strong>{visibleSummary.waitingAccounting}</strong> chờ Kế toán</span>
            <span className="cus-action-summary__ready"><CircleCheck size={15} aria-hidden="true" /><strong>{visibleSummary.readyToLock}</strong> sẵn sàng khóa</span>
            <span className="cus-action-summary__attention"><AlertTriangle size={15} aria-hidden="true" /><strong>{visibleSummary.needsAttention}</strong> cần xử lý</span>
          </div>
        )}

        <div className="cus-workspace__summary" role="status" aria-live="polite">
          <span>{resultLabel}</span>
          <div className="cus-status-legend" aria-label="Chú thích trạng thái lô hàng">
            {BUCKETS.map((value) => (
              <span key={value}><StatusSwatch color={SHIPMENT_BUCKET_COLORS[value]} /> {SHIPMENT_CUS_BUCKET_LABELS[value]}</span>
            ))}
          </div>
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
            <div className="cus-master-scroll" role="region" aria-label="Bảng tổng hợp lô hàng">
              <table className={`cus-master-table cus-master-table--${workspaceLayout}`}>
                <colgroup>
                  <col className="cus-master-table__col-customer" />
                  <col className="cus-master-table__col-bill" />
                  {visibleOptionalColumns.includes('route') && <col className="cus-master-table__col-route" />}
                  {visibleOptionalColumns.includes('type') && <col className="cus-master-table__col-type" />}
                  <col className="cus-master-table__col-quantity" />
                  <col className="cus-master-table__col-plan" />
                  {visibleOptionalColumns.includes('invoice') && <col className="cus-master-table__col-invoice" />}
                  {visibleOptionalColumns.includes('nonInvoice') && <col className="cus-master-table__col-non-invoice" />}
                  <col className="cus-master-table__col-cost" />
                  <col className="cus-master-table__col-custody" />
                  <col className="cus-master-table__col-accounting" />
                  <col className="cus-master-table__col-status" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Khách hàng / Nhà máy</th>
                    <th scope="col">Bill/Book / Tờ khai</th>
                    {visibleOptionalColumns.includes('route') && <th scope="col">Hãng tàu / Tuyến</th>}
                    {visibleOptionalColumns.includes('type') && <th scope="col">Loại hàng</th>}
                    <th scope="col">Số lượng</th>
                    <th scope="col">Kế hoạch</th>
                    {visibleOptionalColumns.includes('invoice') && <th scope="col">Thu có hóa đơn</th>}
                    {visibleOptionalColumns.includes('nonInvoice') && <th scope="col">Thu không hóa đơn</th>}
                    <th scope="col">Tổng chi phí</th>
                    <th scope="col">Phơi phiếu</th>
                    <th scope="col">Kế toán duyệt</th>
                    <th scope="col">Trạng thái / Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const expanded = expandedShipmentIds.has(item.id);
                    const detailLoading = detailLoadingIds.has(item.id);
                    return (
                      <Fragment key={item.id}>
                      <tr
                        key={`master-${item.id}`}
                        className={`cus-master-row${expanded ? ' cus-master-row--expanded' : ''}`}
                        onClick={(event) => {
                          if (isInteractiveRowTarget(event.target)) return;
                          toggleInlineDetail(item.id);
                        }}
                      >
                        <td>
                          <StatusStrip color={SHIPMENT_BUCKET_COLORS[item.bucket]} />
                          <button id={`cus-row-disclosure-${item.id}`} type="button" className="cus-row-disclosure" aria-expanded={expanded} aria-controls={`cus-inline-detail-${item.id}`} aria-label={`${expanded ? 'Chi tiết container đang mở' : 'Mở chi tiết container'} của ${item.billOrBookNumber || item.declarationNumber || item.customerName || 'lô hàng'}`} onClick={() => toggleInlineDetail(item.id)}><span className="sr-only">{expanded ? 'Chi tiết container đang mở. Dùng nút Thu gọn trong phần chi tiết.' : 'Mở chi tiết container'}</span></button>
                          <div className="cus-index-cell">
                            <strong>{item.customerName || 'Chưa có khách hàng'}</strong>
                            <span title={item.factoryName || 'Chưa có nhà máy'}><Warehouse size={13} aria-hidden="true" /> {item.factoryName || 'Chưa có nhà máy'}</span>
                          </div>
                        </td>
                        <td>
                          <div className="cus-index-cell"><strong>{item.billOrBookNumber || 'Chưa có Bill/Book'}</strong><span>{item.declarationNumber ? `Tờ khai ${item.declarationNumber}` : 'Chưa có tờ khai'}</span></div>
                        </td>
                        {visibleOptionalColumns.includes('route') && <td><div className="cus-index-cell"><strong>{item.shippingLineName || '—'}</strong><span><Route size={13} aria-hidden="true" /> {item.routeName || 'Chưa xác định tuyến'}</span></div></td>}
                        {visibleOptionalColumns.includes('type') && <td><div className="cus-index-cell"><strong>{directionLabel(item.direction)}</strong><span>{item.isCombined ? 'Có kết hợp hàng' : 'Không kết hợp'}</span></div></td>}
                        <td>
                          <div className="cus-index-cell cus-index-cell--numbers"><strong>{item.containerSummary || '—'}</strong><span>{formatQuantity(item.weightKg)} kg · {formatQuantity(item.volumeCbm, 3)} CBM</span></div>
                        </td>
                        <td>
                          <div className="cus-index-cell"><ScheduleEvidence item={item} />
                            {item.operational.transportDateEditable && <div className="cus-schedule-editor" data-row-interactive><label className="sr-only" htmlFor={`cus-master-transport-date-${item.id}`}>Ngày vận chuyển của {item.billOrBookNumber || item.declarationNumber || item.customerName || 'lô hàng'}</label><input id={`cus-master-transport-date-${item.id}`} type="date" value={transportDateDrafts[item.id] ?? item.transportDate ?? ''} disabled={savingTransportDateIds.has(item.id)} onChange={(event) => setTransportDateDrafts((current) => ({ ...current, [item.id]: event.target.value }))} /><button type="button" className="cus-schedule-editor__save" disabled={!(transportDateDrafts[item.id] ?? item.transportDate ?? '') || (transportDateDrafts[item.id] ?? item.transportDate ?? '') === item.transportDate || savingTransportDateIds.has(item.id)} onClick={() => void saveTransportDate(item)} aria-label={`Chốt ngày vận chuyển của ${item.billOrBookNumber || item.declarationNumber || item.customerName || 'lô hàng'}`}>{savingTransportDateIds.has(item.id) ? <Loader2 className="spin" size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}</button></div>}
                            <span>{item.note || 'Không có ghi chú'}</span></div>
                        </td>
                        {visibleOptionalColumns.includes('invoice') && <td><div className="cus-index-cell cus-index-cell--money"><strong>{item.finance.customerChargeTotalsAvailable ? `${formatMoney(item.finance.customerInvoiceTotal)} ₫` : 'Chưa có dữ liệu'}</strong></div></td>}
                        {visibleOptionalColumns.includes('nonInvoice') && <td><div className="cus-index-cell cus-index-cell--money"><strong>{item.finance.customerChargeTotalsAvailable ? `${formatMoney(item.finance.customerNoInvoiceTotal)} ₫` : 'Chưa có dữ liệu'}</strong></div></td>}
                        <td>
                          <div className="cus-index-cell cus-index-cell--money"><strong>{item.finance.totalCostAvailable ? `${formatMoney(item.finance.totalCost)} ₫` : 'Chưa có dữ liệu'}</strong><FinanceEvidence item={item} /></div>
                        </td>
                        <td>
                          <select className="cus-custody-select cus-custody-select--table" value={item.documentCustody.status ?? ''} disabled={item.bucket === ShipmentCusBucket.LOCKED || !item.documentCustody.available || !item.documentCustody.editable} aria-label={`Trạng thái phơi phiếu của ${item.customerName || 'lô hàng'}`} onChange={(event) => void updateCustody(item, event.target.value as ShipmentDocumentCustody)}><option value="" disabled>Chưa xác định</option>{Object.values(ShipmentDocumentCustody).map((status) => <option value={status} key={status}>{SHIPMENT_DOCUMENT_CUSTODY_LABELS[status]}</option>)}</select>
                        </td>
                        <td><div className="cus-index-cell"><strong>{accountingConfirmationLabel(item.accountingConfirmation)}</strong></div></td>
                        <td>
                          <div className="cus-status-cell"><WorkflowBadge item={item} /><ShipmentSignals item={item} />{shipmentActionButton(item, 'btn btn--primary btn--sm')}</div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr key={`detail-${item.id}`} className="cus-inline-detail-row"><td id={`cus-inline-detail-${item.id}`} colSpan={visibleColumnCount}>
                          <ShipmentDetailContent detail={details[item.id]} loading={detailLoading} error={detailErrors[item.id]} onRetry={() => void loadDetail(item.id, true)} onLineSaved={(line) => applySavedContainerLine(item.id, line)} getIdempotencyKey={getIdempotencyKey} clearIdempotencyKey={clearIdempotencyKey} idPrefix="cus-inline-detail" onCollapse={() => collapseInlineDetail(item.id)} onDirtyChange={(dirty) => setDetailDirty(item.id, dirty)} onSavingChange={(saving) => setDetailSaving(item.id, saving)} />
                        </td></tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="cus-mobile-list" aria-label="Danh sách lô hàng trên thiết bị di động">
              {items.map((item) => (
                <article
                  key={item.id}
                  className={`cus-mobile-card cus-mobile-card--interactive${item.finance.isLoss ? ' cus-mobile-card--loss' : ''}${item.finance.hasPendingRecovery ? ' cus-mobile-card--pending' : ''}`}
                  onClick={(event) => {
                    if (isInteractiveRowTarget(event.target)) return;
                    openMobileDetail(item.id);
                  }}
                >
                  <StatusStrip color={SHIPMENT_BUCKET_COLORS[item.bucket]} />
                  <header>
                    <div>
                      <h3>{item.customerName || 'Chưa có khách hàng'}</h3>
                      <button
                        type="button"
                        className="cus-mobile-card__reference"
                        aria-haspopup="dialog"
                        aria-controls={`cus-detail-drawer-${item.id}`}
                        aria-label={`Mở chi tiết lô hàng của ${item.customerName || 'khách hàng'}`}
                        onClick={() => openMobileDetail(item.id)}
                      >
                        {item.billOrBookNumber || item.declarationNumber || 'Chưa có Bill/Tờ khai'}
                        <span className="sr-only"> — Mở chi tiết lô hàng</span>
                      </button>
                    </div>
                  </header>
                  <div className="cus-mobile-card__workflow"><WorkflowBadge item={item} /></div>
                  <ShipmentSignals item={item} />
                  <FinanceEvidence item={item} />
                  <dl>
                    <div className="cus-mobile-card__wide"><dt>Tuyến</dt><dd>{item.routeName || item.factoryName || 'Chưa xác định'}</dd></div>
                    <div><dt>Ngày vận chuyển</dt><dd>{formatDate(item.transportDate)}</dd></div>
                    <div><dt>Container</dt><dd>{item.containerSummary} · {directionLabel(item.direction)}</dd></div>
                    <div><dt>Điều xe</dt><dd>{item.operational.assignedContainers}/{item.operational.totalContainers}</dd></div>
                    <div><dt>Biển số</dt><dd>{item.operational.plateAssignedContainers}/{item.operational.totalContainers}</dd></div>
                  </dl>
                  <div className="cus-mobile-card__shipment-controls" data-row-interactive>
                    <label><span>Ngày vận chuyển</span><input type="date" value={transportDateDrafts[item.id] ?? item.transportDate ?? ''} disabled={!item.operational.transportDateEditable || savingTransportDateIds.has(item.id)} onChange={(event) => setTransportDateDrafts((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
                    {item.operational.transportDateEditable && <button type="button" className="btn btn--secondary btn--sm" disabled={!(transportDateDrafts[item.id] ?? item.transportDate ?? '') || (transportDateDrafts[item.id] ?? item.transportDate ?? '') === item.transportDate || savingTransportDateIds.has(item.id)} onClick={() => void saveTransportDate(item)}>{savingTransportDateIds.has(item.id) ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />} Chốt lịch</button>}
                    <label><span>Phơi phiếu</span><select className="cus-custody-select" value={item.documentCustody.status ?? ''} disabled={item.bucket === ShipmentCusBucket.LOCKED || !item.documentCustody.available || !item.documentCustody.editable} aria-label={`Trạng thái phơi phiếu của ${item.customerName || 'lô hàng'}`} onChange={(event) => void updateCustody(item, event.target.value as ShipmentDocumentCustody)}><option value="" disabled>Chưa xác định</option>{Object.values(ShipmentDocumentCustody).map((status) => <option value={status} key={status}>{SHIPMENT_DOCUMENT_CUSTODY_LABELS[status]}</option>)}</select></label>
                  </div>
                  {item.action.kind !== 'NONE' && (
                    <footer className="cus-mobile-card__action" data-row-interactive>
                      {shipmentActionButton(item, 'btn btn--primary btn--sm')}
                      {!item.action.enabled && item.action.disabledReason && <span>{item.action.disabledReason}</span>}
                    </footer>
                  )}
                </article>
              ))}
            </div>

            {totalPages > 1 && (
              <Pagination
                page={page}
                totalPages={totalPages}
                totalItems={total}
                pageSize={PAGE_SIZE}
                onChange={(nextPage) => updateParam('page', String(nextPage))}
              />
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
            <ShipmentDetailContent detail={details[drawerItem.id]} loading={detailLoadingIds.has(drawerItem.id)} error={detailErrors[drawerItem.id]} onRetry={() => void loadDetail(drawerItem.id, true)} onLineSaved={(line) => applySavedContainerLine(drawerItem.id, line)} getIdempotencyKey={getIdempotencyKey} clearIdempotencyKey={clearIdempotencyKey} idPrefix="cus-drawer-detail" onDirtyChange={(dirty) => setDetailDirty(drawerItem.id, dirty)} onSavingChange={(saving) => setDetailSaving(drawerItem.id, saving)} />
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
