import { Play, RefreshCw, Building2, ArrowRight } from 'lucide-react';
import { formatDayMonth } from '../../../lib/date';
import { splitRoute } from '../../../lib/route';
import { isUrgent } from '../utils';
import { ReassignDialog } from './ReassignDialog';
import { StatusStrip } from '../../../components/shared/StatusStrip';
import { TRIP_STATUS_COLORS, type TripStatus } from '@tingting/shared';
import type { NormalizedTrip } from '../../../hooks/useTripQueries';
import type { ReassignState, Truck, Driver } from '../utils';

interface DispatchTripCardProps {
  trip: NormalizedTrip;
  isEditing: boolean;
  reassignState: ReassignState;
  setReassignState: React.Dispatch<React.SetStateAction<ReassignState>>;
  trucks: Truck[];
  drivers: Driver[];
  carrierCustomers: { id: number; label: string }[];
  onDispatch: () => void;
  onOpenReassign: () => void;
  onCloseReassign: () => void;
  onReassign: () => void;
  dispatching: boolean;
  actionLoadingId: number | null;
}

export function DispatchTripCard({
  trip,
  isEditing,
  reassignState,
  setReassignState,
  trucks,
  drivers,
  carrierCustomers,
  onDispatch,
  onOpenReassign,
  onCloseReassign,
  onReassign,
  dispatching,
  actionLoadingId,
}: DispatchTripCardProps) {
  const route = splitRoute(trip.routeName);
  const urgent = isUrgent(trip.departureDate);

  return (
    <div className="order-row" data-tour-id="dispatch-ready-list">
      <StatusStrip color={TRIP_STATUS_COLORS[trip.status as TripStatus]} />
      <div className={`o-date${urgent ? ' urgent' : ''}`}>
        <span className="day">{formatDayMonth(trip.departureDate)}</span>
        <span className="lbl">Khởi hành</span>
      </div>

      <div className="o-route">
        {route ? (
          <>
            <span className="from">{route.from}</span>
            <span className="arr">
              <ArrowRight size={14} />
            </span>
            <span className="to">{route.to}</span>
          </>
        ) : (
          <span className="single">{trip.routeName}</span>
        )}
      </div>

      <div className="o-customer">
        <div className="cust-icon">
          <Building2 size={15} />
        </div>
        <div className="info">
          <div className="name">{trip.customerName}</div>
          {trip.customerReference && (
            <div className="meta">Mã KH: {trip.customerReference}</div>
          )}
        </div>
      </div>

      <div className="o-assign">
        {isEditing ? (
          <ReassignDialog
            reassignState={reassignState}
            setReassignState={setReassignState}
            trucks={trucks}
            drivers={drivers}
            carrierCustomers={carrierCustomers}
            onSave={onReassign}
            onCancel={onCloseReassign}
          />
        ) : (
          <div className="assign-card">
            <span className="ap">
              {trip.truckPlate || '—'}
            </span>
            <div className="ai">
              <div className="dn">
                {trip.driverName || <span style={{ color: 'var(--fg-3)', fontWeight: 400 }}>Chưa phân lái xe</span>}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="o-actions">
        <button
          type="button"
          className="dispatch-btn"
          data-tour-id="dispatch-primary-action"
          onClick={onDispatch}
          disabled={dispatching || actionLoadingId === trip.id || isEditing}
        >
          {actionLoadingId === trip.id ? (
            <div
              className="spin"
              style={{
                width: 10,
                height: 10,
                border: '2px solid #fff',
                borderTopColor: 'transparent',
                borderRadius: '50%',
              }}
            />
          ) : (
            <Play size={11} fill="currentColor" />
          )}
          Khởi hành
        </button>
        {!isEditing && (
          <button
            type="button"
            className="swap-btn"
            title="Đổi xe / lái xe"
            onClick={onOpenReassign}
            disabled={dispatching || actionLoadingId === trip.id}
          >
            <RefreshCw size={11} />
            Đổi xe
          </button>
        )}
      </div>
    </div>
  );
}
