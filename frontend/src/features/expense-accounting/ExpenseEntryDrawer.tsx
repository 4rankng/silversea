import { useId, useRef, useState } from 'react';
import { DriverIncidentalCostType, DRIVER_INCIDENTAL_COST_LABELS, EXPENSE_COST_GROUP_LABELS, expenseAccountingUpdateSchema, type ExpenseAccountingEntry, type ExpenseCostGroup } from '@tingting/shared';
import { Drawer } from '../../components/UI';
import { DateField, NumberField, TextField, UuiSelectField } from '../../design-system';
import { ExpenseProofs } from './ExpenseProofs';
import { ExpenseWorkLink } from './ExpenseWorkLink';
import { formatDate } from '../../lib/format';
import { useExpenseMutations } from './useExpenseAccounting';
import { expenseMoney } from './expense-accounting-model';

export function ExpenseEntryDrawer({ entry, staff, chargeOnly = false, onClose }: {
  entry: ExpenseAccountingEntry;
  staff: Array<{ id: number; name: string }>;
  chargeOnly?: boolean;
  onClose: () => void;
}) {
  const id = useId();
  const { update } = useExpenseMutations();
  const lock = useRef(false);
  const [amount, setAmount] = useState<number | ''>(entry.amount);
  const [charge, setCharge] = useState<number | ''>(entry.customerChargeAmount ?? '');
  const [equal, setEqual] = useState(false);
  const [group, setGroup] = useState<ExpenseCostGroup | ''>(entry.costGroup ?? '');
  const [name, setName] = useState(entry.feeName);
  const [driverCostType, setDriverCostType] = useState(Object.values(DriverIncidentalCostType).includes(entry.expenseTypeCode as DriverIncidentalCostType) ? entry.expenseTypeCode : '');
  const [date, setDate] = useState(entry.expenseDate);
  const [invoice, setInvoice] = useState(entry.invoiceNumber ?? '');
  const [invoiceDate, setInvoiceDate] = useState(entry.invoiceDate ?? '');
  const [recoveryNote, setRecoveryNote] = useState(entry.recoveryNote ?? '');
  const [payerKind, setPayerKind] = useState(entry.payerKind ?? 'USER');
  const [payerId, setPayerId] = useState(String(entry.payerUserId ?? ''));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const blocked = entry.locked || entry.status !== 'RECORDED';
  const disabled = blocked || update.isPending;
  const close = () => { if (!lock.current) onClose(); };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (disabled || lock.current) return;
    const payload = expenseAccountingUpdateSchema.safeParse({
      expectedVersion: entry.version, reason, ...(charge !== '' ? { customerChargeAmount: charge } : {}),
      recoveryNote: recoveryNote.trim() || null,
      ...(!chargeOnly ? { ...(entry.sourceKind === 'DRIVER' && driverCostType ? { driverCostType } : {}), amount, costGroup: group || undefined, feeName: name, expenseDate: date,
        invoiceNumber: invoice.trim() || null, invoiceDate: invoiceDate || null,
        payerKind, payerUserId: payerKind === 'USER' ? Number(payerId) || null : null } : {}),
    });
    if (!payload.success) { setError('Kiểm tra số tiền, tên khoản chi, ngày hợp lệ và lý do điều chỉnh. Số thu khách có thể bằng 0.'); return; }
    if (!chargeOnly && payerKind === 'USER' && !payerId) { setError('Chọn người thực chi.'); return; }
    lock.current = true; setError(null);
    try { await update.mutateAsync({ entry, body: payload.data }); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa lưu được điều chỉnh. Nội dung vẫn được giữ.'); }
    finally { lock.current = false; }
  }

  return <Drawer isOpen onClose={close} title={entry.feeName} subtitle={`${entry.shipmentCode} · ${entry.containerNumber ?? 'Phí chung lô'}`}
    className="expense-accounting-drawer" footer={<><button type="button" className="btn btn--secondary" onClick={close} disabled={update.isPending}>Đóng</button>
      {!blocked && <button type="submit" form={id} className="btn btn--primary" disabled={disabled}>{update.isPending ? 'Đang lưu…' : 'Lưu điều chỉnh'}</button>}</>}>
    <form id={id} onSubmit={(event) => void save(event)} className="expense-accounting-form">
      {blocked && <p role="status">Khoản đã khóa hoặc hủy. Xem lịch sử; không sửa đè nguồn tài chính.</p>}
      {error && <p role="alert" className="expense-accounting-error">{error}</p>}
      <dl className="expense-accounting-facts">
        <div><dt>Người thực chi</dt><dd>{entry.payerName ?? 'Chưa xác định'}</dd></div>
        <div><dt>Ngày đối chiếu</dt><dd>{entry.confirmedAt ? formatDate(entry.confirmedAt) : 'Chưa đối chiếu'}</dd></div>
        {entry.canViewPayments && <><div><dt>Đã thu</dt><dd>{expenseMoney(entry.receivedAmount)}</dd></div><div><dt>Đã trả</dt><dd>{expenseMoney(entry.paidAmount)}</dd></div></>}
      </dl>
      <div className="expense-accounting-fields">
        <NumberField controlSize="sm" label="Thực chi (VND)" value={amount} disabled={disabled || chargeOnly} min={1} max={999_999_999_999_999} step={1} required onChange={(next) => { setAmount(next); if (equal) setCharge(next); }} />
        <NumberField controlSize="sm" label="Thực thu — thu khách (VND)" value={charge} disabled={disabled || equal} min={0} max={999_999_999_999_999} step={1} required={chargeOnly} onChange={setCharge} helpText="Khoản tính cho khách; không phải tiền đã thu." />
      </div>
      {!chargeOnly && <label className="expense-accounting-check"><input type="checkbox" checked={equal} disabled={disabled} onChange={(event) => { setEqual(event.target.checked); if (event.target.checked) setCharge(amount); }} /> Thu bằng trả</label>}
      {!chargeOnly && <div className="expense-accounting-fields">
        {entry.sourceKind === 'DRIVER' && <UuiSelectField label="Loại chi phí lái xe" value={driverCostType} disabled={disabled} onChange={event => setDriverCostType(event.target.value)} options={[{ value: '', label: 'Giữ loại phí hiện tại' }, ...Object.values(DriverIncidentalCostType).filter(type => type !== DriverIncidentalCostType.FUEL).map(value => ({ value, label: DRIVER_INCIDENTAL_COST_LABELS[value] }))]} />}
        <UuiSelectField label="Nhóm chi phí" value={group} disabled={disabled} onChange={(event) => setGroup(event.target.value as ExpenseCostGroup)} options={[{ value: '', label: 'Chọn nhóm chi phí' }, ...Object.entries(EXPENSE_COST_GROUP_LABELS).map(([value, label]) => ({ value, label }))]} />
        <TextField controlSize="sm" label="Tên khoản chi" value={name} disabled={disabled} required maxLength={200} onChange={(event) => setName(event.target.value)} />
        <DateField controlSize="sm" label="Ngày chi" value={date} disabled={disabled} required onChange={setDate} />
        <UuiSelectField label="Bên thực chi" value={payerKind} disabled={disabled} onChange={(event) => setPayerKind(event.target.value as typeof payerKind)} options={[{ value: 'USER', label: 'Nhân viên chi' }, { value: 'COMPANY', label: 'Công ty trả trực tiếp' }, ...(entry.payerKind === 'SUPPLIER' ? [{ value: 'SUPPLIER', label: 'Nhà cung cấp' }] : [])]} />
        {payerKind === 'USER' && <UuiSelectField label="Người thực chi" value={payerId} disabled={disabled} onChange={(event) => setPayerId(event.target.value)} options={[{ value: '', label: 'Chọn nhân viên' }, ...staff.map(item => ({ value: String(item.id), label: item.name })), ...(entry.payerUserId && !staff.some(item => item.id === entry.payerUserId) ? [{ value: String(entry.payerUserId), label: entry.payerName ?? `Nhân viên ${entry.payerUserId}` }] : [])]} />}
        <TextField controlSize="sm" label="Số hóa đơn" value={invoice} disabled={disabled} maxLength={100} onChange={(event) => setInvoice(event.target.value)} />
        <DateField controlSize="sm" label="Ngày hóa đơn" value={invoiceDate} disabled={disabled} onChange={setInvoiceDate} />
      </div>}
      <TextField controlSize="sm" label="Ghi chú thu khách" value={recoveryNote} disabled={disabled} maxLength={1000} onChange={(event) => setRecoveryNote(event.target.value)} />
      {!blocked && <TextField controlSize="sm" label="Lý do điều chỉnh" value={reason} disabled={disabled} required maxLength={1000} onChange={(event) => setReason(event.target.value)} />}
      {(entry.note || entry.customerNotes || entry.operationalNotes || entry.driverNotes) && <dl className="expense-accounting-notes">
        {entry.note && <div><dt>Khoản chi</dt><dd>{entry.note}</dd></div>}{entry.customerNotes && <div><dt>CUS</dt><dd>{entry.customerNotes}</dd></div>}
        {entry.operationalNotes && <div><dt>Điều vận</dt><dd>{entry.operationalNotes}</dd></div>}{entry.driverNotes && <div><dt>Lái xe</dt><dd>{entry.driverNotes}</dd></div>}
      </dl>}
      {!chargeOnly && entry.tripId === null && entry.status === 'RECORDED' && <ExpenseWorkLink entry={entry} onLinked={onClose} />}
      <ExpenseProofs entry={entry} canUpload={!chargeOnly && entry.status === 'RECORDED'} />
    </form>
  </Drawer>;
}
