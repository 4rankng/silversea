import React from 'react';
import { Truck, User, Calendar, Package, Hash, CheckCircle } from 'lucide-react';
import { fmtDate } from '../formatters';
import type { TripDetail } from '@tingting/shared';

interface BasicInfoCardProps {
  trip: TripDetail;
}

export function BasicInfoCard({ trip }: BasicInfoCardProps) {
  const rows = [
    { icon: <Truck size={17} />, label: 'Xe đầu kéo', value: trip.truck?.licensePlate ?? '—', mono: true },
    { icon: <User size={17} />, label: 'Lái xe', value: trip.driver?.name ?? '—' },
    {
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="6" width="16" height="10" rx="1" /><path d="M18 12h3M9 16v2" /><circle cx="9" cy="18" r="2" />
        </svg>
      ),
      label: 'Rơ moóc',
      value: trip.trailer ? `${trip.trailer.licensePlate} · ${trip.trailer.type || (trip.trailerType ?? '—')}` : (trip.trailerType ?? '—'),
      mono: true,
    },
    { icon: <Package size={17} />, label: 'Số container', value: String(trip.containerCount ?? 1), mono: true },
    { icon: <Calendar size={17} />, label: 'Ngày khởi hành', value: fmtDate(trip.departureDate), mono: true, isDate: true },
    { icon: <CheckCircle size={17} />, label: 'Ngày hoàn thành', value: trip.completedAt ? fmtDate(trip.completedAt) : '—', mono: true },
    { icon: <Hash size={17} />, label: 'Mã tham chiếu', value: trip.customerReference ?? 'Chưa có', muted: !trip.customerReference, full: true },
  ];

  return (
    <div className="card">
      <div className="card-head">
        <h2><span className="hicon"><Truck size={15} /></span>Thông tin cơ bản</h2>
      </div>
      <div className="card-body">
        <div className="info-list">
          {rows.map((row, i) => (
            <div className={`info-row${row.full ? ' info-row--full' : ''}`} key={i}>
              <span className="ri">{row.icon}</span>
              <div className="info-meta">
                <div className="lbl">{row.label}</div>
                <div className={`val ${row.mono ? 'mono' : ''} ${row.muted ? 'muted' : ''}`}>{row.value}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
