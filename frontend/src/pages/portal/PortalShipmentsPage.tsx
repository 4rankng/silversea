import { useState, useEffect } from 'react';
import { Package, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { SHIPMENT_STATUS_LABELS, type ShipmentStatus } from '@tingting/shared';
import { ClickableCard } from '../../components/shared/ClickableCard';
import { EmptyState } from '../../design-system';
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
        <span className="portal-page__eyebrow">Theo dõi vận chuyển</span>
        <h1>Lô hàng của tôi</h1>
        <p>Cập nhật trạng thái, chứng từ và tiến độ của các lô hàng thuộc tài khoản này.</p>
      </header>

      {loading ? (
        <div className="portal-panel portal-state" role="status">Đang tải danh sách lô hàng…</div>
      ) : error ? (
        <div className="portal-panel portal-state portal-state--error" role="alert">{error}</div>
      ) : items.length === 0 ? (
        <div className="portal-panel"><EmptyState icon={Package} title="Chưa có lô hàng" description="Lô hàng sẽ xuất hiện tại đây sau khi được bộ phận vận hành tạo." /></div>
      ) : (
        <div className="portal-panel">
          <div className="portal-list">
            {items.map((s) => (
              <ClickableCard
                key={s.id}
                to={withCustomerScope(routes.portalShipmentDetail(s.id), selectedCustomerId)}
                className="portal-list__row"
              >
                <div className="portal-list__primary">
                  <strong>{s.shipmentCode ?? `Lô hàng #${s.id}`}</strong>
                  <div className="portal-list__meta">
                    {s.bookingRef && <span>Booking: {s.bookingRef}</span>}
                    {s.blNumber && <span>B/L: {s.blNumber}</span>}
                    {s.expectedDeliveryDate && <span>Giao dự kiến: {new Date(s.expectedDeliveryDate).toLocaleDateString('vi-VN')}</span>}
                  </div>
                </div>
                <div className="portal-list__aside">
                  <span className="portal-status">{SHIPMENT_STATUS_LABELS[s.status]}</span>
                  <ChevronRight size={18} aria-hidden="true" />
                </div>
              </ClickableCard>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="portal-pagination">
              <button type="button" className="portal-button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Trang trước</button>
              <span>Trang {page} / {totalPages}</span>
              <button type="button" className="portal-button" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Trang sau</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
