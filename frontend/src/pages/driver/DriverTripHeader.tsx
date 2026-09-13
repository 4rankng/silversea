import { useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { TRIP_STATUS_LABELS } from '@tingting/shared';
import { StatusPill } from '../../components/UI';
import { tripStatusVariant } from '../../lib/tripStatus';
import type { DriverTaskDetail } from '../../api/driverClient';

/**
 * 2a618442: collapsible TÁC VỤ TÀI XẾ header, extracted from
 * DriverTripDetailPage (structure-guard split). DEFAULT EXPANDED — the
 * mockup renders the section open; collapsing is the driver's on-demand
 * space-saving opt-out (customer: "có thể thu nhỏ… đỡ chiếm diện tích").
 *
 * Factory identity leads the heading in BOTH states (short name, full-name
 * fallback), with the route line subordinate beneath it. The route line
 * carries ROUTE TEXT ONLY — never the factory address, which has its
 * dedicated row in the info grid. It renders whenever it differs from the
 * title; without a factory name the title falls back to the route and the
 * line hides (it would duplicate the title). Collapsing only hides the
 * customer name; the status pill and the Đóng/Trả chip stay visible in
 * both states.
 */
export function DriverTripHeader({ trip, onBack }: { trip: DriverTaskDetail; onBack: () => void }) {
  // Per-session persistence, same mechanism as the chips toggle.
  const [expanded, setExpanded] = useState(true);
  const fulfillment = trip.fulfillment ?? null;
  // Route text only — the factory site address never rides this line.
  const routeLine = fulfillment?.routeSummary ?? trip.routeName ?? null;
  const title = fulfillment?.factoryShortName || fulfillment?.factoryName || trip.routeName || 'Lệnh vận chuyển';
  const headerHasFactoryTitle = Boolean(fulfillment?.factoryShortName || fulfillment?.factoryName);

  return (
    <header className="driver-task-header">
      <button type="button" className="driver-task-back" onClick={onBack} aria-label="Quay lại">
        <ArrowLeft size={18} />
      </button>
      <div className="driver-task-header__body">
        <p className="driver-task-header__eyebrow">Tác vụ tài xế</p>
        <h1 className="driver-task-header__title">{title}</h1>
        {Boolean(routeLine) && title !== routeLine && headerHasFactoryTitle && (
          <p className="driver-task-header__route">{routeLine}</p>
        )}
        <div className="driver-task-header__meta">
          <StatusPill variant={tripStatusVariant(trip.status)}>
            {TRIP_STATUS_LABELS[trip.status] || trip.status}
          </StatusPill>
          {trip.tradeDirection ? (
            <span className="driver-task-close-chip" data-testid="close-status-chip">
              {trip.tradeDirection === 'EXPORT' ? 'Đóng' : 'Trả'}
            </span>
          ) : null}
          {expanded && trip.customerName && (
            <span className="driver-task-header__customer">{trip.customerName}</span>
          )}
        </div>
      </div>
      <button
        type="button"
        className="driver-task-header__toggle"
        aria-expanded={expanded}
        aria-label={expanded ? 'Thu gọn thông tin tác vụ' : 'Mở rộng thông tin tác vụ'}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
    </header>
  );
}
