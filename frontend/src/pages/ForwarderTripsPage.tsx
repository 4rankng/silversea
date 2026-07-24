import { useState, useRef, useEffect } from 'react';
import { Truck, Calendar, ArrowRight, Loader2, Package, Search } from 'lucide-react';
import { formatDate } from '../lib/format';
import { TripStatus, TRIP_STATUS_LABELS, TRIP_STATUS_COLORS } from '@tingting/shared';
import { PageHeader, Panel } from '../components/UI';
import { ClickableCard } from '../components/shared/ClickableCard';
import { StatusStrip } from '../components/shared/StatusStrip';
import { useForwarderTrips } from '../hooks/useQueries';
import { usePageAnimations, useListAnimations, useCounterAnimation } from '../hooks/animations';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { useDebouncedValue } from '../design-system';
import './ForwarderTripsPage.css';
import '../components/shared/HeroKpiRow.css';
import { resolveEmptyIllustration } from '../lib/emptyIllustrations';

interface TripSummary {
  id: number;
  tripCode: string | null;
  departureDate: string;
  status: TripStatus;
  routeName: string | null;
  truckPlate: string | null;
  customerName: string | null;
  containerCount: number | null;
  containerNumbers: string | null;
  /** N4: derived payment/approval state for row coloring. */
  statusColor: 'paid' | 'pending' | 'none';
}

type StatusFilter = '' | TripStatus;

const FORWARDER_STATUS_COLORS: Record<TripStatus, string> = {
  ...TRIP_STATUS_COLORS,
  [TripStatus.CREATED]: '#0284C7',
  [TripStatus.LOCKED]: '#7C3AED',
};

/** Build the className suffix for a row from its derived statusColor. */
function rowColorClass(statusColor: TripSummary['statusColor']): string {
  if (statusColor === 'paid') return 'fwd-row--paid';
  if (statusColor === 'pending') return 'fwd-row--pending';
  return '';
}

export default function ForwarderTripsPage() {
  const [activeFilter, setActiveFilter] = useState<StatusFilter>('');
  // N4: search + date-range filters. Passed into the trips query so the
  // backend filters (ilike on container/customer + departure_date range).
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Debounce the free-text search so we don't fire a backend query per keystroke
  // (matches the TripListPage pattern). Date pickers are discrete — no debounce.
  const debouncedSearch = useDebouncedValue(search, 300);

  const { data, isLoading: loading, error: queryError } = useForwarderTrips(
    activeFilter || undefined,
    {
      search: debouncedSearch || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    },
  );
  const trips = (data?.items ?? []) as TripSummary[];
  const counts = data?.counts ?? {};
  const error = queryError ? 'Không thể tải danh sách chuyến đi' : null;

  const totalTrips = Object.values(counts).reduce((sum: number, c) => sum + c, 0);
  const totalContainers = trips.reduce((sum, t) => sum + (t.containerCount ?? 0), 0);
  const hasPaymentHighlights = trips.some((trip) => trip.statusColor === 'paid' || trip.statusColor === 'pending');

  /* ── Page entrance animation ── */
  const { rootRef } = usePageAnimations({
    ready: !loading,
    selectors: ['.page-header', '.hero-kpi-row', '.fwd-filter-pills', '.ftrip-card'],
  });

  /* ── List stagger animation ── */
  const { rootRef: listRef } = useListAnimations({
    itemSelector: '.ftrip-card',
    mode: 'cards',
    deps: [trips],
  });

  /* ── Counter animation ── */
  const prefersReduced = usePrefersReducedMotion();
  const { animateCounters } = useCounterAnimation({ duration: 1200, delay: 400 });
  const heroTotalRef = useRef<HTMLSpanElement>(null);
  const heroContainersRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (loading || totalTrips === 0 || prefersReduced) return;
    animateCounters(
      [
        { el: heroTotalRef.current, value: totalTrips, suffix: ' chuyến' },
        { el: heroContainersRef.current, value: totalContainers, suffix: ' cont' },
      ],
    );
  }, [loading, totalTrips, totalContainers, animateCounters, prefersReduced]);

  if (loading) return (
    <Panel>
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-3)' }}>
        <Loader2 size={20} className="spin" style={{ display: 'inline-block' }} />
        <p style={{ marginTop: 8 }}>Đang tải danh sách chuyến đi…</p>
      </div>
    </Panel>
  );

  if (error) return (
    <Panel><div style={{ padding: 20, textAlign: 'center', color: 'var(--danger)' }}>{error}</div></Panel>
  );

  if (totalTrips === 0) return (
    <div>
      <PageHeader title="Chuyến đi" description="Danh sách chuyến đi vận chuyển" />
      <div className="empty-state">
        <img src={resolveEmptyIllustration('empty-forwarder')} alt="No trips" />
        <h3 className="empty-state-title">Chưa có chuyến đi nào</h3>
        <p className="empty-state-desc">
          Hiện chưa có chuyến đi nào trong hệ thống. Khi có chuyến đi mới, thông tin sẽ xuất hiện tại đây.
        </p>
      </div>
    </div>
  );

  return (
    <div ref={rootRef}>
      <PageHeader title="Chuyến đi" description="Danh sách chuyến đi vận chuyển" />

      {/* ── Hero KPI Row ── */}
      <div className="hero-kpi-row">
        <div className="hero-kpi-card">
          <span className="hero-kpi-card__eyebrow">Tổng chuyến đi</span>
          <span className="hero-kpi-card__amount" ref={heroTotalRef}>0 chuyến</span>
          <span className="hero-kpi-card__subtitle">Danh sách chuyến đi vận chuyển</span>
          <Truck size={72} className="hero-kpi-card__watermark" aria-hidden="true" />
        </div>
        <div className="hero-kpi-stack">
          <div className="hero-kpi-mini hero-kpi-mini--accent">
            <div className="hero-kpi-mini__body">
              <span className="hero-kpi-mini__value" ref={heroContainersRef}>0</span>
              <span className="hero-kpi-mini__label">container</span>
            </div>
            <Package size={40} className="hero-kpi-mini__watermark" aria-hidden="true" />
          </div>
        </div>
      </div>

      {/* ── Search + date-range filter (N4) ── */}
      <div className="fwd-trip-filters">
        <div className="fwd-trip-filters__search">
          <Search size={14} />
          <input
            type="text"
            placeholder="Tìm theo container, khách hàng..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="fwd-trip-filters__dates">
          <label className="fwd-trip-filters__date">
            <span>Từ ngày</span>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
            />
          </label>
          <label className="fwd-trip-filters__date">
            <span>Đến ngày</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
            />
          </label>
        </div>
      </div>

      {/* ── Clickable status filter pills ── */}
      <div className="fwd-filter-pills">
        <button
          className={`fwd-filter-pill ${activeFilter === '' ? 'fwd-filter-pill--active' : ''}`}
          onClick={() => setActiveFilter('')}
        >
          Tất cả
          <span className="fwd-filter-pill__count">{totalTrips}</span>
        </button>
        {(Object.entries(TRIP_STATUS_LABELS) as [TripStatus, string][]).map(([status, label]) => {
          const count = counts[status] ?? 0;
          if (count === 0) return null;
          return (
            <button
              key={status}
              className={`fwd-filter-pill ${activeFilter === status ? 'fwd-filter-pill--active' : ''}`}
              data-status={status}
              onClick={() => setActiveFilter(prev => prev === status ? '' : status)}
            >
              <span className="fwd-filter-pill__dot" style={{ background: FORWARDER_STATUS_COLORS[status] }} />
              {label}
              <span className="fwd-filter-pill__count">{count}</span>
            </button>
          );
        })}
      </div>

      {hasPaymentHighlights && (
        <div className="fwd-row-legend" aria-label="Giải thích màu thẻ chuyến đi">
          <span className="fwd-row-legend__label">Màu thẻ</span>
          <span className="fwd-row-legend__item">
            <span className="fwd-row-legend__swatch fwd-row-legend__swatch--pending" />
            Chờ duyệt chi phí / phiếu thanh toán
          </span>
          <span className="fwd-row-legend__item">
            <span className="fwd-row-legend__swatch fwd-row-legend__swatch--paid" />
            Đã duyệt thanh toán
          </span>
        </div>
      )}

      {/* ── Trip card list ── */}
      <div ref={listRef} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {trips.map((trip, idx) => (
          <ClickableCard
            key={trip.id}
            to={`/my-forwarder-trips/${trip.id}`}
            className={`ftrip-card fade-up ${rowColorClass(trip.statusColor)}`}
            style={{
              position: 'relative',
              overflow: 'hidden',
              animationDelay: `${idx * 40}ms`,
            }}
          >
            <StatusStrip color={FORWARDER_STATUS_COLORS[trip.status]} />
            <div className="driver-trip-card__body">
              <div className="ftrip-card__icon"><Truck size={16} /></div>
              <div className="driver-trip-card__main">
                <div className="driver-trip-card__head">
                  <span className="driver-trip-card__route">
                    {trip.routeName || 'Tuyến không xác định'}
                  </span>
                </div>
                <div className="driver-trip-card__meta">
                  <span className="driver-trip-card__plate-badge">
                    <Truck size={12} />
                    <span className="driver-trip-card__badge-text">{trip.truckPlate || '—'}</span>
                  </span>
                  {trip.containerNumbers && (
                    <span className="driver-trip-card__plate-badge">
                      <Package size={12} />
                      <span className="driver-trip-card__badge-text">{trip.containerNumbers}</span>
                    </span>
                  )}
                  <span className="driver-trip-card__meta-item">
                    <Calendar size={12} />
                    {formatDate(trip.departureDate)}
                  </span>
                  {trip.customerName && (
                    <span className="driver-trip-card__meta-item">
                      {trip.customerName}
                    </span>
                  )}
                </div>
              </div>
              <ArrowRight size={16} className="driver-trip-card__arrow" />
            </div>
          </ClickableCard>
        ))}
      </div>
    </div>
  );
}
