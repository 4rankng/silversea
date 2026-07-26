import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Package, Search, X, Loader2, ChevronRight, CalendarClock, MapPin, User } from 'lucide-react';
import { api } from '../lib/api';
import { ApiError } from '../lib/api';
import { PageHeader, FilterPill, StatusPill } from '../components/UI';
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
  const statusFilter = (searchParams.get('status') as StatusFilter | null) ?? 'all';
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const [searchInput, setSearchInput] = useState(searchParams.get('q') ?? '');

  const [data, setData] = useState<ShipmentListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { rootRef: pageAnimRef } = usePageAnimations({ ready: !loading });

  const updateFilter = useCallback((key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value === null || value === '' || value === 'all') {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    // Reset to page 1 whenever the filter changes — staying on page 5 of a
    // newly-filtered result set is never what the user wants.
    if (key !== 'page') next.delete('page');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

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
    setLoading(true);
    setError(null);
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
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không thể tải danh sách lô hàng');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // Client-side text filter (see note above).
  const q = (searchParams.get('q') ?? '').trim().toLowerCase();
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
        description={total > 0 ? `${total} lô hàng đang quản lý` : 'Quản lý lô hàng theo khách hàng'}
      />

      {/* Toolbar: status filter pills + free-text search */}
      <div className="toolbar shipments-page__toolbar">
        <FilterPill
          active={statusFilter === 'all'}
          onClick={() => updateFilter('status', null)}
        >
          Tất cả · {total}
        </FilterPill>
        {STATUS_FILTER_ORDER.filter((k) => k !== 'all').map((key) => (
          <FilterPill
            key={key}
            active={statusFilter === key}
            onClick={() => updateFilter('status', key)}
          >
            {STATUS_FILTER_LABELS[key]}
          </FilterPill>
        ))}
        <div className="toolbar__spacer" />
        <div className="shipments-page__search">
          <Search size={14} className="shipments-page__search-icon" />
          <input
            type="text"
            className="input shipments-page__search-input"
            placeholder="Tìm mã lô, số B/L, mã đặt chỗ…"
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
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="shipments-page__error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void fetchData()}>
            Thử lại
          </button>
        </div>
      )}

      {/* ── Mobile card list (≤820px) ──────────────────────────────────── */}
      <div className="mobile-only table-wrap shipments-page__mobile">
        {loading ? (
          <div className="shipments-page__loading">
            <Loader2 size={22} className="spin" />
            <span>Đang tải…</span>
          </div>
        ) : visibleItems.length === 0 ? (
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
          <div className="m-card-list">
            {visibleItems.map((s) => (
              <ClickableCard
                key={s.id}
                as="div"
                className="m-card shipments-page__card"
                to={`/shipments/${s.id}`}
                ariaLabel={`Lô hàng ${s.shipmentCode ?? `#${s.id}`}`}
              >
                <div className="m-card__top">
                  <span className="m-card__title shipments-page__card-code">
                    {s.shipmentCode ?? `#${s.id}`}
                  </span>
                  <StatusPill variant={STATUS_PILL_VARIANT[s.status]}>
                    {SHIPMENT_STATUS_LABELS[s.status]}
                  </StatusPill>
                </div>
                <div className="m-card__meta shipments-page__card-meta">
                  {s.blNumber && <span>Số B/L: <strong>{s.blNumber}</strong></span>}
                  {s.bookingRef && <span>Đặt chỗ: {s.bookingRef}</span>}
                </div>
                {formatRoute(s) && (
                  <div className="m-card__meta shipments-page__card-route">
                    <MapPin size={12} aria-hidden="true" />
                    <span>{formatRoute(s)}</span>
                  </div>
                )}
                <div className="m-card__row shipments-page__card-foot">
                  <span className="m-card__row-label">
                    {s.expectedDeliveryDate ? (
                      <><CalendarClock size={12} aria-hidden="true" /> Giao dự kiến</>
                    ) : s.contactName ? (
                      <><User size={12} aria-hidden="true" /> {s.contactName}</>
                    ) : (
                      <><User size={12} aria-hidden="true" /> {customerLabel(s)}</>
                    )}
                  </span>
                  <span className="m-card__row-value shipments-page__card-cta">
                    {s.expectedDeliveryDate ? formatDeliveryDate(s.expectedDeliveryDate) : 'Xem chi tiết'}
                    <ChevronRight size={14} aria-hidden="true" />
                  </span>
                </div>
              </ClickableCard>
            ))}
          </div>
        )}
        {!loading && visibleItems.length > 0 && (
          <div className="table-foot">
            <span>Hiển thị <strong style={{ fontFamily: 'var(--font-mono)' }}>{visibleItems.length}</strong> lô hàng</span>
          </div>
        )}
      </div>

      {/* ── Desktop table (>820px) ─────────────────────────────────────── */}
      <div className="desktop-only table-wrap shipments-page__desktop">
        <div className="table-scroll">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 880, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '20%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: 40 }} />
            </colgroup>
            <thead>
              <tr>
                {['Mã lô hàng', 'Số B/L', 'Mã đặt chỗ', 'Tuyến', 'Trạng thái'].map((h) => (
                  <th key={h} className="shipments-page__th">{h}</th>
                ))}
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="shipments-page__cell-msg">
                  <Loader2 size={22} className="spin" />
                  <p>Đang tải…</p>
                </td></tr>
              )}
              {!loading && visibleItems.length === 0 && (
                <tr><td colSpan={6} className="shipments-page__cell-msg">
                  <Package size={28} aria-hidden="true" style={{ color: 'var(--ink-4)' }} />
                  <p>{q ? 'Không tìm thấy lô hàng phù hợp ở trang này' : 'Chưa có lô hàng nào'}</p>
                </td></tr>
              )}
              {!loading && visibleItems.map((s) => (
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
                  <td className="shipments-page__td shipments-page__td--mono">
                    {s.blNumber ?? <span className="shipments-page__muted">—</span>}
                  </td>
                  <td className="shipments-page__td shipments-page__td--mono">
                    {s.bookingRef ?? <span className="shipments-page__muted">—</span>}
                  </td>
                  <td className="shipments-page__td">
                    {formatRoute(s)
                      ? <span className="shipments-page__route"><MapPin size={12} aria-hidden="true" /> {formatRoute(s)}</span>
                      : <span className="shipments-page__muted">—</span>}
                  </td>
                  <td className="shipments-page__td">
                    <StatusPill variant={STATUS_PILL_VARIANT[s.status]}>
                      {SHIPMENT_STATUS_LABELS[s.status]}
                    </StatusPill>
                  </td>
                  <td className="shipments-page__td shipments-page__td--chev">
                    <ChevronRight size={16} aria-hidden="true" />
                  </td>
                </ClickableCard>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && total > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            totalItems={total}
            pageSize={PAGE_SIZE}
            onChange={(p) => updateFilter('page', String(p))}
          />
        )}
      </div>
    </div>
  );
}
