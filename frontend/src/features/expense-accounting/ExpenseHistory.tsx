import { useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExpenseVoucher, ExpenseReconciliation, ExpenseAccountingEntry } from '@tingting/shared';
import { Drawer } from '../../components/UI';
import { DateField, TextField } from '../../design-system';
import { expenseAccountingClient, type ExpenseAccountingCatalog } from '../../api/expenseAccountingClient';
import { qk } from '../../api/keys';
import { businessDateISO, formatDate } from '../../lib/format';
import { expenseMoney } from './expense-accounting-model';
import { ExpenseCashDrawer } from './ExpenseCashDrawer';
import { useExpenseMutations } from './useExpenseAccounting';

function ReverseVoucherDrawer({ voucher, onClose }: { voucher: ExpenseVoucher; onClose: () => void }) {
  const id = useId();
  const { reverse } = useExpenseMutations();
  const lock = useRef(false);
  const request = useRef<{ payload: string; key: string } | null>(null);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(businessDateISO);
  const [reference, setReference] = useState('');
  const close = () => { if (!lock.current) onClose(); };
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (lock.current || !reason.trim() || !reference.trim()) return;
    const body = { expectedVersion: voucher.version, reason: reason.trim(), valueDate: date, physicalReference: reference.trim() };
    const payload = JSON.stringify(body);
    if (request.current?.payload !== payload) request.current = { payload, key: crypto.randomUUID() };
    lock.current = true;
    try { await reverse.mutateAsync({ id: voucher.id, body, key: request.current.key }); onClose(); }
    catch { /* Mutation error remains visible with the original draft and key. */ }
    finally { lock.current = false; }
  }
  return <Drawer isOpen onClose={close} title={`Đảo phiếu ${voucher.code}`} className="expense-accounting-drawer" footer={<><button type="button" className="btn btn--secondary" disabled={reverse.isPending} onClick={close}>Đóng</button><button type="submit" form={id} className="btn btn--primary" disabled={reverse.isPending}>{reverse.isPending ? 'Đang ghi…' : 'Ghi phiếu đảo'}</button></>}>
    <form id={id} className="expense-accounting-form" onSubmit={event => void save(event)}>
      <p>Ghi giao dịch ngược {expenseMoney(voucher.amount)} và trả lại các phân bổ; phiếu gốc vẫn được giữ trong lịch sử.</p>
      {reverse.isError && <p role="alert" className="expense-accounting-error">{reverse.error instanceof Error ? reverse.error.message : 'Không đảo được phiếu.'}</p>}
      <DateField controlSize="sm" label="Ngày đảo phiếu" value={date} onChange={setDate} required disabled={reverse.isPending} />
      <TextField controlSize="sm" label="Mã tham chiếu phiếu đảo" value={reference} onChange={event => setReference(event.target.value)} required maxLength={160} disabled={reverse.isPending} />
      <TextField controlSize="sm" label="Lý do đảo" value={reason} onChange={event => setReason(event.target.value)} required maxLength={1000} disabled={reverse.isPending} />
    </form>
  </Drawer>;
}
export function ExpenseHistory({ catalog, onVoucher }: { catalog: ExpenseAccountingCatalog; onVoucher: (entries: ExpenseAccountingEntry[], direction: 'IN' | 'OUT') => void }) {
  const cache = useQueryClient();
  const allocationKeys = useRef(new Map<string, string>());
  const allocate = useMutation({ mutationFn: (voucher: ExpenseVoucher) => { const identity = `${voucher.id}:${voucher.version}`; let key = allocationKeys.current.get(identity); if (!key) { key = crypto.randomUUID(); allocationKeys.current.set(identity, key); } return expenseAccountingClient.allocateVoucher(voucher.id, voucher.version, key); }, onSuccess: () => cache.invalidateQueries({ queryKey: qk.expenseAccounting.all }) });
  const [refunding, setRefunding] = useState<ExpenseReconciliation | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<'vouchers' | 'reconciliations'>('vouchers');
  const [reversing, setReversing] = useState<ExpenseVoucher | null>(null);
  const vouchers = useQuery({ queryKey: qk.expenseAccounting.vouchers, queryFn: expenseAccountingClient.vouchers });
  const reconciliations = useQuery({ queryKey: qk.expenseAccounting.reconciliations, queryFn: expenseAccountingClient.reconciliations });
  const query = view === 'vouchers' ? vouchers : reconciliations;
  async function pay(item: ExpenseReconciliation) {
    setOpening(true); setError('');
    try { const entries = await Promise.all(item.entries.map(entry => expenseAccountingClient.get(entry))); onVoucher(entries.filter(entry => Number(entry.outstandingPayable) > 0), 'OUT'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không mở được các khoản cần trả.'); }
    finally { setOpening(false); }
  }
  return <section className="expense-accounting" aria-label="Lịch sử thu chi và hoàn ứng">
    <div className="expense-accounting-toolbar-actions"><button type="button" className={`btn btn--${view === 'vouchers' ? 'primary' : 'secondary'} btn--sm`} aria-pressed={view === 'vouchers'} onClick={() => setView('vouchers')}>Phiếu thu / chi</button><button type="button" className={`btn btn--${view === 'reconciliations' ? 'primary' : 'secondary'} btn--sm`} aria-pressed={view === 'reconciliations'} onClick={() => setView('reconciliations')}>Đối chiếu hoàn ứng</button></div>
    {allocate.isError && <p role="alert" className="expense-accounting-error">{allocate.error instanceof Error ? allocate.error.message : 'Không phân bổ được công nợ.'}</p>}
    {error && <p role="alert" className="expense-accounting-error">{error}</p>}
    {query.isError ? <p role="alert">Không tải được lịch sử. <button type="button" className="btn btn--secondary btn--sm" onClick={() => void query.refetch()}>Thử lại</button></p> : query.isPending ? <p role="status">Đang tải lịch sử…</p> : <div className="expense-accounting-history">
      {view === 'vouchers' ? vouchers.data?.items.map(voucher => <article key={voucher.id}><header><strong>{voucher.code} · {voucher.direction === 'IN' ? 'Thu' : 'Chi'}</strong><span>{voucher.status === 'REVERSED' ? 'Đã đảo' : 'Đã ghi tiền'}</span></header><dl><div><dt>Đối tượng</dt><dd>{voucher.counterpartyName ?? (voucher.counterpartyType === 'USER' ? catalog.staff.find(person => person.id === voucher.counterpartyId)?.name : voucher.counterpartyType === 'SUPPLIER' ? catalog.suppliers.find(person => person.id === voucher.counterpartyId)?.name : null) ?? 'Chưa có tên đối tượng'}</dd></div><div><dt>Quỹ / tài khoản</dt><dd>{voucher.treasuryAccountName ?? catalog.accounts.find(account => account.id === voucher.treasuryAccountId)?.name ?? 'Tài khoản đã ngừng dùng'}</dd></div><div><dt>Ngày</dt><dd>{formatDate(voucher.valueDate)}</dd></div><div><dt>Số tiền</dt><dd>{expenseMoney(voucher.amount)}</dd></div><div><dt>Tham chiếu</dt><dd>{voucher.physicalReference}</dd></div><div><dt>Phân bổ</dt><dd>{voucher.entries.length} khoản</dd></div></dl>{voucher.note && <p>{voucher.note}</p>}{voucher.status === 'RECORDED' && voucher.direction === 'IN' && voucher.counterpartyType === 'CUSTOMER' && (voucher.unappliedAmount ?? 0) > 0 && <div><p>Chưa phân bổ công nợ: {expenseMoney(voucher.unappliedAmount)}</p><button type="button" className="btn btn--secondary btn--sm" disabled={allocate.isPending} onClick={() => allocate.mutate(voucher)}>Phân bổ công nợ {voucher.code}</button></div>}{voucher.status === 'RECORDED' && <div><button type="button" className="btn btn--secondary btn--sm" onClick={() => setReversing(voucher)}>Đảo phiếu {voucher.code}</button></div>}</article>)
        : reconciliations.data?.items.map(item => <article key={item.id}><header><strong>{item.code} · {catalog.opsUsers.find(person => person.id === item.opsUserId)?.name ?? 'Nhân viên OPS'}</strong><span>{formatDate(item.from)} – {formatDate(item.to)}</span></header><dl><div><dt>Thực chi</dt><dd>{expenseMoney(item.amount)}</dd></div><div><dt>Ứng phân bổ</dt><dd>{expenseMoney(item.advanceAmount)}</dd></div><div><dt>Đã trả thêm</dt><dd>{expenseMoney(item.paidAmount)}</dd></div><div><dt>Đã hoàn ứng</dt><dd>{expenseMoney(item.refundedAmount)}</dd></div><div><dt>{item.remainingDifference < 0 ? 'OPS còn phải hoàn' : 'Công ty còn phải trả'}</dt><dd>{expenseMoney(Math.abs(item.remainingDifference))}</dd></div></dl>{item.note && <p>{item.note}</p>}{item.remainingDifference !== 0 && <div><button type="button" className="btn btn--secondary btn--sm" disabled={opening} onClick={() => item.remainingDifference < 0 ? setRefunding(item) : void pay(item)}>{item.remainingDifference < 0 ? 'Thu hoàn ứng' : 'Trả phần chênh lệch'}</button></div>}</article>)}
      {!query.data?.items.length && <p className="expense-accounting-empty">Chưa có lịch sử.</p>}
    </div>}
    {refunding && <ExpenseCashDrawer catalog={catalog} reconciliation={refunding} onClose={() => setRefunding(null)} />}
    {reversing && <ReverseVoucherDrawer voucher={reversing} onClose={() => setReversing(null)} />}
  </section>;
}
