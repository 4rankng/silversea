import React from 'react';
import { Route, Ruler, Image as ImageIcon, Plus, ArrowRight, Fuel, Radio } from 'lucide-react';
import type { TripDetail, LiveFleetVehicle } from '@tingting/shared';
import { LoadingType } from '@tingting/shared';
import { LeafletMap } from '../../../components/shared/LeafletMap';
import { LIVE_STATUS_COLOR, LIVE_STATUS_LABEL } from '../../../lib/liveFleet';
import type { TripDerivedData } from '../types';

interface JourneyCardProps {
  trip: TripDetail;
  derived: TripDerivedData;
  /** Live truck position to overlay on the route (present when the trip is in transit). */
  liveVehicle?: LiveFleetVehicle | null;
}

export function JourneyCard({
  trip,
  derived,
  liveVehicle = null,
}: JourneyCardProps) {
  const { totalKm } = derived;
  const hasPolyline = trip.legs?.some(leg => leg.polylinePath);
  const hasLegCoord = trip.legs?.some(leg => leg.originCoord) ?? false;
  const legCount = trip.legs?.length ?? 0;

  return (
    <section className="card journey-card anim d5">
      <div className="card-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h2 style={{ gap: '8px', margin: 0 }}>
            <span className="hicon" style={{ width: 24, height: 24 }}><Route size={14} /></span>
            Hành trình
            <span className="sub" style={{ margin: 0, marginLeft: '4px', fontSize: '13px', fontWeight: 500, color: 'var(--ink-3)' }}>
              • {legCount} chặng đường
            </span>
          </h2>
          {liveVehicle && (
            <span
              title="Vị trí trực tiếp từ GPS"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 6,
                padding: '3px 8px', borderRadius: 999, fontSize: 12, lineHeight: 1.35, fontWeight: 600,
                background: `${LIVE_STATUS_COLOR[liveVehicle.status]}22`, color: LIVE_STATUS_COLOR[liveVehicle.status],
              }}
            >
              <Radio size={11} /> {LIVE_STATUS_LABEL[liveVehicle.status]}
            </span>
          )}
        </div>
        <div className="journey-pills">
          <span className="jp jp--km">
            <Ruler size={13} />
            <span className="mono">{totalKm.toLocaleString('vi-VN')} km</span> tổng
          </span>
        </div>
      </div>

      <div className="journey-body">
        {(hasPolyline || !!trip.gpsTrail || liveVehicle || hasLegCoord) && (
          <div className="map-wrap">
            <LeafletMap
              legs={trip.legs}
              gpsTrail={trip.gpsTrail ?? null}
              height="100%"
              livePosition={liveVehicle ? {
                lat: liveVehicle.lat,
                lng: liveVehicle.lng,
                angle: liveVehicle.angle,
                status: liveVehicle.status,
                speed: liveVehicle.speed,
              } : null}
            />
          </div>
        )}

        <div className="legs">
          {trip.legs?.map((leg, index) => (
            <div className="leg" key={leg.id ?? index}>
              <span className="leg-no">{leg.sequence ?? index + 1}</span>
              <div className="leg-route">
                <div className="leg-stops">
                  <span className="st">{leg.origin}</span>
                  <span className="ar"><ArrowRight size={14} /></span>
                  <span className="st">{leg.destination}</span>
                </div>
                <div className="leg-meta">
                  <span><Ruler size={13} /><span className="mono">{Number(leg.km).toLocaleString('vi-VN')} km</span></span>
                  <span><Fuel size={13} /><span className="mono">{leg.calculatedLiters ? `${Number(leg.calculatedLiters).toLocaleString('vi-VN')} L` : '—'}</span></span>
                </div>
              </div>
              <div className="leg-right">
                <span className={`badge ${leg.loadingType === LoadingType.HANG ? 'badge--load' : 'badge--empty'}`}>
                  {leg.loadingType === LoadingType.HANG ? 'CÓ HÀNG' : 'CHẠY VỎ'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="journey-foot">
        <ImageIcon size={15} />
        Chưa có ảnh hoặc ghi chú cho chuyến này.
        <span className="add-note">
          <Plus size={13} />
          Thêm ảnh / ghi chú
        </span>
      </div>
    </section>
  );
}
