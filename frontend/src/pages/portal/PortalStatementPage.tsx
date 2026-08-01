import { useEffect, useState } from 'react';
import { Download, Landmark, Printer } from 'lucide-react';
import type { CustomerStatement } from '@tingting/shared';
import { api } from '../../lib/api';
import { EmptyState } from '../../design-system';
import { useCustomerPortalScope } from './CustomerPortalScope';
import './PortalPages.css';

function queryFor(dateFrom: string, dateTo: string, format?: 'xlsx' | 'pdf', customerId?: number | null) {
  const query = new URLSearchParams();
  if (dateFrom) query.set('dateFrom', dateFrom);
  if (dateTo) query.set('dateTo', dateTo);
  if (format) query.set('format', format);
  if (customerId != null) query.set('customerId', String(customerId));
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

function formatIsoDisplayDate(value: string | null | undefined): string {
  if (!value) return '—';
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : '—';
}

export default function PortalStatementPage() {
  const { selectedCustomerId, ready: customerScopeReady } = useCustomerPortalScope();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [appliedRange, setAppliedRange] = useState({ dateFrom: '', dateTo: '' });
  const [data, setData] = useState<CustomerStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!customerScopeReady) return;
    let active = true;
    setLoading(true);
    setError(null);
    api.get<CustomerStatement>(
      `/portal/statement${queryFor(appliedRange.dateFrom, appliedRange.dateTo, undefined, selectedCustomerId)}`,
    )
      .then((response) => { if (active) setData(response); })
      .catch(() => { if (active) setError('Không thể tải sao kê công nợ. Vui lòng thử lại.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [appliedRange, customerScopeReady, selectedCustomerId]);

  const exportStatement = async (format: 'xlsx' | 'pdf') => {
    setExporting(true);
    setError(null);
    try {
      const path = `/portal/statement/export${queryFor(
        appliedRange.dateFrom,
        appliedRange.dateTo,
        format,
        selectedCustomerId,
      )}`;
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
  const openingBalance = Number(summary?.openingBalance ?? 0);
  const periodActivity = Number(summary?.periodActivity ?? data?.totalOutstanding ?? 0);
  const closingBalance = Number(summary?.closingBalance ?? data?.totalOutstanding ?? 0);
  const activityOperator = periodActivity < 0 ? '−' : '+';
  const balanceEquationLabel = [
    `Số dư đầu kỳ ${openingBalance.toLocaleString('vi-VN')} đồng`,
    `${periodActivity < 0 ? 'trừ' : 'cộng'} ${Math.abs(periodActivity).toLocaleString('vi-VN')} đồng`,
    `bằng số dư cuối kỳ ${closingBalance.toLocaleString('vi-VN')} đồng`,
  ].join(', ');

  return (
    <div className="portal-page">
      <header className="portal-page__header">
        <div className="portal-page__title">
          <span className="portal-page__eyebrow">Công nợ phải thu</span>
          <h1>Sao kê công nợ</h1>
          <p>Đối chiếu số dư, các khoản phát sinh và thanh toán theo từng thời kỳ.</p>
        </div>
        <div className="portal-page__headline-stat" aria-label="Số dư công nợ hiện tại">
          <span>Số dư hiện tại</span>
          <strong>{loading ? '—' : `${Number(data?.totalOutstanding ?? 0).toLocaleString('vi-VN')} ₫`}</strong>
          <small>{data?.customer.name ?? 'Tài khoản đang xem'}</small>
        </div>
      </header>

      <div className="portal-panel">
        <div className="portal-panel__heading">
          <div><span>Khoảng thời gian</span><h2>Lọc và xuất sao kê</h2></div>
          <strong>{appliedRange.dateFrom || appliedRange.dateTo ? 'Đang lọc theo kỳ' : 'Toàn bộ lịch sử'}</strong>
        </div>
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
            <button type="submit" className="portal-button portal-button--primary" disabled={loading}>Áp dụng kỳ</button>
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
            <div className="portal-balance-equation" aria-label={balanceEquationLabel}>
              <div><span>Số dư đầu kỳ</span><strong>{openingBalance.toLocaleString('vi-VN')} ₫</strong></div>
              <span className="portal-balance-equation__operator" aria-hidden="true">{activityOperator}</span>
              <div><span>Phát sinh trong kỳ</span><strong>{Math.abs(periodActivity).toLocaleString('vi-VN')} ₫</strong></div>
              <span className="portal-balance-equation__operator" aria-hidden="true">=</span>
              <div className="portal-balance-equation__result"><span>Số dư cuối kỳ</span><strong>{closingBalance.toLocaleString('vi-VN')} ₫</strong></div>
            </div>
            {data.unpaidTrips.length > 0 && (
              <section className="portal-due-list" aria-labelledby="portal-due-list-title">
                <div className="portal-due-list__heading">
                  <div>
                    <span>Cần theo dõi</span>
                    <h2 id="portal-due-list-title">Các khoản chưa thanh toán</h2>
                  </div>
                  <strong>{data.unpaidTrips.length} khoản</strong>
                </div>
                {data.unpaidTrips.map((trip) => (
                  <article key={trip.tripId} className="portal-due-row">
                    <div>
                      <strong>{trip.note || 'Chuyến chưa có mã'}</strong>
                      <span>{trip.outstanding.toLocaleString('vi-VN')} ₫ còn phải thanh toán</span>
                    </div>
                    <div>
                      <span>Ngày theo hợp đồng</span>
                      <strong>{formatIsoDisplayDate(trip.originalDueDate)}</strong>
                    </div>
                    <div>
                      <span>Ngày xử lý</span>
                      <strong>{formatIsoDisplayDate(trip.processingDueDate)}</strong>
                      {trip.dueDateAdjusted && <small>Đã chuyển sang ngày làm việc tiếp theo</small>}
                    </div>
                  </article>
                ))}
              </section>
            )}
            {rows.length === 0 ? (
              <EmptyState icon={Landmark} title="Không có phát sinh trong khoảng thời gian này" />
            ) : (
              <section className="portal-ledger" aria-labelledby="portal-ledger-title">
                <div className="portal-ledger__heading">
                  <div><span>Chi tiết giao dịch</span><h2 id="portal-ledger-title">Phát sinh công nợ</h2></div>
                  <strong>{rows.length} dòng</strong>
                </div>
                <div className="portal-table-wrap">
                  <table className="portal-table">
                    <thead><tr><th>Ngày</th><th>Nội dung</th><th className="portal-table__number">Ghi nợ</th><th className="portal-table__number">Thanh toán</th><th className="portal-table__number">Số dư</th></tr></thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id}>
                          <td data-label="Ngày">{new Date(row.timestamp).toLocaleDateString('vi-VN')}</td>
                          <td data-label="Nội dung">{row.note || row.tripCode || row.txnType}</td>
                          <td data-label="Ghi nợ" className="portal-table__number">{Number(row.debit ?? 0).toLocaleString('vi-VN')} ₫</td>
                          <td data-label="Thanh toán" className="portal-table__number">{Number(row.credit ?? 0).toLocaleString('vi-VN')} ₫</td>
                          <td data-label="Số dư" className="portal-table__number portal-table__balance">{Number(row.balance ?? 0).toLocaleString('vi-VN')} ₫</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
