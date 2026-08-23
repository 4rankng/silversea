import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BadgeCheck, CircleHelp, Download, RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatCurrency } from '../../lib/format';
import { customerServiceFinanceClient, type ProfitabilityDimension } from '../../api/customerServiceFinanceClient';
import { qk } from '../../api/keys';
import { Pagination } from '../../design-system';
import { UuiSelectField } from '../../design-system';

const DIMENSIONS: Array<{ value: ProfitabilityDimension; label: string }> = [
  { value: 'CUSTOMER', label: 'Khách hàng' }, { value: 'ROUTE', label: 'Tuyến' },
  { value: 'TRUCK', label: 'Xe' }, { value: 'DISPATCHER', label: 'Điều vận' },
  { value: 'SALESPERSON', label: 'Nhân viên kinh doanh' }, { value: 'CONTAINER', label: 'Container' },
  { value: 'MONTH', label: 'Tháng' }, { value: 'YEAR', label: 'Năm' },
];

function calculationVersionLabel(value: string): string {
  const match = /^profitability-v(\d+)$/.exec(value);
  return match ? `Phiên bản tính toán ${match[1]}` : 'Phiên bản tính toán hiện hành';
}

export function ProfitabilityReportPanel({ month, year }: { month: number; year: number }) {
  const [dimension, setDimension] = useState<ProfitabilityDimension>('CUSTOMER');
  const [page, setPage] = useState(1);
  const [lowMarginOnly, setLowMarginOnly] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const reportQuery = useQuery({
    queryKey: qk.dashboard.profitability({ month, year, dimension, page, lowMarginOnly }),
    queryFn: () => customerServiceFinanceClient.getProfitability({ month, year, dimension, page, lowMarginOnly }),
  });
  const data = reportQuery.data ?? null;
  const loading = reportQuery.isLoading || reportQuery.isFetching;
  const queryError = reportQuery.error instanceof Error ? reportQuery.error.message : null;
  const error = actionError ?? queryError;
  useEffect(() => { setPage(1); setLowMarginOnly(false); }, [month, year]);
  useEffect(() => {
    if (data?.lowMarginPolicy.status === 'UNCONFIGURED' && lowMarginOnly) {
      setLowMarginOnly(false);
      setPage(1);
    }
  }, [data?.lowMarginPolicy.status, lowMarginOnly]);
  const exportReport = useCallback(async () => {
    setExporting(true);
    setActionError(null);
    try {
      const blob = await customerServiceFinanceClient.exportProfitability({ month, year, dimension, lowMarginOnly });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `loi-nhuan-${year}-${String(month).padStart(2, '0')}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Không thể xuất báo cáo lợi nhuận.');
    } finally {
      setExporting(false);
    }
  }, [dimension, lowMarginOnly, month, year]);
  const margin = data && data.totals.revenue !== 0 ? (data.totals.profit / data.totals.revenue) * 100 : 0;
  return <section className="workflow-profitability" aria-labelledby="profitability-heading">
    <div className="workflow-profitability__head"><div><h2 id="profitability-heading">Lợi nhuận vận hành theo chiều phân tích</h2><p>Chỉ dùng các bản ghi tài chính đã chốt trong kỳ hoàn thành.</p></div><div className="workflow-profitability__controls"><UuiSelectField id="profitability-dimension" label="Phân tích theo" value={dimension} onChange={(e) => { setDimension(e.target.value as ProfitabilityDimension); setPage(1); }} options={DIMENSIONS.map((item) => ({ value: item.value, label: item.label }))} inline /><label className="workflow-profitability__low-filter"><input type="checkbox" checked={lowMarginOnly} disabled={data?.lowMarginPolicy.status === 'UNCONFIGURED'} onChange={(event) => { setLowMarginOnly(event.target.checked); setPage(1); }} /> <span>Chỉ hiện nhóm biên lợi nhuận thấp</span></label><button className="btn btn--ghost" type="button" disabled={loading || exporting} onClick={() => void exportReport()}><Download size={16}/> {exporting ? 'Đang xuất…' : 'Xuất XLSX'}</button></div></div>
    {data && <div className="workflow-profitability__meta"><span>Cập nhật đến {new Date(data.asOf).toLocaleString('vi-VN')}</span><span>{calculationVersionLabel(data.definitionVersion)}</span></div>}
    {error && <div className="workflow-notice workflow-notice--error" role="alert">{error}<button className="btn btn--ghost" onClick={() => { setActionError(null); void reportQuery.refetch(); }}><RotateCcw size={15}/> Thử lại</button></div>}
    {data?.lowMarginPolicy.status === 'UNCONFIGURED' && <div className="workflow-notice workflow-notice--partial" role="status"><CircleHelp size={18}/><span>{data.lowMarginPolicy.note}</span></div>}
    {data?.lowMarginPolicy.status === 'CONFIGURED' && <div className="workflow-notice" role="status"><BadgeCheck size={18}/><span>Ngưỡng cảnh báo kỳ này: {data.lowMarginPolicy.thresholdPercent?.toLocaleString('vi-VN')}%. {data.lowMarginPolicy.note}</span></div>}
    {data?.reconciliation.status === 'PARTIAL' && <div className="workflow-notice workflow-notice--partial"><AlertTriangle size={18}/><span>{data.reconciliation.note} Chênh lệch: {formatCurrency(data.reconciliation.difference)}.</span></div>}
    <div className="workflow-summary workflow-summary--four"><div><span>Doanh thu</span><strong>{loading ? '—' : formatCurrency(data?.totals.revenue ?? 0)}</strong></div><div><span>Chi phí trực tiếp</span><strong>{loading ? '—' : formatCurrency(data?.totals.directCost ?? 0)}</strong></div><div><span>Lợi nhuận</span><strong>{loading ? '—' : formatCurrency(data?.totals.profit ?? 0)}</strong></div><div><span>Biên lợi nhuận</span><strong>{loading ? '—' : `${margin.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`}</strong></div></div>
    <div className="workflow-table workflow-profitability__table" role="region" aria-label="Bảng lợi nhuận theo chiều phân tích" tabIndex={0}><table><thead><tr><th>{DIMENSIONS.find((item) => item.value === dimension)?.label}</th><th>Chuyến</th><th>Thu</th><th>CP trực tiếp</th><th>CP đội xe</th><th>Lợi nhuận</th><th>Biên LN</th></tr></thead><tbody>{data?.items.map((item) => {
      const sourceReferences = item.sourceTripReferences ?? [];
      return <tr key={`${item.key}:${item.label}:${item.attributionStatus}`}><td data-label={DIMENSIONS.find((entry) => entry.value === dimension)?.label ?? 'Nhóm phân tích'}><strong title={item.label ?? 'Thiếu phân bổ'}>{item.label ?? 'Thiếu phân bổ'}</strong>{item.attributionStatus === 'MISSING' && <small>{item.attributionNote}</small>}{sourceReferences.length > 0 && <small className="workflow-profitability__sources">Nguồn: {sourceReferences.slice(0, 3).map((source, index) => <span key={source.tripId}>{index > 0 && ' · '}<Link to={`/trips/${source.tripId}`}>{source.reference}</Link></span>)}{item.tripCount > sourceReferences.length && ` · +${(item.tripCount - sourceReferences.length).toLocaleString('vi-VN')} chuyến`}</small>}</td><td data-label="Số chuyến">{item.tripCount.toLocaleString('vi-VN')}</td><td data-label="Doanh thu">{formatCurrency(item.revenue)}</td><td data-label="Chi phí trực tiếp">{formatCurrency(item.directCost)}</td><td data-label="Chi phí đội xe">{formatCurrency(item.allocatedFleetFixedCost)}</td><td data-label="Lợi nhuận">{formatCurrency(item.profit)}</td><td data-label="Biên lợi nhuận">{item.marginRatio == null ? <span title="Không thể so sánh" aria-label="Không thể so sánh">—</span> : `${(item.marginRatio * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`}{item.alertState === 'LOW_MARGIN' && <small role="status">Biên lợi nhuận thấp</small>}</td></tr>;
    })}</tbody></table></div>
    {data && data.totalPages > 1 && <Pagination page={data.page} totalPages={data.totalPages} summary={<span>{data.totalGroups.toLocaleString('vi-VN')} nhóm</span>} onChange={setPage} disabled={loading} />}
  </section>;
}
