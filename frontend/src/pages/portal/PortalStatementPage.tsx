import { useEffect, useState } from 'react';
import { Download, Landmark, Printer } from 'lucide-react';
import type { CustomerStatement } from '@tingting/shared';
import { api } from '../../lib/api';
import { EmptyState } from '../../design-system';
import './PortalPages.css';

function queryFor(dateFrom: string, dateTo: string, format?: 'xlsx' | 'pdf') {
  const query = new URLSearchParams();
  if (dateFrom) query.set('dateFrom', dateFrom);
  if (dateTo) query.set('dateTo', dateTo);
  if (format) query.set('format', format);
  return query.toString() ? `?${query}` : '';
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function PortalStatementPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [appliedRange, setAppliedRange] = useState({ dateFrom: '', dateTo: '' });
  const [data, setData] = useState<CustomerStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api.get<CustomerStatement>(`/portal/statement${queryFor(appliedRange.dateFrom, appliedRange.dateTo)}`)
      .then((response) => { if (active) setData(response); })
      .catch(() => { if (active) setError('Không thể tải sao kê công nợ. Vui lòng thử lại.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [appliedRange]);

  const exportStatement = async (format: 'xlsx' | 'pdf') => {
    setExporting(true);
    setError(null);
    try {
      const path = `/portal/statement/export${queryFor(appliedRange.dateFrom, appliedRange.dateTo, format)}`;
      if (format === 'xlsx') {
        triggerDownload(await api.getBlob(path), 'sao-ke-cong-no.xlsx');
      } else {
        triggerDownload(await api.getBlob(path), 'sao-ke-cong-no.pdf');
      }
    } catch {
      setError('Không thể xuất sao kê. Vui lòng thử lại.');
    } finally {
      setExporting(false);
    }
  };

  const summary = data?.periodSummary;
  const rows = data?.ledgerRows ?? [];

  return (
    <div className="portal-page">
      <header className="portal-page__header">
        <span className="portal-page__eyebrow">Công nợ phải thu</span>
        <h1>Sao kê công nợ</h1>
        <p>Kiểm tra phát sinh, thanh toán và số dư của tài khoản khách hàng.</p>
      </header>

      <div className="portal-panel">
        <form
          className="portal-filters"
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedRange({ dateFrom, dateTo });
          }}
        >
          <label>Từ ngày<input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} /></label>
          <label>Đến ngày<input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} /></label>
          <div className="portal-actions">
            <button type="submit" className="portal-button portal-button--primary">Áp dụng</button>
            <button type="button" className="portal-button" disabled={exporting || !data} onClick={() => void exportStatement('xlsx')}><Download size={16} /> XLSX</button>
            <button type="button" className="portal-button" disabled={exporting || !data} onClick={() => void exportStatement('pdf')}><Printer size={16} /> PDF</button>
          </div>
        </form>

        {loading ? (
          <div className="portal-state" role="status">Đang tải sao kê…</div>
        ) : error ? (
          <div className="portal-state portal-state--error" role="alert">{error}</div>
        ) : !data ? (
          <EmptyState icon={Landmark} title="Chưa có dữ liệu sao kê" />
        ) : (
          <>
            <div className="portal-summary">
              <div><span>Số dư đầu kỳ</span><strong>{Number(summary?.openingBalance ?? 0).toLocaleString('vi-VN')} ₫</strong></div>
              <div><span>Phát sinh trong kỳ</span><strong>{Number(summary?.periodActivity ?? data.totalOutstanding).toLocaleString('vi-VN')} ₫</strong></div>
              <div><span>Số dư cuối kỳ</span><strong>{Number(summary?.closingBalance ?? data.totalOutstanding).toLocaleString('vi-VN')} ₫</strong></div>
            </div>
            {rows.length === 0 ? (
              <EmptyState icon={Landmark} title="Không có phát sinh trong khoảng thời gian này" />
            ) : (
              <div className="portal-table-wrap">
                <table className="portal-table">
                  <thead><tr><th>Ngày</th><th>Nội dung</th><th>Ghi nợ</th><th>Thanh toán</th><th>Số dư</th></tr></thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>{new Date(row.timestamp).toLocaleDateString('vi-VN')}</td>
                        <td>{row.note || row.tripCode || row.txnType}</td>
                        <td>{Number(row.debit ?? 0).toLocaleString('vi-VN')} ₫</td>
                        <td>{Number(row.credit ?? 0).toLocaleString('vi-VN')} ₫</td>
                        <td>{Number(row.balance ?? 0).toLocaleString('vi-VN')} ₫</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
