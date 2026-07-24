import { Link } from 'react-router-dom';
import { ArrowRight, Copy } from 'lucide-react';
import {
  TripStatus, TRIP_STATUS_LABELS,
  type TripDetail,
} from '@tingting/shared';
import { splitRoute } from '../../lib/route';
import { formatDayMonth } from '../../lib/date';
import { formatCurrency } from '../../lib/format';
import {
  buildTripCode, calcConsumption, getMissingIndicators,
  STATUS_PILL_CLASS, type TripListContainer, type TripListRow,
  getTripDistance, getTripDisplayGrossProfit,
} from './tripHelpers';
import { XeNgoaiBadge } from './XeNgoaiBadge';

const formatMoney = (n: number): string =>
  formatCurrency(n).replace(' ₫', '').replace('₫', '').trim();

export interface TripMobileCardProps {
  trip: TripDetail;
  warnThreshold: number;
  style?: React.CSSProperties;
  copyingPlan?: boolean;
  onCopyPlan?: (tripId: number) => void;
}

export function TripMobileCard({ trip, warnThreshold, style, copyingPlan, onCopyPlan }: TripMobileCardProps) {
  const cons = calcConsumption(trip);
  const route = splitRoute(trip.route?.name);
  const isCanceled = trip.status === TripStatus.CANCELED;
  const isCreated = trip.status === TripStatus.CREATED;
  const pillClass = STATUS_PILL_CLASS[trip.status] ?? 'pill-moi';
  const km = getTripDistance(trip);
  const road = Number(trip.totalRoadAllowance ?? 0) + Number(trip.tollCost ?? 0);
  const revenue = Number(trip.revenue ?? 0);
  const totalCost = Number(trip.totalCost ?? 0);
  const grossProfit = getTripDisplayGrossProfit(trip);
  const missingIndicators = getMissingIndicators(trip);
  const tripContainers: TripListContainer[] = (trip as TripListRow).containers ?? [];
  const typeCodes = Array.from(new Set(tripContainers.map((c) => c.containerTypeCode || c.containerTypeName).filter(Boolean)));

  const content = (
    <>
      <div className="trip-mcard__top">
        <div className="left">
          <div className="trip-mcard__name" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span>{trip.customer?.name ?? '—'}</span>
            {trip.carrierType === 'EXTERNAL' && <XeNgoaiBadge />}
          </div>
          <div className="trip-mcard__id">
            {buildTripCode(trip)}
            <span className="trip-meta-sep">·</span>
            <span>{formatDayMonth(trip.departureDate)}</span>
            <span className="trip-meta-sep">·</span>
            <span className={`plate${isCreated || isCanceled ? ' idle' : ''}${trip.carrierType === 'EXTERNAL' ? ' external' : ''}`}>
              {trip.carrierType === 'EXTERNAL' ? (trip.externalPlateNumber || '—') : (trip.truck?.licensePlate ?? '—')}
            </span>
          </div>
        </div>
        <span className={`status-pill ${pillClass}`}>
          {TRIP_STATUS_LABELS[trip.status]}
        </span>
      </div>

      <div className="trip-mcard__route">
        {route ? (
          <>
            {route.from}
            <span className="arr"><ArrowRight size={12} /></span>
            {route.to}
          </>
        ) : (
          trip.route?.name ?? '—'
        )}
      </div>

      {tripContainers.length > 0 && (
        <div className="trip-mcard__containers" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {typeCodes.map((code, i) => (
              <span key={i} className="container-tag">{code}</span>
            ))}
          </div>
          <div className="trip-mcard__container-numbers">
            {tripContainers.slice(0, 4).map((c, i) => (
              <span key={i}>{c.containerNumber}</span>
            ))}
            {tripContainers.length > 4 && (
              <span style={{ color: 'var(--ink-3)' }}>+{tripContainers.length - 4}</span>
            )}
          </div>
        </div>
      )}

      {missingIndicators.length > 0 && (
        <div className="trip-mcard__missing">
          {missingIndicators.map((m, i) => (
            <span key={i} className="missing-tag" title={m.label}>
              <m.icon size={10} />
            </span>
          ))}
        </div>
      )}

      <div className="trip-mcard__meta">
        <div className="mm">
          <span className="lab">KM</span>
          <span className={km > 0 ? 'val' : 'val empty'}>
            {km > 0 ? `${km.toLocaleString('vi-VN')} km` : '—'}
          </span>
        </div>
        <div className="mm">
          <span className="lab">Tiêu hao</span>
          {isCanceled ? (
            <span className="val empty">—</span>
          ) : cons ? (
            <span className={`val${cons.per100 > warnThreshold ? ' warn' : ''}`}>
              {cons.per100.toFixed(1).replace('.', ',')} L/100km
            </span>
          ) : (
            <span className="val empty">Chờ khai báo</span>
          )}
        </div>
        <div className="mm">
          <span className="lab">Tổng đi đường</span>
          <span className={road > 0 ? 'val' : 'val empty'}>
            {road > 0 ? `${formatMoney(road)} ₫` : '—'}
          </span>
        </div>
        <div className="mm">
          <span className="lab">Doanh thu</span>
          <span className={revenue > 0 ? 'val' : 'val empty'}>
            {revenue > 0 ? `${formatMoney(revenue)} ₫` : '—'}
          </span>
        </div>
        <div className="mm">
          <span className="lab">Tổng chi phí</span>
          <span className={totalCost > 0 ? 'val' : 'val empty'}>
            {totalCost > 0 ? `${formatMoney(totalCost)} ₫` : '—'}
          </span>
        </div>
        <div className="mm">
          <span className="lab">LN gộp</span>
          <span className={grossProfit !== 0 ? `val${grossProfit < 0 ? ' warn' : ''}` : 'val empty'}>
            {grossProfit !== 0 ? `${formatMoney(grossProfit)} ₫` : '—'}
          </span>
        </div>
        <div className="mm">
          <span className="lab">Dầu</span>
          <span className={cons ? 'val' : 'val empty'}>
            {cons ? `${cons.liters.toFixed(0)} L` : 'Chờ khai báo'}
          </span>
        </div>
      </div>
    </>
  );

  if (!onCopyPlan) {
    return (
      <Link
        to={`/trips/${trip.id}`}
        className="trip-mcard"
        style={{
          textDecoration: 'none',
          color: 'inherit',
          display: 'block',
          ...style,
        }}
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="trip-mcard" style={style}>
      <Link
        to={`/trips/${trip.id}`}
        className="trip-mcard__main-link"
      >
        {content}
      </Link>
      <button
        type="button"
        className={`trip-copy-btn trip-copy-btn--mobile${copyingPlan ? ' is-copying' : ''}`}
        disabled={copyingPlan}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onCopyPlan(trip.id);
        }}
      >
        <Copy size={13} />
        <span>{copyingPlan ? 'Đang copy' : 'Copy'}</span>
      </button>
    </div>
  );
}
