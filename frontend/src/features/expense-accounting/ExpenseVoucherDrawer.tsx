import { useId, useRef, useState } from 'react';
import { expenseVoucherSchema, type ExpenseAccountingEntry, type ExpenseVoucher } from '@tingting/shared';
import { Drawer } from '../../components/UI';
import { DateField, NumberField, TextField, UuiSelectField } from '../../design-system';
import { businessDateISO } from '../../lib/format';
import { useExpenseMutations } from './useExpenseAccounting';
import { expenseKey, expenseMoney, sourceRef, validAllocation, voucherSelectionIssue } from './expense-accounting-model';

export interface ExpenseFundAccount { id: number; name: string; fundCode: 'COMPANY' | 'TM' | null; }

export function ExpenseVoucherDrawer({ entries, direction, accounts, onClose, onSaved }: {
  entries: ExpenseAccountingEntry[]; direction: 'IN' | 'OUT'; accounts: ExpenseFundAccount[];
  onClose: () => void; onSaved: (voucher: ExpenseVoucher) => void;
}) {
  const formId = useId();
  const { voucher } = useExpenseMutations();
  const operation = useRef(false);
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  const [fund, setFund] = useState('');
  const [account, setAccount] = useState('');
  const [date, setDate] = useState(businessDateISO);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, number | ''>>(() => Object.fromEntries(entries.map(entry => [expenseKey(entry), (direction === 'IN' ? entry.outstandingReceivable : entry.outstandingPayable) ?? ''])));
  const issue = voucherSelectionIssue(entries, direction);
  const filteredAccounts = accounts.filter(item => item.fundCode === fund);
  const total = Object.values(amounts).reduce<number>((sum, value) => sum + (value === '' ? 0 : value), 0);
  const allocationsValid = entries.every(entry => validAllocation(amounts[expenseKey(entry)], direction === 'IN' ? entry.outstandingReceivable : entry.outstandingPayable));
  const title = direction === 'IN' ? 'Lập phiếu thu' : 'Lập phiếu chi';
  const close = () => { if (!operation.current) onClose(); };
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (operation.current || issue || !allocationsValid) return;
    const parsed = expenseVoucherSchema.safeParse({ direction, treasuryAccountId: Number(account), valueDate: date, physicalReference: reference,
      note: note.trim() || undefined, entries: entries.map(entry => ({ ...sourceRef(entry), amount: amounts[expenseKey(entry)] })) });
    if (!parsed.success || !filteredAccounts.some(item => String(item.id) === account)) { setError('Chọn quỹ, tài khoản hợp lệ, ngày và mã tham chiếu thu / chi.'); return; }
    const fingerprint = JSON.stringify(parsed.data);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    operation.current = true; setError(null);
    try { const result = await voucher.mutateAsync({ body: parsed.data, key: request.current.key }); onSaved(result); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa rõ kết quả. Giữ nguyên nội dung và thử lại để tra đúng phiếu.'); }
    finally { operation.current = false; }
  }
  return <Drawer isOpen onClose={close} title={title} subtitle={`${entries.length} khoản · ${direction === 'IN' ? entries[0]?.customerName : entries[0]?.payerName ?? 'Đối tượng nhận tiền'}`}
    className="expense-accounting-drawer" footer={<><strong className="expense-voucher-total">{expenseMoney(total)}</strong><button type="button" className="btn btn--secondary" onClick={close} disabled={voucher.isPending}>Đóng</button><button type="submit" form={formId} className="btn btn--primary" disabled={voucher.isPending || Boolean(issue) || !allocationsValid}>{voucher.isPending ? 'Đang ghi…' : 'Ghi phiếu'}</button></>}>
    <form id={formId} className="expense-accounting-form" onSubmit={(event) => void save(event)}>
      {(issue || error) && <p role="alert" className="expense-accounting-error">{issue || error}</p>}
      <p>{direction === 'IN' ? 'Phiếu thu tăng số dư quỹ.' : 'Phiếu chi giảm số dư quỹ.'} Chỉ ghi khi đã giao / nhận tiền thực tế. Thao tác này không gửi tiền qua ngân hàng.</p>
      <div className="expense-accounting-fields">
        <UuiSelectField label="Nguồn quỹ" value={fund} disabled={voucher.isPending} onChange={(event) => { setFund(event.target.value); setAccount(''); }} options={[{ value: '', label: 'Chọn nguồn quỹ' }, { value: 'COMPANY', label: 'Quỹ công ty' }, { value: 'TM', label: 'Quỹ TM' }]} />
        <UuiSelectField label="Tài khoản" value={account} disabled={voucher.isPending || !fund} onChange={(event) => setAccount(event.target.value)} options={[{ value: '', label: 'Chọn tài khoản đã cấu hình' }, ...filteredAccounts.map(item => ({ value: String(item.id), label: item.name }))]} />
        <DateField controlSize="sm" label="Ngày thu / chi thực tế" required value={date} onChange={setDate} disabled={voucher.isPending} />
        <TextField controlSize="sm" label="Mã tham chiếu / biên lai" required value={reference} onChange={(event) => setReference(event.target.value)} maxLength={160} disabled={voucher.isPending} />
      </div>
      {fund && filteredAccounts.length === 0 && <p role="status">Quỹ này chưa có tài khoản đang sử dụng. Cần cấu hình tài khoản trước khi ghi tiền. <a href="/finance/treasury" target="_blank" rel="noreferrer">Mở Sổ quỹ / ngân hàng</a> (quản lý hoặc quản trị cấu hình).</p>}
      <h3 className="expense-accounting-subtitle">Phân bổ từng khoản</h3>
      <div className="expense-voucher-allocations">{entries.map(entry => {
        const remaining = direction === 'IN' ? entry.outstandingReceivable : entry.outstandingPayable;
        return <div key={expenseKey(entry)} className="expense-voucher-allocation"><div><strong>{entry.feeName}</strong><span>{entry.shipmentCode} · {entry.containerNumber ?? 'Chung lô'}</span><small>Còn lại: {expenseMoney(remaining)}</small></div><NumberField controlSize="sm" label={`Số ${direction === 'IN' ? 'thu' : 'trả'} · ${entry.feeName}`} value={amounts[expenseKey(entry)]} min={1} max={remaining ?? undefined} step={1} required disabled={voucher.isPending} onChange={(amount) => setAmounts(current => ({ ...current, [expenseKey(entry)]: amount }))} error={!validAllocation(amounts[expenseKey(entry)], remaining) ? 'Số tiền phải lớn hơn 0 và không vượt phần còn lại.' : undefined} /></div>;
      })}</div>
      <TextField controlSize="sm" label="Ghi chú phiếu" value={note} disabled={voucher.isPending} onChange={(event) => setNote(event.target.value)} maxLength={2000} />
    </form>
  </Drawer>;
}
