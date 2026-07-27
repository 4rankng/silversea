import { Play, RefreshCw, Building2, ArrowRight, Link2, Timer, Truck } from 'lucide-react';
import { formatDayMonth } from '../../../lib/date';
import { splitRoute } from '../../../lib/route';
import { isUrgent } from '../utils';
import { ReassignDialog } from './ReassignDialog';
import { StatusStrip } from '../../../components/shared/StatusStrip';
import { TRIP_STATUS_COLORS, type TripStatus } from '@tingting/shared';
import type { NormalizedTrip } from '../../../hooks/useTripQueries';
import type { PairingState, ReassignState, Truck as TruckType, Driver } from '../utils';

interface DispatchTripCardProps {
  trip: NormalizedTrip;
  pendingTrips: NormalizedTrip[];
  isEditing: boolean;
  isPairing: boolean;
  pairingState: PairingState;
  setPairingState: React.Dispatch<React.SetStateAction<PairingState>>;
  reassignState: ReassignState;
  setReassignState: React.Dispatch<React.SetStateAction<ReassignState>>;
  trucks: TruckType[];
  drivers: Driver[];
  carrierCustomers: { id: number; label: string }[];
  onDispatch: () => void;
  onOpenPairing: () => void;
  onClosePairing: () => void;
  onSelectPairCandidate: (tripId: number) => void;
  onPair: () => void;
  onOpenReassign: () => void;
  onCloseReassign: () => void;
  onReassign: () => void;
  dispatching: boolean;
  actionLoadingId: number | null;
}

export function DispatchTripCard({
  trip,
  pendingTrips,
  isEditing,
  isPairing,
  pairingState,
  setPairingState,
  reassignState,
  setReassignState,
  trucks,
  drivers,
  carrierCustomers,
  onDispatch,
  onOpenPairing,
  onClosePairing,
  onSelectPairCandidate,
  onPair,
  onOpenReassign,
  onCloseReassign,
  onReassign,
  dispatching,
  actionLoadingId,
}: DispatchTripCardProps) {
  const route = splitRoute(trip.routeName);
  const urgent = isUrgent(trip.departureDate);
  const pairCandidates = pendingTrips.filter((candidate) =>
    candidate.id !== trip.id
      && !trip.pairing
      && !candidate.pairing
      && trip.carrierType !== 'EXTERNAL'
      && candidate.carrierType !== 'EXTERNAL'
      && candidate.truckId === trip.truckId
      && candidate.driverId === trip.driverId,
  );
  const isBusy = dispatching || actionLoadingId === trip.id;

  const updatePairField = (
    target: 'firstTrip' | 'secondTrip',
    field: keyof PairingState['firstTrip'],
    value: string,
  ) => {
    setPairingState((current) => ({
      ...current,
      [target]: {
        ...current[target],
        [field]: value,
      },
      error: '',
    }));
  };

  const renderPairSummary = () => {
    if (!trip.pairing) return null;
    return (
      <div
        className="dispatch-pair-panel"
        style={{
          gridColumn: '1 / -1',
          marginTop: 14,
          padding: 14,
          borderRadius: 14,
          border: '1px solid rgba(23, 89, 74, 0.18)',
          background: 'linear-gradient(180deg, rgba(245,249,246,0.98) 0%, rgba(237,245,241,0.96) 100%)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: 'var(--ink)' }}>
            <Link2 size={15} />
            Cặp 2 chiều #{trip.pairing.pairId}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            Chặng {trip.pairing.order}/2 · Ghép với {trip.pairing.partnerTripCode ?? `#${trip.pairing.partnerTripId}`}
          </div>
        </div>
        <div style={{ marginTop: 10, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <div style={{ padding: '10px 12px', borderRadius: 10, background: '#fff', border: '1px solid var(--border-1)' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-3)' }}>Chuyến ghép</div>
            <div style={{ marginTop: 4, fontWeight: 700 }}>{trip.pairing.partnerRouteName ?? 'Tuyến chưa rõ'}</div>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)' }}>{formatDayMonth(trip.pairing.partnerDepartureDate)}</div>
          </div>
          <div style={{ padding: '10px 12px', borderRadius: 10, background: '#fff', border: '1px solid var(--border-1)' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-3)' }}>Xe rỗng</div>
            <div style={{ marginTop: 4, fontWeight: 700 }}>{trip.pairing.emptyDistanceKm ? `${trip.pairing.emptyDistanceKm} km` : '—'}</div>
          </div>
          <div style={{ padding: '10px 12px', borderRadius: 10, background: '#fff', border: '1px solid var(--border-1)' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-3)' }}>Hiệu suất</div>
            <div style={{ marginTop: 4, fontWeight: 700 }}>{trip.pairing.combinedEfficiencyPercent ? `${trip.pairing.combinedEfficiencyPercent}%` : '—'}</div>
          </div>
          <div style={{ padding: '10px 12px', borderRadius: 10, background: '#fff', border: '1px solid var(--border-1)' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-3)' }}>Đệm thời gian</div>
            <div style={{ marginTop: 4, fontWeight: 700 }}>
              {trip.pairing.actualGapMinutes != null && trip.pairing.requiredGapMinutes != null
                ? `${trip.pairing.actualGapMinutes}/${trip.pairing.requiredGapMinutes} phút`
                : '—'}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderPairEditor = () => {
    if (!isPairing) return null;
    return (
      <div
        className="dispatch-pair-panel"
        style={{
          gridColumn: '1 / -1',
          marginTop: 14,
          padding: 16,
          borderRadius: 14,
          border: '1px solid rgba(33, 74, 59, 0.18)',
          background: '#f7faf8',
          display: 'grid',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: 'var(--ink)' }}>
              <Link2 size={15} />
              Ghép điều vận 2 chiều
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)' }}>
              Chọn chuyến chiều về cùng xe và lái xe, sau đó nhập lịch kế hoạch để hệ thống kiểm tra chồng giờ và quãng xe rỗng.
            </div>
          </div>
          <button type="button" className="swap-btn" onClick={onClosePairing}>Đóng</button>
        </div>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Chuyến chiều về</span>
          <select
            value={pairingState.secondTripId}
            onChange={(event) => onSelectPairCandidate(Number(event.target.value))}
            className="input"
          >
            <option value="">Chọn chuyến ghép</option>
            {pairCandidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {(candidate.tripCode ?? `#${candidate.id}`)} · {candidate.routeName}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {[
            { title: 'Chuyến 1', value: pairingState.firstTrip, target: 'firstTrip' as const },
            { title: 'Chuyến 2', value: pairingState.secondTrip, target: 'secondTrip' as const },
          ].map((section) => (
            <div key={section.title} style={{ padding: 14, borderRadius: 12, background: '#fff', border: '1px solid var(--border-1)', display: 'grid', gap: 10 }}>
              <div style={{ fontWeight: 700 }}>{section.title}</div>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Giờ bắt đầu</span>
                <input type="datetime-local" className="input" value={section.value.plannedStartAt} onChange={(event) => updatePairField(section.target, 'plannedStartAt', event.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Giờ kết thúc</span>
                <input type="datetime-local" className="input" value={section.value.plannedEndAt} onChange={(event) => updatePairField(section.target, 'plannedEndAt', event.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Điểm đi</span>
                <input type="text" className="input" value={section.value.canonicalOrigin} onChange={(event) => updatePairField(section.target, 'canonicalOrigin', event.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Điểm đến</span>
                <input type="text" className="input" value={section.value.canonicalDestination} onChange={(event) => updatePairField(section.target, 'canonicalDestination', event.target.value)} />
              </label>
              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Hàng (kg)</span>
                  <input type="number" min="0" className="input" value={section.value.cargoWeightKg} onChange={(event) => updatePairField(section.target, 'cargoWeightKg', event.target.value)} />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Tải trọng xe (kg)</span>
                  <input type="number" min="0" className="input" value={section.value.vehicleCapacityKg} onChange={(event) => updatePairField(section.target, 'vehicleCapacityKg', event.target.value)} />
                </label>
              </div>
            </div>
          ))}
        </div>

        {pairingState.error && (
          <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(220, 38, 38, 0.08)', color: '#b91c1c', fontSize: 13 }}>
            {pairingState.error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="swap-btn" onClick={onClosePairing} disabled={pairingState.loading}>Hủy</button>
          <button type="button" className="dispatch-btn" onClick={onPair} disabled={pairingState.loading || !pairingState.secondTripId}>
            {pairingState.loading ? <Timer size={12} className="spin" /> : <Truck size={12} />}
            Lưu cặp 2 chiều
          </button>
        </div>
      </div>
    );
  };

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
              {trip.pairing && (
                <div className="lb" style={{ marginTop: 4 }}>
                  Chặng {trip.pairing.order}/2 · {trip.pairing.partnerTripCode ?? `#${trip.pairing.partnerTripId}`}
                </div>
              )}
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
          disabled={isBusy || isEditing || isPairing}
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
          <>
            {!trip.pairing && (
              <button
                type="button"
                className="swap-btn"
                title="Ghép điều vận hai chiều"
                onClick={onOpenPairing}
                disabled={isBusy || pairCandidates.length === 0}
              >
                <Link2 size={11} />
                Ghép 2 chiều
              </button>
            )}
            <button
              type="button"
              className="swap-btn"
              title="Đổi xe / lái xe"
              onClick={onOpenReassign}
              disabled={isBusy || isPairing}
            >
              <RefreshCw size={11} />
              Đổi xe
            </button>
          </>
        )}
      </div>

      {renderPairEditor()}
      {renderPairSummary()}
    </div>
  );
}
