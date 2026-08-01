import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { formatCurrency } from '../../lib/format';
import { customerServiceFinanceClient, type ProfitabilityDimension, type ProfitabilityReport } from '../../api/customerServiceFinanceClient';

const DIMENSIONS: Array<{ value: ProfitabilityDimension; label: string }> = [
  { value: 'CUSTOMER', label: 'Khách hàng' }, { value: 'ROUTE', label: 'Tuyến' },
  { value: 'TRUCK', label: 'Xe' }, { value: 'DISPATCHER', label: 'Điều vận' },
  { value: 'SALESPERSON', label: 'Nhân viên kinh doanh' }, { value: 'CONTAINER', label: 'Container' },
  { value: 'MONTH', label: 'Tháng' }, { value: 'YEAR', label: 'Năm' },
];

export function ProfitabilityReportPanel({ month, year }: { month: number; year: number }) {
  const [dimension, setDimension] = useState<ProfitabilityDimension>('CUSTOMER');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ProfitabilityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { setLoading(true); setError(null); try { setData(await customerServiceFinanceClient.getProfitability({ month, year, dimension, page })); } catch (err) { setError(err instanceof Error ? err.message : 'Không thể tải báo cáo lợi nhuận.'); } finally { setLoading(false); } }, [dimension, month, page, year]);
  useEffect(() => { void load(); }, [load]);
  const margin = data && data.totals.revenue !== 0 ? (data.totals.profit / data.totals.revenue) * 100 : 0;
  return <section className="workflow-profitability" aria-labelledby="profitability-heading">
    <div className="workflow-profitability__head"><div><h2 id="profitability-heading">Lợi nhuận vận hành theo chiều phân tích</h2><p>Chỉ dùng các bản ghi tài chính đã chốt trong kỳ hoàn thành.</p></div><label>Phân tích theo<select className="input" value={dimension} onChange={(e) => { setDimension(e.target.value as ProfitabilityDimension); setPage(1); }}>{DIMENSIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
    {data && <div className="workflow-profitability__meta"><span>Cập nhật đến {new Date(data.asOf).toLocaleString('vi-VN')}</span><span>Định nghĩa {data.definitionVersion}</span></div>}
    {error && <div className="workflow-notice workflow-notice--error" role="alert">{error}<button className="btn btn--ghost" onClick={() => void load()}><RotateCcw size={15}/> Thử lại</button></div>}
    {data?.reconciliation.status === 'PARTIAL' && <div className="workflow-notice workflow-notice--partial"><AlertTriangle size={18}/><span>{data.reconciliation.note} Chênh lệch: {formatCurrency(data.reconciliation.difference)}.</span></div>}
    <div className="workflow-summary workflow-summary--four"><div><span>Doanh thu</span><strong>{loading ? '—' : formatCurrency(data?.totals.revenue ?? 0)}</strong></div><div><span>Chi phí trực tiếp</span><strong>{loading ? '—' : formatCurrency(data?.totals.directCost ?? 0)}</strong></div><div><span>Lợi nhuận</span><strong>{loading ? '—' : formatCurrency(data?.totals.profit ?? 0)}</strong></div><div><span>Biên lợi nhuận</span><strong>{loading ? '—' : `${margin.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`}</strong></div></div>
    <div className="workflow-table" role="region" aria-label="Bảng lợi nhuận theo chiều phân tích" tabIndex={0}><table><thead><tr><th>{DIMENSIONS.find((item) => item.value === dimension)?.label}</th><th>Số chuyến</th><th>Doanh thu</th><th>Chi phí trực tiếp</th><th>Lợi nhuận</th></tr></thead><tbody>{data?.items.map((item) => <tr key={`${item.key}:${item.label}:${item.attributionStatus}`}><td><strong>{item.label ?? 'Thiếu phân bổ'}</strong>{item.attributionStatus === 'MISSING' && <small>Thiếu phân bổ</small>}</td><td>{item.tripCount.toLocaleString('vi-VN')}</td><td>{formatCurrency(item.revenue)}</td><td>{formatCurrency(item.directCost)}</td><td>{formatCurrency(item.profit)}</td></tr>)}</tbody></table></div>
    {data && data.totalPages > 1 && <nav className="workflow-pagination" aria-label="Phân trang báo cáo lợi nhuận"><span>{data.totalGroups.toLocaleString('vi-VN')} nhóm · Trang {data.page}/{data.totalPages}</span><div><button className="btn btn--ghost" disabled={loading || data.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Trang trước</button><button className="btn btn--ghost" disabled={loading || data.page >= data.totalPages} onClick={() => setPage((current) => current + 1)}>Trang sau</button></div></nav>}
  </section>;
}
