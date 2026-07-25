import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { SHIPMENT_STATUS_LABELS, type ShipmentStatus } from '@tingting/shared';
import { ClickableCard } from '../../components/shared/ClickableCard';
import { EmptyState } from '../../design-system';

interface ShipmentRow {
  id: number;
  shipmentCode: string | null;
  status: ShipmentStatus;
  bookingRef: string | null;
  blNumber: string | null;
  expectedDeliveryDate: string | null;
}

export default function PortalShipmentsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    setLoading(true);
    api.get<{ items: ShipmentRow[]; total: number }>(`/api/shipments?page=${page}&limit=10`)
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch(() => setError('Không thể tải danh sách lô hàng'))
      .finally(() => setLoading(false));
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / 10));

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Lô hàng của tôi</h1>
      <p style={{ color: 'var(--fg-3)', fontSize: 14, marginBottom: 24 }}>Theo dõi trạng thái lô hàng của bạn</p>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--fg-3)' }}>Đang tải…</div>
      ) : error ? (
        <div style={{ color: 'var(--danger)', padding: 24 }}>{error}</div>
      ) : items.length === 0 ? (
        <EmptyState icon={Package} title="Chưa có lô hàng" description="Lô hàng sẽ xuất hiện ở đây khi được tạo." />
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((s) => (
              <ClickableCard key={s.id} to={`/portal/shipments/${s.id}`} style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{s.shipmentCode ?? `#${s.id}`}</div>
                  <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>
                    {s.blNumber && <span>B/L: {s.blNumber}</span>}
                    {s.expectedDeliveryDate && <span> · Giao dự kiến: {s.expectedDeliveryDate}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-2)' }}>{SHIPMENT_STATUS_LABELS[s.status]}</span>
                  <ChevronRight size={16} color="var(--fg-3)" />
                </div>
              </ClickableCard>
            ))}
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, padding: '16px 0' }}>
              <button className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Trang trước</button>
              <span style={{ fontSize: 13, color: 'var(--fg-3)', lineHeight: '32px' }}>{page} / {totalPages}</span>
              <button className="btn btn--ghost btn--sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Trang sau</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
