import { useId, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { treasuryFundLabel, type ExpenseReconciliation } from '@tingting/shared';
import { Drawer } from '../../components/UI';
import { DateField, NumberField, TextField, UuiSelectField } from '../../design-system';
import { expenseAccountingClient, type ExpenseAccountingCatalog } from '../../api/expenseAccountingClient';
import { qk } from '../../api/keys';
import { opsReconciliationReportKeys } from '../../api/opsReconciliationReportClient';
import { businessDateISO } from '../../lib/format';
import { expenseMoney } from './expense-accounting-model';

/** SIL-728 — staff-level recovery target: the person holds a NEGATIVE signed
 *  advance balance (tiền ứng vượt chi) and the accountant books the payback.
 *  The drawer pre-fills the deficit and locks the person — one shared money
 *  entry surface for all three flows (đợt refund / funded advance / recovery). */
export interface AdvanceRecoveryTarget { opsUserId: number; staffName: string; deficit: number; reason?: string; }

export function ExpenseCashDrawer({ catalog, reconciliation, recovery, onClose }: { catalog: ExpenseAccountingCatalog; reconciliation?: ExpenseReconciliation; recovery?: AdvanceRecoveryTarget; onClose: () => void }) {
  const id = useId();
  const cache = useQueryClient();
  const [requestId, setRequestId] = useState('');
  const [person, setPerson] = useState(String(reconciliation?.opsUserId ?? recovery?.opsUserId ?? ''));
  const [amount, setAmount] = useState<number | ''>(reconciliation ? Math.abs(reconciliation.remainingDifference) : recovery ? recovery.deficit : '');
  const [fund, setFund] = useState('');
  const [account, setAccount] = useState('');
  const [date, setDate] = useState(businessDateISO);
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState(recovery ? (recovery.reason ?? 'Thu hồi tiền ứng số dư âm') : '');
  const [error, setError] = useState('');
  const lock = useRef(false);
  const command = useRef<{ payload: string; key: string } | null>(null);
  // KP-148: yêu cầu PENDING phải được kế toán phê duyệt trước khi ghi tiền —
  // chỉ đưa yêu cầu đã ghi sổ (RECORDED, chưa có tiền thật) vào danh sách chọn.
  const requests = (catalog.pendingAdvances ?? []).filter(item => String(item.opsUserId) === person && item.status !== 'PENDING');
  const accounts = catalog.accounts.filter(item => item.fundCode === fund);
  const mutation = useMutation({ mutationFn: async () => {
    const body = { amount: Number(amount), reason: reason.trim(), treasuryAccountId: Number(account), valueDate: date, physicalReference: reference.trim() };
    const input = reconciliation ? body : { ...body, opsUserId: Number(person), ...(requestId ? { advanceRequestId: Number(requestId) } : {}) };
    const payload = JSON.stringify(input);
    if (command.current?.payload !== payload) command.current = { payload, key: crypto.randomUUID() };
    if (recovery) return expenseAccountingClient.advanceRecovery({ opsUserId: recovery.opsUserId, ...body }, command.current.key);
    return reconciliation ? expenseAccountingClient.refundReconciliation(reconciliation.id, body, command.current.key)
      : expenseAccountingClient.fundAdvance({ ...body, opsUserId: Number(person), ...(requestId ? { advanceRequestId: Number(requestId) } : {}) }, command.current.key);
  }, onSuccess: async () => {
    await cache.invalidateQueries({ queryKey: qk.expenseAccounting.all });
    await cache.invalidateQueries({ queryKey: opsReconciliationReportKeys.all });
    onClose();
  } });
  const close = () => { if (!lock.current) onClose(); };
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (lock.current) return;
    if (!person || amount === '' || !Number.isSafeInteger(amount) || amount <= 0 || !date || !reference.trim() || !reason.trim() || !accounts.some(item => String(item.id) === account)) { setError('Chọn người, quỹ, tài khoản, ngày, tham chiếu và số tiền nguyên dương.'); return; }
    if (recovery && amount > recovery.deficit) { setError('Tiền thu hồi vượt số dư ứng âm nhân viên đang nắm.'); return; }
    if (reconciliation && amount > Math.abs(reconciliation.remainingDifference)) { setError('Tiền hoàn vượt phần ứng còn phải hoàn.'); return; }
    lock.current = true; setError('');
    try { await mutation.mutateAsync(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa rõ kết quả. Thử lại cùng nội dung.'); }
    finally { lock.current = false; }
  }
  const busy = mutation.isPending;
  return <Drawer isOpen onClose={close} title={recovery ? `Xác nhận hoàn ứng · ${recovery.staffName}` : reconciliation ? `Thu hoàn ứng · ${reconciliation.code}` : 'Chi tạm ứng OPS'} className="expense-accounting-drawer" footer={<><button type="button" className="btn btn--secondary" disabled={busy} onClick={close}>Đóng</button><button type="submit" form={id} className="btn btn--primary" disabled={busy}>{busy ? 'Đang ghi…' : recovery || reconciliation ? 'Ghi thu hoàn ứng' : 'Ghi chi tạm ứng'}</button></>}>
    <form id={id} className="expense-accounting-form" onSubmit={event => void save(event)}>
      {error && <p role="alert" className="expense-accounting-error">{error}</p>}
      <p>Chỉ ghi khi đã giao nhận tiền thực tế. Thao tác không gửi tiền qua ngân hàng.</p>
      {recovery && <p>Số dư ứng âm đang nắm: <strong>{expenseMoney(recovery.deficit)}</strong></p>}
      {reconciliation && <p>Còn phải hoàn: <strong>{expenseMoney(Math.abs(reconciliation.remainingDifference))}</strong></p>}
      <div className="expense-accounting-fields">
        {!recovery && <UuiSelectField label="Nhân viên OPS" value={person} required disabled={busy || Boolean(reconciliation)} onChange={event => { setPerson(event.target.value); setRequestId(''); setAmount(''); setReason(''); }} options={[{ value: '', label: 'Chọn nhân viên' }, ...catalog.opsUsers.map(item => ({ value: String(item.id), label: item.name }))]} />}
        {recovery && <p><strong>{recovery.staffName}</strong></p>}
        {!reconciliation && !recovery && person && <UuiSelectField label="Yêu cầu ứng" value={requestId} disabled={busy} onChange={event => {
          const value = event.target.value; setRequestId(value);
          const request = requests.find(item => String(item.id) === value);
          setAmount(request?.amount ?? ''); setReason(request?.reason ?? '');
        }} options={[{ value: '', label: 'Ghi chi mới — không có yêu cầu trước' }, ...requests.map(item => ({ value: String(item.id), label: `${item.reason} · ${item.date} · ${expenseMoney(item.amount)}` }))]} />}
        <NumberField controlSize="sm" label={recovery || reconciliation ? 'Tiền hoàn ứng (VND)' : 'Tiền tạm ứng (VND)'} required value={amount} min={1} max={recovery ? recovery.deficit : reconciliation ? Math.abs(reconciliation.remainingDifference) : 999_999_999_999_999} step={1} grouped disabled={busy || Boolean(requestId)} onChange={setAmount} />
        <UuiSelectField label="Nguồn quỹ" value={fund} disabled={busy} onChange={event => { setFund(event.target.value); setAccount(''); }} options={[{ value: '', label: 'Chọn quỹ' }, { value: 'COMPANY', label: treasuryFundLabel('COMPANY') }, { value: 'TM', label: treasuryFundLabel('TM') }]} />
        <UuiSelectField label="Tài khoản" value={account} disabled={busy || !fund} onChange={event => setAccount(event.target.value)} options={[{ value: '', label: 'Chọn tài khoản' }, ...accounts.map(item => ({ value: String(item.id), label: item.name }))]} />
        <DateField controlSize="sm" label="Ngày giao nhận tiền" required value={date} disabled={busy} onChange={setDate} />
        <TextField controlSize="sm" label="Mã tham chiếu / biên lai" required value={reference} maxLength={160} disabled={busy} onChange={event => setReference(event.target.value)} />
      </div>
      {fund && !accounts.length && <p role="status">Quỹ này chưa có tài khoản đang sử dụng. Cần cấu hình trước khi ghi tiền. <a href="/finance/treasury" target="_blank" rel="noreferrer">Mở Sổ quỹ / ngân hàng</a> (quản lý hoặc quản trị cấu hình).</p>}
      <TextField controlSize="sm" label="Lý do" required value={reason} maxLength={1000} disabled={busy} onChange={event => setReason(event.target.value)} />
    </form>
  </Drawer>;
}
