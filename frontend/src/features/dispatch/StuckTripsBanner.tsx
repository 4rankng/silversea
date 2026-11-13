import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { qk } from '../../api/keys';
import { tripClient } from '../../api/tripClient';
import './StuckTripsBanner.css';

/**
 * SIL-817 (id 946, PROD 13/11) — dispatch's strand watchlist.
 *
 * Trip 13 TRP-202609-0011 sat IN_TRANSIT from 21/09 to 13/11 behind dispatch
 * handoff #38 (UNSEEN, handler NULL) with nobody looking: the driver's app
 * offered no reachable Hoàn tất and dispatch had no surface that names a
 * running trip gone stale. This banner fixes the visibility half: every
 * IN_TRANSIT trip whose clock (plannedStartAt, falling back to updatedAt) ran
 * past `days` days renders here with its active handoff and whether a handler
 * is attached. Fetch failure stays silent — a watchlist must never break the
 * plan grid beneath it.
 */
const STUCK_DAYS = 7;
const COLLAPSED_ROW_CAP = 5;

export function StuckTripsBanner() {
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: qk.trips.stuck(STUCK_DAYS),
    queryFn: () => tripClient.listStuckTrips(STUCK_DAYS),
    // The watchlist is advisory: a failed fetch must not hammer the API.
    retry: 1,
    staleTime: 60_000,
  });

  if (isLoading || isError || !data || data.items.length === 0) return null;

  const items = expanded ? data.items : data.items.slice(0, COLLAPSED_ROW_CAP);
  const overflow = data.items.length - items.length;

  return (
    <div className="stuck-trips-banner" role="region" aria-label={`Chuyến kẹt quá ${data.days} ngày`}>
      <div className="stuck-trips-banner__head">
        <AlertTriangle size={16} aria-hidden="true" />
        <strong>
          Chuyến kẹt quá {data.days} ngày ({data.items.length})
        </strong>
        <span className="stuck-trips-banner__hint">
          — chuyến đang chạy cần điều vận xử lý (hoàn tất/hủy). Lệnh phát chưa gắn điều vận đánh dấu “chưa có người phụ trách”.
        </span>
        <button
          type="button"
          className="stuck-trips-banner__btn"
          onClick={() => void refetch()}
          aria-label="Làm mới danh sách chuyến kẹt"
        >
          <RefreshCw size={14} className={isFetching ? 'stuck-trips-banner__spin' : undefined} />
        </button>
        <button
          type="button"
          className="stuck-trips-banner__btn"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Thu gọn danh sách chuyến kẹt' : 'Mở rộng danh sách chuyến kẹt'}
        >
          {expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </button>
      </div>
      <ul className="stuck-trips-banner__list">
        {items.map((trip) => (
          <li key={trip.tripId} className="stuck-trips-banner__row">
            <strong>{trip.tripCode ?? `#${trip.tripId}`}</strong>
            <span>{trip.shipmentCode ?? '—'}</span>
            <span>{trip.driverName ?? '—'}</span>
            <span>{trip.truckPlate ?? '—'}</span>
            <span className="stuck-trips-banner__days">{trip.daysStuck} ngày</span>
            {trip.activeHandoff == null
              ? <span className="stuck-trips-banner__chip">không có lệnh phát</span>
              : (
                <span
                  className={`stuck-trips-banner__chip${trip.activeHandoff.handlerId == null ? ' stuck-trips-banner__chip--unhandled' : ''}`}
                >
                  {`lệnh phát #${trip.activeHandoff.id} ${trip.activeHandoff.status}${trip.activeHandoff.handlerId == null ? ' — chưa có người phụ trách' : ''}`}
                </span>
              )}
          </li>
        ))}
        {overflow > 0 && (
          <li className="stuck-trips-banner__row stuck-trips-banner__row--more">
            <span>… còn {overflow} chuyến nữa</span>
          </li>
        )}
      </ul>
    </div>
  );
}
