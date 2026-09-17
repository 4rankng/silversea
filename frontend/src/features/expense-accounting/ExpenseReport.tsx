import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ExpenseListQuery } from '@tingting/shared';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { qk } from '../../api/keys';
import { DateField, UuiSelectField } from '../../design-system';
import { businessDateISO } from '../../lib/format';
import { expenseMoney } from './expense-accounting-model';

export function ExpenseReport({ filters }: { filters: ExpenseListQuery }) {
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const [asOfDate, setAsOfDate] = useState(businessDateISO);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const params = { ...filters, direction, asOfDate };
  const report = useQuery({ queryKey: qk.expenseAccounting.report(params), queryFn: () => expenseAccountingClient.report(params) });
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
    <div className="expense-accounting-toolbar"><div className="expense-accounting-fields"><UuiSelectField label="Loại báo cáo" value={direction} onChange={event => setDirection(event.target.value as typeof direction)} options={[{ value: 'IN', label: 'Phải thu khách hàng' }, { value: 'OUT', label: 'Phải trả / chi phí xe' }]} /><DateField controlSize="sm" label="Thanh toán tính đến" value={asOfDate} onChange={setAsOfDate} required /></div><button type="button" className="btn btn--secondary btn--sm" onClick={() => void download()} disabled={exporting || report.isPending || report.isError}>{exporting ? 'Đang xuất…' : 'Tải XLSX'}</button></div>
    <p className="expense-accounting-hint">Khoảng ngày lọc theo ngày phát sinh chi phí. Đã thu / trả tính đến ngày được chọn; cùng bộ lọc được dùng khi xuất.</p>
    {error && <p role="alert" className="expense-accounting-error">{error}</p>}
    {report.isError ? <p role="alert">Không tải được báo cáo. <button type="button" className="btn btn--secondary btn--sm" onClick={() => void report.refetch()}>Thử lại</button></p> : report.isPending ? <p role="status">Đang tải báo cáo…</p> : <>
      {report.data.unknownCount > 0 && <p className="expense-accounting-notice">{report.data.unknownCount} khoản còn thiếu giá trị hoặc chưa phân bổ thanh toán chi tiết. Số chưa xác định không được tính là 0đ.</p>}
      <div className="expense-register-table-wrap"><table className="expense-register-table"><thead><tr><th scope="col">Đối tượng</th><th scope="col">Nâng</th><th scope="col">Hạ</th><th scope="col">Khác</th><th scope="col">Tổng</th><th scope="col">Đã {direction === 'IN' ? 'thu' : 'trả / ứng'}</th><th scope="col">Còn lại</th></tr></thead><tbody>
        {report.data.items.map(row => <tr key={`${row.entityType}:${row.entityId}:${row.carrierCode}`}><td data-label="Đối tượng" className="expense-register-context"><strong>{row.entityName}</strong>{row.carrierCode && <small>{row.carrierCode}</small>}</td>{(['lift', 'drop', 'other', 'total', 'settled', 'outstanding'] as const).map((field, index) => <td key={field} className="num" data-label={['Nâng', 'Hạ', 'Khác', 'Tổng', 'Đã thanh toán', 'Còn lại'][index]}>{expenseMoney(row[field])}</td>)}</tr>)}
      </tbody></table></div>
      {!report.data.items.length && <p className="expense-accounting-empty">Chưa có công nợ trong khoảng ngày này.</p>}
      <div className="expense-accounting-summary"><div><span>Tổng</span><strong>{expenseMoney(report.data.totals.total)}</strong></div><div><span>Đã thanh toán</span><strong>{expenseMoney(report.data.totals.settled)}</strong></div><div><span>Còn lại</span><strong>{expenseMoney(report.data.totals.outstanding)}</strong></div></div>
    </>}
  </section>;
}
