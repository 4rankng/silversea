import { useState, useEffect } from 'react';
import { FileText, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { ClickableCard } from '../../components/shared/ClickableCard';
import { EmptyState } from '../../design-system';

interface BillingDoc {
  id: number;
  entityName: string;
  rangeFrom: string;
  rangeTo: string;
  totalInclVat: string;
  debitNoteStatus: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Bản nháp', SENT: 'Đã gửi', PENDING_CONFIRM: 'Chờ xác nhận',
  CONFIRMED: 'Đã xác nhận', PARTIAL_PAID: 'Thanh toán một phần', PAID: 'Đã thanh toán',
  REJECTED: 'Từ chối', CANCELED: 'Đã hủy',
};

export default function PortalDebitNotesPage() {
  const [items, setItems] = useState<BillingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    // Reuse the existing financial billing-documents endpoint.
    api.get<{ items: BillingDoc[] }>('/api/financial/billing-documents?type=DEBIT_NOTE&entityType=CUSTOMER')
      .then((res) => setItems(res.items ?? []))
      .catch(() => setError('Không thể tải danh sách giấy báo nợ'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Giấy báo nợ</h1>
      <p style={{ color: 'var(--fg-3)', fontSize: 14, marginBottom: 24 }}>Xem và xác nhận giấy báo nợ của bạn</p>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--fg-3)' }}>Đang tải…</div>
      ) : error ? (
        <div style={{ color: 'var(--danger)', padding: 24 }}>{error}</div>
      ) : items.length === 0 ? (
        <EmptyState icon={FileText} title="Chưa có giấy báo nợ" description="Giấy báo nợ sẽ xuất hiện ở đây khi được phát hành." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((d) => (
            <div key={d.id} style={{ padding: '12px 16px', border: '1px solid var(--border-2)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>Kỳ: {d.rangeFrom} → {d.rangeTo}</div>
                <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>
                  Tổng: {Number(d.totalInclVat).toLocaleString('vi-VN')} ₫
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-2)' }}>
                  {STATUS_LABELS[d.debitNoteStatus ?? 'DRAFT']}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
