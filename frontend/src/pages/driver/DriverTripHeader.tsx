import { ArrowLeft } from 'lucide-react';
import { TRIP_STATUS_LABELS } from '@tingting/shared';
import { StatusPill } from '../../components/UI';
import { tripStatusVariant } from '../../lib/tripStatus';
import type { DriverTaskDetail } from '../../api/driverClient';

/**
 * 20260926_20: static TÁC VỤ TÀI XẾ header — the collapse chevron is gone
 * (it hid only the customer name: no real space saving), the header always
 * shows fully.
 *
 * Factory identity leads the heading (short name, full-name fallback), with
 * the route line subordinate beneath it. The route line carries ROUTE TEXT
 * ONLY — never the factory address, which has its dedicated row in the info
 * grid. It renders whenever it differs from the title; without a factory
 * name the title falls back to the route and the line hides (it would
 * duplicate the title). Status pill, Đóng/Trả chip, and customer name all
 * render unconditionally.
 */
export function DriverTripHeader({ trip, onBack }: { trip: DriverTaskDetail; onBack: () => void }) {
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
              {/* Unknown values render the em-dash (pill-axis convention) —
                  the DB enum is IMPORT/EXPORT only, so this branch is
                  unreachable-by-data but keeps the chip honest by contract. */}
              {trip.tradeDirection === 'EXPORT' ? 'Đóng' : trip.tradeDirection === 'IMPORT' ? 'Trả' : '—'}
            </span>
          ) : null}
          {trip.customerName && (
            <span className="driver-task-header__customer">{trip.customerName}</span>
          )}
        </div>
      </div>
    </header>
  );
}
