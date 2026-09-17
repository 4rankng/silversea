import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ExpenseReconciliation } from '@tingting/shared';
import { DateField, TextField } from '../../design-system';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { qk } from '../../api/keys';
import { formatDate } from '../../lib/format';
import { downloadCSV } from '../../lib/csv';
import { expenseMoney } from './expense-accounting-model';
import { ExpenseHistoryDetail } from './ExpenseHistoryDetail';
import { ReleaseReconciliationDrawer } from './ReleaseReconciliationDrawer';
import './ExpenseAccounting.css';

export function filterReconciliations(items: ExpenseReconciliation[], search: string, from: string, to: string, names: Map<number, string>) {
  const text = search.trim().toLocaleLowerCase('vi');
  return items.filter(item => (!from || item.to >= from) && (!to || item.from <= to)
    && (!text || `${item.code} ${names.get(item.opsUserId) ?? ''} ${item.note ?? ''}`.toLocaleLowerCase('vi').includes(text)));
}

export function ExpenseReconciliationHistory({ people = [], onPay, canRelease = false }: {
  people?: Array<{ id: number; name: string }>;
  onPay?: (item: ExpenseReconciliation) => void;
  canRelease?: boolean;
}) {
  const query = useQuery({ queryKey: qk.expenseAccounting.reconciliations, queryFn: expenseAccountingClient.reconciliations });
  const [search, setSearch] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [opened, setOpened] = useState<ExpenseReconciliation | null>(null);
  const [releasing, setReleasing] = useState<ExpenseReconciliation | null>(null);
  const [exporting, setExporting] = useState(false), [error, setError] = useState('');
  const names = new Map(people.map(person => [person.id, person.name]));
  const valid = !from || !to || from <= to;
  const rows = valid ? filterReconciliations(query.data?.items ?? [], search, from, to, names) : [];
  async function download() {
    setExporting(true); setError('');
    try { await downloadCSV('doi-chieu-hoan-ung.xlsx', ['Mã', 'Trạng thái', 'OPS', 'Từ ngày', 'Đến ngày', 'Thực chi', 'Ứng phân bổ', 'Đã trả thêm', 'Đã hoàn', 'Chênh lệch còn lại'], rows.map(item => [item.code, item.voidedAt ? 'Đã hoàn tác' : 'Đã đối chiếu', names.get(item.opsUserId) ?? String(item.opsUserId), item.from, item.to, item.amount, item.advanceAmount, item.paidAmount, item.refundedAmount, item.remainingDifference]), { title: 'ĐỐI CHIẾU HOÀN ỨNG', columnTypes: ['text', 'text', 'text', 'date', 'date', 'currency', 'currency', 'currency', 'currency', 'currency'], hideTotals: true }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không xuất được lịch sử.'); }
    finally { setExporting(false); }
  }
  return <section className="expense-accounting" aria-label="Lịch sử đối chiếu hoàn ứng">
    <h2 className="expense-accounting-subtitle">Đối chiếu hoàn ứng</h2>
    <div className="expense-history-filters"><TextField controlSize="sm" label="Mã / nhân viên / ghi chú" value={search} onChange={event => setSearch(event.target.value)} /><DateField controlSize="sm" label="Kỳ từ ngày" value={from} onChange={setFrom} /><DateField controlSize="sm" label="Kỳ đến ngày" value={to} onChange={setTo} /><button type="button" className="btn btn--secondary" disabled={!valid || query.isPending || query.isError || exporting} onClick={() => void download()}>{exporting ? 'Đang xuất…' : 'Tải XLSX'}</button></div>
    {!valid && <p role="alert">Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.</p>}{error && <p role="alert">{error}</p>}
    {query.isError ? <p role="alert">Không tải được đối chiếu. <button type="button" className="btn btn--secondary" onClick={() => void query.refetch()}>Thử lại</button></p> : query.isPending ? <p role="status">Đang tải đối chiếu…</p> : <div className="expense-accounting-history">{rows.map(item => <article key={item.id}>
      <header><button type="button" className="expense-register-open" onClick={() => setOpened(item)}>{item.code}</button><span>{names.get(item.opsUserId) ?? ''} · {formatDate(item.from)} – {formatDate(item.to)}</span></header>
      <dl><div><dt>Thực chi</dt><dd>{expenseMoney(item.amount)}</dd></div><div><dt>Ứng phân bổ</dt><dd>{expenseMoney(item.advanceAmount)}</dd></div><div><dt>{item.remainingDifference < 0 ? 'OPS còn phải hoàn' : 'Công ty còn phải trả'}</dt><dd>{expenseMoney(Math.abs(item.remainingDifference))}</dd></div></dl>
      {item.voidedAt && <p>Đã hoàn tác · {formatDate(item.voidedAt)}</p>}
      {item.note && <p>{item.note}</p>}{!item.voidedAt && <div className="expense-accounting-toolbar-actions">{onPay && item.remainingDifference !== 0 && <button type="button" className="btn btn--secondary btn--sm" onClick={() => onPay(item)}>{item.remainingDifference < 0 ? 'Thu hoàn ứng' : 'Trả phần chênh lệch'}</button>}{canRelease && <button type="button" className="btn btn--secondary btn--sm" onClick={() => setReleasing(item)}>Hoàn tác đối chiếu</button>}</div>}
    </article>)}{!rows.length && <p>Không có đối chiếu phù hợp.</p>}</div>}
    {opened && <ExpenseHistoryDetail item={opened} onClose={() => setOpened(null)} />}
    {releasing && <ReleaseReconciliationDrawer item={releasing} onClose={() => setReleasing(null)} />}
  </section>;
}
