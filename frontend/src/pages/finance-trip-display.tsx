import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';
import type { PnlMaintenanceItem } from '@tingting/shared';
import { formatNumber } from '../lib/format';

export function CostCheck({ matches, difference }: { matches: boolean; difference: number }) {
  return matches ? (
    <span className="cost-check cost-check--ok" title="Các khoản chi phí cộng lại khớp với tổng chi phí đã lưu">
      <CheckCircle2 size={14} aria-hidden="true" /> Khớp
    </span>
  ) : (
    <span className="cost-check cost-check--warning" title={`Chênh ${formatNumber(Math.abs(difference))} ₫ so với tổng chi phí đã lưu`}>
      <AlertTriangle size={14} aria-hidden="true" /> Cần kiểm tra {formatNumber(Math.abs(difference))}₫
    </span>
  );
}

export function TripAmount({ label, value, emphasized = false }: { label: string; value: number; emphasized?: boolean }) {
  return (
    <div className={emphasized ? 'truck-trip-amount truck-trip-amount--emphasized' : 'truck-trip-amount'}>
      <span>{label}</span>
      <strong>{formatNumber(value)}₫</strong>
    </div>
  );
}

export function MaintenanceDetails({ truck, trailer, items }: { truck: number; trailer: number; items: PnlMaintenanceItem[] }) {
  if (truck <= 0 && trailer <= 0) return null;
  return (
    <div className="truck-maintenance-details">
      <div className="truck-maintenance-note">
        Chi phí phát sinh ngoài từng lệnh trong kỳ:
        {truck > 0 ? <> đầu kéo <strong>{formatNumber(truck)}₫</strong></> : null}
        {truck > 0 && trailer > 0 ? ' · ' : null}
        {trailer > 0 ? <> rơ-moóc <strong>{formatNumber(trailer)}₫</strong></> : null}.
      </div>
      {items.length > 0 && (
        <div className="truck-maintenance-list">
          {items.map(item => (
            <Link key={item.id} to={`/expenses/${item.id}/edit`} className="truck-maintenance-item">
              <span className="truck-maintenance-item__main">
                <strong>{item.categoryName}</strong>
                <small>
                  {item.vehicleComponent === 'TRAILER' ? 'Rơ-moóc' : 'Đầu kéo'} · {item.supplierName} · {new Date(item.expenseDate).toLocaleDateString('vi-VN')}
                  {item.note ? ` · ${item.note}` : ''}
                </small>
              </span>
              <span className="truck-maintenance-item__amount">{formatNumber(item.amount)}₫ <ExternalLink size={12} aria-hidden="true" /></span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
