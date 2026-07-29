import { useEffect, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, FileText, Printer, TriangleAlert } from 'lucide-react';
import type { BillingDocument } from '@tingting/shared';
import { api } from '../../lib/api';
import { EmptyState, Pagination } from '../../design-system';
import { useCustomerPortalScope, withCustomerScope } from './CustomerPortalScope';
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

function formatDate(value: string | null | undefined) {
  if (!value) return 'Chưa có dữ liệu lịch sử';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
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
  const { selectedCustomerId, ready: customerScopeReady } = useCustomerPortalScope();
  const [items, setItems] = useState<BillingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!customerScopeReady) return;
    let active = true;
    setLoading(true);
    setError(null);
    api.get<{ items: BillingDocument[]; total: number }>(
      withCustomerScope(`/portal/debit-notes?page=${page}&limit=20`, selectedCustomerId),
    )
      .then((response) => {
        if (!active) return;
        setItems(response.items ?? []);
        setTotal(response.total ?? response.items?.length ?? 0);
      })
      .catch(() => {
        if (active) setError('Không thể tải danh sách giấy báo nợ. Vui lòng thử lại.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [customerScopeReady, page, retryKey, selectedCustomerId]);

  useEffect(() => {
    setPage(1);
  }, [selectedCustomerId]);

  const updateStatus = async (doc: BillingDocument, action: 'confirm' | 'dispute') => {
    const question = action === 'confirm'
      ? 'Xác nhận giấy báo nợ này? Sau khi xác nhận, nội dung sẽ được khóa.'
      : 'Phản hồi tranh chấp giấy báo nợ này? Bộ phận công nợ sẽ kiểm tra lại.';
    if (!window.confirm(question)) return;

    setWorkingId(doc.id);
    setNotice(null);
    try {
      const updated = await api.post<BillingDocument>(
        withCustomerScope(`/portal/debit-notes/${doc.id}/${action}`, selectedCustomerId),
        {},
      );
      setItems((current) => current.map((item) => item.id === doc.id ? updated : item));
      setNotice({
        tone: 'success',
        text: action === 'confirm' ? 'Đã xác nhận giấy báo nợ.' : 'Đã gửi phản hồi tranh chấp.',
      });
    } catch (err) {
      setNotice({ tone: 'error', text: (err as Error).message || 'Không thể cập nhật giấy báo nợ.' });
    } finally {
      setWorkingId(null);
    }
  };

  const exportDoc = async (doc: BillingDocument, format: 'xlsx' | 'pdf') => {
    setWorkingId(doc.id);
    setNotice(null);
    try {
      const blob = await api.getBlob(
        withCustomerScope(`/portal/debit-notes/${doc.id}/export?format=${format}`, selectedCustomerId),
      );
      triggerDownload(blob, `giay-bao-no-${doc.id}.${format}`);
    } catch (err) {
      setNotice({ tone: 'error', text: (err as Error).message || 'Không thể xuất giấy báo nợ.' });
    } finally {
      setWorkingId(null);
    }
  };

  const pendingCount = items.filter((item) => item.debitNoteStatus === 'PENDING_CONFIRM').length;
  const visibleValue = items.reduce((sum, item) => sum + Number(item.totalInclVat || 0), 0);
  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="portal-page">
      <header className="portal-page__header">
        <div className="portal-page__title">
          <span className="portal-page__eyebrow">Đối soát công nợ</span>
          <h1>Giấy báo nợ</h1>
          <p>Kiểm tra giá trị, thời hạn và phản hồi những chứng từ cần xác nhận.</p>
        </div>
        <div className="portal-page__headline-stat" aria-label="Tổng số giấy báo nợ">
          <span>Tổng chứng từ</span>
          <strong>{loading ? '—' : total.toLocaleString('vi-VN')}</strong>
          <small>{pendingCount > 0 ? `${pendingCount} cần phản hồi trong trang này` : 'Không có phản hồi đang chờ'}</small>
        </div>
      </header>

      {notice && (
        <div className={`portal-notice portal-notice--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
          {notice.text}
        </div>
      )}

      {loading ? (
        <div className="portal-panel portal-loading" role="status" aria-label="Đang tải giấy báo nợ">
          <span className="portal-loading__bar" />
          <span className="portal-loading__bar" />
          <span className="portal-loading__bar" />
        </div>
      ) : error ? (
        <div className="portal-panel portal-state portal-state--error" role="alert">
          <div><p>{error}</p><button type="button" className="portal-button" onClick={() => setRetryKey((value) => value + 1)}>Thử lại</button></div>
        </div>
      ) : items.length === 0 ? (
        <div className="portal-panel">
          <div className="portal-panel__heading">
            <div><span>Hồ sơ đối soát</span><h2>Chứng từ đã phát hành</h2></div>
            <strong>0 chứng từ</strong>
          </div>
          <EmptyState icon={FileText} title="Chưa có giấy báo nợ" description="Giấy báo nợ đã phát hành sẽ xuất hiện tại đây." />
        </div>
      ) : (
        <div className="portal-panel">
          <div className="portal-panel__heading portal-panel__heading--split">
            <div><span>Hồ sơ đối soát</span><h2>Chứng từ đã phát hành</h2></div>
            <div className="portal-panel__totals">
              <span>Giá trị trong trang</span>
              <strong>{visibleValue.toLocaleString('vi-VN')} ₫</strong>
            </div>
          </div>
          <div className="portal-list">
            {items.map((doc) => {
              const pending = doc.debitNoteStatus === 'PENDING_CONFIRM';
              const busy = workingId === doc.id;
              return (
                <article key={doc.id} className="portal-list__row portal-debit-row">
                  <div className="portal-list__primary">
                    <span className={statusClass(doc.debitNoteStatus)}>{STATUS_LABELS[doc.debitNoteStatus ?? 'DRAFT']}</span>
                    <strong>Kỳ {new Date(doc.rangeFrom).toLocaleDateString('vi-VN')} – {new Date(doc.rangeTo).toLocaleDateString('vi-VN')}</strong>
                    <span className="portal-debit-row__amount">{Number(doc.totalInclVat).toLocaleString('vi-VN')} ₫</span>
                  </div>
                  <dl className="portal-debit-row__dates">
                    <div><dt>Hạn hợp đồng</dt><dd>{formatDate(doc.originalDueDate)}</dd></div>
                    <div><dt>Ngày xử lý</dt><dd>{formatDate(doc.processingDueDate)}</dd></div>
                  </dl>
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
          <div className="portal-pagination">
            <Pagination page={page} totalPages={totalPages} totalItems={total} pageSize={20} onChange={setPage} />
          </div>
        </div>
      )}
    </div>
  );
}
