import { useId, useRef, useState } from 'react';
import { EXPENSE_COST_GROUP_LABELS, expenseAccountingCreateSchema, type ExpenseAccountingCreate, type ExpenseCostGroup, type ExpenseWorkRow } from '@tingting/shared';
import { Drawer } from '../../components/UI';
import { DateField, NumberField, TextField, UuiSelectField } from '../../design-system';
import type { ExpenseAccountingCatalog } from '../../api/expenseAccountingClient';
import { businessDateISO } from '../../lib/format';
import { useExpenseMutations } from './useExpenseAccounting';
import { ExpenseNameSuggestions } from './ExpenseNameSuggestions';
import { ExpenseEvidenceFields, type ExpenseEvidenceKind } from './ExpenseEvidenceFields';
import { DRIVER_EXPENSE_OPTIONS, driverExpenseOption } from '../driver/driver-expense-options';
import './ExpenseAccounting.css';

// Card 20261005 — nhập tay chỉ còn 2 nhóm (PM): báo cáo và dữ liệu cũ vẫn đọc
// đủ 8 giá trị EXPENSE_COST_GROUPS, chỉ form không chào bán nhóm khác nữa.
const MANUAL_GROUPS = ['DRIVER_SHIPMENT', 'DRIVER_ROAD'] as const;
const GROUP_OPTIONS = MANUAL_GROUPS.map(value => ({ value, label: EXPENSE_COST_GROUP_LABELS[value] }));
type PayerKind = 'COMPANY' | 'USER' | 'SUPPLIER';

/** One draft row = one future `ExpenseAccountingCreate`; the batch is saved all-or-nothing. */
interface ExpenseDraft {
  group: ExpenseCostGroup; driverOption: string; name: string;
  amount: number | ''; charge: number | ''; equal: boolean; date: string;
  payerKind: PayerKind; payer: string; supplier: string;
  evidenceKind: ExpenseEvidenceKind; invoice: string; invoiceDate: string; note: string;
}

// PM ruling (2026-10): khi kế toán khai chi phí, "Bên thực chi" mặc định là
// CÔNG TY TRẢ TRỰC TIẾP cho mọi dòng — kể cả đường nhập của Ops — vẫn đổi tay
// sang Nhân viên chi / Nhà cung cấp được. Phiếu thu là mặc định chứng từ vì đa
// số chi phí lô hàng không có hóa đơn VAT (đồng quy ước với màn hình lái xe).
function blankDraft(group: ExpenseCostGroup): ExpenseDraft {
  return { group, driverOption: '', name: '', amount: '', charge: group === 'DRIVER_ROAD' ? 0 : '', equal: false,
    date: businessDateISO(), payerKind: 'COMPANY', payer: '', supplier: '',
    evidenceKind: 'RECEIPT', invoice: '', invoiceDate: '', note: '' };
}

export function ExpenseCreateDrawer({ work, catalog, initialGroup = 'DRIVER_SHIPMENT', entryScope, onClose, onSaved }: {
  work: Pick<ExpenseWorkRow, 'tripId' | 'shipmentId' | 'shipmentCode' | 'containerNumber'>;
  initialGroup?: ExpenseCostGroup; entryScope?: 'OPS'; catalog: ExpenseAccountingCatalog;
  onClose: () => void; onSaved?: () => void;
}) {
  const formId = useId();
  const { createBatch } = useExpenseMutations();
  const lock = useRef(false);
  const request = useRef<{ payload: string; key: string } | null>(null);
  const startGroup = (MANUAL_GROUPS as readonly string[]).includes(initialGroup) ? initialGroup : 'DRIVER_SHIPMENT';
  const [drafts, setDrafts] = useState<ExpenseDraft[]>([blankDraft(startGroup)]);
  const [error, setError] = useState('');
  const busy = createBatch.isPending;
  const close = () => { if (!lock.current) onClose(); };
  const patchDraft = (index: number, patch: Partial<ExpenseDraft>) =>
    setDrafts(rows => rows.map((row, position) => position === index ? { ...row, ...patch } : row));

  async function save(event?: React.FormEvent) {
    event?.preventDefault();
    if (lock.current) return;
    const items: ExpenseAccountingCreate[] = [];
    for (const [index, draft] of drafts.entries()) {
      const row = (message: string) => `Dòng ${index + 1}: ${message}`;
      if (!draft.driverOption) { setError(row('Chọn loại chi phí lái xe.')); return; }
      const option = driverExpenseOption(draft.driverOption);
      const parsed = expenseAccountingCreateSchema.safeParse({ driverCostType: option.type, tripId: work.tripId, shipmentId: work.shipmentId,
        expenseTypeCode: option.type, amount: draft.amount, customerChargeAmount: draft.charge,
        expenseDate: draft.date, costGroup: draft.group, feeName: draft.name, payerKind: draft.payerKind,
        payerUserId: draft.payerKind === 'USER' ? Number(draft.payer) || null : null,
        supplierId: draft.payerKind === 'SUPPLIER' ? Number(draft.supplier) || null : null,
        invoiceNumber: draft.evidenceKind === 'INVOICE' ? draft.invoice.trim() || null : undefined,
        invoiceDate: draft.evidenceKind === 'INVOICE' ? draft.invoiceDate || null : undefined, note: draft.note });
      if (!parsed.success) { setError(row('Kiểm tra loại phí, tên, ngày, số tiền và số thực thu. Số thực thu có thể bằng 0 hoặc thấp hơn thực chi.')); return; }
      if ((draft.payerKind === 'USER' && !draft.payer) || (draft.payerKind === 'SUPPLIER' && !draft.supplier)) { setError(row('Chọn người chi hoặc nhà cung cấp.')); return; }
      items.push(parsed.data);
    }
    const payload = JSON.stringify([work.shipmentId, work.tripId, drafts]);
    if (request.current?.payload !== payload) request.current = { payload, key: crypto.randomUUID() };
    lock.current = true; setError('');
    try { await createBatch.mutateAsync({ body: { items }, key: request.current.key }); setDrafts([]); onSaved?.(); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa rõ kết quả lưu. Giữ nguyên nội dung và thử lại.'); }
    finally { lock.current = false; }
  }
  return <Drawer isOpen onClose={close} title="Thêm khoản chi" subtitle={`${work.shipmentCode ?? '—'} · ${work.containerNumber ?? 'Chung lô'}`} className="expense-accounting-drawer"
    footer={<><button type="button" className="btn btn--secondary" disabled={busy} onClick={close}>Đóng</button><button type="button" className="btn btn--primary" disabled={busy || drafts.length === 0} onClick={() => void save()}>{busy ? 'Đang lưu…' : `Lưu ${drafts.length} khoản chi`}</button></>}>
    <form id={formId} onSubmit={(event) => void save(event)} className="expense-accounting-form">
      {error && <p role="alert" className="expense-accounting-error">{error}</p>}
      <div className="expense-accounting-drafts">
        {drafts.map((draft, index) => <section className="expense-accounting-draft-row" key={index}>
          <header className="expense-accounting-draft-head"><h4>Khoản {index + 1}</h4>
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setDrafts(rows => rows.filter((_, position) => position !== index))}>Xóa dòng</button></header>
          <div className="expense-accounting-fields">
            <UuiSelectField label="Nhóm chi phí" value={draft.group} disabled={busy} onChange={event => { const next = event.target.value as ExpenseCostGroup; patchDraft(index, next === 'DRIVER_ROAD' ? { group: next, driverOption: '', name: '', charge: 0, equal: false } : { group: next, driverOption: '', name: '' }); }} options={GROUP_OPTIONS} />
            <UuiSelectField label="Loại chi phí lái xe" required value={draft.driverOption} disabled={busy} onChange={event => { const choice = driverExpenseOption(event.target.value); patchDraft(index, { driverOption: choice.code, name: choice.label, ...(draft.amount === '' && choice.amount !== undefined ? { amount: choice.amount } : {}) }); }} options={[{ value: '', label: 'Chọn loại chi phí' }, ...DRIVER_EXPENSE_OPTIONS.filter(item => item.group === draft.group).map(item => ({ value: item.code, label: item.label }))]} />
            <NumberField controlSize="sm" label="Thực chi (VND)" required value={draft.amount} disabled={busy} min={-999_999_999_999_999} step={1} onChange={next => patchDraft(index, { amount: next, ...(draft.equal ? { charge: next } : {}) })} />
            <NumberField controlSize="sm" label="Thực thu — thu khách (VND)" required value={draft.charge} disabled={busy || draft.equal || draft.group === 'DRIVER_ROAD'} min={0} step={1} onChange={next => patchDraft(index, { charge: next })} />
          </div>
          <label className="expense-accounting-check"><input type="checkbox" checked={draft.equal} disabled={busy || draft.group === 'DRIVER_ROAD'} onChange={event => { const checked = event.target.checked; patchDraft(index, { equal: checked, ...(checked ? { charge: draft.amount } : {}) }); }} /> Nhập Thu và Trả bằng nhau</label>
          <TextField controlSize="sm" label="Tên khoản chi" value={draft.name} required maxLength={200} disabled={busy} onChange={event => patchDraft(index, { name: event.target.value })} />
          <ExpenseNameSuggestions group={draft.group} disabled={busy} onChoose={name => patchDraft(index, { name })} />
          <div className="expense-accounting-fields">
            <DateField controlSize="sm" label="Ngày chi" value={draft.date} required disabled={busy} onChange={value => patchDraft(index, { date: value })} />
            <UuiSelectField label="Bên thực chi" value={draft.payerKind} disabled={busy} onChange={event => {
              const next = event.target.value as PayerKind;
              // Tự điền nhà xe theo tuyến của dòng đang khai (routeName khớp số
              // Booking/Bill của lô). Không có nhà xe trên tuyến này thì để trống
              // cho người chọn tay — không chặn lưu.
              const carrier = catalog.carriers.find(item => item.routeName != null && work.shipmentCode != null
                && item.routeName.trim().toLocaleLowerCase('vi') === work.shipmentCode.trim().toLocaleLowerCase('vi'));
              patchDraft(index, next === 'SUPPLIER' ? { payerKind: next, supplier: carrier ? String(carrier.id) : '' } : { payerKind: next });
            }} options={[{ value: 'COMPANY', label: 'Công ty trả trực tiếp' }, { value: 'USER', label: 'Nhân viên chi' }, { value: 'SUPPLIER', label: 'Nhà cung cấp' }]} />
            {draft.payerKind === 'USER' && <UuiSelectField label="Người thực chi" value={draft.payer} disabled={busy} required onChange={event => patchDraft(index, { payer: event.target.value })} options={[{ value: '', label: 'Chọn nhân viên' }, ...(entryScope === 'OPS' ? catalog.opsUsers : catalog.staff).map(item => ({ value: String(item.id), label: item.name }))]} />}
            {draft.payerKind === 'SUPPLIER' && <UuiSelectField label="Nhà cung cấp" value={draft.supplier} disabled={busy} required onChange={event => patchDraft(index, { supplier: event.target.value })} options={[{ value: '', label: 'Chọn nhà cung cấp' }, ...catalog.suppliers.map(item => ({ value: String(item.id), label: item.name }))]} />}
            <ExpenseEvidenceFields kind={draft.evidenceKind} onKindChange={kind => patchDraft(index, { evidenceKind: kind })}
              invoiceNumber={draft.invoice} onInvoiceNumber={value => patchDraft(index, { invoice: value })}
              invoiceDate={draft.invoiceDate} onInvoiceDate={value => patchDraft(index, { invoiceDate: value })}
              required={false} disabled={busy} />
          </div>
          {draft.payerKind === 'SUPPLIER' && !draft.supplier && <p className="expense-accounting-hint">Chưa có nhà xe trên tuyến này — chọn thủ công.</p>}
          <TextField controlSize="sm" label="Ghi chú khoản chi" value={draft.note} disabled={busy} maxLength={2000} onChange={event => patchDraft(index, { note: event.target.value })} />
        </section>)}
      </div>
      <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => setDrafts(rows => [...rows, blankDraft(rows[rows.length - 1]?.group ?? startGroup)])}>+ Thêm dòng</button>
      <p className="expense-accounting-hint">Lưu khoản chi không ghi tiền vào hoặc ra quỹ. Kế toán lập phiếu khi đã giao nhận tiền.</p>
    </form>
  </Drawer>;
}
