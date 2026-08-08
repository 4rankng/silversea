import { useState, useEffect, useCallback, useMemo, useRef, type MouseEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Package,
  Search,
  X,
  Loader2,
  ChevronRight,
  CalendarClock,
  Plus,
  SlidersHorizontal,
  Save,
} from 'lucide-react';
import { api } from '../lib/api';
import { ApiError } from '../lib/api';
import { PageHeader, StatusPill } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { EmptyState, Pagination } from '../design-system';
import { ClickableCard } from '../components/shared/ClickableCard';
import { Role, SHIPMENT_STATUS_LABELS, ShipmentStatus } from '@tingting/shared';
import { usePageAnimations } from '../hooks/animations';
import { useAuth } from '../hooks/useAuth';
import { getModernRole } from '../lib/role-helpers';
import { routes } from '../lib/routes';
import { updateShipment } from '../api/shipmentClient';
import './ShipmentsPage.css';

// ─── Types (local; the API responses are not yet in @tingting/shared types) ──
// Wave 0 minimal surface — typed locally to avoid a shared-types churn that
// would expand this slice. Promote to @tingting/shared when the Wave 2 CUS UI
// lands and other consumers need them.

interface ShipmentRow {
  id: number;
  shipmentCode: string | null;
  customerId: number;
  // Joined from customers.name by listShipmentsPaginated. Nullable because
  // the join is a leftJoin (a hard-deleted customer still has its shipments).
  customerName: string | null;
  status: ShipmentStatus;
  bookingRef: string | null;
  blNumber: string | null;
  expectedDeliveryDate: string | null;
  pickupLocation: string | null;
  deliveryLocation: string | null;
  contactName: string | null;
  contactPhone: string | null;
  tradeDirection?: 'IMPORT' | 'EXPORT' | null;
  cargoMode?: 'FCL' | 'LCL' | null;
  factoryName?: string | null;
  shippingLineName?: string | null;
  customsCutoffAt?: string | null;
  closingAt?: string | null;
  plannedReturnAt?: string | null;
  packageCount?: number | null;
  packageType?: string | null;
  cargoSummary?: string | null;
  shippingLineSummary?: string | null;
  carrierSummary?: string | null;
  vehiclePlateSummary?: string | null;
  operationalNotes?: string | null;
  declarationNumber?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface ShipmentListResponse {
  items: ShipmentRow[];
  total: number;
  page: number;
  limit: number;
}

type StatusFilter =
  | 'all'
  | ShipmentStatus.PENDING_DATE
  | ShipmentStatus.READY_FOR_DISPATCH
  | ShipmentStatus.DISPATCHED
  | ShipmentStatus.IN_TRANSIT
  | ShipmentStatus.PENDING_EXPENSE_APPROVAL
  | ShipmentStatus.COMPLETED;

type ShipmentColumnId =
  | 'shipment'
  | 'customer'
  | 'direction'
  | 'cargo'
  | 'shippingLine'
  | 'carrier'
  | 'vehiclePlate'
  | 'delivery'
  | 'status'
  | 'blNumber'
  | 'bookingRef'
  | 'route'
  | 'factory'
  | 'cutoffTime'
  | 'cutoffDate'
  | 'notes'
  | 'declarationNumber';

const COLUMN_STORAGE_KEY = 'silversea:shipments:columns:v1';
const REQUIRED_COLUMNS = new Set<ShipmentColumnId>(['shipment', 'customer', 'delivery', 'status']);
const OPTIONAL_COLUMNS: Array<{ id: ShipmentColumnId; label: string; defaultVisible: boolean }> = [
  { id: 'direction', label: 'Loại hàng (Xuất/Nhập)', defaultVisible: true },
  { id: 'cargo', label: 'Số Cont/Số lượng', defaultVisible: true },
  { id: 'shippingLine', label: 'Hãng tàu', defaultVisible: true },
  { id: 'carrier', label: 'Nhà xe', defaultVisible: true },
  { id: 'vehiclePlate', label: 'Biển số xe', defaultVisible: true },
  { id: 'factory', label: 'Nhà máy', defaultVisible: true },
  { id: 'blNumber', label: 'Số B/L', defaultVisible: true },
  { id: 'bookingRef', label: 'Số Bill/Book', defaultVisible: true },
  { id: 'declarationNumber', label: 'Số tờ khai', defaultVisible: true },
  { id: 'route', label: 'Tuyến đường', defaultVisible: true },
  { id: 'cutoffTime', label: 'Giờ đóng/trả', defaultVisible: true },
  { id: 'cutoffDate', label: 'Ngày đóng/trả', defaultVisible: true },
  { id: 'notes', label: 'Ghi chú', defaultVisible: true },
];

const DEFAULT_VISIBLE_COLUMNS = new Set<ShipmentColumnId>([
  ...REQUIRED_COLUMNS,
  ...OPTIONAL_COLUMNS.filter((column) => column.defaultVisible).map((column) => column.id),
]);

function displayShipmentStatus(status: ShipmentStatus): ShipmentStatus {
  return status === ShipmentStatus.NEW ? ShipmentStatus.PENDING_DATE : status;
}

const STATUS_FILTER_ORDER = [
  'all',
  ShipmentStatus.PENDING_DATE,
  ShipmentStatus.READY_FOR_DISPATCH,
  ShipmentStatus.DISPATCHED,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.PENDING_EXPENSE_APPROVAL,
  ShipmentStatus.COMPLETED,
] as const satisfies readonly StatusFilter[];

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'Tất cả',
  [ShipmentStatus.PENDING_DATE]: 'Chờ chốt lịch',
  [ShipmentStatus.READY_FOR_DISPATCH]: 'Sẵn sàng điều xe',
  [ShipmentStatus.DISPATCHED]: 'Đã điều xe',
  [ShipmentStatus.IN_TRANSIT]: 'Đang chạy',
  [ShipmentStatus.PENDING_EXPENSE_APPROVAL]: 'Chờ duyệt phí',
  [ShipmentStatus.COMPLETED]: 'Hoàn thành',
};

// Status → StatusPill variant (mirrors the trip status-color pattern).
const STATUS_PILL_VARIANT: Record<ShipmentStatus, 'neutral' | 'info' | 'success' | 'danger'> = {
  NEW: 'neutral',
  PENDING_DATE: 'neutral',
  READY_FOR_DISPATCH: 'info',
  DISPATCHED: 'info',
  IN_TRANSIT: 'info',
  PENDING_EXPENSE_APPROVAL: 'info',
  COMPLETED: 'success',
  CANCELED: 'danger',
};

// Comma-separated route "Nơi nhận → Nơi giao", shown when either leg is set.
function formatRoute(s: ShipmentRow): string | null {
  if (!s.pickupLocation && !s.deliveryLocation) return null;
  return [s.pickupLocation ?? '—', s.deliveryLocation ?? '—']
    .filter((v) => v && v !== '—')
    .join(' → ');
}

// Human-readable customer label. Database identifiers are never useful as
// customer-facing names, including when a historical customer was removed.
function customerLabel(s: ShipmentRow): string {
  return s.customerName?.trim() || 'Chưa có tên khách hàng';
}

function shipmentLabel(s: ShipmentRow): string {
  return s.shipmentCode?.trim() || 'Chưa có mã lô hàng';
}

function formatDeliveryDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('vi-VN');
}

function formatClosingTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function formatCutoffDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function truncate(text: string | null | undefined, max: number): string {
  if (!text) return '—';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function cargoModeLabel(shipment: ShipmentRow): string | null {
  if (shipment.cargoMode === 'FCL') return 'FCL';
  if (shipment.cargoMode === 'LCL') return 'LCL';
  return null;
}

function shipmentStatusLabel(status: ShipmentStatus): string {
  const displayed = displayShipmentStatus(status);
  return displayed === ShipmentStatus.PENDING_DATE
    ? 'Chờ chốt lịch'
    : SHIPMENT_STATUS_LABELS[displayed];
}

function tradeDirectionLabel(shipment: ShipmentRow): string {
  if (shipment.tradeDirection === 'IMPORT') return 'Nhập';
  if (shipment.tradeDirection === 'EXPORT') return 'Xuất';
  return '—';
}

function cargoSummary(shipment: ShipmentRow): string {
  if (shipment.cargoSummary?.trim()) return shipment.cargoSummary;
  if (shipment.cargoMode === 'LCL' && shipment.packageCount != null) {
    return `${shipment.packageCount} ${shipment.packageType?.trim() || 'kiện'}`;
  }
  return cargoModeLabel(shipment) ?? '—';
}

function readVisibleColumns(): Set<ShipmentColumnId> {
  if (typeof window === 'undefined') return new Set(DEFAULT_VISIBLE_COLUMNS);
  try {
    const stored = JSON.parse(window.localStorage.getItem(COLUMN_STORAGE_KEY) ?? 'null');
    if (!Array.isArray(stored)) return new Set(DEFAULT_VISIBLE_COLUMNS);
    const allowed = new Set(OPTIONAL_COLUMNS.map((column) => column.id));
    return new Set<ShipmentColumnId>([
      ...REQUIRED_COLUMNS,
      ...stored.filter((id): id is ShipmentColumnId => typeof id === 'string' && allowed.has(id as ShipmentColumnId)),
    ]);
  } catch {
    return new Set(DEFAULT_VISIBLE_COLUMNS);
  }
}

const PAGE_SIZE = 20;

export default function ShipmentsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentRole = getModernRole(user?.role ?? '');
  const canCreate = currentRole === Role.ADMIN || currentRole === Role.MANAGER;
  const canInlineEdit = currentRole === Role.ADMIN || currentRole === Role.MANAGER || currentRole === Role.CUS;

  // Filter state is mirrored in the URL query string so reloads / deep links
  // preserve the view.
  const rawStatusFilter = searchParams.get('status');
  const normalizedStatusFilter = rawStatusFilter === ShipmentStatus.NEW
    ? ShipmentStatus.PENDING_DATE
    : rawStatusFilter;
  const statusFilter: StatusFilter = normalizedStatusFilter
    && STATUS_FILTER_ORDER.includes(normalizedStatusFilter as StatusFilter)
    ? normalizedStatusFilter as StatusFilter
    : 'all';
  const rawPage = searchParams.get('page');
  const parsedPage = rawPage && /^\d+$/.test(rawPage) ? Number(rawPage) : 1;
  const page = Math.max(1, parsedPage);
  const searchQueryParam = searchParams.get('q') ?? '';
  const [searchInput, setSearchInput] = useState(searchQueryParam);

  const [data, setData] = useState<ShipmentListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<Set<ShipmentColumnId>>(() => readVisibleColumns());
  const [editingDate, setEditingDate] = useState<{
    shipmentId: number;
    value: string;
    saving: boolean;
    error: string | null;
  } | null>(null);
  const requestSequence = useRef(0);

  const { rootRef: pageAnimRef } = usePageAnimations({ ready: !loading });

  const updateFilter = useCallback((key: string, value: string | null) => {
    setSearchParams((currentParams) => {
      const next = new URLSearchParams(currentParams);
      if (value === null || value === '' || value === 'all') {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      // Reset to page 1 whenever the filter changes — staying on page 5 of a
      // newly-filtered result set is never what the user wants.
      if (key !== 'page') next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Keep the field aligned with browser back/forward navigation.
  useEffect(() => {
    setSearchInput(searchQueryParam);
  }, [searchQueryParam]);

  // Debounce the search box: write to the URL after 350ms of inactivity.
  useEffect(() => {
    const handle = setTimeout(() => {
      const current = searchParams.get('q') ?? '';
      if (current !== searchInput.trim()) {
        updateFilter('q', searchInput.trim() || null);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [searchInput, searchParams, updateFilter]);

  const fetchData = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
      });
      if (statusFilter !== 'all') qs.set('status', statusFilter);
      if (searchQueryParam.trim()) qs.set('q', searchQueryParam.trim());
      const res = await api.get<ShipmentListResponse>(`/shipments?${qs.toString()}`);
      if (requestId !== requestSequence.current) return;
      setData(res);
    } catch (err) {
      if (requestId !== requestSequence.current) return;
      setError(err instanceof ApiError ? err.message : 'Không thể tải danh sách lô hàng');
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [page, searchQueryParam, statusFilter]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const optional = OPTIONAL_COLUMNS
        .map((column) => column.id)
        .filter((id) => visibleColumns.has(id));
      window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(optional));
    } catch {
      // Storage may be disabled by browser privacy settings. Column selection
      // still works for the current page session.
    }
  }, [visibleColumns]);

  const toggleColumn = useCallback((columnId: ShipmentColumnId) => {
    if (REQUIRED_COLUMNS.has(columnId)) return;
    setVisibleColumns((current) => {
      const next = new Set(current);
      if (next.has(columnId)) next.delete(columnId);
      else next.add(columnId);
      return next;
    });
  }, []);

  const startDateEdit = useCallback((shipment: ShipmentRow) => {
    if (!canInlineEdit) return;
    setNotice(null);
    setEditingDate({
      shipmentId: shipment.id,
      value: shipment.expectedDeliveryDate?.slice(0, 10) ?? '',
      saving: false,
      error: null,
    });
  }, [canInlineEdit]);

  const cancelDateEdit = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    // Clearing the editor unmounts its parent form immediately, so the button
    // must stop the event itself before ClickableCard can navigate the row.
    event.preventDefault();
    event.stopPropagation();
    setEditingDate(null);
  }, []);

  const saveExpectedDeliveryDate = useCallback(async (shipment: ShipmentRow) => {
    if (!editingDate || editingDate.shipmentId !== shipment.id || !editingDate.value) return;
    setEditingDate((current) => current ? { ...current, saving: true, error: null } : current);
    try {
      const updated = await updateShipment(shipment.id, {
        expectedVersion: shipment.version,
        expectedDeliveryDate: editingDate.value,
      });
      setEditingDate(null);
      setNotice(updated.message ?? (updated.changeMode === 'REQUESTED'
        ? 'Đã gửi yêu cầu đổi ngày vận chuyển để phê duyệt.'
        : 'Đã cập nhật ngày vận chuyển.'));
      await fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Không thể cập nhật ngày vận chuyển';
      setEditingDate((current) => current ? { ...current, saving: false, error: message } : current);
    }
  }, [editingDate, fetchData]);

  const q = searchQueryParam.trim().toLowerCase();
  const visibleItems = useMemo(() => data?.items ?? [], [data?.items]);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const desktopColumnCount = [...visibleColumns].length + 1;
  const hasBlockingError = Boolean(error && !data);
  const currentViewLabel = statusFilter === 'all'
    ? 'Tất cả lô hàng'
    : STATUS_FILTER_LABELS[statusFilter];
  const resultSummary = hasBlockingError
    ? 'Không thể tải dữ liệu lô hàng'
    : loading
    ? 'Đang cập nhật danh sách…'
    : q
      ? `${total} kết quả phù hợp`
      : `${visibleItems.length} lô hàng trên trang ${page}`;

  return (
    <div className="shipments-page page-anim" ref={pageAnimRef}>
      <Breadcrumbs
        className="shipments-page__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Quản lý Lô hàng' },
        ]}
      />
      <PageHeader
        title="Quản lý Lô hàng"
        iconName="cargo"
        description="Theo dõi hồ sơ, tuyến vận chuyển và tiến độ giao nhận"
        action={canCreate ? (
          <Link to={routes.shipmentNew} className="btn btn--primary shipments-page__create">
            <Plus size={18} aria-hidden="true" />
            Tạo lô hàng
          </Link>
        ) : undefined}
      />

      <section
        className={`shipments-page__workspace${q ? ' shipments-page__workspace--searching' : ''}`}
        aria-label="Danh sách lô hàng"
        aria-busy={loading}
      >
        <div className="shipments-page__toolbar">
          <div className="shipments-page__filters" role="group" aria-label="Lọc theo trạng thái">
            <button
              type="button"
              className={`filter-pill${statusFilter === 'all' ? ' is-active' : ''}`}
              onClick={() => updateFilter('status', null)}
              aria-pressed={statusFilter === 'all'}
              aria-label={statusFilter === 'all' ? `Tất cả, ${total} lô hàng` : 'Tất cả'}
            >
              <span>Tất cả</span>
              {statusFilter === 'all' && <span className="filter-pill__count">{total}</span>}
            </button>
            {STATUS_FILTER_ORDER.filter((k) => k !== 'all').map((key) => (
              <button
                type="button"
                key={key}
                className={`filter-pill${statusFilter === key ? ' is-active' : ''}`}
                onClick={() => updateFilter('status', key)}
                aria-pressed={statusFilter === key}
              >
                <span>{STATUS_FILTER_LABELS[key]}</span>
              </button>
            ))}
          </div>

          {/* W4 20260805_03 §"Bổ sung các trường Filter tìm kiếm": trade direction
              + Ngày đóng/trả range + Số Bill/Book. Khách hàng + Trạng thái lô
              hàng are already covered by the customer search box and the
              status pills above. */}
          <div className="shipments-page__advanced-filters" role="group" aria-label="Bộ lọc nâng cao">
            <select
              className="shipments-page__filter-select"
              value={searchParams.get('tradeDirection') ?? ''}
              onChange={(e) => updateFilter('tradeDirection', e.target.value || null)}
              aria-label="Lọc theo Nhập / Xuất"
            >
              <option value="">Nhập / Xuất (tất cả)</option>
              <option value="EXPORT">Xuất</option>
              <option value="IMPORT">Nhập</option>
            </select>
            <label className="shipments-page__filter-date">
              <span>Ngày đóng/trả</span>
              <input
                type="date"
                className="shipments-page__filter-date-input"
                value={searchParams.get('dateFrom') ?? ''}
                onChange={(e) => updateFilter('dateFrom', e.target.value || null)}
                aria-label="Từ ngày đóng/trả"
              />
              <span aria-hidden="true">→</span>
              <input
                type="date"
                className="shipments-page__filter-date-input"
                value={searchParams.get('dateTo') ?? ''}
                onChange={(e) => updateFilter('dateTo', e.target.value || null)}
                aria-label="Đến ngày đóng/trả"
              />
            </label>
            <input
              type="search"
              className="shipments-page__filter-bl"
              maxLength={50}
              placeholder="Số Bill/Book"
              aria-label="Lọc theo số Bill/Book"
              defaultValue={searchParams.get('blNumber') ?? ''}
              onBlur={(e) => updateFilter('blNumber', e.target.value.trim() || null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') updateFilter('blNumber', (e.target as HTMLInputElement).value.trim() || null);
              }}
            />
          </div>

          <div className="shipments-page__toolbar-actions">
            <div className="shipments-page__search">
              <Search size={18} className="shipments-page__search-icon" aria-hidden="true" />
              <input
                type="search"
                className="shipments-page__search-input"
                maxLength={100}
                placeholder="Tìm mã lô, khách hàng, hãng tàu"
                aria-label="Tìm lô hàng theo mã, số B/L, mã đặt chỗ, khách hàng hoặc hãng tàu"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              {searchInput && (
                <button
                  type="button"
                  className="shipments-page__search-clear"
                  onClick={() => { setSearchInput(''); updateFilter('q', null); }}
                  aria-label="Xóa tìm kiếm"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              )}
            </div>
            <details className="shipments-page__columns desktop-only">
              <summary className="btn btn--secondary shipments-page__columns-trigger">
                <SlidersHorizontal size={17} aria-hidden="true" />
                Hiển thị cột
              </summary>
              <div className="shipments-page__columns-menu" role="group" aria-label="Chọn cột hiển thị">
                <p>Cột hiển thị</p>
                {[
                  { id: 'shipment' as const, label: 'Lô hàng' },
                  { id: 'customer' as const, label: 'Khách hàng' },
                  { id: 'delivery' as const, label: 'Ngày vận chuyển' },
                  { id: 'status' as const, label: 'Trạng thái' },
                ].map((column) => (
                  <label key={column.id}>
                    <input type="checkbox" checked disabled />
                    <span>{column.label} <small>Luôn hiển thị</small></span>
                  </label>
                ))}
                {OPTIONAL_COLUMNS.map((column) => (
                  <label key={column.id}>
                    <input
                      type="checkbox"
                      checked={visibleColumns.has(column.id)}
                      onChange={() => toggleColumn(column.id)}
                    />
                    <span>{column.label}</span>
                  </label>
                ))}
                <button
                  type="button"
                  className="shipments-page__columns-reset"
                  onClick={() => setVisibleColumns(new Set(DEFAULT_VISIBLE_COLUMNS))}
                >
                  Khôi phục mặc định
                </button>
              </div>
            </details>
          </div>
        </div>

        <div className="shipments-page__list-heading" aria-live="polite">
          <div>
            <h2>{currentViewLabel}</h2>
            <p>{resultSummary}</p>
          </div>
          {!loading && total > 0 && (
            <span className="shipments-page__total">
              <strong>{total}</strong>
              <span>đang quản lý</span>
            </span>
          )}
        </div>

        {error && (
          <div className="shipments-page__error" role="alert">
            <span>{error}</span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void fetchData()}>
              Thử lại
            </button>
          </div>
        )}
        {notice && (
          <div className="shipments-page__notice" role="status">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Đóng thông báo">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}

        {/* ── Mobile card list (≤820px) ────────────────────────────────── */}
        <div className="mobile-only shipments-page__mobile">
          {loading ? (
            <div className="shipments-page__loading">
              <Loader2 size={22} className="spin" />
              <span>Đang tải lô hàng…</span>
            </div>
          ) : hasBlockingError ? null : visibleItems.length === 0 ? (
            <EmptyState
              illustration="/assets/illustrations/empty-clients.svg"
              icon={Package}
              title={q ? 'Không tìm thấy lô hàng phù hợp' : 'Chưa có lô hàng nào'}
              description={q
                ? 'Thử bỏ bộ lọc hoặc thay từ khoá tìm kiếm.'
                : 'Lô hàng sẽ xuất hiện ở đây khi được tạo.'}
            />
          ) : (
            <div className="shipments-page__card-list">
              {visibleItems.map((s) => (
                <article
                  key={s.id}
                  className={`shipments-page__card${displayShipmentStatus(s.status) === ShipmentStatus.PENDING_DATE && !s.expectedDeliveryDate ? ' is-missing-date' : ''}`}
                >
                  <div className="shipments-page__card-top">
                    <div className="shipments-page__card-identity">
                      <span className="shipments-page__card-code">
                        {shipmentLabel(s)}
                      </span>
                      <span className="shipments-page__card-customer">{customerLabel(s)}</span>
                    </div>
                    <StatusPill variant={STATUS_PILL_VARIANT[displayShipmentStatus(s.status)]}>
                      {shipmentStatusLabel(s.status)}
                    </StatusPill>
                  </div>

                  <div className="shipments-page__card-facts">
                    <div>
                      <span>Loại hàng (Xuất/Nhập)</span>
                      <strong>{tradeDirectionLabel(s)}</strong>
                    </div>
                    <div>
                      <span>Số Cont/Số lượng</span>
                      <strong>{cargoSummary(s)}</strong>
                    </div>
                    <div>
                      <span>Hãng tàu</span>
                      <strong>{s.shippingLineSummary ?? s.shippingLineName ?? '—'}</strong>
                    </div>
                    <div>
                      <span>Nhà xe</span>
                      <strong>{s.carrierSummary ?? '—'}</strong>
                    </div>
                    <div>
                      <span>Biển số xe</span>
                      <strong>{s.vehiclePlateSummary ?? '—'}</strong>
                    </div>
                    <div>
                      <span>Nhà máy</span>
                      <strong>{s.factoryName ?? '—'}</strong>
                    </div>
                    <div>
                      <span>Ngày vận chuyển</span>
                      <strong>{formatDeliveryDate(s.expectedDeliveryDate)}</strong>
                    </div>
                    <div>
                      <span>Giờ đóng/trả</span>
                      <strong>{formatClosingTime(s.closingAt)}</strong>
                    </div>
                    <div>
                      <span>Ngày đóng/trả</span>
                      <strong>{formatCutoffDate(s.customsCutoffAt)}</strong>
                    </div>
                    <div>
                      <span>Tuyến đường</span>
                      <strong>{formatRoute(s) ?? '—'}</strong>
                    </div>
                  </div>

                  {(s.blNumber || s.bookingRef) && (
                    <div className="shipments-page__card-refs">
                      <div>
                        <span>Số B/L</span>
                        <strong>{s.blNumber ?? '—'}</strong>
                      </div>
                      <div>
                        <span>Số Bill/Book</span>
                        <strong>{s.bookingRef ?? '—'}</strong>
                      </div>
                    </div>
                  )}
                  {s.operationalNotes && (
                    <div className="shipments-page__card-notes">
                      <span>Ghi chú</span>
                      <strong title={s.operationalNotes}>{truncate(s.operationalNotes, 80)}</strong>
                    </div>
                  )}

                  {displayShipmentStatus(s.status) === ShipmentStatus.PENDING_DATE && !s.expectedDeliveryDate && (
                    <div className="shipments-page__warning" role="note">
                      <CalendarClock size={16} aria-hidden="true" />
                      <span>Thiếu ngày vận chuyển</span>
                    </div>
                  )}

                  {editingDate?.shipmentId === s.id && (
                    <form
                      className="shipments-page__date-editor shipments-page__date-editor--mobile"
                      aria-busy={editingDate.saving}
                      onClick={(event) => event.stopPropagation()}
                      onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void saveExpectedDeliveryDate(s); }}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Escape') setEditingDate(null);
                      }}
                    >
                      <label htmlFor={`mobile-delivery-date-${s.id}`}>Ngày vận chuyển</label>
                      <div>
                        <input
                          id={`mobile-delivery-date-${s.id}`}
                          name="expectedDeliveryDate"
                          type="date"
                          required
                          value={editingDate.value}
                          disabled={editingDate.saving}
                          onChange={(event) => setEditingDate((current) => current ? { ...current, value: event.target.value, error: null } : current)}
                        />
                        <button type="submit" disabled={editingDate.saving || !editingDate.value} aria-label="Lưu ngày vận chuyển">
                          {editingDate.saving ? <Loader2 size={17} className="spin" aria-hidden="true" /> : <Save size={17} aria-hidden="true" />}
                          <span>Lưu</span>
                        </button>
                        <button type="button" disabled={editingDate.saving} onClick={cancelDateEdit} aria-label="Hủy chỉnh sửa ngày vận chuyển">
                          <X size={17} aria-hidden="true" />
                          <span>Hủy</span>
                        </button>
                      </div>
                      {editingDate.error && <p role="alert">{editingDate.error}</p>}
                    </form>
                  )}

                  <div className="shipments-page__card-foot">
                    {canInlineEdit && editingDate?.shipmentId !== s.id && (
                      <button
                        type="button"
                        className="shipments-page__mobile-date-action"
                        onClick={(event) => { event.preventDefault(); event.stopPropagation(); startDateEdit(s); }}
                      >
                        <CalendarClock size={16} aria-hidden="true" />
                        {s.expectedDeliveryDate ? 'Đổi ngày vận chuyển' : 'Chọn ngày vận chuyển'}
                      </button>
                    )}
                    <Link
                      to={`/shipments/${s.id}`}
                      className="shipments-page__card-cta"
                      aria-label={`Xem chi tiết ${shipmentLabel(s)}`}
                    >
                      Xem chi tiết
                      <ChevronRight size={16} aria-hidden="true" />
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}

          {!loading && !hasBlockingError && total > 0 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              totalItems={total}
              pageSize={PAGE_SIZE}
              onChange={(p) => updateFilter('page', String(p))}
            />
          )}
        </div>

        {/* ── Desktop table (>820px) ───────────────────────────────────── */}
        <div className="desktop-only shipments-page__desktop">
          <div className="shipments-page__table-scroll">
            <table className="shipments-page__table" aria-label="Danh sách lô hàng">
              <caption className="sr-only">Danh sách lô hàng và thông tin điều phối</caption>
              <thead>
                <tr>
                  {visibleColumns.has('shipment') && <th className="shipments-page__th">Lô hàng</th>}
                  {visibleColumns.has('customer') && <th className="shipments-page__th">Khách hàng</th>}
                  {visibleColumns.has('direction') && <th className="shipments-page__th">Loại hàng (Xuất/Nhập)</th>}
                  {visibleColumns.has('cargo') && <th className="shipments-page__th">Số Cont/Số lượng</th>}
                  {visibleColumns.has('shippingLine') && <th className="shipments-page__th">Hãng tàu</th>}
                  {visibleColumns.has('carrier') && <th className="shipments-page__th">Nhà xe</th>}
                  {visibleColumns.has('vehiclePlate') && <th className="shipments-page__th">Biển số xe</th>}
                  {visibleColumns.has('factory') && <th className="shipments-page__th">Nhà máy</th>}
                  {visibleColumns.has('blNumber') && <th className="shipments-page__th">Số B/L</th>}
                  {visibleColumns.has('bookingRef') && <th className="shipments-page__th">Số Bill/Book</th>}
                  {visibleColumns.has('declarationNumber') && <th className="shipments-page__th">Số tờ khai</th>}
                  {visibleColumns.has('route') && <th className="shipments-page__th">Tuyến đường</th>}
                  {visibleColumns.has('delivery') && <th className="shipments-page__th">Ngày vận chuyển</th>}
                  {visibleColumns.has('cutoffTime') && <th className="shipments-page__th">Giờ đóng/trả</th>}
                  {visibleColumns.has('cutoffDate') && <th className="shipments-page__th">Ngày đóng/trả</th>}
                  {visibleColumns.has('status') && <th className="shipments-page__th">Trạng thái</th>}
                  {visibleColumns.has('notes') && <th className="shipments-page__th">Ghi chú</th>}
                  <th aria-label="Mở chi tiết" />
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={desktopColumnCount} className="shipments-page__cell-msg">
                    <Loader2 size={22} className="spin" />
                    <p>Đang tải lô hàng…</p>
                  </td></tr>
                )}
                {!loading && !hasBlockingError && visibleItems.length === 0 && (
                  <tr><td colSpan={desktopColumnCount} className="shipments-page__cell-msg">
                    <Package size={28} aria-hidden="true" />
                    <p>{q ? 'Không tìm thấy lô hàng phù hợp' : 'Chưa có lô hàng nào'}</p>
                  </td></tr>
                )}
                {!loading && !hasBlockingError && visibleItems.map((s) => (
                    <ClickableCard
                      key={s.id}
                      as="tr"
                      className={`shipments-page__tr${displayShipmentStatus(s.status) === ShipmentStatus.PENDING_DATE && !s.expectedDeliveryDate ? ' is-missing-date' : ''}`}
                      to={`/shipments/${s.id}`}
                      ariaLabel={shipmentLabel(s)}
                    >
                      {visibleColumns.has('shipment') && <td className="shipments-page__td shipments-page__td--code">
                        <span className="shipments-page__code">{shipmentLabel(s)}</span>
                        {s.factoryName && <span className="shipments-page__sub">{s.factoryName}</span>}
                      </td>}
                      {visibleColumns.has('customer') && <td className="shipments-page__td" title={customerLabel(s)}>{customerLabel(s)}</td>}
                      {visibleColumns.has('direction') && <td className="shipments-page__td">{tradeDirectionLabel(s)}</td>}
                      {visibleColumns.has('cargo') && <td className="shipments-page__td">{cargoSummary(s)}</td>}
                      {visibleColumns.has('shippingLine') && <td className="shipments-page__td">{s.shippingLineSummary ?? s.shippingLineName ?? <span className="shipments-page__muted">—</span>}</td>}
                      {visibleColumns.has('carrier') && <td className="shipments-page__td">{s.carrierSummary ?? <span className="shipments-page__muted">—</span>}</td>}
                      {visibleColumns.has('vehiclePlate') && <td className="shipments-page__td shipments-page__td--mono">{s.vehiclePlateSummary ?? <span className="shipments-page__muted">—</span>}</td>}
                      {visibleColumns.has('factory') && <td className="shipments-page__td">{s.factoryName ?? <span className="shipments-page__muted">—</span>}</td>}
                      {visibleColumns.has('blNumber') && <td className="shipments-page__td shipments-page__td--mono" title={s.blNumber ?? undefined}>
                        {s.blNumber ?? <span className="shipments-page__muted">—</span>}
                      </td>}
                      {visibleColumns.has('bookingRef') && <td className="shipments-page__td shipments-page__td--mono" title={s.bookingRef ?? undefined}>
                        {s.bookingRef ?? <span className="shipments-page__muted">—</span>}
                      </td>}
                      {visibleColumns.has('declarationNumber') && <td className="shipments-page__td shipments-page__td--mono" title={s.declarationNumber ?? undefined}>
                        {s.declarationNumber ?? <span className="shipments-page__muted">—</span>}
                      </td>}
                      {visibleColumns.has('route') && <td className="shipments-page__td">
                        {formatRoute(s)
                          ? <span className="shipments-page__route" title={formatRoute(s) ?? undefined}>{formatRoute(s)}</span>
                          : <span className="shipments-page__muted">Chưa cập nhật</span>}
                      </td>}
                      {visibleColumns.has('cutoffTime') && <td className="shipments-page__td shipments-page__td--mono">{formatClosingTime(s.closingAt)}</td>}
                      {visibleColumns.has('cutoffDate') && <td className="shipments-page__td shipments-page__td--mono">{formatCutoffDate(s.customsCutoffAt)}</td>}
                      {visibleColumns.has('notes') && <td className="shipments-page__td" title={s.operationalNotes ?? undefined}>{truncate(s.operationalNotes, 60)}</td>}
                      {visibleColumns.has('delivery') && <td className="shipments-page__td shipments-page__td--date">
                        {editingDate?.shipmentId === s.id ? (
                          <form
                            className="shipments-page__date-editor"
                            aria-busy={editingDate.saving}
                            onClick={(event) => event.stopPropagation()}
                            onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void saveExpectedDeliveryDate(s); }}
                            onKeyDown={(event) => {
                              event.stopPropagation();
                              if (event.key === 'Escape') setEditingDate(null);
                            }}
                          >
                            <label className="sr-only" htmlFor={`delivery-date-${s.id}`}>Ngày vận chuyển của {shipmentLabel(s)}</label>
                            <input
                              id={`delivery-date-${s.id}`}
                              name="expectedDeliveryDate"
                              type="date"
                              required
                              value={editingDate.value}
                              disabled={editingDate.saving}
                              onChange={(event) => setEditingDate((current) => current ? { ...current, value: event.target.value, error: null } : current)}
                            />
                            <button type="submit" disabled={editingDate.saving || !editingDate.value} aria-label="Lưu ngày vận chuyển">
                              {editingDate.saving ? <Loader2 size={17} className="spin" aria-hidden="true" /> : <Save size={17} aria-hidden="true" />}
                            </button>
                            <button type="button" disabled={editingDate.saving} onClick={cancelDateEdit} aria-label="Hủy chỉnh sửa ngày vận chuyển">
                              <X size={17} aria-hidden="true" />
                            </button>
                            {editingDate.error && <p role="alert">{editingDate.error}</p>}
                          </form>
                        ) : canInlineEdit ? (
                          <button
                            type="button"
                            className="shipments-page__date-trigger"
                            title="Chọn hoặc cập nhật ngày vận chuyển"
                            aria-keyshortcuts="Enter F2"
                            onClick={(event) => { event.preventDefault(); event.stopPropagation(); startDateEdit(s); }}
                            onKeyDown={(event) => {
                              event.stopPropagation();
                              if (event.key === 'Enter' || event.key === 'F2') {
                                event.preventDefault();
                                startDateEdit(s);
                              }
                            }}
                          >
                            <CalendarClock size={16} aria-hidden="true" />
                            <span>{formatDeliveryDate(s.expectedDeliveryDate)}</span>
                            {displayShipmentStatus(s.status) === ShipmentStatus.PENDING_DATE && !s.expectedDeliveryDate && <small>Thiếu ngày vận chuyển</small>}
                          </button>
                        ) : (
                          <span className="shipments-page__delivery-readonly">
                            {formatDeliveryDate(s.expectedDeliveryDate)}
                            {displayShipmentStatus(s.status) === ShipmentStatus.PENDING_DATE && !s.expectedDeliveryDate && <small>Thiếu ngày vận chuyển</small>}
                          </span>
                        )}
                      </td>}
                      {visibleColumns.has('status') && <td className="shipments-page__td">
                        <StatusPill variant={STATUS_PILL_VARIANT[displayShipmentStatus(s.status)]}>
                          {shipmentStatusLabel(s.status)}
                        </StatusPill>
                      </td>}
                      <td className="shipments-page__td shipments-page__td--chev">
                        <ChevronRight size={18} aria-hidden="true" />
                      </td>
                    </ClickableCard>
                ))}
              </tbody>
            </table>
          </div>

          {!loading && !hasBlockingError && total > 0 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              totalItems={total}
              pageSize={PAGE_SIZE}
              onChange={(p) => updateFilter('page', String(p))}
            />
          )}
        </div>
      </section>
    </div>
  );
}
