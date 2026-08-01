import { useState, useEffect } from 'react';
import { CalendarClock, ChevronRight, Package } from 'lucide-react';
import { api } from '../../lib/api';
import { SHIPMENT_STATUS_LABELS, type ShipmentStatus } from '@tingting/shared';
import { ClickableCard } from '../../components/shared/ClickableCard';
import { EmptyState, Pagination } from '../../design-system';
import { routes } from '../../lib/routes';
import { useCustomerPortalScope, withCustomerScope } from './CustomerPortalScope';
import './PortalPages.css';

interface ShipmentRow {
  id: number;
  shipmentCode: string | null;
  status: ShipmentStatus;
  bookingRef: string | null;
  blNumber: string | null;
  expectedDeliveryDate: string | null;
}

function shipmentStatusClass(status: ShipmentStatus) {
  if (status === 'IN_PROGRESS') return 'portal-status portal-status--action';
  if (status === 'DELIVERED' || status === 'CLOSED') return 'portal-status portal-status--success';
  if (status === 'CANCELED') return 'portal-status portal-status--danger';
  return 'portal-status';
}

function formatDeliveryDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString('vi-VN') : 'Chưa cập nhật';
}

export default function PortalShipmentsPage() {
  const { selectedCustomerId, ready: customerScopeReady } = useCustomerPortalScope();
  const [items, setItems] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!customerScopeReady) return;
    let active = true;
    setLoading(true);
    setError(null);
    api.get<{ items: ShipmentRow[]; total: number }>(
      withCustomerScope(`/portal/shipments?page=${page}&limit=10`, selectedCustomerId),
    )
      .then((res) => {
        if (!active) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch(() => {
        if (active) setError('Không thể tải danh sách lô hàng');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [customerScopeReady, page, selectedCustomerId]);

  useEffect(() => {
    setPage(1);
  }, [selectedCustomerId]);

  const totalPages = Math.max(1, Math.ceil(total / 10));

  return (
    <div className="portal-page">
      <header className="portal-page__header">
        <div className="portal-page__title">
          <span className="portal-page__eyebrow">Theo dõi vận chuyển</span>
          <h1>Lô hàng của tôi</h1>
          <p>Theo dõi tiến độ giao nhận và mở hồ sơ để xem chứng từ của từng lô hàng.</p>
        </div>
        <div className="portal-page__headline-stat" aria-label="Tổng số lô hàng">
          <span>Tổng lô hàng</span>
          <strong>{loading ? '—' : total.toLocaleString('vi-VN')}</strong>
          <small>Thuộc tài khoản đang xem</small>
        </div>
      </header>

      {loading ? (
        <div className="portal-panel portal-loading" role="status" aria-label="Đang tải danh sách lô hàng">
          <span className="portal-loading__bar" />
          <span className="portal-loading__bar" />
          <span className="portal-loading__bar" />
        </div>
      ) : error ? (
        <div className="portal-panel portal-state portal-state--error" role="alert">{error}</div>
      ) : items.length === 0 ? (
        <div className="portal-panel">
          <div className="portal-panel__heading">
            <div><span>Danh sách vận chuyển</span><h2>Lô hàng gần đây</h2></div>
            <strong>0 lô hàng</strong>
          </div>
          <EmptyState icon={Package} title="Chưa có lô hàng" description="Lô hàng sẽ xuất hiện tại đây sau khi được bộ phận vận hành tạo." />
        </div>
      ) : (
        <div className="portal-panel">
          <div className="portal-panel__heading">
            <div><span>Danh sách vận chuyển</span><h2>Lô hàng gần đây</h2></div>
            <strong>{total.toLocaleString('vi-VN')} lô hàng</strong>
          </div>
          <div className="portal-list">
            {items.map((s) => (
              <ClickableCard
                key={s.id}
                to={withCustomerScope(routes.portalShipmentDetail(s.id), selectedCustomerId)}
                className={`portal-list__row portal-shipment-row portal-shipment-row--${s.status.toLowerCase()}`}
              >
                <div className="portal-list__primary">
                  <strong>{s.shipmentCode?.trim() || 'Chưa có mã lô hàng'}</strong>
                  <div className="portal-list__meta">
                    {s.bookingRef && <span>Booking: {s.bookingRef}</span>}
                    {s.blNumber && <span>B/L: {s.blNumber}</span>}
                  </div>
                </div>
                <div className="portal-list__datum">
                  <span><CalendarClock size={15} aria-hidden="true" /> Giao dự kiến</span>
                  <strong>{formatDeliveryDate(s.expectedDeliveryDate)}</strong>
                </div>
                <div className="portal-list__aside">
                  <span className={shipmentStatusClass(s.status)}>{SHIPMENT_STATUS_LABELS[s.status]}</span>
                  <ChevronRight size={18} aria-hidden="true" />
                </div>
              </ClickableCard>
            ))}
          </div>
          <div className="portal-pagination">
            <Pagination page={page} totalPages={totalPages} totalItems={total} pageSize={10} onChange={setPage} />
          </div>
        </div>
      )}
    </div>
  );
}
