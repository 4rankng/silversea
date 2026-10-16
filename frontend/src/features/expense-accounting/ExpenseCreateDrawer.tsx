import { useId, useRef, useState } from 'react';
import { EXPENSE_COST_GROUP_LABELS, expenseAccountingCreateSchema, type ExpenseAccountingCreate, type ExpenseCostGroup, type ExpenseWorkRow } from '@tingting/shared';
import { Drawer } from '../../components/UI';
import { DateField, NumberField, TextField, UuiSelectField } from '../../design-system';
import type { ExpenseAccountingCatalog } from '../../api/expenseAccountingClient';
import { businessDateISO } from '../../lib/format';
import { useExpenseMutations } from './useExpenseAccounting';
import { ExpenseNameSuggestions } from './ExpenseNameSuggestions';
import { ExpenseEvidenceFields } from './ExpenseEvidenceFields';
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
  invoice: string; invoiceDate: string;
}

// PM ruling (2026-10): khi kế toán khai chi phí, "Bên thực chi" mặc định là
// CÔNG TY TRẢ TRỰC TIẾP cho mọi dòng — kể cả đường nhập của Ops — vẫn đổi tay
// sang Nhân viên chi / Nhà cung cấp được.
function blankDraft(group: ExpenseCostGroup): ExpenseDraft {
  return { group, driverOption: '', name: '', amount: '', charge: group === 'DRIVER_ROAD' ? 0 : '', equal: false,
    date: businessDateISO(), payerKind: 'COMPANY', payer: '', supplier: '',
    invoice: '', invoiceDate: '' };
}

/** FB-097 — nhà xe chạy chuyến → NCC mặc định: khớp danh mục theo id
 *  (`trip_carrier_info.external_entity_id` khi external là SUPPLIER), dự phòng
 *  theo tên. Không có nhà xe ngoài / không khớp → để trống cho người chọn tay. */
function matchCarrierSupplier(catalog: ExpenseAccountingCatalog, carrier?: { supplierId: number | null; name: string | null }): string {
  if (!carrier) return '';
  const byId = carrier.supplierId != null ? catalog.suppliers.find(item => item.id === carrier.supplierId) : undefined;
  if (byId) return String(byId.id);
  const wantedName = (carrier.name ?? '').trim().toLocaleLowerCase('vi');
  const byName = wantedName ? catalog.suppliers.find(item => item.name.trim().toLocaleLowerCase('vi') === wantedName) : undefined;
  return byName ? String(byName.id) : '';
}

export function ExpenseCreateDrawer({ work, catalog, initialGroup = 'DRIVER_SHIPMENT', entryScope, carrier, onClose, onSaved }: {
  work: Pick<ExpenseWorkRow, 'tripId' | 'shipmentId' | 'shipmentCode' | 'containerNumber'>;
  initialGroup?: ExpenseCostGroup; entryScope?: 'OPS'; catalog: ExpenseAccountingCatalog;
  carrier?: { supplierId: number | null; name: string | null };
  onClose: () => void; onSaved?: () => void;
}) {
  const formId = useId();
  const { createBatch } = useExpenseMutations();
  const lock = useRef(false);
  const request = useRef<{ payload: string; key: string } | null>(null);
  const startGroup = (MANUAL_GROUPS as readonly string[]).includes(initialGroup) ? initialGroup : 'DRIVER_SHIPMENT';
  const [drafts, setDrafts] = useState<ExpenseDraft[]>([blankDraft(startGroup)]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const busy = createBatch.isPending;
  const close = () => { if (!lock.current) onClose(); };
  const patchDraft = (index: number, patch: Partial<ExpenseDraft>) => {
    setSaved(false);
    setDrafts(rows => rows.map((row, position) => position === index ? { ...row, ...patch } : row));
  };

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
        invoiceNumber: draft.invoice.trim() || null,
        invoiceDate: draft.invoiceDate || null });
      if (!parsed.success) { setError(row('Kiểm tra loại phí, tên, ngày, số tiền và số thực thu. Số thực thu có thể bằng 0 hoặc thấp hơn thực chi.')); return; }
      if ((draft.payerKind === 'USER' && !draft.payer) || (draft.payerKind === 'SUPPLIER' && !draft.supplier)) { setError(row('Chọn người chi hoặc nhà cung cấp.')); return; }
      items.push(parsed.data);
    }
    const payload = JSON.stringify([work.shipmentId, work.tripId, drafts]);
    if (request.current?.payload !== payload) request.current = { payload, key: crypto.randomUUID() };
    lock.current = true; setError('');
    try {
      await createBatch.mutateAsync({ body: { items }, key: request.current.key });
      request.current = null;
      // TC-COSTUX-04 — nhập liên tục: drawer KHÔNG đóng sau lưu; ô của từng
      // khoản làm trống để nhập tiếp, nhóm chi phí / bên thực chi / ngày giữ
      // nguyên. Nút "Đóng" mới kết thúc phiên nhập.
      const kept = drafts[0];
      setDrafts([{ ...blankDraft(kept.group), date: kept.date, payerKind: kept.payerKind }]);
      setSaved(true);
      onSaved?.();
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa rõ kết quả lưu. Giữ nguyên nội dung và thử lại.'); }
    finally { lock.current = false; }
  }
  return <Drawer isOpen onClose={close} title="Thêm khoản chi" subtitle={`${work.shipmentCode ?? '—'} · ${work.containerNumber ?? 'Chung lô'}`} className="expense-accounting-drawer"
    footer={<><button type="button" className="btn btn--secondary" disabled={busy} onClick={close}>Đóng</button><button type="button" className="btn btn--primary" disabled={busy || drafts.length === 0} onClick={() => void save()}>{busy ? 'Đang lưu…' : `Lưu ${drafts.length} khoản chi`}</button></>}>
    <form id={formId} onSubmit={(event) => void save(event)} className="expense-accounting-form">
      {error && <p role="alert" className="expense-accounting-error">{error}</p>}
      {saved && <p role="status" className="expense-accounting-hint">Đã lưu khoản chi.</p>}
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
              // FB-097 — chọn "Nhà cung cấp" thì mặc định là nhà xe đang chạy
              // chuyến (khớp danh mục theo id, dự phòng theo tên). Không có nhà
              // xe ngoài thì để trống cho người chọn tay — không chặn lưu.
              patchDraft(index, next === 'SUPPLIER' ? { payerKind: next, supplier: matchCarrierSupplier(catalog, carrier) } : { payerKind: next });
            }} options={[{ value: 'COMPANY', label: 'Công ty trả trực tiếp' }, { value: 'USER', label: 'Nhân viên chi' }, { value: 'SUPPLIER', label: 'Nhà cung cấp' }]} />
            {draft.payerKind === 'USER' && <UuiSelectField label="Người thực chi" value={draft.payer} disabled={busy} required onChange={event => patchDraft(index, { payer: event.target.value })} options={[{ value: '', label: 'Chọn nhân viên' }, ...(entryScope === 'OPS' ? catalog.opsUsers : catalog.staff).map(item => ({ value: String(item.id), label: item.name }))]} />}
            {draft.payerKind === 'SUPPLIER' && <UuiSelectField label="Nhà cung cấp" value={draft.supplier} disabled={busy} required onChange={event => patchDraft(index, { supplier: event.target.value })} options={[{ value: '', label: 'Chọn nhà cung cấp' }, ...catalog.suppliers.map(item => ({ value: String(item.id), label: item.name }))]} />}
            <ExpenseEvidenceFields variant="invoice-pair"
              invoiceNumber={draft.invoice} onInvoiceNumber={value => patchDraft(index, { invoice: value })}
              invoiceDate={draft.invoiceDate} onInvoiceDate={value => patchDraft(index, { invoiceDate: value })}
              required={false} disabled={busy} />
          </div>
          {draft.payerKind === 'SUPPLIER' && !draft.supplier && <p className="expense-accounting-hint">Chưa có nhà xe trên tuyến này — chọn thủ công.</p>}
        </section>)}
      </div>
      <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => setDrafts(rows => [...rows, blankDraft(rows[rows.length - 1]?.group ?? startGroup)])}>+ Thêm dòng</button>
      <p className="expense-accounting-hint">Lưu khoản chi không ghi tiền vào hoặc ra quỹ. Kế toán lập phiếu khi đã giao nhận tiền.</p>
    </form>
  </Drawer>;
}
