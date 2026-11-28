import { useId, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { sumExcludingNegative, DRIVER_INCIDENTAL_COST_LABELS, EXPENSE_COST_GROUP_LABELS, expenseAccountingCreateSchema, type ExpenseAccountingCreate, type ExpenseCostGroup, type ExpenseWorkRow } from '@tingting/shared';
import { Drawer } from '../../components/UI';
import { DateField, NumberField, TextField, UuiSelectField } from '../../design-system';
import type { ExpenseAccountingCatalog } from '../../api/expenseAccountingClient';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { getPhoiPhieuChiHo, getPhoiPhieuTienDuong, type PhoiPhieuChiHoDetail, type PhoiPhieuTienDuongDetail } from '../../api/phoiPhieuClient';
import { qk } from '../../api/keys';
import { businessDateISO, formatMoney } from '../../lib/format';
import { actionErrorMessage, NETWORK_FAILURE_SAVE_MESSAGE } from '../../lib/api/action-error';
import { useExpenseMutations } from './useExpenseAccounting';
import { ExpenseNameSuggestions } from './ExpenseNameSuggestions';
import { ExpenseEvidenceFields } from './ExpenseEvidenceFields';
import { DRIVER_EXPENSE_OPTIONS, driverExpenseOption } from '../driver/driver-expense-options';
import './ExpenseAccounting.css';

// Card 20261005 — nhập tay chỉ còn 2 nhóm (PM): báo cáo và dữ liệu cũ vẫn đọc
// đủ 8 giá trị EXPENSE_COST_GROUPS, chỉ form không chào bán nhóm khác nữa.
// SIL-1028 (KB K6.9) — hai nhóm "Tiền đường" / "Chi phí lô hàng" hiển thị CẠNH
// NHAU: hai khu song song, mỗi khu giữ dòng nháp của nhóm, nút "+ Thêm dòng"
// và bảng con các khoản đã có của chính nhóm đó. Thẻ 191026160000 trước đây
// dựng cặp tab chỉ hiện nội dung một bên — QA staging 25/11 chốt tab KHÔNG
// phải "hiển thị cạnh nhau" (K6.9).
const MANUAL_GROUP_KINDS: Record<string, true> = { DRIVER_SHIPMENT: true, DRIVER_ROAD: true };
type PayerKind = 'COMPANY' | 'USER' | 'SUPPLIER';

/** One draft row = one future `ExpenseAccountingCreate`; the batch is saved all-or-nothing. */
interface ExpenseDraft {
  group: ExpenseCostGroup; driverOption: string; name: string;
  amount: number | ''; charge: number | ''; equal: boolean; date: string;
  payerKind: PayerKind; payer: string; supplier: string;
  invoice: string; invoiceDate: string; hasInvoice: boolean;
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
type PhoiExistingRaw = PhoiPhieuTienDuongDetail | PhoiPhieuChiHoDetail;

// PM ruling (2026-10): khi kế toán khai chi phí, "Bên thực chi" mặc định là
// CÔNG TY TRẢ TRỰC TIẾP cho mọi dòng — kể cả đường nhập của Ops — vẫn đổi tay
// sang Nhân viên chi / Nhà cung cấp được.
// K5.34 (KB Ch.5 §5.4.5, SIL-1240): "Số tiền mặc định là 1,000,000 cho tất cả
// trường số tiền" — Thực chi / Thực thu mở sẵn giá trị mặc định thay vì 0
// (Tiền đường giữ Thực thu = 0 vì ô đó khóa trên nhóm lái xe).
const DEFAULT_EXPENSE_AMOUNT = 1_000_000;

function blankDraft(group: ExpenseCostGroup): ExpenseDraft {  return { group, driverOption: '', name: '', amount: DEFAULT_EXPENSE_AMOUNT, charge: group === 'DRIVER_ROAD' ? 0 : DEFAULT_EXPENSE_AMOUNT, equal: false,
    date: businessDateISO(), payerKind: 'COMPANY', payer: '', supplier: '',
    invoice: '', invoiceDate: '', hasInvoice: false };
}

/** TC-COSTUX-04 (FB-097) — the post-save reset blanks the per-expense cells
 *  (Thực chi/Thực thu, tên, hóa đơn) for continuous entry while the group /
 *  ngày / bên thực chi session is kept. K5.34's 1.000.000 seed is the OPENING
 *  default only — a saved-then-reset row never re-seeds it. */
function resetDraftAfterSave(group: ExpenseCostGroup): ExpenseDraft {
  return { ...blankDraft(group), amount: '', charge: group === 'DRIVER_ROAD' ? 0 : '' };
}

/** FB-097 — nhà xe chạy chuyến → NCC mặc định: khớp danh mục theo id
 *  (`trip_carrier_info.external_entity_id` khi external là SUPPLIER), dự phòng
 *  theo tên. Không có nhà xe ngoài / không khớp → để trống cho người chọn tay. */
function matchCarrierSupplier(catalog: ExpenseAccountingCatalog, carrier?: { supplierId: number | null; name: string | null }): string {
  if (!carrier) return '';
  // SIL-1242 — a catalog without the suppliers key (role-scoped payload,
  // deploy skew) must never crash the drawer — degrade to "pick by hand".
  const suppliers = catalog.suppliers ?? [];
  const byId = carrier.supplierId != null ? suppliers.find(item => item.id === carrier.supplierId) : undefined;
  if (byId) return String(byId.id);
  const wantedName = (carrier.name ?? '').trim().toLocaleLowerCase('vi');
  const byName = wantedName ? suppliers.find(item => item.name.trim().toLocaleLowerCase('vi') === wantedName) : undefined;
  return byName ? String(byName.id) : '';
}

/** SIL-1028 (KB K6.9) — "Tiền đường | Chi phí lô hàng": hai khu cạnh nhau. */
const GROUP_PANELS = [
  { group: 'DRIVER_ROAD', label: EXPENSE_COST_GROUP_LABELS.DRIVER_ROAD, existingTitle: 'Các khoản tiền đường đã có', emptyText: 'Chưa có tiền đường phát sinh.' },
  { group: 'DRIVER_SHIPMENT', label: EXPENSE_COST_GROUP_LABELS.DRIVER_SHIPMENT, existingTitle: 'Các khoản chi phí lô hàng đã có', emptyText: 'Chưa có chi phí lô hàng phát sinh.' },
] as const;

/** Card 191026160000 — the type's own sub-table ("bảng con") mapping: the raw
 *  detail the shared query returns, straight to the tickable row view. The
 *  chi-hộ detail is the one carrying `ngayLayPhoi`, so the union narrows on it
 *  instead of trusting the caller's group pick. */
function mapExistingRows(detail: PhoiExistingRaw): PhoiExistingRow[] {
  if ('ngayLayPhoi' in detail) {
    return detail.rows
      .filter(row => row.sourceKind !== 'TRIP')
      .map(row => ({
        id: row.entryId,
        version: row.version,
        confirmed: Boolean(row.confirmed),
        primary: row.feeName ?? '—',
        secondary: row.invoiceNumber ?? '—',
        date: '—',
        amount: row.amountTra,
        thu: row.amountThu,
      }));
  }
  return detail.rows.map(row => ({
    id: row.sourceId,
    version: row.version,
    confirmed: Boolean(row.confirmed),
    // Same label rule the tiền-đường dialog prints: the Ops custom name
    // first, else the cost-type's Vietnamese label, never the raw code.
    primary: row.feeName
      || DRIVER_INCIDENTAL_COST_LABELS[row.costType as keyof typeof DRIVER_INCIDENTAL_COST_LABELS]
      || row.costType || '—',
    secondary: row.driverName ?? '—',
    date: row.occurredAt ?? '—',
    amount: row.amount,
    thu: null,
  }));
}

/** SIL-1028 (KB K6.9) — one group panel ("khu"): the group's draft rows, its
 *  own "+ Thêm dòng", and the type's own sub-table ("bảng con" card
 *  191026160000) — every existing entry of THIS group tickable in the STT
 *  cell; Lưu duyệt confirms the ticked ones in ONE call. Confirms ride the
 *  same endpoint the tiền-đường tick uses, so duyệt here and duyệt there
 *  cannot disagree. */
function ExpenseGroupPanel({ group, label, existingTitle, work, catalog, entryScope, carrier, rows, busy, errorField, onPatch, onRemove, onAdd, onSaved }: {
  group: ExpenseCostGroup;
  label: string;
  existingTitle: string;
  work: Pick<ExpenseWorkRow, 'tripId' | 'shipmentId' | 'shipmentCode' | 'containerNumber'>;
  catalog: ExpenseAccountingCatalog;
  entryScope?: 'OPS';
  carrier?: { supplierId: number | null; name: string | null };
  rows: Array<{ index: number; draft: ExpenseDraft }>;
  busy: boolean;
  /** SIL-1129 (KB Ch.10 §10.8.5) — the save validation's failing field: the
   *  named row's Loại-chi-phí-lái-xe select wears the danger border + the
   *  field-level message. Null = no failed attempt pending. */
  errorField: { index: number; field: 'driverOption' } | null;
  onPatch: (index: number, patch: Partial<ExpenseDraft>) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
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
    select: (detail) => mapExistingRows(detail),
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

  return <section className="expense-group-panel" aria-label={`Nhóm chi phí: ${label}`}>
    <h4 className="expense-group-panel__title">{label}</h4>
    <div className="expense-accounting-drafts">
      {rows.map(({ index, draft }) => <section className="expense-accounting-draft-row" key={index}>
        <header className="expense-accounting-draft-head"><h4>Khoản {index + 1}</h4>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => onRemove(index)}>Xóa dòng</button></header>
        {/* KB Ch.10 §10.7.2 (SIL-950) — thứ tự trường của một dòng khai chi:
            Ngày chi · Tên khoản chi · Bên thực chi (Người chi / Nhà cung cấp
            theo lựa chọn) · ô chứng từ "Có hóa đơn" + cặp Số hóa đơn – ngày
            hóa đơn (SIL-949/KB §10.6.4: cờ bật mới hiện và yêu cầu số hóa
            đơn) · 3 trường ngoài danh sách KB (Loại chi phí lái xe, Thực chi,
            Thực thu) xếp sau nhóm trường KB · ô đánh dấu "Nhập Thu và Trả
            bằng nhau" CUỐI dòng. Nhóm chi phí đứng TRƯỚC dòng — tiêu đề khu
            song song (SIL-1028, K6.9) thay cho ô tab trong dòng. */}
        <div className="expense-accounting-fields">
          <DateField controlSize="sm" label="Ngày chi" value={draft.date} required disabled={busy} onChange={value => onPatch(index, { date: value })} />
        </div>
        <TextField controlSize="sm" label="Tên khoản chi" value={draft.name} required maxLength={200} disabled={busy} onChange={event => onPatch(index, { name: event.target.value })} />
        <ExpenseNameSuggestions group={draft.group} disabled={busy} onChoose={name => onPatch(index, { name })} />
        <div className="expense-accounting-fields">
          <UuiSelectField label="Bên thực chi" value={draft.payerKind} disabled={busy} onChange={event => {
            const next = event.target.value as PayerKind;
            // FB-097 — chọn "Nhà cung cấp" thì mặc định là nhà xe đang chạy
            // chuyến (khớp danh mục theo id, dự phòng theo tên). Không có nhà
            // xe ngoài thì để trống cho người chọn tay — không chặn lưu.
            onPatch(index, next === 'SUPPLIER' ? { payerKind: next, supplier: matchCarrierSupplier(catalog, carrier) } : { payerKind: next });
          }} options={[{ value: 'COMPANY', label: 'Công ty trả trực tiếp' }, { value: 'USER', label: 'Nhân viên chi' }, { value: 'SUPPLIER', label: 'Nhà cung cấp' }]} />
          {/* SIL-1028 (KB K6.9) — "có đủ ô Người chi, Nhà cung cấp, Bên thực
              chi": hai ô chọn người chi / nhà cung cấp LUÔN hiện ở chế độ xem
              đầu (QA 25/11 đếm 0 lần xuất hiện là lỗi), chỉ MỞ theo lựa chọn
              của Bên thực chi — đúng slot theo lựa chọn (KB §10.7.2). */}
          <UuiSelectField label="Người chi" value={draft.payer} disabled={busy || draft.payerKind !== 'USER'} required={draft.payerKind === 'USER'} onChange={event => onPatch(index, { payer: event.target.value })} options={[{ value: '', label: 'Chọn nhân viên' }, ...((entryScope === 'OPS' ? catalog.opsUsers : catalog.staff) ?? []).map(item => ({ value: String(item.id), label: item.name }))]} />
          <UuiSelectField label="Nhà cung cấp" value={draft.supplier} disabled={busy || draft.payerKind !== 'SUPPLIER'} required={draft.payerKind === 'SUPPLIER'} onChange={event => onPatch(index, { supplier: event.target.value })} options={[{ value: '', label: 'Chọn nhà cung cấp' }, ...(catalog.suppliers ?? []).map(item => ({ value: String(item.id), label: item.name }))]} />
        </div>
        {/* KB §10.6.4 (K10.32, SIL-949) — ô "chứng từ" là cờ "Có hóa đơn":
            tắt thì cặp Số/Ngày hóa đơn ẩn hoàn toàn và dòng không mang số
            hóa đơn; bật lên cặp hiện ra và Số hóa đơn bắt buộc. */}
        <label className="expense-accounting-check"><input type="checkbox" checked={draft.hasInvoice} disabled={busy} onChange={event => { const checked = event.target.checked; onPatch(index, checked ? { hasInvoice: true } : { hasInvoice: false, invoice: '', invoiceDate: '' }); }} /> Có hóa đơn</label>
        {draft.hasInvoice && <div className="expense-accounting-fields">
          <ExpenseEvidenceFields variant="invoice-pair"
            invoiceNumber={draft.invoice} onInvoiceNumber={value => onPatch(index, { invoice: value })}
            invoiceDate={draft.invoiceDate} onInvoiceDate={value => onPatch(index, { invoiceDate: value })}
            required disabled={busy} />
        </div>}
        <div className="expense-accounting-fields">
          {/* SIL-1129 (KB Ch.10 §10.8.5) — a failed save paints THIS select's
              danger border (border-error + aria-invalid) with the message
              beside the field; fixing the row's pick clears it (patchDraft). */}
          <UuiSelectField label="Loại chi phí lái xe" required value={draft.driverOption} disabled={busy} error={errorField?.index === index && errorField.field === 'driverOption' ? 'Chọn loại chi phí lái xe.' : undefined} onChange={event => { const choice = driverExpenseOption(event.target.value); onPatch(index, { driverOption: choice.code, name: choice.label, // SIL-1240: preset của loại phí lái xe vẫn thay thế giá trị mặc định K5.34 chưa bị sửa tay
            ...((draft.amount === '' || draft.amount === DEFAULT_EXPENSE_AMOUNT) && choice.amount !== undefined ? { amount: choice.amount } : {}) }); }} options={[{ value: '', label: 'Chọn loại chi phí' }, ...DRIVER_EXPENSE_OPTIONS.filter(item => item.group === draft.group).map(item => ({ value: item.code, label: item.label }))]} />
          <NumberField controlSize="sm" label="Thực chi (VND)" required value={draft.amount} disabled={busy} min={-999_999_999_999_999} step={1} grouped signed onChange={next => onPatch(index, { amount: next, ...(draft.equal ? { charge: next } : {}) })} />
          <NumberField controlSize="sm" label="Thực thu — thu khách (VND)" required value={draft.charge} disabled={busy || draft.equal || draft.group === 'DRIVER_ROAD'} min={0} step={1} grouped onChange={next => onPatch(index, { charge: next })} />
        </div>
        <label className="expense-accounting-check"><input type="checkbox" checked={draft.equal} disabled={busy || draft.group === 'DRIVER_ROAD'} onChange={event => { const checked = event.target.checked; onPatch(index, { equal: checked, ...(checked ? { charge: draft.amount } : {}) }); }} /> Nhập Thu và Trả bằng nhau</label>
        {draft.payerKind === 'SUPPLIER' && !draft.supplier && <p className="expense-accounting-hint">Chưa có nhà xe trên tuyến này — chọn thủ công.</p>}
      </section>)}
    </div>
    <button type="button" className="btn btn--secondary btn--sm" disabled={busy} aria-label={`Thêm dòng nhóm ${label}`} onClick={onAdd}>+ Thêm dòng</button>
    {(work.tripId != null) && (
      <section className="expense-existing" aria-label={existingTitle}>
        <h4>{existingTitle}</h4>
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
        {existingRows.length > 0 && <div className="expense-existing-bar" role="region" aria-label={`Duyệt các dòng ${label} đã chọn`}>
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
  </section>;
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
  const startGroup: ExpenseCostGroup = MANUAL_GROUP_KINDS[initialGroup] ? initialGroup : 'DRIVER_SHIPMENT';
  const [drafts, setDrafts] = useState<ExpenseDraft[]>([blankDraft(startGroup)]);
  const [error, setError] = useState('');
  // SIL-1129 (KB Ch.10 §10.8.5) — the failing save names its FIELD: the
  // Loại-chi-phí-lái-xe select wears the danger border (UuiSelectField error
  // → border-error + aria-invalid) beside the row-level alert, instead of a
  // message floating above a neutral form.
  const [errorField, setErrorField] = useState<{ index: number; field: 'driverOption' } | null>(null);
  const [saved, setSaved] = useState(false);
  const busy = createBatch.isPending;
  const close = () => { if (!lock.current) onClose(); };
  const patchDraft = (index: number, patch: Partial<ExpenseDraft>) => {
    setSaved(false);
    if (errorField != null && errorField.index === index && 'driverOption' in patch) setErrorField(null);
    setDrafts(rows => rows.map((row, position) => position === index ? { ...row, ...patch } : row));
  };

  async function save(event?: React.FormEvent) {
    event?.preventDefault();
    if (lock.current) return;
    const items: ExpenseAccountingCreate[] = [];
    for (const [index, draft] of drafts.entries()) {
      const row = (message: string) => `Dòng ${index + 1}: ${message}`;
      if (!draft.driverOption) { setError(row('Chọn loại chi phí lái xe.')); setErrorField({ index, field: 'driverOption' }); return; }
      // KB §10.6.4 (K10.32, SIL-949): ô "Có hóa đơn" là cờ có hóa đơn — bật lên
      // mới yêu cầu số hóa đơn; cờ tắt thì dòng không mang số/ngày hóa đơn.
      if (draft.hasInvoice && !draft.invoice.trim()) { setError(row('Bật "Có hóa đơn" thì bắt buộc nhập số hóa đơn.')); return; }
      const option = driverExpenseOption(draft.driverOption);
      const parsed = expenseAccountingCreateSchema.safeParse({ driverCostType: option.type, tripId: work.tripId, shipmentId: work.shipmentId,
        expenseTypeCode: option.type, amount: draft.amount, customerChargeAmount: draft.charge,
        expenseDate: draft.date, costGroup: draft.group, feeName: draft.name, payerKind: draft.payerKind,
        payerUserId: draft.payerKind === 'USER' ? Number(draft.payer) || null : null,
        supplierId: draft.payerKind === 'SUPPLIER' ? Number(draft.supplier) || null : null,
        // SIL-949 (KB §10.6.4) — the flag owns the invoice: a flag-on row ships
        // its Số hóa đơn, a flag-off row ships null (no leftover text).
        invoiceNumber: draft.hasInvoice ? draft.invoice.trim() || null : null,
        invoiceDate: draft.hasInvoice ? (draft.invoiceDate || null) : null });
      if (!parsed.success) { setError(row('Kiểm tra loại phí, tên, ngày, số tiền và số thực thu. Số thực thu có thể bằng 0 hoặc thấp hơn thực chi.')); return; }
      if ((draft.payerKind === 'USER' && !draft.payer) || (draft.payerKind === 'SUPPLIER' && !draft.supplier)) { setError(row('Chọn người chi hoặc nhà cung cấp.')); return; }
      items.push(parsed.data);
    }
    const payload = JSON.stringify([work.shipmentId, work.tripId, drafts]);
    if (request.current?.payload !== payload) request.current = { payload, key: crypto.randomUUID() };
    lock.current = true; setError(''); setErrorField(null);
    try {
      await createBatch.mutateAsync({ body: { items }, key: request.current.key });
      request.current = null;
      // TC-COSTUX-04 — nhập liên tục: drawer KHÔNG đóng sau lưu; ô của từng
      // khoản làm trống để nhập tiếp, nhóm chi phí / bên thực chi / ngày giữ
      // nguyên. Nút "Đóng" mới kết thúc phiên nhập.
      const kept = drafts[0];
      setDrafts([{ ...resetDraftAfterSave(kept.group), date: kept.date, payerKind: kept.payerKind }]);
      setSaved(true);
      onSaved?.();
    }
    catch (cause) {
      setError(
        // SIL-1105 (K2.161) — offline, the save must SAY it did not save and
        // when to retry; the shared layer still owns the "this is a network
        // failure" classification.
        actionErrorMessage(
          'lưu khoản chi',
          cause,
          'Chưa thể lưu khoản chi. Giữ nguyên nội dung và thử lại.',
          undefined,
          NETWORK_FAILURE_SAVE_MESSAGE,
        )
        ?? 'Chưa thể lưu khoản chi. Giữ nguyên nội dung và thử lại.',
      );
    }
    finally { lock.current = false; }
  }
  return <Drawer isOpen onClose={close} title="Thêm khoản chi" subtitle={`${work.shipmentCode ?? '—'} · ${work.containerNumber ?? 'Chung lô'}`} className="expense-accounting-drawer"
    footer={<><button type="button" className="btn btn--secondary" disabled={busy} onClick={close}>Đóng</button><button type="button" className="btn btn--primary" disabled={busy || drafts.length === 0} onClick={() => void save()}>{busy ? 'Đang lưu…' : `Lưu ${drafts.length} khoản chi`}</button></>}>
    <form id={formId} onSubmit={(event) => void save(event)} className="expense-accounting-form">
      {error && <p role="alert" className="expense-accounting-error">{error}</p>}
      {saved && <p role="status" className="expense-accounting-hint">Đã lưu khoản chi.</p>}
      {/* SIL-1028 (KB K6.9) — hai nhóm "Tiền đường" / "Chi phí lô hàng" hiển
          thị CẠNH NHAU (hai khu song song, không còn cặp tab chỉ hiện một
          bên); dòng nháp mới đi vào khu của nhóm đó. */}
      <div className="expense-accounting-group-panels">
        {GROUP_PANELS.map(panel => (
          <ExpenseGroupPanel key={panel.group}
            group={panel.group} label={panel.label} existingTitle={panel.existingTitle}
            work={work} catalog={catalog} entryScope={entryScope} carrier={carrier}
            rows={drafts.map((draft, index) => ({ index, draft })).filter(({ draft }) => draft.group === panel.group)}
            busy={busy}
            errorField={errorField}
            onPatch={patchDraft}
            onRemove={index => setDrafts(rows => rows.filter((_, position) => position !== index))}
            onAdd={() => setDrafts(rows => [...rows, blankDraft(panel.group)])}
            onSaved={onSaved} />
        ))}
      </div>
      <p className="expense-accounting-hint">Lưu khoản chi không ghi tiền vào hoặc ra quỹ. Kế toán lập phiếu khi đã giao nhận tiền.</p>
    </form>
  </Drawer>;
}
