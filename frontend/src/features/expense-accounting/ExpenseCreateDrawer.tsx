import { useId, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { sumExcludingNegative, DRIVER_INCIDENTAL_COST_LABELS, EXPENSE_COST_GROUP_LABELS, expenseAccountingCreateSchema, type ExpenseAccountingCreate, type ExpenseCostGroup, type ExpenseWorkRow } from '@tingting/shared';
import { Drawer } from '../../components/UI';
import { DateField, NumberField, TextField, UuiSelectField } from '../../design-system';
import type { ExpenseAccountingCatalog } from '../../api/expenseAccountingClient';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { getPhoiPhieuChiHo, getPhoiPhieuTienDuong } from '../../api/phoiPhieuClient';
import { qk } from '../../api/keys';
import { businessDateISO, formatMoney } from '../../lib/format';
import { useExpenseMutations } from './useExpenseAccounting';
import { ExpenseNameSuggestions } from './ExpenseNameSuggestions';
import { ExpenseEvidenceFields } from './ExpenseEvidenceFields';
import { DRIVER_EXPENSE_OPTIONS, driverExpenseOption } from '../driver/driver-expense-options';
import './ExpenseAccounting.css';

// Card 20261005 — nhập tay chỉ còn 2 nhóm (PM): báo cáo và dữ liệu cũ vẫn đọc
// đủ 8 giá trị EXPENSE_COST_GROUPS, chỉ form không chào bán nhóm khác nữa.
// Card 191026160000 — the two choices render as the mockup's side-by-side tab
// pair ("Tiền đường | Chi phí lô hàng"), not a dropdown.
const MANUAL_GROUPS = ['DRIVER_SHIPMENT', 'DRIVER_ROAD'] as const;
type PayerKind = 'COMPANY' | 'USER' | 'SUPPLIER';

/** One draft row = one future `ExpenseAccountingCreate`; the batch is saved all-or-nothing. */
interface ExpenseDraft {
  group: ExpenseCostGroup; driverOption: string; name: string;
  amount: number | ''; charge: number | ''; equal: boolean; date: string;
  payerKind: PayerKind; payer: string; supplier: string;
  invoice: string; invoiceDate: string;
}

/** One tickable row of the sub-table ("bảng con") — the mapped view over the
 *  shared tiền-đường / chi-hộ detail cache. */
interface PhoiExistingRow {
  id: number;
  version: number;
  confirmed: boolean;
  primary: string;
  secondary: string;
  date: string;
  amount: number;
  thu: number | null;
}

/** The raw detail shapes the two dialogs cache under the SHARED query keys. */
type PhoiExistingRaw =
  | Awaited<ReturnType<typeof getPhoiPhieuTienDuong>>
  | Awaited<ReturnType<typeof getPhoiPhieuChiHo>>;

// PM ruling (2026-10): khi kế toán khai chi phí, "Bên thực chi" mặc định là
// CÔNG TY TRẢ TRỰC TIẾP cho mọi dòng — kể cả đường nhập của Ops — vẫn đổi tay
// sang Nhân viên chi / Nhà cung cấp được.
function blankDraft(group: ExpenseCostGroup): ExpenseDraft {  return { group, driverOption: '', name: '', amount: '', charge: group === 'DRIVER_ROAD' ? 0 : '', equal: false,
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
  const queryClient = useQueryClient();
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
  // Card 191026160000 — the group pick is the mockup's TWO side-by-side
  // choices ("Tiền đường | Chi phí lô hàng"). One drawer-level tab pair
  // replaces the per-draft dropdown: switching re-targets every open draft,
  // new rows inherit it.
  const [group, setGroup] = useState<ExpenseCostGroup>(startGroup);
  function switchGroup(next: ExpenseCostGroup) {
    setGroup(next);
    setSaved(false);
    setDrafts(rows => rows.map(row => ({ ...row, group: next, driverOption: '', name: '',
      ...(next === 'DRIVER_ROAD' ? { charge: 0, equal: false } : {}) })));
  }
  const groupTabs: Array<{ value: ExpenseCostGroup; label: string }> = [
    { value: 'DRIVER_ROAD', label: EXPENSE_COST_GROUP_LABELS.DRIVER_ROAD },
    { value: 'DRIVER_SHIPMENT', label: EXPENSE_COST_GROUP_LABELS.DRIVER_SHIPMENT },
  ];

  // ── Card 191026160000 — the type's own sub-table ("bảng con"): picking a
  // tab lists the trip's EXISTING entries of THAT type under the form, each
  // tickable in the STT cell; Lưu duyệt confirms the ticked ones in ONE call.
  // Confirms ride the same endpoint the tiền-đường tick uses, so duyệt here
  // and duyệt there cannot disagree.
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState('');
  // NOTE: these keys are SHARED with the tiền-đường / chi-hộ dialogs (same
  // read, one cache). The dialog stores the RAW detail under the key, so the
  // shape mapping must live in `select` — putting it in queryFn would let the
  // cached raw object land in `data` un-mapped and crash the sub-table render.
  const existingQuery = useQuery<PhoiExistingRaw, Error, PhoiExistingRow[]>({
    queryKey: group === 'DRIVER_ROAD'
      ? qk.phoiPhieu.tienDuong(work.tripId ?? 0)
      : qk.phoiPhieu.chiHo(work.tripId ?? 0),
    queryFn: () => group === 'DRIVER_ROAD'
      ? getPhoiPhieuTienDuong(work.tripId!)
      : getPhoiPhieuChiHo(work.tripId!),
    enabled: work.tripId != null,
    select: (detail) => {
      const rows: Array<Record<string, unknown>> = (detail as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? [];
      if (group === 'DRIVER_ROAD') {
        return rows.map(row => ({
          id: row.sourceId as number,
          version: row.version as number,
          confirmed: Boolean(row.confirmed),
          // Same label rule the tiền-đường dialog prints: the Ops custom name
          // first, else the cost-type's Vietnamese label, never the raw code.
          primary: (row.feeName as string)
            || DRIVER_INCIDENTAL_COST_LABELS[row.costType as keyof typeof DRIVER_INCIDENTAL_COST_LABELS]
            || (row.costType as string) || '—',
          secondary: (row.driverName as string | null) ?? '—',
          date: (row.occurredAt as string | null) ?? '—',
          amount: row.amount as number,
          thu: null as number | null,
        }));
      }
      return rows
        .filter(row => row.sourceKind !== 'TRIP')
        .map(row => ({
          id: row.entryId as number,
          version: row.version as number,
          confirmed: Boolean(row.confirmed),
          primary: (row.feeName as string) ?? '—',
          secondary: (row.invoiceNumber as string | null) ?? '—',
          date: '—',
          amount: row.amountTra as number,
          thu: (row.amountThu as number | null) ?? null,
        }));
    },
  });
  const existingRows = useMemo(() => existingQuery.data ?? [], [existingQuery.data]);
  const tickable = existingRows.filter(row => !row.confirmed);
  const tickedRows = existingRows.filter(row => ticked.has(row.id));
  const tickedTotal = sumExcludingNegative(tickedRows, row => row.amount);

  function toggleTick(id: number) {
    setTicked(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllTicks() {
    setTicked(current => current.size === tickable.length && tickable.length > 0
      ? new Set<number>()
      : new Set(tickable.map(row => row.id)));
  }

  async function approveTicked() {
    if (approving || tickedRows.length === 0 || work.tripId == null) return;
    setApproving(true);
    setApproveError('');
    try {
      await expenseAccountingClient.confirm(tickedRows.map(row => ({
        sourceKind: (group === 'DRIVER_ROAD' ? 'DRIVER' : 'OPS') as 'DRIVER' | 'OPS',
        sourceId: row.id, expectedVersion: row.version,
      })));
      setTicked(new Set());
      await queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.rowsAll });
      onSaved?.();
    } catch (cause) {
      setApproveError(cause instanceof Error ? cause.message : 'Không duyệt được các dòng đã chọn.');
    } finally {
      setApproving(false);
    }
  }


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
      <div className="expense-accounting-group-tabs" role="tablist" aria-label="Loại chi phí">
        {groupTabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={group === tab.value}
            className={group === tab.value ? 'expense-group-tab is-active' : 'expense-group-tab'}
            disabled={busy}
            onClick={() => switchGroup(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="expense-accounting-drafts">
        {drafts.map((draft, index) => <section className="expense-accounting-draft-row" key={index}>
          <header className="expense-accounting-draft-head"><h4>Khoản {index + 1}</h4>
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setDrafts(rows => rows.filter((_, position) => position !== index))}>Xóa dòng</button></header>
          <div className="expense-accounting-fields">
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
      {(work.tripId != null) && (
        <section className="expense-existing" aria-label={`Các khoản ${group === 'DRIVER_ROAD' ? 'tiền đường' : 'chi phí lô hàng'} đã có`}>
          <h4>{group === 'DRIVER_ROAD' ? 'Các khoản tiền đường đã có' : 'Các khoản chi phí lô hàng đã có'}</h4>
          {existingQuery.isPending && <p role="status">Đang tải các khoản đã có…</p>}
          {/* A read failure (e.g. a role without the phoi-phieu grant on a
              non-accountant surface) never blocks the create form — the
              sub-table is a reviewer, not a dependency. */}
          {existingQuery.isError && <p className="expense-accounting-hint">Không tải được các khoản đã có của loại này.</p>}
          {existingQuery.isSuccess && existingRows.length === 0 && (
            <p className="expense-accounting-hint">Chưa có khoản nào của loại này trên chuyến.</p>
          )}
          {existingRows.length > 0 && <div className="record-table-wrap">
            <table className="record-table ops-table expense-existing-table">
              <thead><tr>
                <th className="expense-existing-col--tick">
                  <input
                    type="checkbox"
                    aria-label={ticked.size === tickable.length && tickable.length > 0 ? 'Bỏ chọn tất cả' : 'Chọn tất cả dòng chưa duyệt'}
                    checked={ticked.size === tickable.length && tickable.length > 0}
                    disabled={tickable.length === 0 || approving}
                    onChange={toggleAllTicks}
                  />
                </th>
                <th>STT</th>
                <th>{group === 'DRIVER_ROAD' ? 'Khoản lái xe nhập' : 'Nội dung phí'}</th>
                {group === 'DRIVER_ROAD' && <th>Ngày</th>}
                {group === 'DRIVER_ROAD' && <th>Lái xe</th>}
                {group !== 'DRIVER_ROAD' && <th>Hóa đơn</th>}
                {group !== 'DRIVER_ROAD' && <th>Số tiền thu</th>}
                <th>Số tiền trả</th>
                <th>Trạng thái</th>
              </tr></thead>
              <tbody>
                {existingRows.map((row, index) => (
                  <tr key={row.id} data-confirmed={row.confirmed || undefined}>
                    <td className="expense-existing-col--tick">
                      <input
                        type="checkbox"
                        aria-label={`Chọn dòng ${index + 1}`}
                        checked={ticked.has(row.id)}
                        disabled={row.confirmed || approving}
                        onChange={() => toggleTick(row.id)}
                      />
                    </td>
                    {/* Card 191026160000 — the tick lives in the STT cell of
                        the sub-table, per the mockup. */}
                    <td>{index + 1}</td>
                    <td>{row.primary}</td>
                    {group === 'DRIVER_ROAD' && <td>{row.date}</td>}
                    {group === 'DRIVER_ROAD' && <td>{row.secondary}</td>}
                    {group !== 'DRIVER_ROAD' && <td>{row.secondary}</td>}
                    {group !== 'DRIVER_ROAD' && <td>{row.thu != null ? `${formatMoney(row.thu)} ₫` : '—'}</td>}
                    <td>{formatMoney(row.amount)} ₫</td>
                    <td>{row.confirmed ? 'Đã duyệt' : 'Chưa duyệt'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
          {existingRows.length > 0 && <div className="expense-existing-bar" role="region" aria-label="Duyệt các dòng đã chọn">
            <p role="status">
              {tickedRows.length === 0
                ? `${tickable.length} dòng chưa duyệt`
                : `Đã chọn ${tickedRows.length} dòng · Tổng ${formatMoney(tickedTotal)} ₫`}
            </p>
            {approveError && <p role="alert">{approveError}</p>}
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={approving || tickedRows.length === 0}
              title={tickedRows.length === 0 ? 'Tích các dòng chưa duyệt để lưu duyệt hàng loạt' : undefined}
              onClick={() => void approveTicked()}
            >
              {approving ? 'Đang duyệt…' : `Lưu duyệt (${tickedRows.length})`}
            </button>
          </div>}
        </section>
      )}
      <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => setDrafts(rows => [...rows, blankDraft(group)])}>+ Thêm dòng</button>
      <p className="expense-accounting-hint">Lưu khoản chi không ghi tiền vào hoặc ra quỹ. Kế toán lập phiếu khi đã giao nhận tiền.</p>
    </form>
  </Drawer>;
}
