// DriverTwoOrdersPage — M8.3 two-orders-per-day view for the driver.
//
// Shows today's active order (IN_TRANSIT) and next order (earliest CREATED)
// as DISTINCT cards so documents/costs are never mixed between them (PRD
// M08-03-03). When the day's first order hasn't started yet, an advisory
// `firstOrderLate` banner appears — the open §3 threshold (minutes? GPS?)
// is resolved server-side as "earliest of 2+ today still CREATED"; this
// page only surfaces it.
//
// Mobile-first single column, Vietnamese labels (PRD Mxx-HT-01). Each card
// links to its trip detail at /my-trips/:id.

import { Link } from 'react-router-dom';
import { AlertTriangle, Loader2, Truck, Building2, Package, ArrowRight } from 'lucide-react';
import { TRIP_STATUS_LABELS, TRIP_STATUS_COLORS, type TripStatus } from '@tingting/shared';
import { PageHeader } from '../../components/UI';
import { useDriverTwoOrders } from '../../hooks/useDriverQueries';
import { usePageAnimations } from '../../hooks/animations';
import { resolveEmptyIllustration } from '../../lib/emptyIllustrations';
import { formatDate } from '../../lib/format';
import './DriverSecondaryPages.css';
import { EmptyState } from '../../design-system';

interface TripSummary {
  id: number;
  fulfillmentId: number | null;
  tripCode: string | null;
  departureDate: string;
  status: string;
  routeName: string | null;
  truckPlate: string | null;
  customerName: string | null;
  containerNumbers: string[];
}

/** Comma-join container numbers, capping at 2 with a "+N" overflow. */
function formatContainerList(nums: string[] | null | undefined): string {
  if (!nums || nums.length === 0) return '—';
  if (nums.length <= 2) return nums.join(', ');
  return `${nums.slice(0, 2).join(', ')} +${nums.length - 2}`;
}

function TripCard({ trip, label, accent }: { trip: TripSummary; label: string; accent: string }) {
  const status = trip.status as TripStatus;
  return (
    <Link
      to={`/my-trips/${trip.id}`}
      className="driver-trip-card"
      data-testid={`two-orders-card-${label}`}
      style={{ '--strip': TRIP_STATUS_COLORS[status], animationDelay: '0ms' } as React.CSSProperties}
    >
      <div className="dt-card__header">
        <span className="dt-card__label" style={{ color: accent, fontWeight: 700 }}>{label}</span>
        <span className="dt-card__status-pill" style={{ background: TRIP_STATUS_COLORS[status] }}>
          {TRIP_STATUS_LABELS[status] ?? trip.status}
        </span>
      </div>
      <h3 className="dt-card__route">{trip.routeName || 'Tuyến không xác định'}</h3>
      <div className="dt-card__meta">
        <span className="dt-card__meta-item">
          <Truck size={14} />
          <span className="dt-card__meta-text">{trip.tripCode ?? 'Chuyến chưa có mã'}</span>
        </span>
        <span className="dt-card__meta-item">
          <Building2 size={14} />
          <span className="dt-card__meta-text">{trip.customerName || '—'}</span>
        </span>
        <span className="dt-card__meta-item">
          <Package size={14} />
          <span className="dt-card__meta-text">{formatContainerList(trip.containerNumbers)}</span>
        </span>
      </div>
      <div className="dt-card__footer">
        <span className="dt-card__truck">{trip.truckPlate || '—'}</span>
        <ArrowRight size={16} />
      </div>
    </Link>
  );
}

export default function DriverTwoOrdersPage() {
  const { data, isLoading: loading, error: queryError, refetch, isFetching } = useDriverTwoOrders();
  const error = queryError ? 'Không thể tải thông tin hai lệnh' : null;
  const { rootRef } = usePageAnimations({ ready: !loading });

  if (loading) return (
    <div className="driver-secondary-page">
      <PageHeader title="Hai lệnh hôm nay" description="Lệnh đang chạy và lệnh tiếp theo trong ngày" />
      <div className="driver-secondary-state" role="status">
        <Loader2 size={20} className="spin" />
        <p>Đang tải hai lệnh hôm nay…</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="driver-secondary-page">
      <PageHeader title="Hai lệnh hôm nay" description="Lệnh đang chạy và lệnh tiếp theo trong ngày" />
      <EmptyState
        role="alert"
        variant="compact"
        icon={AlertTriangle}
        title={error}
        description="Hệ thống tạm thời không phản hồi."
        action={<button type="button" className="btn btn--secondary btn--sm" disabled={isFetching} onClick={() => void refetch()}>
          {isFetching ? 'Đang tải…' : 'Thử lại'}
        </button>}
      />
    </div>
  );

  const view = data;
  const allToday: TripSummary[] = view?.allToday ?? [];
  const pairedTrips = view?.pair ? [view.pair.first, view.pair.second].filter((trip): trip is TripSummary => Boolean(trip)) : [];
  const hasPersistedPair = pairedTrips.length > 0;
  const pageTitle = hasPersistedPair ? 'Lệnh ghép 2 chiều' : 'Hai lệnh hôm nay';
  const pageDescription = hasPersistedPair
    ? 'Thứ tự chuyến đi đã được điều vận ghép sẵn cho cùng xe và lái xe'
    : 'Lệnh đang chạy và lệnh tiếp theo trong ngày';

  if (!view || (!hasPersistedPair && allToday.length === 0)) return (
    <div className="driver-secondary-page">
      <PageHeader title={pageTitle} description={pageDescription} />
      <EmptyState
        variant="compact"
        illustration="empty-trips"
        title="Hôm nay không có lệnh"
        description="Bạn chưa được phân công lệnh nào cho hôm nay."
      />
    </div>
  );

  return (
    <div ref={rootRef} className="driver-secondary-page">
      <PageHeader
        title={pageTitle}
        description={hasPersistedPair ? `Cặp điều vận ngày ${formatDate(view.date)}` : `${allToday.length} lệnh trong ngày ${formatDate(view.date)}`}
      />

      {view.pair && (
        <div
          data-testid="ordered-pair-summary"
          style={{
            display: 'grid',
            gap: 10,
            marginBottom: 16,
            padding: '14px 16px',
            borderRadius: 12,
            background: 'linear-gradient(180deg, rgba(240,247,243,0.96) 0%, rgba(234,243,238,0.96) 100%)',
            border: '1px solid rgba(22, 101, 52, 0.14)',
          }}
        >
          <div style={{ fontWeight: 700, color: 'var(--ink)' }}>Cặp điều vận đã ghép</div>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', fontSize: 'var(--text-data-size)' }}>
            <div>
              <div style={{ color: 'var(--ink-3)' }}>Xe rỗng</div>
              <div style={{ fontWeight: 700 }}>{view.pair.emptyDistanceKm != null ? `${view.pair.emptyDistanceKm} km` : '—'}</div>
            </div>
            <div>
              <div style={{ color: 'var(--ink-3)' }}>Hiệu suất</div>
              <div style={{ fontWeight: 700 }}>{view.pair.combinedEfficiencyPercent != null ? `${view.pair.combinedEfficiencyPercent}%` : '—'}</div>
            </div>
            <div>
              <div style={{ color: 'var(--ink-3)' }}>Đệm thời gian</div>
              <div style={{ fontWeight: 700 }}>
                {view.pair.actualGapMinutes != null && view.pair.requiredGapMinutes != null
                  ? `${view.pair.actualGapMinutes}/${view.pair.requiredGapMinutes} phút`
                  : '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      {view.firstOrderLate && (
        <div
          role="alert"
          data-testid="first-order-late-banner"
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', marginBottom: 16,
            borderRadius: 8, background: 'rgba(217,119,6,0.08)', color: 'var(--warn, #d97706)', fontSize: 'var(--text-body-size)',
          }}
        >
          <AlertTriangle size={18} />
          <span>Lệnh đầu tiên hôm nay chưa khởi hành — vui lòng xuất phát kịp lệnh thứ hai.</span>
        </div>
      )}

      <div className="driver-secondary-list">
        {view.pair ? (
          <>
            {view.pair.first ? (
              <TripCard trip={view.pair.first} label="Chuyến 1" accent="var(--ok, #166534)" />
            ) : null}
            {view.pair.second ? (
              <TripCard trip={view.pair.second} label="Chuyến 2" accent="var(--accent, #2563eb)" />
            ) : null}
          </>
        ) : (
          <>
            {view.active ? (
              <TripCard trip={view.active} label="Lệnh đang chạy" accent="var(--ok, #16a34a)" />
            ) : (
              <div className="dt-card__empty-slot" data-testid="active-empty" style={{ padding: 16, border: '1px dashed var(--border, #e5e7eb)', borderRadius: 8, color: 'var(--ink-3)', fontSize: 'var(--text-body-size)' }}>
                Chưa có lệnh nào đang chạy.
              </div>
            )}

            {view.next ? (
              <TripCard trip={view.next} label="Lệnh tiếp theo" accent="var(--accent, #2563eb)" />
            ) : (
              <div className="dt-card__empty-slot" data-testid="next-empty" style={{ padding: 16, border: '1px dashed var(--border, #e5e7eb)', borderRadius: 8, color: 'var(--ink-3)', fontSize: 'var(--text-body-size)' }}>
                Không có lệnh tiếp theo.
              </div>
            )}
          </>
        )}
      </div>

      {!hasPersistedPair && allToday.length > 2 && (
        <p style={{ marginTop: 16, color: 'var(--ink-3)', fontSize: 'var(--text-data-size)' }}>
          Còn {allToday.length - 2} lệnh khác hôm nay — xem đầy đủ ở <Link to="/my-trips">Danh sách lệnh</Link>.
        </p>
      )}
    </div>
  );
}
