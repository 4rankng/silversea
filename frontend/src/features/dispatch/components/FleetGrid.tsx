import { UserX, Wrench } from 'lucide-react';
import type { Driver, Truck } from '../utils';
import type { NormalizedTrip } from '../../../hooks/useTripQueries';
import { StatusStrip } from '../../../components/shared/StatusStrip';
import { resolveEmptyIllustration } from '../../../lib/emptyIllustrations';

interface FleetGridProps {
  trucks: Truck[];
  activeTrips: NormalizedTrip[];
  drivers: Driver[];
  onTripClick: (tripId: number) => void;
}

function getActiveTripForTruck(truckId: number, activeTrips: NormalizedTrip[]) {
  return activeTrips.find((t) => t.truckId === truckId);
}

function getDefaultDriverForTruck(truckId: number, drivers: Driver[]) {
  return drivers.find((d) => d.assignedTruckId === truckId);
}

/** Restrained operational strip map: color signals state, never decoration. */
const STATUS_STRIP: Record<string, { color: string; label: string }> = {
  running:  { color: '#176E45', label: 'Đang chạy' },
  ready:    { color: '#2E675E', label: 'Sẵn sàng' },
  maint:    { color: '#A45D1C', label: 'Bảo dưỡng' },
  noassign: { color: '#69736F', label: 'Chưa giao' },
};

function getStatusKey(isMaint: boolean, isRunning: boolean, defDriver: Driver | undefined) {
  if (isMaint) return 'maint';
  if (isRunning) return 'running';
  if (defDriver) return 'ready';
  return 'noassign';
}

export function FleetGrid({ trucks, activeTrips, drivers, onTripClick }: FleetGridProps) {
  if (trucks.length === 0) {
    return (
      <div className="fleet-empty">
        <img src={resolveEmptyIllustration('empty-fleet')} alt="" aria-hidden="true" style={{ width: 160, height: 132, objectFit: 'contain' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        Không có xe nào trong nhóm này.
      </div>
    );
  }

  return (
    <div className="fleet-table fade-up-4">
      {/* Header */}
      <div className="fleet-head">
        <div>Biển số</div>
        <div>Lái xe</div>
        <div className="fleet-col-route">Tuyến đường</div>
        <div className="fleet-col-cust">Khách hàng</div>
      </div>
      {/* Rows */}
      {trucks.map((truck) => {
        const activeTrip = getActiveTripForTruck(truck.id, activeTrips);
        const defDriver = getDefaultDriverForTruck(truck.id, drivers);
        const isMaint = truck.status === 'MAINTENANCE';
        const isRunning = !!activeTrip;
        const onClickRow = activeTrip ? () => onTripClick(activeTrip.id) : undefined;
        const statusKey = getStatusKey(isMaint, isRunning, defDriver);
        const status = STATUS_STRIP[statusKey];

        return (
          <div
            key={truck.id}
            className={`fleet-row${onClickRow ? ' is-clickable' : ''}`}
            onClick={onClickRow}
          >
            <StatusStrip color={status.color} />
            {/* Biển số */}
            <div className="fleet-cell fleet-col-plate">
              <span className={`plate${isMaint ? ' maint' : ''}`}>{truck.licensePlate}</span>
            </div>

            {/* Lái xe — name only, no avatar */}
            <div className="fleet-cell fleet-driver">
              {isMaint ? <span className="no-driver"><Wrench size={13} /> Bảo dưỡng</span>
              : isRunning ? <span className="driver-name">{activeTrip.driverName}</span>
              : defDriver ? <span className="driver-name">{defDriver.name}</span>
              : <span className="no-driver"><UserX size={13} /> Chưa giao</span>}
            </div>

            {/* Tuyến đường */}
            <div className="fleet-cell fleet-col-route">
              {isRunning ? (
                <span className="fleet-route">{activeTrip.routeName}</span>
              ) : (
                <span className="fleet-dash">—</span>
              )}
            </div>

            {/* Khách hàng */}
            <div className="fleet-cell fleet-col-cust">
              {isRunning ? (
                <span className="fleet-cust">{activeTrip.customerName}</span>
              ) : (
                <span className="fleet-dash">—</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
