import { useId, useRef, useState } from 'react';
import { expenseReconciliationSchema, type ExpenseAccountingEntry } from '@tingting/shared';
import type { ExpenseAccountingCatalog } from '../../api/expenseAccountingClient';
import { Drawer } from '../../components/UI';
import { DateField, NumberField, TextField } from '../../design-system';
import { expenseMoney, sourceRef } from './expense-accounting-model';
import { useExpenseMutations } from './useExpenseAccounting';

export function ExpenseReconciliationDrawer({ entries, catalog, onClose, onSaved }: { entries: ExpenseAccountingEntry[]; catalog: ExpenseAccountingCatalog; onClose: () => void; onSaved: () => void }) {
  const id = useId();
  const { reconcile } = useExpenseMutations();
  const operation = useRef(false);
  const request = useRef<{ payload: string; key: string } | null>(null);
  const userId = entries[0]?.payerUserId;
  const dates = entries.map(entry => entry.expenseDate).sort();
  const [from, setFrom] = useState(dates[0] ?? '');
  const [to, setTo] = useState(dates.at(-1) ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [allocations, setAllocations] = useState<Record<number, number | ''>>({});
  const advances = catalog.advances.filter(advance => advance.opsUserId === userId);
  const amount = entries.reduce((total, entry) => total + entry.amount, 0);
  const allocated = Object.values(allocations).reduce<number>((total, value) => total + (value || 0), 0);
  const difference = amount - allocated;
  const issue = entries.some(entry => entry.sourceKind !== 'OPS' || !userId || entry.payerUserId !== userId || entry.reconciliationId != null || entry.status !== 'RECORDED')
    ? 'Chọn các khoản OPS chưa hoàn ứng của cùng một người thực chi.' : null;
  const close = () => { if (!operation.current) onClose(); };
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (operation.current || issue) return;
    const selected = advances.filter(advance => Number(allocations[advance.id]) > 0);
    if (selected.some(advance => Number(allocations[advance.id]) > advance.remainingAmount)) { setError('Số phân bổ vượt khoản ứng còn lại.'); return; }
    const parsed = expenseReconciliationSchema.safeParse({ opsUserId: userId, from, to, entries: entries.map(sourceRef), advances: selected.map(advance => ({ advanceRequestId: advance.id, amount: allocations[advance.id] })), note });
    if (!parsed.success) { setError('Kiểm tra khoảng ngày và số tiền phân bổ.'); return; }
    const payload = JSON.stringify(parsed.data);
    if (request.current?.payload !== payload) request.current = { payload, key: crypto.randomUUID() };
    operation.current = true; setError('');
    try { await reconcile.mutateAsync({ body: parsed.data, key: request.current.key }); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa rõ kết quả đối chiếu. Thử lại cùng nội dung.'); }
    finally { operation.current = false; }
  }
  return <Drawer isOpen onClose={close} title="Đối chiếu hoàn ứng OPS" subtitle={entries[0]?.payerName ?? 'Người thực chi'} className="expense-accounting-drawer" footer={<><button type="button" className="btn btn--secondary" disabled={reconcile.isPending} onClick={close}>Đóng</button><button type="submit" form={id} className="btn btn--primary" disabled={reconcile.isPending || Boolean(issue)}>{reconcile.isPending ? 'Đang lưu…' : 'Ghi đối chiếu'}</button></>}>
    <form id={id} className="expense-accounting-form" onSubmit={event => void save(event)}>
      {(issue || error) && <p role="alert" className="expense-accounting-error">{issue || error}</p>}
      <div className="expense-accounting-fields"><DateField controlSize="sm" label="Từ ngày chi" value={from} onChange={setFrom} required disabled={reconcile.isPending} /><DateField controlSize="sm" label="Đến ngày chi" value={to} onChange={setTo} required disabled={reconcile.isPending} /></div>
      <div className="expense-accounting-summary"><div><span>{entries.length} khoản thực chi</span><strong>{expenseMoney(amount)}</strong></div><div><span>Ứng đã phân bổ</span><strong>{expenseMoney(allocated)}</strong></div><div><span>{difference < 0 ? 'OPS cần hoàn lại' : 'Công ty cần trả thêm'}</span><strong>{expenseMoney(Math.abs(difference))}</strong></div></div>
      <h3 className="expense-accounting-subtitle">Chọn khoản ứng đã giao tiền</h3>
      {!advances.length && <p className="expense-accounting-hint">Không có khoản ứng còn dư đủ điều kiện. Có thể đối chiếu chi phí để xác định khoản công ty cần trả.</p>}
      {advances.map(advance => <div key={advance.id} className="expense-voucher-allocation"><div><strong>Ứng #{advance.id}</strong><span>{advance.date}</span><small>Còn lại: {expenseMoney(advance.remainingAmount)}</small></div><NumberField controlSize="sm" label={`Phân bổ ứng #${advance.id}`} min={0} max={advance.remainingAmount} step={1} disabled={reconcile.isPending} value={allocations[advance.id] ?? ''} onChange={value => setAllocations(current => ({ ...current, [advance.id]: value }))} /></div>)}
      <TextField controlSize="sm" label="Ghi chú đối chiếu" value={note} onChange={event => setNote(event.target.value)} disabled={reconcile.isPending} maxLength={2000} />
      <p className="expense-accounting-hint">Đối chiếu không tự trả hoặc thu tiền. Lập phiếu riêng khi thực tế đã giao nhận phần chênh lệch.</p>
    </form>
  </Drawer>;
}
