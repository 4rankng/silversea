import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Package, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { api } from '../lib/api';
import { ApiError } from '../lib/api';
import { PageHeader, FilterPill } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { EmptyState } from '../design-system';
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
const STATUS_VARIANT: Record<ShipmentStatus, 'draft' | 'info' | 'success' | 'muted' | 'danger'> = {
  DRAFT: 'draft',
  IN_PROGRESS: 'info',
  DELIVERED: 'success',
  CLOSED: 'muted',
  CANCELED: 'danger',
};

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
      const res = await api.get<ShipmentListResponse>(`/api/shipments?${qs.toString()}`);
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
  const visibleItems = (data?.items ?? []).filter((s) => {
    if (!q) return true;
    return (
      (s.shipmentCode ?? '').toLowerCase().includes(q) ||
      (s.blNumber ?? '').toLowerCase().includes(q) ||
      (s.bookingRef ?? '').toLowerCase().includes(q)
    );
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  return (
    <div className="shipments-page page-anim" ref={pageAnimRef}>
      <Breadcrumbs items={[{ label: 'Lô hàng' }]} />
      <PageHeader title="Lô hàng" description="Danh sách lô hàng (lô hàng precedes and outlives any single trip)." />

      <div className="shipments-page__toolbar">
        <div className="shipments-page__filters">
          {STATUS_FILTER_ORDER.map((key) => (
            <FilterPill
              key={key}
              active={statusFilter === key}
              onClick={() => updateFilter('status', key === 'all' ? null : key)}
            >
              {STATUS_FILTER_LABELS[key]}
            </FilterPill>
          ))}
        </div>
        <div className="shipments-page__search">
          <Search size={16} className="shipments-page__search-icon" />
          <input
            type="text"
            className="input shipments-page__search-input"
            placeholder="Tìm theo mã lô, số B/L, mã đặt chỗ…"
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
          {error}
        </div>
      )}

      {loading ? (
        <div className="shipments-page__loading">
          <div className="spin" style={{ width: 24, height: 24, border: '3px solid var(--border-2)', borderTopColor: 'var(--brand)', borderRadius: '50%' }} />
          <span>Đang tải…</span>
        </div>
      ) : visibleItems.length === 0 ? (
        <EmptyState
          icon={Package}
          title={q ? 'Không tìm thấy lô hàng phù hợp ở trang này' : 'Chưa có lô hàng nào'}
          description={q
            ? (data && data.total > data.items.length
                ? 'Tìm kiếm hiện chỉ áp dụng trong trang đang xem. Thử sang trang kế hoặc xoá tìm kiếm để xem toàn bộ.'
                : 'Thử bỏ bộ lọc hoặc thay từ khoá tìm kiếm.')
            : 'Lô hàng (lô hàng) sẽ xuất hiện ở đây khi được tạo qua /api/shipments.'}
        />
      ) : (
        <>
          <ul className="shipments-page__list" aria-label="Danh sách lô hàng">
            {visibleItems.map((s) => (
              <li key={s.id}>
                <ClickableCard to={`/shipments/${s.id}`} className="shipments-page__row">
                  <div className="shipments-page__row-main">
                    <div className="shipments-page__row-code">
                      {s.shipmentCode ?? `#${s.id}`}
                    </div>
                    <div className="shipments-page__row-meta">
                      {s.blNumber && <span>B/L: {s.blNumber}</span>}
                      {s.bookingRef && <span>Đặt chỗ: {s.bookingRef}</span>}
                      {s.expectedDeliveryDate && <span>Giao dự kiến: {s.expectedDeliveryDate}</span>}
                    </div>
                  </div>
                  <span className={`shipments-page__status shipments-page__status--${STATUS_VARIANT[s.status]}`}>
                    {SHIPMENT_STATUS_LABELS[s.status]}
                  </span>
                </ClickableCard>
              </li>
            ))}
          </ul>

          {/* Pagination */}
          <div className="shipments-page__pager">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={page <= 1}
              onClick={() => updateFilter('page', String(page - 1))}
            >
              <ChevronLeft size={14} /> Trang trước
            </button>
            <span className="shipments-page__pager-info">
              Trang {page} / {totalPages} · {(data?.total ?? 0)} lô
            </span>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={page >= totalPages}
              onClick={() => updateFilter('page', String(page + 1))}
            >
              Trang sau <ChevronRight size={14} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
