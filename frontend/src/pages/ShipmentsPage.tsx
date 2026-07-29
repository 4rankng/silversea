import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Package,
  Search,
  X,
  Loader2,
  ChevronRight,
  CalendarClock,
  MapPin,
  User,
  ArrowRight,
} from 'lucide-react';
import { api } from '../lib/api';
import { ApiError } from '../lib/api';
import { PageHeader, StatusPill } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { EmptyState, Pagination } from '../design-system';
import { ClickableCard } from '../components/shared/ClickableCard';
import { SHIPMENT_STATUS_LABELS, ShipmentStatus } from '@tingting/shared';
import { usePageAnimations } from '../hooks/animations';
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

type StatusFilter = 'all' | ShipmentStatus;

const STATUS_FILTER_ORDER = [
  'all',
  ShipmentStatus.DRAFT,
  ShipmentStatus.IN_PROGRESS,
  ShipmentStatus.DELIVERED,
  ShipmentStatus.CLOSED,
  ShipmentStatus.CANCELED,
] as const satisfies readonly StatusFilter[];

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'Tất cả',
  ...SHIPMENT_STATUS_LABELS,
};

// Status → StatusPill variant (mirrors the trip status-color pattern).
const STATUS_PILL_VARIANT: Record<ShipmentStatus, 'neutral' | 'info' | 'success' | 'danger'> = {
  DRAFT: 'neutral',
  IN_PROGRESS: 'info',
  DELIVERED: 'success',
  CLOSED: 'neutral',
  CANCELED: 'danger',
};

// Comma-separated route "Nơi nhận → Nơi giao", shown when either leg is set.
function formatRoute(s: ShipmentRow): string | null {
  if (!s.pickupLocation && !s.deliveryLocation) return null;
  return [s.pickupLocation ?? '—', s.deliveryLocation ?? '—']
    .filter((v) => v && v !== '—')
    .join(' → ');
}

// Human-readable customer label. The backend joins customers.name onto each
// list row; we only fall back to the bare id in the rare case the join
// returned null (hard-deleted customer).
function customerLabel(s: ShipmentRow): string {
  return s.customerName ?? `#${s.customerId}`;
}

function formatDeliveryDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('vi-VN');
}

const PAGE_SIZE = 20;

export default function ShipmentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Filter state is mirrored in the URL query string so reloads / deep links
  // preserve the view.
  const rawStatusFilter = searchParams.get('status');
  const statusFilter: StatusFilter = rawStatusFilter
    && STATUS_FILTER_ORDER.includes(rawStatusFilter as StatusFilter)
    ? rawStatusFilter as StatusFilter
    : 'all';
  const rawPage = searchParams.get('page');
  const parsedPage = rawPage && /^\d+$/.test(rawPage) ? Number(rawPage) : 1;
  const page = Math.max(1, parsedPage);
  const searchQueryParam = searchParams.get('q') ?? '';
  const [searchInput, setSearchInput] = useState(searchQueryParam);

  const [data, setData] = useState<ShipmentListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      // NOTE: the backend list endpoint doesn't yet support free-text `q`; we
      // filter client-side on shipmentCode/BL/bookingRef across the fetched
      // page (see `visibleItems` below). The param is preserved in the URL so
      // the backend can pick it up transparently when the filter ships.
      // Importantly `q` is NOT a fetch dependency — typing in the search box
      // must NOT trigger a server refetch.
      const res = await api.get<ShipmentListResponse>(`/shipments?${qs.toString()}`);
      if (requestId !== requestSequence.current) return;
      setData(res);
    } catch (err) {
      if (requestId !== requestSequence.current) return;
      setError(err instanceof ApiError ? err.message : 'Không thể tải danh sách lô hàng');
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // Client-side text filter (see note above).
  const q = searchQueryParam.trim().toLowerCase();
  const visibleItems = useMemo(() => (data?.items ?? []).filter((s) => {
    if (!q) return true;
    return (
      (s.shipmentCode ?? '').toLowerCase().includes(q) ||
      (s.blNumber ?? '').toLowerCase().includes(q) ||
      (s.bookingRef ?? '').toLowerCase().includes(q)
    );
  }), [data?.items, q]);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasBlockingError = Boolean(error && !data);
  const currentViewLabel = statusFilter === 'all'
    ? 'Tất cả lô hàng'
    : STATUS_FILTER_LABELS[statusFilter];
  const resultSummary = hasBlockingError
    ? 'Không thể tải dữ liệu lô hàng'
    : loading
    ? 'Đang cập nhật danh sách…'
    : q
      ? `${visibleItems.length} kết quả phù hợp trên trang ${page}`
      : `${visibleItems.length} lô hàng trên trang ${page}`;

  return (
    <div className="shipments-page page-anim" ref={pageAnimRef}>
      <Breadcrumbs
        className="shipments-page__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Lô hàng' },
        ]}
      />
      <PageHeader
        title="Lô hàng"
        iconName="cargo"
        description="Theo dõi hồ sơ, tuyến vận chuyển và tiến độ giao nhận"
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

          <div className="shipments-page__search">
            <Search size={18} className="shipments-page__search-icon" aria-hidden="true" />
            <input
              type="search"
              className="shipments-page__search-input"
              placeholder="Tìm mã lô, số B/L, mã đặt chỗ"
              aria-label="Tìm lô hàng theo mã, số B/L, hoặc mã đặt chỗ"
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
              title={q ? 'Không tìm thấy lô hàng phù hợp ở trang này' : 'Chưa có lô hàng nào'}
              description={q
                ? (data && data.total > data.items.length
                    ? 'Tìm kiếm hiện chỉ áp dụng trong trang đang xem. Thử sang trang kế hoặc xoá tìm kiếm để xem toàn bộ.'
                    : 'Thử bỏ bộ lọc hoặc thay từ khoá tìm kiếm.')
                : 'Lô hàng sẽ xuất hiện ở đây khi được tạo.'}
            />
          ) : (
            <div className="shipments-page__card-list">
              {visibleItems.map((s) => (
                <ClickableCard
                  key={s.id}
                  as="article"
                  className="shipments-page__card"
                  to={`/shipments/${s.id}`}
                  ariaLabel={`Lô hàng ${s.shipmentCode ?? `#${s.id}`}`}
                >
                  <div className="shipments-page__card-top">
                    <div className="shipments-page__card-identity">
                      <span className="shipments-page__card-code">
                        {s.shipmentCode ?? `#${s.id}`}
                      </span>
                      <span className="shipments-page__card-customer">{customerLabel(s)}</span>
                    </div>
                    <StatusPill variant={STATUS_PILL_VARIANT[s.status]}>
                      {SHIPMENT_STATUS_LABELS[s.status]}
                    </StatusPill>
                  </div>

                  <div className="shipments-page__card-refs">
                    <div>
                      <span>Số B/L</span>
                      <strong>{s.blNumber ?? '—'}</strong>
                    </div>
                    <div>
                      <span>Mã đặt chỗ</span>
                      <strong>{s.bookingRef ?? '—'}</strong>
                    </div>
                  </div>

                  {formatRoute(s) && (
                    <div className="shipments-page__card-route">
                      <MapPin size={16} aria-hidden="true" />
                      <span>{formatRoute(s)}</span>
                    </div>
                  )}

                  <div className="shipments-page__card-foot">
                    <span>
                      {s.expectedDeliveryDate ? (
                        <><CalendarClock size={15} aria-hidden="true" /> Giao dự kiến {formatDeliveryDate(s.expectedDeliveryDate)}</>
                      ) : s.contactName ? (
                        <><User size={15} aria-hidden="true" /> {s.contactName}</>
                      ) : (
                        <><User size={15} aria-hidden="true" /> {customerLabel(s)}</>
                      )}
                    </span>
                    <span className="shipments-page__card-cta">
                      Xem chi tiết
                      <ChevronRight size={16} aria-hidden="true" />
                    </span>
                  </div>
                </ClickableCard>
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
              <colgroup>
                <col className="shipments-page__col--shipment" />
                <col className="shipments-page__col--bl" />
                <col className="shipments-page__col--booking" />
                <col className="shipments-page__col--route" />
                <col className="shipments-page__col--delivery" />
                <col className="shipments-page__col--status" />
                <col className="shipments-page__col--chevron" />
              </colgroup>
              <thead>
                <tr>
                  {['Lô hàng', 'Số B/L', 'Mã đặt chỗ', 'Tuyến vận chuyển', 'Giao dự kiến', 'Trạng thái'].map((h) => (
                    <th key={h} className="shipments-page__th">{h}</th>
                  ))}
                  <th aria-label="Mở chi tiết" />
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={7} className="shipments-page__cell-msg">
                    <Loader2 size={22} className="spin" />
                    <p>Đang tải lô hàng…</p>
                  </td></tr>
                )}
                {!loading && !hasBlockingError && visibleItems.length === 0 && (
                  <tr><td colSpan={7} className="shipments-page__cell-msg">
                    <Package size={28} aria-hidden="true" />
                    <p>{q ? 'Không tìm thấy lô hàng phù hợp ở trang này' : 'Chưa có lô hàng nào'}</p>
                  </td></tr>
                )}
                {!loading && !hasBlockingError && visibleItems.map((s) => (
                  <ClickableCard
                    key={s.id}
                    as="tr"
                    className="shipments-page__tr"
                    to={`/shipments/${s.id}`}
                    ariaLabel={`Lô hàng ${s.shipmentCode ?? `#${s.id}`}`}
                  >
                    <td className="shipments-page__td shipments-page__td--code">
                      <span className="shipments-page__code">{s.shipmentCode ?? `#${s.id}`}</span>
                      <span className="shipments-page__sub">{customerLabel(s)}</span>
                    </td>
                    <td className="shipments-page__td shipments-page__td--mono" title={s.blNumber ?? undefined}>
                      {s.blNumber ?? <span className="shipments-page__muted">—</span>}
                    </td>
                    <td className="shipments-page__td shipments-page__td--mono" title={s.bookingRef ?? undefined}>
                      {s.bookingRef ?? <span className="shipments-page__muted">—</span>}
                    </td>
                    <td className="shipments-page__td">
                      {formatRoute(s)
                        ? (
                          <span className="shipments-page__route" title={formatRoute(s) ?? undefined}>
                            <MapPin size={15} aria-hidden="true" />
                            <span>{s.pickupLocation ?? '—'}</span>
                            <ArrowRight size={14} aria-hidden="true" />
                            <span>{s.deliveryLocation ?? '—'}</span>
                          </span>
                        )
                        : <span className="shipments-page__muted">Chưa cập nhật</span>}
                    </td>
                    <td className="shipments-page__td shipments-page__td--date">
                      {s.expectedDeliveryDate
                        ? (
                          <span>
                            <CalendarClock size={15} aria-hidden="true" />
                            {formatDeliveryDate(s.expectedDeliveryDate)}
                          </span>
                        )
                        : <span className="shipments-page__muted">—</span>}
                    </td>
                    <td className="shipments-page__td">
                      <StatusPill variant={STATUS_PILL_VARIANT[s.status]}>
                        {SHIPMENT_STATUS_LABELS[s.status]}
                      </StatusPill>
                    </td>
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
