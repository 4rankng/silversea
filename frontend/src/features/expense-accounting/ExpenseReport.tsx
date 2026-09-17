import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { expenseDateSchema, type ExpenseAccountingEntry, type ExpenseListQuery } from '@tingting/shared';
import { useSearchParams, Link } from 'react-router-dom';
import { Drawer } from '../../components/UI';
import { expenseAccountingClient, type ExpenseReportRow } from '../../api/expenseAccountingClient';
import { qk } from '../../api/keys';
import { DateField, UuiSelectField } from '../../design-system';
import { businessDateISO, formatDate } from '../../lib/format';
import { expenseMoney } from './expense-accounting-model';

export function ExpenseReport({ filters }: { filters: ExpenseListQuery }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const direction: 'IN' | 'OUT' = searchParams.get('reportDirection') === 'OUT' ? 'OUT' : 'IN';
  const storedDate = expenseDateSchema.safeParse(searchParams.get('reportAsOf'));
  const asOfDate = storedDate.success ? storedDate.data : businessDateISO();
  const [dateDraft, setDateDraft] = useState<{ anchor: string; value: string } | null>(null);
  const dateValue = dateDraft?.anchor === asOfDate ? dateDraft.value : asOfDate;
  function changeDate(value: string) {
    setDateDraft({ anchor: asOfDate, value });
    if (expenseDateSchema.safeParse(value).success) {
      setFilter('reportAsOf', value);
      setDateDraft(null);
    }
  }
  const setFilter = (key: string, value: string) => setSearchParams(current => { const next = new URLSearchParams(current); next.set(key, value); return next; });
  const [detail, setDetail] = useState<{ key: string; field: ReportField; filters: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const params = { ...filters, direction, asOfDate };
  const filterKey = JSON.stringify(params);
  const report = useQuery({ queryKey: qk.expenseAccounting.report(params), queryFn: () => expenseAccountingClient.report(params) });
  const detailRow = detail?.filters === filterKey ? report.data?.items.find(row => reportKey(row) === detail.key) : undefined;
  async function download() {
    setExporting(true); setError('');
    try {
      const blob = await expenseAccountingClient.exportReport(params);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `chi-phi-${direction === 'IN' ? 'phai-thu' : 'phai-tra'}-${filters.from ?? 'all'}-${filters.to ?? asOfDate}.xlsx`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không xuất được báo cáo.'); }
    finally { setExporting(false); }
  }
  return <section className="expense-accounting" aria-label="Báo cáo công nợ chi phí">
    <div className="expense-accounting-toolbar"><div className="expense-accounting-fields"><UuiSelectField label="Loại báo cáo" value={direction} onChange={event => setFilter('reportDirection', event.target.value)} options={[{ value: 'IN', label: 'Phải thu khách hàng' }, { value: 'OUT', label: 'Phải trả / chi phí xe' }]} /><DateField controlSize="sm" label="Thanh toán tính đến" value={dateValue} onChange={changeDate} required /></div><button type="button" className="btn btn--secondary btn--sm" onClick={() => void download()} disabled={exporting || report.isPending || report.isError}>{exporting ? 'Đang xuất…' : 'Tải XLSX'}</button></div>
    <p className="expense-accounting-hint">Khoảng ngày lọc theo ngày phát sinh chi phí. Đã thu / trả tính đến ngày được chọn; cùng bộ lọc được dùng khi xuất.</p>
    {error && <p role="alert" className="expense-accounting-error">{error}</p>}
    {report.isError ? <p role="alert">Không tải được báo cáo. <button type="button" className="btn btn--secondary btn--sm" onClick={() => void report.refetch()}>Thử lại</button></p> : report.isPending ? <p role="status">Đang tải báo cáo…</p> : <>
      {report.data.unknownCount > 0 && <p className="expense-accounting-notice">{report.data.unknownCount} khoản còn thiếu giá trị hoặc chưa phân bổ thanh toán chi tiết. Số chưa xác định không được tính là 0đ.</p>}
      <div className="expense-register-table-wrap"><table className="expense-register-table"><thead><tr><th scope="col">Đối tượng</th><th scope="col">Nâng</th><th scope="col">Hạ</th><th scope="col">Khác</th><th scope="col">Tổng</th><th scope="col">Đã {direction === 'IN' ? 'thu' : 'trả / ứng'}</th><th scope="col">Còn lại</th></tr></thead><tbody>
        {report.data.items.map(row => <tr key={`${row.entityType}:${row.entityId}:${row.carrierCode}`}><td data-label="Đối tượng" className="expense-register-context"><strong>{row.entityName}</strong>{row.carrierCode && <small>{row.carrierCode}</small>}</td>{(['lift', 'drop', 'other', 'total', 'settled', 'outstanding'] as const).map((field, index) => <td key={field} className="num" data-label={['Nâng', 'Hạ', 'Khác', 'Tổng', 'Đã thanh toán', 'Còn lại'][index]}><button type="button" className="expense-register-money" onClick={() => setDetail({ key: reportKey(row), field, filters: filterKey })} aria-label={`${REPORT_LABELS[field]} · ${row.entityName}`}>{expenseMoney(row[field])}</button></td>)}</tr>)}
      </tbody></table></div>
      {!report.data.items.length && <p className="expense-accounting-empty">Chưa có công nợ trong khoảng ngày này.</p>}
      <div className="expense-accounting-summary"><div><span>Tổng</span><strong>{expenseMoney(report.data.totals.total)}</strong></div><div><span>Đã thanh toán</span><strong>{expenseMoney(report.data.totals.settled)}</strong></div><div><span>Còn lại</span><strong>{expenseMoney(report.data.totals.outstanding)}</strong></div></div>
    </>}
    {detail && detailRow && <ReportDetail row={detailRow} direction={direction} field={detail.field} asOfDate={asOfDate} onClose={() => setDetail(null)} />}
  </section>;
}

const SOURCE_LABELS = { OPS: 'Giao nhận', DRIVER: 'Lái xe', TRIP: 'Công việc', INVOICE: 'Hóa đơn' };
const REPORT_LABELS = { lift: 'Nâng', drop: 'Hạ', other: 'Khác', total: 'Tổng', settled: 'Đã thanh toán', outstanding: 'Còn lại' };
type ReportField = keyof typeof REPORT_LABELS;
const reportKey = (row: ExpenseReportRow) => `${row.entityType}:${row.entityId}:${row.carrierCode ?? ''}`;
function reportEntryValue(entry: ExpenseAccountingEntry, direction: 'IN' | 'OUT', field: ReportField) {
  if (field === 'settled') return direction === 'IN' ? entry.receivedAmount : entry.paidAmount == null || entry.allocatedAdvanceAmount == null ? null : entry.paidAmount + entry.allocatedAdvanceAmount;
  if (field === 'outstanding') return direction === 'IN' ? entry.outstandingReceivable : entry.outstandingPayable;
  return direction === 'IN' ? entry.customerChargeAmount : entry.amount;
}
function ReportDetail({ row, direction, field, asOfDate, onClose }: { row: ExpenseReportRow; direction: 'IN' | 'OUT'; field: ReportField; asOfDate: string; onClose: () => void }) {
  const entries = row.entries.filter(entry => field === 'lift' ? entry.costGroup === 'INVOICED_LIFT' : field === 'drop' ? entry.costGroup === 'INVOICED_DROP'
    : field === 'other' ? !['INVOICED_LIFT', 'INVOICED_DROP'].includes(entry.costGroup ?? '') : true);
  return <Drawer isOpen onClose={onClose} title={`${REPORT_LABELS[field]} · ${row.entityName}`} subtitle={`Thanh toán tính đến ${formatDate(asOfDate)}`} className="expense-accounting-drawer"
    footer={<button type="button" className="btn btn--secondary" onClick={onClose}>Đóng</button>}>
    <div className="expense-accounting">
      <p className="expense-accounting-hint">{entries.length} khoản theo đúng bộ lọc báo cáo. {direction === 'IN' ? 'Thực thu là khoản tính cho khách; đã thu chỉ lấy từ phiếu thu.' : 'Đã thanh toán gồm phiếu chi và khoản ứng đã phân bổ.'}</p>
      <div className="expense-register-table-wrap"><table className="expense-register-table"><thead><tr><th scope="col">Lô hàng / khoản chi</th><th scope="col">Ngày phát sinh</th><th scope="col">Nguồn</th><th scope="col">{REPORT_LABELS[field]}</th></tr></thead><tbody>
        {entries.map(entry => <tr key={`${entry.sourceKind}:${entry.sourceId}`}><td data-label="Lô hàng / khoản chi"><Link to={`/shipments/${entry.shipmentId}`}>{entry.shipmentCode}</Link><strong>{entry.feeName}</strong><span>{entry.invoiceNumber ?? entry.containerNumber ?? 'Chung lô'}</span></td><td data-label="Ngày phát sinh">{formatDate(entry.expenseDate)}</td><td data-label="Nguồn">{SOURCE_LABELS[entry.sourceKind]}<small>#{entry.sourceId}</small></td><td data-label={REPORT_LABELS[field]} className="num">{expenseMoney(reportEntryValue(entry, direction, field))}</td></tr>)}
      </tbody></table></div>
      <div className="expense-accounting-summary"><div><span>{REPORT_LABELS[field]}</span><strong>{expenseMoney(row[field])}</strong></div></div>
    </div>
  </Drawer>;
}
