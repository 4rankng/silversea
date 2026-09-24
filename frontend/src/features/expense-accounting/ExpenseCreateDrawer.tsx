import { useId, useRef, useState } from 'react';
import { EXPENSE_COST_GROUP_LABELS, expenseAccountingCreateSchema, type ExpenseCostGroup, type ExpenseWorkRow } from '@tingting/shared';
import { Drawer } from '../../components/UI';
import { DateField, NumberField, TextField, UuiSelectField } from '../../design-system';
import type { ExpenseAccountingCatalog } from '../../api/expenseAccountingClient';
import { businessDateISO } from '../../lib/format';
import { useExpenseMutations } from './useExpenseAccounting';
import { ExpenseNameSuggestions } from './ExpenseNameSuggestions';
import { DRIVER_EXPENSE_OPTIONS, driverExpenseOption } from '../driver/driver-expense-options';
import './ExpenseAccounting.css';

export function ExpenseCreateDrawer({ work, catalog, initialGroup = 'INVOICED_OTHER', entryScope, onClose, onSaved }: {
  work: Pick<ExpenseWorkRow, 'tripId' | 'shipmentCode' | 'containerNumber'>;
  initialGroup?: ExpenseCostGroup; entryScope?: 'OPS'; catalog: ExpenseAccountingCatalog;
  onClose: () => void; onSaved?: () => void;
}) {
  const formId = useId();
  const { create } = useExpenseMutations();
  const lock = useRef(false);
  const request = useRef<{ payload: string; key: string } | null>(null);
  const [group, setGroup] = useState<ExpenseCostGroup>(initialGroup);
  const [type, setType] = useState('');
  const [driverOption, setDriverOption] = useState('');
  const driverGroup = group === 'DRIVER_ROAD' || group === 'DRIVER_SHIPMENT';
  const [name, setName] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [charge, setCharge] = useState<number | ''>(initialGroup === 'DRIVER_ROAD' ? 0 : '');
  const [equal, setEqual] = useState(false);
  const [date, setDate] = useState(businessDateISO);
  const [payerKind, setPayerKind] = useState<'COMPANY' | 'USER' | 'SUPPLIER'>(entryScope === 'OPS' ? 'USER' : 'COMPANY');
  const [payer, setPayer] = useState('');
  const [supplier, setSupplier] = useState('');
  const [invoice, setInvoice] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const busy = create.isPending;
  const close = () => { if (!lock.current) onClose(); };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    if (driverGroup && !driverOption) { setError('Chọn loại chi phí lái xe.'); return; }
    const parsed = expenseAccountingCreateSchema.safeParse({ driverCostType: driverGroup ? driverExpenseOption(driverOption).type : undefined, tripId: work.tripId, expenseTypeCode: type, amount, customerChargeAmount: charge,
      expenseDate: date, costGroup: group, feeName: name, payerKind, payerUserId: payerKind === 'USER' ? Number(payer) || null : null,
      supplierId: payerKind === 'SUPPLIER' ? Number(supplier) || null : null, invoiceNumber: invoice.trim() || null, invoiceDate: invoiceDate || null, note });
    if (!parsed.success) { setError('Kiểm tra loại phí, tên, ngày, số tiền và số thực thu. Số thực thu có thể bằng 0 hoặc thấp hơn thực chi.'); return; }
    if ((payerKind === 'USER' && !payer) || (payerKind === 'SUPPLIER' && !supplier)) { setError('Chọn người chi hoặc nhà cung cấp.'); return; }
    const payload = JSON.stringify(parsed.data);
    if (request.current?.payload !== payload) request.current = { payload, key: crypto.randomUUID() };
    lock.current = true; setError('');
    try { await create.mutateAsync({ body: parsed.data, key: request.current.key }); onSaved?.(); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa rõ kết quả lưu. Giữ nguyên nội dung và thử lại.'); }
    finally { lock.current = false; }
  }
  return <Drawer isOpen onClose={close} title="Thêm khoản chi" subtitle={`${work.shipmentCode ?? '—'} · ${work.containerNumber ?? 'Chung lô'}`} className="expense-accounting-drawer"
    footer={<><button type="button" className="btn btn--secondary" disabled={busy} onClick={close}>Đóng</button><button type="submit" form={formId} className="btn btn--primary" disabled={busy || !work.tripId}>{busy ? 'Đang lưu…' : 'Lưu khoản chi'}</button></>}>
    <form id={formId} onSubmit={(event) => void save(event)} className="expense-accounting-form">
      {error && <p role="alert" className="expense-accounting-error">{error}</p>}
      <div className="expense-accounting-fields">
        <UuiSelectField label="Nhóm chi phí" value={group} disabled={busy} onChange={event => { const next = event.target.value as ExpenseCostGroup; setGroup(next); setType(''); setDriverOption(''); if (next === 'DRIVER_ROAD') { setCharge(0); setEqual(false); } }} options={Object.entries(EXPENSE_COST_GROUP_LABELS).filter(([value]) => entryScope !== 'OPS' || value.startsWith('OPS_')).map(([value, label]) => ({ value, label }))} />
        {driverGroup ? <UuiSelectField label="Loại chi phí lái xe" required value={driverOption} disabled={busy} onChange={event => { const choice = driverExpenseOption(event.target.value); setDriverOption(choice.code); setType(choice.type); setName(choice.label); if (amount === '' && choice.amount !== undefined) setAmount(choice.amount); }} options={[{ value: '', label: 'Chọn loại chi phí' }, ...DRIVER_EXPENSE_OPTIONS.filter(item => item.group === group).map(item => ({ value: item.code, label: item.label }))]} /> : <UuiSelectField label="Loại phí" required value={type} disabled={busy} onChange={event => { setType(event.target.value); if (!name) setName(catalog.expenseTypes.find(item => item.code === event.target.value)?.name ?? ''); }} options={[{ value: '', label: 'Chọn loại phí' }, ...catalog.expenseTypes.map(item => ({ value: item.code, label: item.name }))]} />}
        <NumberField controlSize="sm" label="Thực chi (VND)" required value={amount} disabled={busy} min={1} step={1} onChange={next => { setAmount(next); if (equal) setCharge(next); }} />
        <NumberField controlSize="sm" label="Thực thu — thu khách (VND)" required value={charge} disabled={busy || equal || group === 'DRIVER_ROAD'} min={0} step={1} onChange={setCharge} />
      </div>
      <label className="expense-accounting-check"><input type="checkbox" checked={equal} disabled={busy || group === 'DRIVER_ROAD'} onChange={event => { setEqual(event.target.checked); if (event.target.checked) setCharge(amount); }} /> Nhập Thu và Trả bằng nhau</label>
      <TextField controlSize="sm" label="Tên khoản chi" value={name} required maxLength={200} disabled={busy} onChange={event => setName(event.target.value)} />
      <ExpenseNameSuggestions group={group} disabled={busy} onChoose={setName} />
      <div className="expense-accounting-fields">
        <DateField controlSize="sm" label="Ngày chi" value={date} required disabled={busy} onChange={setDate} />
        <UuiSelectField label="Bên thực chi" value={payerKind} disabled={busy || entryScope === 'OPS'} onChange={event => setPayerKind(event.target.value as typeof payerKind)} options={[{ value: 'COMPANY', label: 'Công ty trả trực tiếp' }, { value: 'USER', label: 'Nhân viên chi' }, { value: 'SUPPLIER', label: 'Nhà cung cấp' }]} />
        {payerKind === 'USER' && <UuiSelectField label="Người thực chi" value={payer} disabled={busy} required onChange={event => setPayer(event.target.value)} options={[{ value: '', label: 'Chọn nhân viên' }, ...(entryScope === 'OPS' ? catalog.opsUsers : catalog.staff).map(item => ({ value: String(item.id), label: item.name }))]} />}
        {payerKind === 'SUPPLIER' && <UuiSelectField label="Nhà cung cấp" value={supplier} disabled={busy} required onChange={event => setSupplier(event.target.value)} options={[{ value: '', label: 'Chọn nhà cung cấp' }, ...catalog.suppliers.map(item => ({ value: String(item.id), label: item.name }))]} />}
        <TextField controlSize="sm" label="Số hóa đơn" value={invoice} maxLength={100} disabled={busy} onChange={event => setInvoice(event.target.value)} />
        <DateField controlSize="sm" label="Ngày hóa đơn" value={invoiceDate} disabled={busy} onChange={setInvoiceDate} />
      </div>
      <TextField controlSize="sm" label="Ghi chú khoản chi" value={note} disabled={busy} maxLength={2000} onChange={event => setNote(event.target.value)} />
      <p className="expense-accounting-hint">Lưu khoản chi không ghi tiền vào hoặc ra quỹ. Kế toán lập phiếu khi đã giao nhận tiền.</p>
    </form>
  </Drawer>;
}
