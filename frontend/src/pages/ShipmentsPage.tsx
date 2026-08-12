import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CircleDollarSign,
  FileLock2,
  Loader2,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
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
import { Drawer, Modal, PageHeader } from '../components/UI';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../components/ui/DropdownMenu';
import { EmptyState, Pagination, SearchableSelect, Tabs } from '../design-system';
import {
  getCusShipmentWorkspaceDetail,
  confirmCusShipmentFinance,
  listCusShipmentWorkspace,
  lockCusShipment,
  requestCusShipmentReopen,
  updateCusShipmentContainerLine,
  updateCusShipmentDocumentCustody,
} from '../api/shipmentClient';
import './ShipmentsPage.css';

const PAGE_SIZE = 20;
const SEARCH_PATTERN = /^[A-Za-z0-9]{4,5}$/;
const BUCKETS = Object.values(ShipmentCusBucket);
const CUS_COLUMN_PREFERENCE_KEY = 'silversea:cus-shipments:columns:v2';
const OPTIONAL_CUS_COLUMNS = ['containerSchedule', 'records'] as const;
type OptionalCusColumn = (typeof OPTIONAL_CUS_COLUMNS)[number];
type CusWorkspaceLayout = 'wide' | 'compact' | 'cards';

interface CusColumnPreferences {
  wide: OptionalCusColumn[];
  compact: OptionalCusColumn[];
}

const DEFAULT_CUS_COLUMN_PREFERENCES: CusColumnPreferences = {
  wide: ['containerSchedule', 'records'],
  compact: ['records'],
};

function readCusColumnPreferences(): CusColumnPreferences {
  if (typeof window === 'undefined') return DEFAULT_CUS_COLUMN_PREFERENCES;
  try {
    const stored = JSON.parse(window.localStorage.getItem(CUS_COLUMN_PREFERENCE_KEY) ?? '{}') as Partial<CusColumnPreferences>;
    const normalize = (values: unknown, fallback: OptionalCusColumn[]) => (
      Array.isArray(values)
        ? OPTIONAL_CUS_COLUMNS.filter((column): column is OptionalCusColumn => values.includes(column))
        : fallback
    );
    return {
      wide: normalize(stored.wide, DEFAULT_CUS_COLUMN_PREFERENCES.wide),
      compact: normalize(stored.compact, DEFAULT_CUS_COLUMN_PREFERENCES.compact),
    };
  } catch {
    return DEFAULT_CUS_COLUMN_PREFERENCES;
  }
}

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

interface MoneyCellProps {
  amount: string | null;
  invoiceNumber?: string | null;
  warning?: boolean;
  warningLabel?: string;
  available?: boolean;
}

function MoneyCell({ amount, invoiceNumber, warning, warningLabel, available = true }: MoneyCellProps) {
  if (!available || amount == null) {
    return <span className="cus-money-unavailable">Chưa có dữ liệu đối soát</span>;
  }
  return (
    <div className={`cus-money-cell${warning ? ' cus-money-cell--warning' : ''}`}>
      <strong>{formatMoney(amount)}</strong>
      <span>{invoiceNumber ? `HĐ: ${invoiceNumber}` : 'Chưa có hóa đơn'}</span>
      {warning && <em>{warningLabel ?? 'Chưa thu hồi'}</em>}
    </div>
  );
}

function ChargeGroup({
  title,
  group,
}: {
  title: string;
  group: ShipmentCusWorkspaceContainerLine['outboundCharges'];
}) {
  return (
    <section className="cus-detail-group" aria-label={title}>
      <h4>{title}</h4>
      {!group.available && <p className="cus-detail-group__unavailable">Chưa có dữ liệu đối soát từ nguồn nghiệp vụ.</p>}
      <dl>
        <div><dt>Phí vận chuyển</dt><dd><MoneyCell {...group.transport} /></dd></div>
        <div><dt>Phí làm hàng</dt><dd><MoneyCell {...group.handling} /></dd></div>
        <div><dt>Phí phát sinh</dt><dd><MoneyCell {...group.incidental} /></dd></div>
        <div className="cus-detail-group__total"><dt>Tổng</dt><dd>{formatMoney(group.total)}</dd></div>
      </dl>
    </section>
  );
}

function PassThroughGroup({ line }: { line: ShipmentCusWorkspaceContainerLine }) {
  const group = line.passThroughChargesGrouped;
  return (
    <section className="cus-detail-group" aria-label="Phí chi hộ">
      <h4>Phí chi hộ</h4>
      <dl>
        <div><dt>CSHT</dt><dd><MoneyCell {...group.csht} /></dd></div>
        <div><dt>Nâng</dt><dd><MoneyCell {...group.lift} /></dd></div>
        <div><dt>Hạ</dt><dd><MoneyCell {...group.dropoff} /></dd></div>
        <div><dt>Khác</dt><dd><MoneyCell {...group.other} warning={group.other.repairRecoveryPending} warningLabel="Chưa thu hồi sửa chữa" /></dd></div>
        <div className="cus-detail-group__total"><dt>Tổng</dt><dd>{formatMoney(group.total)}</dd></div>
      </dl>
    </section>
  );
}

interface ContainerLineDraft {
  carrierKey: string;
  newCarrierName: string;
  plateNumber: string;
  containerTypeId: string;
  liftSiteId: string;
  dropoffSiteId: string;
  closeOrReturnAt: string;
  outboundTransport: string;
  outboundHandling: string;
  outboundIncidental: string;
  inboundTransport: string;
  inboundHandling: string;
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
    closeOrReturnAt: toLocalDateTime(line.closeOrReturnAt),
    outboundTransport: line.outboundCharges.transport.amount ?? '',
    outboundHandling: line.outboundCharges.handling.amount ?? '',
    outboundIncidental: line.outboundCharges.incidental.amount ?? '',
    inboundTransport: line.inboundCharges.transport.amount ?? '',
    inboundHandling: line.inboundCharges.handling.amount ?? '',
  };
}

function optionalMoney(value: string): string | null {
  const normalized = value.trim();
  if (normalized === '') return null;
  if (!/^\d+$/.test(normalized)) {
    throw new Error('Số tiền phải là số nguyên không âm, không dùng ký hiệu rút gọn.');
  }
  return normalized;
}

function idempotencySignature(...parts: Array<string | number | boolean | null | undefined>): string {
  return parts.map((part) => (part == null ? '' : String(part))).join(':');
}

function draftMoneyTotal(values: string[]): string | null {
  const amounts = values.filter((value) => /^\d+$/.test(value.trim()));
  if (amounts.length === 0) return null;
  return amounts.reduce((sum, value) => sum + BigInt(value.trim()), 0n).toString();
}

function EditableMoneyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="cus-inline-money-field">
      <span>{label}</span>
      <input
        type="number"
        min="0"
        step="1"
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ContainerLineCard({
  detail,
  line,
  onSaved,
  getIdempotencyKey,
  clearIdempotencyKey,
}: {
  detail: ShipmentCusWorkspaceDetail;
  line: ShipmentCusWorkspaceContainerLine;
  onSaved: (line: ShipmentCusWorkspaceContainerLine) => void;
  getIdempotencyKey: (signature: string) => string;
  clearIdempotencyKey: (signature: string) => void;
}) {
  const [draft, setDraft] = useState<ContainerLineDraft>(() => lineDraft(line));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const permissions = line.permissions;
  const editable = Object.values(permissions).some(Boolean);

  useEffect(() => {
    setDraft(lineDraft(line));
    setDirty(false);
  }, [line]);

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
        ...(permissions.closeOrReturnTimeEditable ? {
          closeOrReturnAt: draft.closeOrReturnAt ? new Date(draft.closeOrReturnAt).toISOString() : null,
        } : {}),
        ...(permissions.outboundEditable ? {
          outboundCharges: {
            transportAmount: optionalMoney(draft.outboundTransport),
            handlingAmount: optionalMoney(draft.outboundHandling),
            incidentalAmount: optionalMoney(draft.outboundIncidental),
          },
        } : {}),
        ...(permissions.inboundEditable ? {
          inboundCharges: {
            transportAmount: optionalMoney(draft.inboundTransport),
            handlingAmount: optionalMoney(draft.inboundHandling),
          },
        } : {}),
      }, idempotencyKey);
      onSaved(result.line);
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
    <article className="cus-container">
      <header className="cus-container__head">
        <span className="cus-container__ordinal">{line.ordinal}</span>
        <div>
          <h3>{line.containerNumber || 'Chưa có số container'}</h3>
          <p>{line.containerTypeLabel || 'Chưa chọn loại cont'}</p>
        </div>
        {line.repairRecoveryPending && (
          <span className="cus-signal cus-signal--repair">
            <AlertTriangle size={15} aria-hidden="true" /> Chưa thu hồi sửa chữa
          </span>
        )}
      </header>

      <div className="cus-container__facts">
        <div>
          <span className="cus-container__field-label">Nhà xe</span>
          {permissions.carrierEditable ? (
            <div className="cus-carrier-editor">
              {draft.carrierKey === 'NEW_EXTERNAL' ? (
                <>
                  <label className="sr-only" htmlFor={`cus-new-carrier-${line.id}`}>Tên nhà xe mới</label>
                  <input
                    id={`cus-new-carrier-${line.id}`}
                    value={draft.newCarrierName}
                    maxLength={255}
                    placeholder="Nhập tên nhà xe mới"
                    onChange={(event) => updateDraft({ newCarrierName: event.target.value })}
                  />
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => updateDraft({ carrierKey: '', newCarrierName: '', plateNumber: '' })}
                  >
                    Chọn nhà xe có sẵn
                  </button>
                </>
              ) : (
                <>
                  <SearchableSelect
                    id={`cus-carrier-${line.id}`}
                    value={draft.carrierKey}
                    onChange={(value) => updateDraft({ carrierKey: value, newCarrierName: '' })}
                    options={carrierOptions}
                    placeholder="Chọn nhà xe"
                    searchPlaceholder="Tìm nhà xe"
                  />
                  {permissions.plateEditable && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => updateDraft({ carrierKey: 'NEW_EXTERNAL', newCarrierName: '', plateNumber: '' })}
                    >
                      Nhập nhà xe mới
                    </button>
                  )}
                </>
              )}
            </div>
          ) : <strong>{line.carrierName || '—'}</strong>}
        </div>
        <div>
          <label className="cus-container__field-label" htmlFor={`cus-plate-${line.id}`}>Biển số xe</label>
          {permissions.plateEditable ? (
            <input
              id={`cus-plate-${line.id}`}
              value={draft.plateNumber}
              list={`cus-plates-${line.id}`}
              maxLength={20}
              onChange={(event) => updateDraft({ plateNumber: event.target.value })}
            />
          ) : <strong>{line.plateNumber || '—'}</strong>}
          {permissions.plateEditable && (
            <datalist id={`cus-plates-${line.id}`}>
              {detail.selectors.carrierVehicles.map((vehicle) => <option value={vehicle.licensePlate} key={vehicle.id}>{vehicle.label}</option>)}
            </datalist>
          )}
        </div>
        <div>
          <span className="cus-container__field-label">Loại cont</span>
          {permissions.containerTypeEditable ? (
            <SearchableSelect
              id={`cus-container-type-${line.id}`}
              value={draft.containerTypeId}
              onChange={(value) => updateDraft({ containerTypeId: value })}
              options={detail.selectors.containerTypes.map((option) => ({ value: String(option.id), label: option.label, searchText: `${option.code} ${option.name}` }))}
              placeholder="Chọn loại cont"
            />
          ) : <strong>{line.containerTypeLabel || '—'}</strong>}
        </div>
        <div>
          <span className="cus-container__field-label">Nâng</span>
          {permissions.liftSiteEditable ? (
            <SearchableSelect
              id={`cus-lift-site-${line.id}`}
              value={draft.liftSiteId}
              onChange={(value) => updateDraft({ liftSiteId: value })}
              options={detail.selectors.operationalSites.map((option) => ({ value: String(option.id), label: option.label, searchText: `${option.code} ${option.name}` }))}
              placeholder="Chọn điểm nâng"
            />
          ) : <strong>{line.liftSite || '—'}</strong>}
        </div>
        <div>
          <span className="cus-container__field-label">Hạ</span>
          {permissions.dropoffSiteEditable ? (
            <SearchableSelect
              id={`cus-dropoff-site-${line.id}`}
              value={draft.dropoffSiteId}
              onChange={(value) => updateDraft({ dropoffSiteId: value })}
              options={detail.selectors.operationalSites.map((option) => ({ value: String(option.id), label: option.label, searchText: `${option.code} ${option.name}` }))}
              placeholder="Chọn điểm hạ"
            />
          ) : <strong>{line.dropoffSite || '—'}</strong>}
        </div>
        <div>
          <label className="cus-container__field-label" htmlFor={`cus-close-return-${line.id}`}>Giờ đóng/trả</label>
          {permissions.closeOrReturnTimeEditable ? (
            <input id={`cus-close-return-${line.id}`} type="datetime-local" value={draft.closeOrReturnAt} onChange={(event) => updateDraft({ closeOrReturnAt: event.target.value })} />
          ) : <strong>{formatDateTime(line.closeOrReturnAt)}</strong>}
        </div>
      </div>

      <div className="cus-container__charges">
        {permissions.outboundEditable ? (
          <section className="cus-detail-group" aria-label="Cước đầu ra">
            <h4>Cước đầu ra</h4>
            <p className="cus-proposal-note">Đề xuất CUS — cần đưa vào Giấy báo nợ trước khi Kế toán xác nhận.</p>
            <div className="cus-editable-money-grid">
              <EditableMoneyField label="Phí vận chuyển" value={draft.outboundTransport} onChange={(value) => updateDraft({ outboundTransport: value })} />
              <EditableMoneyField label="Phí làm hàng" value={draft.outboundHandling} onChange={(value) => updateDraft({ outboundHandling: value })} />
              <EditableMoneyField label="Phí phát sinh" value={draft.outboundIncidental} onChange={(value) => updateDraft({ outboundIncidental: value })} />
            </div>
            <div className="cus-editable-total"><span>Tổng</span><strong>{formatMoney(draftMoneyTotal([
              draft.outboundTransport,
              draft.outboundHandling,
              draft.outboundIncidental,
            ]))}</strong></div>
          </section>
        ) : <ChargeGroup title="Cước đầu ra" group={line.outboundCharges} />}
        {permissions.inboundEditable ? (
          <section className="cus-detail-group" aria-label="Cước đầu vào">
            <h4>Cước đầu vào</h4>
            <p className="cus-proposal-note">Đề xuất CUS — cần đưa vào Giấy báo nợ trước khi Kế toán xác nhận.</p>
            <div className="cus-editable-money-grid">
              <EditableMoneyField label="Phí vận chuyển" value={draft.inboundTransport} onChange={(value) => updateDraft({ inboundTransport: value })} />
              <EditableMoneyField label="Phí làm hàng" value={draft.inboundHandling} onChange={(value) => updateDraft({ inboundHandling: value })} />
              <div><span className="cus-container__field-label">Phí phát sinh từ OPS</span><MoneyCell {...line.inboundCharges.incidental} /></div>
            </div>
            <div className="cus-editable-total"><span>Tổng</span><strong>{formatMoney(draftMoneyTotal([
              draft.inboundTransport,
              draft.inboundHandling,
              line.inboundCharges.incidental.amount ?? '',
            ]))}</strong></div>
          </section>
        ) : <ChargeGroup title="Cước đầu vào" group={line.inboundCharges} />}
        <PassThroughGroup line={line} />
      </div>

      {editable && (
        <footer className="cus-container__savebar">
          {saveError && <span role="alert">{saveError}</span>}
          <button type="button" className="btn btn--primary btn--sm" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
            Lưu container
          </button>
        </footer>
      )}
    </article>
  );
}

function ContainerLedger({
  detail,
  onLineSaved,
  getIdempotencyKey,
  clearIdempotencyKey,
}: {
  detail: ShipmentCusWorkspaceDetail;
  onLineSaved: (line: ShipmentCusWorkspaceContainerLine) => void;
  getIdempotencyKey: (signature: string) => string;
  clearIdempotencyKey: (signature: string) => void;
}) {
  if (detail.containers.length === 0) {
    return <p className="cus-detail-empty">Lô hàng chưa có dữ liệu container.</p>;
  }

  return (
    <div className="cus-container-ledger">
      {detail.containers.map((line) => (
        <ContainerLineCard
          key={line.id}
          detail={detail}
          line={line}
          onSaved={onLineSaved}
          getIdempotencyKey={getIdempotencyKey}
          clearIdempotencyKey={clearIdempotencyKey}
        />
      ))}
    </div>
  );
}

function ShipmentSignals({ item }: { item: ShipmentCusWorkspaceListItem }) {
  return (
    <div className="cus-signals" aria-label="Cảnh báo lô hàng">
      {item.finance.isLoss && (
        <span className="cus-signal cus-signal--loss"><AlertTriangle size={15} aria-hidden="true" /> Lỗ</span>
      )}
      {item.finance.hasPendingRecovery && (
        <span className="cus-signal cus-signal--pending"><CircleDollarSign size={15} aria-hidden="true" /> Còn tiền treo</span>
      )}
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
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, ShipmentCusWorkspaceDetail>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);
  const [detailErrors, setDetailErrors] = useState<Record<number, string>>({});
  const [actionItem, setActionItem] = useState<ShipmentCusWorkspaceListItem | null>(null);
  const [actionMode, setActionMode] = useState<'confirm' | 'lock' | 'reopen' | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [workspaceLayout, setWorkspaceLayout] = useState<CusWorkspaceLayout>('wide');
  const [columnPreferences, setColumnPreferences] = useState<CusColumnPreferences>(readCusColumnPreferences);
  const requestSequence = useRef(0);
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

  useEffect(() => {
    try {
      window.localStorage.setItem(CUS_COLUMN_PREFERENCE_KEY, JSON.stringify(columnPreferences));
    } catch {
      // The current in-memory choice remains usable when the browser blocks
      // storage (private mode, quota policy, or an embedded application).
    }
  }, [columnPreferences]);

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
    setDetailLoadingId(shipmentId);
    setDetailErrors((current) => ({ ...current, [shipmentId]: '' }));
    try {
      const detail = await getCusShipmentWorkspaceDetail(shipmentId);
      setDetails((current) => ({ ...current, [shipmentId]: detail }));
    } catch (detailError) {
      setDetailErrors((current) => ({
        ...current,
        [shipmentId]: safeError(detailError, 'Không thể tải chi tiết container.'),
      }));
    } finally {
      setDetailLoadingId((current) => current === shipmentId ? null : current);
    }
  }, [details]);

  const applySavedContainerLine = useCallback((shipmentId: number, line: ShipmentCusWorkspaceContainerLine) => {
    setDetails((current) => {
      const detail = current[shipmentId];
      if (!detail) return current;
      return {
        ...current,
        [shipmentId]: {
          ...detail,
          summary: { ...detail.summary, version: line.shipmentVersion },
          containers: detail.containers.map((currentLine) => (
            currentLine.id === line.id
              ? line
              : { ...currentLine, shipmentVersion: line.shipmentVersion }
          )),
        },
      };
    });
    setNotice('Đã lưu dữ liệu container. Xác nhận Kế toán cũ (nếu có) sẽ được kiểm tra lại theo nguồn mới.');
  }, []);

  const toggleExpanded = useCallback((shipmentId: number) => {
    setExpandedId((current) => current === shipmentId ? null : shipmentId);
    if (expandedId !== shipmentId) void loadDetail(shipmentId);
  }, [expandedId, loadDetail]);

  const openMobileDetail = useCallback((shipmentId: number) => {
    setDrawerId(shipmentId);
    void loadDetail(shipmentId);
  }, [loadDetail]);

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
    setSearchParams({}, { replace: true });
  };

  const updateCustody = async (item: ShipmentCusWorkspaceListItem, status: ShipmentDocumentCustody) => {
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
      await loadList();
    } catch (custodyError) {
      setError(safeError(custodyError, 'Không thể cập nhật trạng thái phơi phiếu.'));
    }
  };

  const openAction = (item: ShipmentCusWorkspaceListItem, mode: 'confirm' | 'lock' | 'reopen') => {
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
  const hasFilters = Boolean(suffixParam || dateFrom || dateTo || bucket);

  const resultLabel = useMemo(() => {
    if (loading) return 'Đang cập nhật danh sách…';
    if (error && !data) return 'Không thể tải dữ liệu';
    return `${total.toLocaleString('vi-VN')} lô hàng`;
  }, [data, error, loading, total]);

  const visibleOptionalColumns = workspaceLayout === 'wide'
    ? columnPreferences.wide
    : columnPreferences.compact;
  const showContainerSchedule = visibleOptionalColumns.includes('containerSchedule');
  const showRecords = visibleOptionalColumns.includes('records');
  const desktopColumnCount = 5 + Number(showContainerSchedule) + Number(showRecords);

  const toggleOptionalColumn = (column: OptionalCusColumn) => {
    if (workspaceLayout === 'cards') return;
    const preferenceKey = workspaceLayout === 'wide' ? 'wide' : 'compact';
    setColumnPreferences((current) => {
      const currentColumns = current[preferenceKey];
      const nextColumns = currentColumns.includes(column)
        ? currentColumns.filter((currentColumn) => currentColumn !== column)
        : [...currentColumns, column];
      return { ...current, [preferenceKey]: nextColumns };
    });
  };

  return (
    <div className="shipments-page">
      <Breadcrumbs items={[{ label: 'Tổng quan', to: '/dashboard' }, { label: 'Quản lý lô hàng' }]} />
      <PageHeader
        title="Quản lý lô hàng"
        iconName="cargo"
        description="Đối soát vận hành, chi phí và khóa lô sau khi Kế toán xác nhận"
      />

      <section ref={workspaceRef} className="cus-workspace" data-layout={workspaceLayout} aria-labelledby="cus-workspace-title" aria-busy={loading}>
        <h2 id="cus-workspace-title" className="sr-only">Không gian quản lý lô hàng CUS</h2>
        <Tabs
          tabs={[
            { id: 'all', label: 'Tất cả lô hàng', count: total },
            { id: 'combined-invoices', label: 'Hóa đơn kết hợp', disabled: true },
          ]}
          value="all"
          onChange={() => undefined}
          ariaLabel="Chức năng quản lý lô hàng"
          variant="bordered"
        />

        <form className="cus-toolbar" onSubmit={submitSearch} noValidate>
          <div className="cus-search-field">
            <label htmlFor="cus-shipment-search">4-5 ký tự cuối Bill/Book hoặc tờ khai</label>
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
                placeholder="Ví dụ: AB12C"
                aria-invalid={Boolean(searchError)}
                aria-describedby={searchError ? 'cus-search-error' : undefined}
              />
              {searchInput && (
                <button type="button" className="cus-icon-button" onClick={() => setSearchInput('')} aria-label="Xóa nội dung tìm kiếm">
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
            {hasFilters && (
              <button className="btn btn--ghost" type="button" onClick={clearFilters}><RotateCcw size={17} aria-hidden="true" /> Xóa lọc</button>
            )}
            {workspaceLayout !== 'cards' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="btn btn--ghost" type="button" aria-label="Cột hiển thị">
                    <SlidersHorizontal size={17} aria-hidden="true" /> Cột hiển thị
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="cus-column-menu">
                  <DropdownMenuLabel>Cột tùy chọn</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    checked={showContainerSchedule}
                    onCheckedChange={() => toggleOptionalColumn('containerSchedule')}
                    onSelect={(event) => event.preventDefault()}
                  >
                    Container &amp; lịch
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showRecords}
                    onCheckedChange={() => toggleOptionalColumn('records')}
                    onSelect={(event) => event.preventDefault()}
                  >
                    Hồ sơ &amp; xác nhận
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </form>

        <div className="cus-workspace__summary" role="status" aria-live="polite">
          <span>{resultLabel}</span>
          <span>Chi tiết container chỉ tải khi mở lô hàng</span>
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
            description={hasFilters ? 'Thử thay đổi số tìm kiếm, ngày vận chuyển hoặc trạng thái.' : 'Dữ liệu lô hàng sẽ xuất hiện tại đây.'}
          />
        ) : (
          <>
            <div className="cus-master-scroll" role="region" aria-label="Bảng tổng hợp lô hàng" tabIndex={0}>
              <table className={`cus-master-table cus-master-table--${workspaceLayout} cus-master-table--columns-${desktopColumnCount}${showContainerSchedule ? ' cus-master-table--has-container' : ''}${showRecords ? ' cus-master-table--has-records' : ''}`}>
                <colgroup>
                  <col className="cus-master-table__col-documents" />
                  <col className="cus-master-table__col-customer-route" />
                  {showContainerSchedule && <col className="cus-master-table__col-container-schedule" />}
                  <col className="cus-master-table__col-status" />
                  <col className="cus-master-table__col-finance" />
                  {showRecords && <col className="cus-master-table__col-records" />}
                  <col className="cus-master-table__col-action" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Hồ sơ</th>
                    <th scope="col">Khách hàng &amp; tuyến</th>
                    {showContainerSchedule && <th scope="col">Container &amp; lịch</th>}
                    <th scope="col">Trạng thái &amp; rủi ro</th>
                    <th scope="col">Tài chính</th>
                    {showRecords && <th scope="col">Hồ sơ &amp; xác nhận</th>}
                    <th scope="col">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const isExpanded = expandedId === item.id;
                    const isLocked = item.bucket === ShipmentCusBucket.LOCKED;
                    return [
                      <tr
                        key={`master-${item.id}`}
                        className={`cus-master-row${isExpanded ? ' cus-master-row--expanded' : ''}${item.finance.isLoss ? ' cus-master-row--loss' : ''}${item.finance.hasPendingRecovery ? ' cus-master-row--pending' : ''}`}
                        onClick={(event) => {
                          if (isInteractiveRowTarget(event.target)) return;
                          toggleExpanded(item.id);
                        }}
                      >
                        <td>
                          <dl className="cus-cell-stack">
                            <div>
                              <dt>Bill/Book</dt>
                              <dd>
                                <button
                                  type="button"
                                  className="cus-row-toggle"
                                  aria-expanded={isExpanded}
                                  aria-controls={`cus-detail-${item.id}`}
                                  onClick={() => toggleExpanded(item.id)}
                                >
                                  {item.billOrBookNumber || '—'}
                                  <span className="sr-only"> — {isExpanded ? 'Thu gọn' : 'Mở'} chi tiết lô hàng của {item.customerName || 'khách hàng'}</span>
                                </button>
                              </dd>
                            </div>
                            <div><dt>Tờ khai</dt><dd>{item.declarationNumber || '—'}</dd></div>
                            <div><dt>Hãng tàu</dt><dd>{item.shippingLineName || '—'}</dd></div>
                          </dl>
                        </td>
                        <td>
                          <dl className="cus-cell-stack">
                            <div><dt>Khách hàng</dt><dd><strong>{item.customerName || 'Chưa có khách hàng'}</strong></dd></div>
                            <div><dt>Nhà máy</dt><dd>{item.factoryName || '—'}</dd></div>
                            <div><dt>Tuyến</dt><dd>{item.routeName || '—'}</dd></div>
                          </dl>
                        </td>
                        {showContainerSchedule && (
                          <td>
                            <dl className="cus-cell-stack cus-cell-stack--metrics">
                              <div><dt>Số lượng</dt><dd>{item.containerSummary}</dd></div>
                              <div><dt>Khối lượng</dt><dd>{formatQuantity(item.weightKg)} kg</dd></div>
                              <div><dt>Thể tích</dt><dd>{formatQuantity(item.volumeCbm, 3)} CBM</dd></div>
                              <div><dt>Lịch chạy</dt><dd>{formatDate(item.transportDate)}</dd></div>
                              <div><dt>Loại hàng</dt><dd>{directionLabel(item.direction)}</dd></div>
                            </dl>
                          </td>
                        )}
                        <td>
                          <span className={`cus-bucket cus-bucket--${item.bucket.toLowerCase()}`}>{item.bucketLabel}</span>
                          <ShipmentSignals item={item} />
                          {item.note && <p className="cus-cell-note">{item.note}</p>}
                        </td>
                        <td>
                          <dl className="cus-cell-stack cus-cell-stack--money">
                            <div><dt>Có hóa đơn</dt><dd>{item.finance.customerChargeTotalsAvailable ? formatMoney(item.finance.customerInvoiceTotal) : <span className="cus-money-unavailable">Chưa có dữ liệu</span>}</dd></div>
                            <div><dt>Không hóa đơn</dt><dd>{item.finance.customerChargeTotalsAvailable ? formatMoney(item.finance.customerNoInvoiceTotal) : <span className="cus-money-unavailable">Chưa có dữ liệu</span>}</dd></div>
                            <div><dt>Tổng chi</dt><dd>{item.finance.totalCostAvailable ? formatMoney(item.finance.totalCost) : <span className="cus-money-unavailable">Chưa có dữ liệu</span>}</dd></div>
                            <div><dt>Trạng thái đối soát</dt><dd>{item.finance.isLoss ? 'Lỗ' : item.finance.hasPendingRecovery ? 'Còn tiền treo' : 'Không cảnh báo'}</dd></div>
                          </dl>
                        </td>
                        {showRecords && (
                          <td>
                            <dl className="cus-cell-stack">
                              <div>
                                <dt>Phơi phiếu</dt>
                                <dd>
                                  <select
                                    className="cus-custody-select"
                                    data-row-interactive
                                    value={item.documentCustody.status ?? ''}
                                    disabled={isLocked || !item.documentCustody.available || !item.documentCustody.editable}
                                    aria-label={`Trạng thái phơi phiếu của ${item.customerName || 'lô hàng'}`}
                                    onChange={(event) => void updateCustody(item, event.target.value as ShipmentDocumentCustody)}
                                  >
                                    <option value="" disabled>Chưa xác định</option>
                                    {Object.values(ShipmentDocumentCustody).map((status) => (
                                      <option value={status} key={status}>{SHIPMENT_DOCUMENT_CUSTODY_LABELS[status]}</option>
                                    ))}
                                  </select>
                                </dd>
                              </div>
                              <div><dt>Kế toán</dt><dd><span className={`cus-confirmation${item.accountingConfirmation.status === 'CONFIRMED' ? ' cus-confirmation--done' : ''}`}>{accountingConfirmationLabel(item.accountingConfirmation)}</span></dd></div>
                            </dl>
                          </td>
                        )}
                        <td className="cus-master-table__action" data-row-interactive>
                          <div className="cus-row-action">
                            {item.action.kind === 'CONFIRM_FINANCE' ? (
                              <button type="button" className="btn btn--primary btn--sm" disabled={!item.action.enabled} onClick={() => openAction(item, 'confirm')}>
                                Xác nhận chi phí
                              </button>
                            ) : item.action.kind === 'LOCK' ? (
                              <button type="button" className="btn btn--primary btn--sm" disabled={!item.action.enabled} onClick={() => openAction(item, 'lock')}>
                                <FileLock2 size={16} aria-hidden="true" /> Khóa lô
                              </button>
                            ) : item.action.kind === 'REQUEST_REOPEN' ? (
                              <button type="button" className="btn btn--secondary btn--sm" disabled={!item.action.enabled} onClick={() => openAction(item, 'reopen')}>
                                Đề nghị điều chỉnh
                              </button>
                            ) : <span className="cus-action-unavailable">{item.action.disabledReason || 'Chỉ xem'}</span>}
                            {item.action.kind !== 'NONE' && !item.action.enabled && item.action.disabledReason && (
                              <span className="cus-action-unavailable">{item.action.disabledReason}</span>
                            )}
                          </div>
                        </td>
                      </tr>,
                      isExpanded && (
                        <tr key={`detail-${item.id}`} id={`cus-detail-${item.id}`} className="cus-master-detail-row">
                          <td colSpan={desktopColumnCount}>
                            {detailLoadingId === item.id && !details[item.id] ? (
                              <div className="cus-detail-loading"><Loader2 className="spin" aria-hidden="true" /> Đang tải chi tiết container…</div>
                            ) : detailErrors[item.id] ? (
                              <div className="cus-inline-error" role="alert"><span>{detailErrors[item.id]}</span><button type="button" onClick={() => void loadDetail(item.id, true)}>Thử lại</button></div>
                            ) : details[item.id] ? (
                              <ContainerLedger
                                detail={details[item.id]}
                                onLineSaved={(line) => applySavedContainerLine(item.id, line)}
                                getIdempotencyKey={getIdempotencyKey}
                                clearIdempotencyKey={clearIdempotencyKey}
                              />
                            ) : null}
                          </td>
                        </tr>
                      ),
                    ];
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
                    <span className={`cus-bucket cus-bucket--${item.bucket.toLowerCase()}`}>{item.bucketLabel}</span>
                  </header>
                  <ShipmentSignals item={item} />
                  <dl>
                    <div><dt>Nhà máy</dt><dd>{item.factoryName || '—'}</dd></div>
                    <div><dt>Ngày vận chuyển</dt><dd>{formatDate(item.transportDate)}</dd></div>
                    <div><dt>Container</dt><dd>{item.containerSummary}</dd></div>
                    <div><dt>Loại hàng</dt><dd>{directionLabel(item.direction)}</dd></div>
                    <div><dt>Tổng thu</dt><dd>{item.finance.customerChargeTotalsAvailable ? formatMoney(item.finance.customerInvoiceTotal) : 'Chưa có dữ liệu'}</dd></div>
                    <div><dt>Tổng chi</dt><dd>{item.finance.totalCostAvailable ? formatMoney(item.finance.totalCost) : 'Chưa có dữ liệu'}</dd></div>
                    <div><dt>Kế toán</dt><dd>{accountingConfirmationLabel(item.accountingConfirmation)}</dd></div>
                  </dl>
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
        onClose={() => setDrawerId(null)}
        title={drawerItem?.customerName || 'Chi tiết lô hàng'}
        subtitle={drawerItem?.billOrBookNumber || drawerItem?.declarationNumber || undefined}
        className="cus-mobile-drawer"
      >
        <div id={drawerItem ? `cus-detail-drawer-${drawerItem.id}` : undefined}>
          {drawerId != null && detailLoadingId === drawerId && !details[drawerId] ? (
            <div className="cus-detail-loading"><Loader2 className="spin" aria-hidden="true" /> Đang tải chi tiết container…</div>
          ) : drawerId != null && detailErrors[drawerId] ? (
            <div className="cus-inline-error" role="alert"><span>{detailErrors[drawerId]}</span><button type="button" onClick={() => void loadDetail(drawerId, true)}>Thử lại</button></div>
          ) : drawerId != null && details[drawerId] ? (
            <ContainerLedger
              detail={details[drawerId]}
              onLineSaved={(line) => applySavedContainerLine(drawerId, line)}
              getIdempotencyKey={getIdempotencyKey}
              clearIdempotencyKey={clearIdempotencyKey}
            />
          ) : null}

          {drawerItem && (
            <div className="cus-drawer-actions">
              <label className="cus-drawer-custody">
                <span>Phơi phiếu</span>
                <select
                  className="cus-custody-select"
                  value={drawerItem.documentCustody.status ?? ''}
                  disabled={drawerItem.bucket === ShipmentCusBucket.LOCKED || !drawerItem.documentCustody.available || !drawerItem.documentCustody.editable}
                  aria-label={`Trạng thái phơi phiếu của ${drawerItem.customerName || 'lô hàng'}`}
                  onChange={(event) => void updateCustody(drawerItem, event.target.value as ShipmentDocumentCustody)}
                >
                  <option value="" disabled>Chưa xác định</option>
                  {Object.values(ShipmentDocumentCustody).map((status) => (
                    <option value={status} key={status}>{SHIPMENT_DOCUMENT_CUSTODY_LABELS[status]}</option>
                  ))}
                </select>
              </label>
              {drawerItem.action.kind === 'CONFIRM_FINANCE' && (
                <button type="button" className="btn btn--primary" disabled={!drawerItem.action.enabled} onClick={() => openAction(drawerItem, 'confirm')}>Xác nhận chi phí</button>
              )}
              {drawerItem.action.kind === 'LOCK' && (
                <button type="button" className="btn btn--primary" disabled={!drawerItem.action.enabled} onClick={() => openAction(drawerItem, 'lock')}>Khóa lô</button>
              )}
              {drawerItem.action.kind === 'REQUEST_REOPEN' && (
                <button type="button" className="btn btn--secondary" disabled={!drawerItem.action.enabled} onClick={() => openAction(drawerItem, 'reopen')}>Đề nghị điều chỉnh</button>
              )}
              {drawerItem.action.kind !== 'NONE' && !drawerItem.action.enabled && drawerItem.action.disabledReason && (
                <span className="cus-action-unavailable">{drawerItem.action.disabledReason}</span>
              )}
            </div>
          )}
        </div>
      </Drawer>

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
