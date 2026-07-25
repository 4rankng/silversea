import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../lib/api';
import { SHIPMENT_STATUS_LABELS, SHIPMENT_DOCUMENT_TYPE_LABELS } from '@tingting/shared';
import { EmptyState } from '../../design-system';

export default function PortalShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get<any>(`/api/shipments/${id}`)
      .then(setData)
      .catch(() => setError('Không thể tải chi tiết lô hàng'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ textAlign: 'center', padding: 48, color: 'var(--fg-3)' }}>Đang tải…</div>;
  if (error || !data) return (
    <div style={{ padding: 16 }}>
      <Link to="/portal/shipments" style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 14, color: 'var(--fg-3)' }}><ArrowLeft size={14} /> Quay lại</Link>
      <EmptyState title={error ?? 'Không có dữ liệu'} />
    </div>
  );

  const { shipment, containers, documents, statusHistory } = data;
  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('vi-VN') : '—';

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <Link to="/portal/shipments" style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 14, color: 'var(--fg-3)', marginBottom: 16 }}><ArrowLeft size={14} /> Danh sách lô hàng</Link>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>{shipment.shipmentCode ?? `Lô hàng #${shipment.id}`}</h1>
      <div style={{ fontSize: 14, color: 'var(--fg-3)', marginBottom: 24 }}>Trạng thái: <strong>{SHIPMENT_STATUS_LABELS[shipment.status as keyof typeof SHIPMENT_STATUS_LABELS]}</strong></div>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Thông tin chung</h2>
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, fontSize: 14 }}>
          <div><dt style={{ color: 'var(--fg-3)', fontSize: 12 }}>Mã đặt chỗ</dt><dd>{shipment.bookingRef ?? '—'}</dd></div>
          <div><dt style={{ color: 'var(--fg-3)', fontSize: 12 }}>Số B/L</dt><dd>{shipment.blNumber ?? '—'}</dd></div>
          <div><dt style={{ color: 'var(--fg-3)', fontSize: 12 }}>Giao dự kiến</dt><dd>{fmt(shipment.expectedDeliveryDate)}</dd></div>
          <div><dt style={{ color: 'var(--fg-3)', fontSize: 12 }}>Nơi nhận</dt><dd>{shipment.pickupLocation ?? '—'}</dd></div>
          <div><dt style={{ color: 'var(--fg-3)', fontSize: 12 }}>Nơi giao</dt><dd>{shipment.deliveryLocation ?? '—'}</dd></div>
        </dl>
      </section>

      {containers?.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Containers ({containers.length})</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr><th style={th}>Số container</th><th style={th}>Seal</th><th style={th}>Trọng lượng (kg)</th></tr></thead>
            <tbody>
              {containers.map((c: any) => (
                <tr key={c.id}><td style={td}>{c.containerNumber ?? '—'}</td><td style={td}>{c.sealNumber ?? '—'}</td><td style={td}>{c.cargoWeightKg ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {statusHistory?.length > 0 && (
        <section>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Lịch sử trạng thái</h2>
          {statusHistory.map((h: any, i: number) => (
            <div key={h.id || i} style={{ display: 'flex', gap: 10, padding: '6px 0', fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>{SHIPMENT_STATUS_LABELS[h.toStatus as keyof typeof SHIPMENT_STATUS_LABELS] ?? h.toStatus}</span>
              <span style={{ color: 'var(--fg-3)' }}>{new Date(h.changedAt).toLocaleString('vi-VN')}</span>
              {h.reason && <span style={{ color: 'var(--fg-2)' }}>{h.reason}</span>}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', fontSize: 12, color: '#666', borderBottom: '2px solid #ddd', padding: 8 };
const td: React.CSSProperties = { fontSize: 13, borderBottom: '1px solid #eee', padding: 8 };
