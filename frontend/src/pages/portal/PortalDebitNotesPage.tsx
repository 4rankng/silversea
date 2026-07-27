import { useEffect, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, FileText, Printer, TriangleAlert } from 'lucide-react';
import type { BillingDocument } from '@tingting/shared';
import { api } from '../../lib/api';
import { EmptyState } from '../../design-system';
import './PortalPages.css';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Bản nháp',
  SENT: 'Đã gửi',
  PENDING_CONFIRM: 'Chờ xác nhận',
  CONFIRMED: 'Đã xác nhận',
  PARTIAL_PAID: 'Thanh toán một phần',
  PAID: 'Đã thanh toán',
  REJECTED: 'Đang tranh chấp',
  CANCELED: 'Đã hủy',
};

function statusClass(status: BillingDocument['debitNoteStatus']) {
  if (status === 'PENDING_CONFIRM') return 'portal-status portal-status--action';
  if (status === 'CONFIRMED' || status === 'PARTIAL_PAID' || status === 'PAID') return 'portal-status portal-status--success';
  if (status === 'REJECTED' || status === 'CANCELED') return 'portal-status portal-status--danger';
  return 'portal-status';
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function PortalDebitNotesPage() {
  const [items, setItems] = useState<BillingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api.get<{ items: BillingDocument[]; total: number }>(`/portal/debit-notes?page=${page}&limit=20`)
      .then((response) => {
        if (!active) return;
        setItems(response.items ?? []);
        setTotal(response.total ?? 0);
      })
      .catch(() => {
        if (active) setError('Không thể tải danh sách giấy báo nợ. Vui lòng thử lại.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [page, retryKey]);

  const updateStatus = async (doc: BillingDocument, action: 'confirm' | 'dispute') => {
    const question = action === 'confirm'
      ? 'Xác nhận giấy báo nợ này? Sau khi xác nhận, nội dung sẽ được khóa.'
      : 'Phản hồi tranh chấp giấy báo nợ này? Bộ phận công nợ sẽ kiểm tra lại.';
    if (!window.confirm(question)) return;

    setWorkingId(doc.id);
    setNotice(null);
    try {
      const updated = await api.post<BillingDocument>(`/portal/debit-notes/${doc.id}/${action}`, {});
      setItems((current) => current.map((item) => item.id === doc.id ? updated : item));
      setNotice(action === 'confirm' ? 'Đã xác nhận giấy báo nợ.' : 'Đã gửi phản hồi tranh chấp.');
    } catch (err) {
      setNotice((err as Error).message || 'Không thể cập nhật giấy báo nợ.');
    } finally {
      setWorkingId(null);
    }
  };

  const exportDoc = async (doc: BillingDocument, format: 'xlsx' | 'pdf') => {
    setWorkingId(doc.id);
    setNotice(null);
    try {
      const blob = await api.getBlob(`/portal/debit-notes/${doc.id}/export?format=${format}`);
      triggerDownload(blob, `giay-bao-no-${doc.id}.${format}`);
    } catch (err) {
      setNotice((err as Error).message || 'Không thể xuất giấy báo nợ.');
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <div className="portal-page">
      <header className="portal-page__header">
        <span className="portal-page__eyebrow">Đối soát công nợ</span>
        <h1>Giấy báo nợ</h1>
        <p>Xem chi tiết, tải bản đối soát và phản hồi các giấy báo nợ đang chờ xác nhận.</p>
      </header>

      {notice && <div className="portal-panel" role="status" style={{ padding: 14, marginBottom: 12 }}>{notice}</div>}

      {loading ? (
        <div className="portal-panel portal-state" role="status">Đang tải giấy báo nợ…</div>
      ) : error ? (
        <div className="portal-panel portal-state portal-state--error" role="alert">
          <div><p>{error}</p><button type="button" className="portal-button" onClick={() => setRetryKey((value) => value + 1)}>Thử lại</button></div>
        </div>
      ) : items.length === 0 ? (
        <div className="portal-panel">
          <EmptyState icon={FileText} title="Chưa có giấy báo nợ" description="Giấy báo nợ đã phát hành sẽ xuất hiện tại đây." />
        </div>
      ) : (
        <div className="portal-panel">
          <div className="portal-list">
            {items.map((doc) => {
              const pending = doc.debitNoteStatus === 'PENDING_CONFIRM';
              const busy = workingId === doc.id;
              return (
                <article key={doc.id} className="portal-list__row">
                  <div className="portal-list__primary">
                    <strong>Kỳ {new Date(doc.rangeFrom).toLocaleDateString('vi-VN')} – {new Date(doc.rangeTo).toLocaleDateString('vi-VN')}</strong>
                    <div className="portal-list__meta">
                      <span>{Number(doc.totalInclVat).toLocaleString('vi-VN')} ₫</span>
                      <span className={statusClass(doc.debitNoteStatus)}>{STATUS_LABELS[doc.debitNoteStatus ?? 'DRAFT']}</span>
                    </div>
                  </div>
                  <div className="portal-actions">
                    <button type="button" className="portal-button" disabled={busy} onClick={() => void exportDoc(doc, 'xlsx')}>
                      <FileSpreadsheet size={16} /> XLSX
                    </button>
                    <button type="button" className="portal-button" disabled={busy} onClick={() => void exportDoc(doc, 'pdf')}>
                      <Printer size={16} /> PDF
                    </button>
                    {pending && (
                      <>
                        <button type="button" className="portal-button portal-button--danger" disabled={busy} onClick={() => void updateStatus(doc, 'dispute')}>
                          <TriangleAlert size={16} /> Tranh chấp
                        </button>
                        <button type="button" className="portal-button portal-button--primary" disabled={busy} onClick={() => void updateStatus(doc, 'confirm')}>
                          <CheckCircle2 size={16} /> Xác nhận
                        </button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {total > 20 && (
            <div className="portal-pagination">
              <button type="button" className="portal-button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Trang trước</button>
              <span>Trang {page} / {Math.ceil(total / 20)}</span>
              <button type="button" className="portal-button" disabled={page * 20 >= total} onClick={() => setPage((value) => value + 1)}>Trang sau</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
