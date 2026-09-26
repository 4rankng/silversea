import { ArrowLeft } from 'lucide-react';
import { TRIP_STATUS_LABELS } from '@tingting/shared';
import { StatusPill } from '../../components/UI';
import { CopyCodeButton } from '../../components/trip/CopyCodeButton';
import { tripStatusVariant } from '../../lib/tripStatus';
import type { DriverTaskDetail } from '../../api/driverClient';

/**
 * Card 20260926_26 item 4: the title block is two lines (~120px, was ~250px).
 *
 * Line 1 — back + mã (Số Bill / Booking — the internal-ids display key; the
 * fallback chain mirrors the old title: factory → route → generic label).
 * Line 2 — location (factory short name, full-name fallback) + status pill,
 * plus the Đóng/Trả chip and customer name inline. The eyebrow ("Tác vụ tài
 * xế") and the standalone route line are gone: the eyebrow is shell chrome
 * the bottom nav already states, and the ports in the info grid carry the
 * route, so route text no longer earns a line of its own.
 */
export function DriverTripHeader({ trip, onBack }: { trip: DriverTaskDetail; onBack: () => void }) {
  const fulfillment = trip.fulfillment ?? null;
  // Route text only — the factory site address never rides this line.
  const routeLine = fulfillment?.routeSummary ?? trip.routeName ?? null;
  const factoryTitle = fulfillment?.factoryShortName || fulfillment?.factoryName || null;
  // Display key leads (Số Bill / Booking); old title chain is the fallback.
  const title = fulfillment?.code || factoryTitle || routeLine || 'Lệnh vận chuyển';
  // Line-2 location: the destination the driver scans for first. Hidden when
  // it would duplicate the title (no-code trips render the location as it).
  const location = factoryTitle || routeLine;
  const locationShown = Boolean(location) && location !== title;

  return (
    <header className="driver-task-header">
      <button type="button" className="driver-task-back" onClick={onBack} aria-label="Quay lại">
        <ArrowLeft size={18} />
      </button>
      <div className="driver-task-header__body">
        {/* Card 20260926_28 item 9: the display key is copyable — drivers
            shuttle the bill/booking code between apps constantly. */}
        <div className="driver-task-header__title-row">
          <h1 className="driver-task-header__title">{title}</h1>
          {fulfillment?.code && <CopyCodeButton value={fulfillment.code} label="Số Bill / Booking" />}
        </div>
        <div className="driver-task-header__meta">
          {locationShown && (
            <span className="driver-task-header__location">{location}</span>
          )}
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
