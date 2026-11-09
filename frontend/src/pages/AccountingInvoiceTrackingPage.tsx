// Card 20260921_18 — THEO DÕI HÓA ĐƠN KẾT HỢP. Kế toán manages combined-invoice
// tracking rows per lot trip; CUS reaches the same page read-only (server-enforced).
//
// SIL-762 REV2 (ticket-v2.txt, Phần IV Epic 3 mục 1): the board renders the
// LƯỚI 8 CỘT MULTI-LINE — the data fields and formulas are unchanged from the
// old 20+-column sheet, but the presentation collapses into 8 grouped cells:
//   1 [Checkbox] & STT        — bulk select for Lưu và Ẩn (ĐNTT lập theo lô là
//                               giai đoạn sau; selection is ready for it)
//   2 KHÁCH HÀNG & LÔ         — KH (Mã KH · MST auto từ Master Data) / Nhà máy ·
//                               Ngày vận chuyển — read-only, auto-fill từ lô
//   3 CONT & CHỨNG TỪ         — Số Cont · badge [loại · X/N] / Bill-tờ khai ·
//                               Hãng tàu — read-only (auto-sync khi tích Kết hợp)
//   4 ĐẦU VÀO (MUA HĐ)        — NCC (datalist) / Số hóa đơn · Ngày gửi HĐ —
//                               inline-edit, commit on blur
//   5 ĐỐI SOÁT SỐ TIỀN        — Thu KH / Trả NCC · Trả KH — inline-edit
//   6 CHÊNH LỆCH              — auto = thu − trả − trả KH (lợi nhuận HĐ ngoài)
//   7 GHI CHÚ & ĐNTT          — Ghi chú inline / badge Số ĐNTT (tự gắn)
//   8 TIẾN ĐỘ XỬ LÝ           — select Chưa lấy HĐ | Đã có HĐ | Đã gửi HĐ |
//                               Không lấy HĐ + nút nhanh [Lưu và Ẩn]
// [Lưu và Ẩn] (per-row quick + bulk qua selection) ticks "Không lấy hóa đơn"
// và ẩn khỏi danh sách chờ (noInvoice + hiddenAt/hiddenBy = vết lịch sử); bộ
// lọc "Dòng đã ẩn" trả lại vết, Bỏ ẩn đưa dòng về làm việc.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, EyeOff, Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  INVOICE_TRACKING_DIFF_FORMULA,
  TRADE_DIRECTION_LABELS,
  Role,
  round2dp,
  type InvoiceTrackingPatchInput,
  type InvoiceTrackingRow,
} from '@tingting/shared';
import { Btn, PageHeader, useConfirm } from '../components/UI';
import { useReasonPrompt } from '../components/reason-prompt';
import { FilterDropdown } from '../components/FilterDropdown';
import { DateRangeFields, DateRangePresets, DateRangePresetSelect, type DateRangePreset, type DateRangeValue } from '../design-system/forms/DateRangeFields';
import { UuiSelectField } from '../design-system/forms/UuiSelectField';
import { downloadCSV } from '../lib/csv';
import {
  deleteInvoiceTracking,
  listInvoiceTracking,
  updateInvoiceTracking,
} from '../api/invoiceTrackingClient';
import { qk } from '../api/keys';
import { useAuth } from '../hooks/useAuth';
import { getModernRole } from '../lib/role-helpers';
import { businessDateISO, formatISODate, formatMoney } from '../lib/format';
import InvoiceTrackingFormModal from '../features/accounting/InvoiceTrackingFormModal';
import { EmptyState, FilterBar, SummaryRail } from '../design-system';
import { SkeletonTable } from '../components/shared/Skeleton';
import '../styles/record-table.css';
import '../styles/operational-table-typography.css';
import './AccountingInvoiceTrackingPage.css';

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT];

const CHUA_LAY_HD = 'Chưa lấy HĐ';
const KHONG_LAY_HD = 'Không lấy HĐ';

/** SIL-762 REV2 — the Cột 8 progress vocabulary. The write model keeps the
 *  original enum + the noInvoice flag; the display derives from the row:
 *   · noInvoice            → Không lấy HĐ (row is hidden from the working list)
 *   · progress GUI_HD      → Đã gửi HĐ
 *   · invoiceNumber set    → Đã có HĐ (legacy CO_HD rows and captured invoices;
 *                            kept as a fourth display value so a captured
 *                            invoice never reads as "chưa lấy") */
function progressDisplayOf(row: InvoiceTrackingRow): string {
  if (row.noInvoice) return KHONG_LAY_HD;
  if (row.progress === 'GUI_HD') return 'Đã gửi HĐ';
  if (row.invoiceNumber != null || row.progress === 'CO_HD') return 'Đã có HĐ';
  return CHUA_LAY_HD;
}

/** Σ thu / Σ trả / Σ trả KH / chênh lệch over the rows currently on screen.
 *  SIL-762 formula: Chênh lệch = thu − trả − trả KH (the profit of the
 *  company's out-of-house invoice handling). Worked example (com 0):
 *  12.000.000/8.000.000 + 5.500.000/6.000.000 → 17.500.000 / 14.000.000 /
 *  3.500.000. A row with no `comAmount` contributes 0, never `NaN`. */
export function computeTotals(rows: ReadonlyArray<{ invoiceAmount: string; supplierPayment: string; comAmount?: string | null }>): {
  invoice: number;
  paid: number;
  difference: number;
  com: number;
} {
  let invoice = 0;
  let paid = 0;
  let com = 0;
  for (const row of rows) {
    invoice += Number(row.invoiceAmount);
    paid += Number(row.supplierPayment);
    com += row.comAmount == null ? 0 : Number(row.comAmount);
  }
  return { invoice, paid, difference: invoice - paid - com, com: round2dp(com) };
}

/** First-of-month..today, Vietnam business timezone (house date helpers). */
function defaultPeriod(): { from: string; to: string } {
  const today = businessDateISO();
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** Preset ranges evaluated at click time so they stay today-anchored. The
 *  anchor is injectable so the month-end law is testable without freezing
 *  the clock. */
export function buildPeriodPresets(today = businessDateISO()): DateRangePreset[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  // Day 0 of month INDEX m is the last day of calendar month m (September →
  // 30, February → 28/29). The old `m - 1` index returned the PREVIOUS
  // month's length, so 'Tháng trước' in October built 2026-09-31 and the
  // backend answered 400 "Khoảng ngày không hợp lệ".
  const last = (y2: number, m2: number) => new Date(Date.UTC(y2, m2, 0)).getUTCDate();
  const iso = (yy: number, mm: number, dd: number) => `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  return [
    { id: 'this-month', label: 'Tháng này', range: () => ({ from: iso(y, m, 1), to: today }) },
    { id: 'last-month', label: 'Tháng trước', range: () => {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: iso(py, pm, 1), to: iso(py, pm, last(py, pm)) };
    } },
    { id: 'this-quarter', label: 'Quý này', range: () => {
      const qStart = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: iso(y, qStart, 1), to: today };
    } },
  ];
}

/** Inline-editable cell input (Cột 4/5/7): commits on blur or Enter, never
 *  per keystroke — one PATCH per finished edit. `numeric` keeps integers. */
function InlineCellInput({ value, onCommit, numeric, listId, ariaLabel, placeholder }: {
  value: string;
  onCommit: (next: string) => void;
  numeric?: boolean;
  listId?: string;
  ariaLabel: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    const current = value.trim();
    if (next === current) return;
    if (numeric && next !== '' && !/^\d+$/.test(next)) { setDraft(value); return; }
    onCommit(next);
  };
  return (
    <input
      className={`ivt-inline-input${numeric ? ' ivt-inline-input--num' : ''}`}
      value={draft}
      aria-label={ariaLabel}
      placeholder={editing ? placeholder : (value || placeholder)}
      list={listId}
      inputMode={numeric ? 'numeric' : undefined}
      onFocus={() => setEditing(true)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); (event.target as HTMLInputElement).blur(); } }}
    />
  );
}

export default function AccountingInvoiceTrackingPage() {
  const { user } = useAuth();
  const canWrite = WRITE_ROLES.includes(getModernRole(user?.role ?? '') as Role);
  const queryClient = useQueryClient();
  const initialPeriod = useMemo(defaultPeriod, []);
  const periodPresets = useMemo(buildPeriodPresets, []);
  const [period, setPeriod] = useState<DateRangeValue>(initialPeriod);
  const [search, setSearch] = useState('');
  const [supplier, setSupplier] = useState('');
  const [diffOnly, setDiffOnly] = useState(false);
  // SIL-762 — the Lưu và Ẩn trace: default hides the "Không lấy hóa đơn" rows;
  // flipping this refetches with includeHidden and marks them on screen.
  const [includeHidden, setIncludeHidden] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const { from, to } = period;
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const { confirm, dialog } = useConfirm();
  const { prompt, dialog: reasonDialog } = useReasonPrompt();
  const supplierListId = useRef(`ivt-suppliers-${Math.random().toString(36).slice(2, 8)}`).current;

  const query = useQuery({
    queryKey: qk.invoiceTracking.list(from, to, includeHidden),
    queryFn: () => listInvoiceTracking(from, to, { includeHidden }),
  });
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const supplierOptions = useMemo(
    () => [...new Set(rows.map((r) => r.supplierName?.trim()).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b, 'vi')),
    [rows],
  );
  const filtered = useMemo(() => rows.filter((r) => {
    if (supplier && r.supplierName?.trim() !== supplier) return false;
    // SIL-762 law — "có lệch" follows the SAME 3-term formula as the column:
    // thu − trả − trả KH ≠ 0 (comAmount folds in, never NaN).
    if (diffOnly && Number(r.invoiceAmount) - Number(r.supplierPayment) - (r.comAmount == null ? 0 : Number(r.comAmount)) === 0) return false;
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      const haystack = [r.invoiceNumber, r.taxCode, r.shipmentCode, r.containerNumber, r.bookingRef, r.blNumber, r.customerName].map(v => (v ?? '').toLowerCase());
      if (!haystack.some(v => v.includes(needle))) return false;
    }
    return true;
  }), [rows, supplier, diffOnly, search]);
  const totals = computeTotals(filtered);

  // Card 20261002_285 AC1: the period IS a filter condition — it scopes the
  // query, not just the view. It is seeded to `initialPeriod`, so "applied"
  // means "differs from the default", not "non-empty"; a plain non-empty test
  // would be permanently true and would suppress the empty state's guidance.
  const periodChanged = period.from !== initialPeriod.from || period.to !== initialPeriod.to;
  const clearFilters = () => {
    setPeriod(initialPeriod);
    setSearch('');
    setSupplier('');
    setDiffOnly(false);
    setIncludeHidden(false);
  };
  const hasActiveFilters = Boolean(periodChanged || search.trim() || supplier || diffOnly || includeHidden);

  const secondaryCount = (supplier ? 1 : 0) + (diffOnly ? 1 : 0) + (includeHidden ? 1 : 0);
  const resetSecondary = () => { setSupplier(''); setDiffOnly(false); setIncludeHidden(false); };
  const presetNode = <DateRangePresets presets={periodPresets} value={period} onChange={setPeriod} ariaLabel="Kỳ theo dõi nhanh" />;
  const presetDialogNode = <DateRangePresetSelect presets={periodPresets} value={period} onChange={setPeriod} ariaLabel="Kỳ theo dõi nhanh" />;

  const exportExcel = () => {
    // The sheet carries the same data fields as the grid (SIL-762 rev2) —
    // one row per container, totals ride the Σ strip on screen.
    const headers = ['STT', 'Ngày vận chuyển', 'Khách hàng', 'Mã KH', 'MST', 'Nhà máy', 'Bill / Số tờ khai', 'Hãng tàu', 'Số Container', 'Loại cont', 'Xuất/Nhập', 'Nhà cung cấp HĐ', 'Số hóa đơn', 'Ngày gửi HĐ', 'Số tiền thu', 'Số tiền trả', 'Số tiền trả KH', 'Ghi chú trả KH', 'Chênh lệch', 'Ghi chú', 'Tiến độ', 'Số ĐNTT'];
    const body = filtered.map((row, index) => [
      index + 1,
      formatISODate(row.transportDate ?? row.expenseDate),
      row.customerName ?? '',
      row.customerCode ?? '',
      row.taxCode ?? '',
      row.factoryName ?? '',
      row.bookingRef ?? row.blNumber ?? '',
      row.shippingLineName ?? '',
      row.containerNumber ?? '',
      row.containerType ?? '',
      row.tradeDirection ? TRADE_DIRECTION_LABELS[row.tradeDirection] : '',
      row.supplierName ?? '',
      row.invoiceNumber ?? '',
      formatISODate(row.invoiceSentAt),
      Number(row.invoiceAmount),
      Number(row.supplierPayment),
      // A row with no COM amount exports the raw empty string — never a `0`,
      // which would read as "no deduction" instead of "not recorded".
      row.comAmount == null ? '' : Number(row.comAmount),
      row.comNote ?? '',
      // SIL-762 law: thu − trả − trả KH.
      Number(row.invoiceAmount) - Number(row.supplierPayment) - (row.comAmount == null ? 0 : Number(row.comAmount)),
      row.note ?? '',
      progressDisplayOf(row),
      row.dnttNumbers.join(', '),
    ]);
    void downloadCSV('theo-doi-hoa-don.xlsx', headers, body, {
      title: 'THEO DÕI HÓA ĐƠN KẾT HỢP',
      subtitle: `Kỳ ${formatISODate(from)} - ${formatISODate(to)}`,
    });
  };

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: qk.invoiceTracking.all });

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<InvoiceTrackingPatchInput> }) =>
      updateInvoiceTracking(id, patch),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (error: Error) => setActionError(error.message),
  });

  // SIL-762 — [Lưu và Ẩn]: each row ticks "Không lấy hóa đơn" and leaves the
  // working list; hiddenBy/hiddenAt keep the who/when trail.
  const hideMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      for (const id of ids) {
        await updateInvoiceTracking(id, { noInvoice: true, hidden: true });
      }
    },
    onSuccess: () => {
      setActionError(null);
      setSelected(new Set());
      invalidate();
    },
    onError: (error: Error) => setActionError(error.message),
  });

  const unhideMutation = useMutation({
    mutationFn: (id: number) => updateInvoiceTracking(id, { hidden: false }),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (error: Error) => setActionError(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (input: { ids: number[]; reason: string }) =>
      Promise.all(input.ids.map((id) => deleteInvoiceTracking(id, input.reason))),
    onSuccess: () => {
      setActionError(null);
      setSelected(new Set());
      invalidate();
    },
    onError: (error: Error) => setActionError(error.message),
  });

  const handleSaveAndHide = async (ids: number[]) => {
    if (ids.length === 0) return;
    const ok = await confirm(`Đánh dấu ${ids.length} dòng "Không lấy hóa đơn" và ẩn khỏi danh sách làm việc? Lịch sử vẫn tra được qua bộ lọc "Dòng đã ẩn".`, { confirmLabel: 'Lưu và Ẩn' });
    if (!ok) return;
    hideMutation.mutate(ids);
  };

  const handleDeleteSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    // Q10 (card 20260922_78): the delete soft-voids the tracker AND its
    // mirrored lot-fee row — the prompt captures the mandatory free-text
    // reason; cancel aborts without any request.
    const reason = await prompt(
      `Xóa ${ids.length} dòng theo dõi đã chọn? Khoản "Chi phí hóa đơn" trên lô cũng sẽ được hủy kèm lý do (đối chiếu được).`,
      { confirmLabel: 'Xóa' },
    );
    if (reason == null) return;
    deleteMutation.mutate({ ids, reason });
  };

  /** Cột 8 — the progress select writes the rev2 vocabulary onto the wire:
   *  Chưa lấy HĐ resets the row to pending (and un-hides a hidden one),
   *  Đã gửi HĐ stamps GUI_HD, Không lấy HĐ ticks noInvoice and auto-hides. */
  const changeProgress = (row: InvoiceTrackingRow, label: string) => {
    if (label === progressDisplayOf(row)) return;
    if (label === KHONG_LAY_HD) {
      hideMutation.mutate([row.id]);
      return;
    }
    const patch: Partial<InvoiceTrackingPatchInput> = label === 'Đã gửi HĐ'
      ? { progress: 'GUI_HD' }
      : label === 'Đã có HĐ'
        ? { progress: 'CO_HD' }
        : { progress: 'CHUA_GUI' };
    if (row.noInvoice) patch.noInvoice = false;
    if (row.hiddenAt != null) patch.hidden = false;
    patchMutation.mutate({ id: row.id, patch });
  };

  const toggleRow = (id: number, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  /** Cột 4 — Ngày gửi HĐ chấp nhận dd/mm/yyyy (nháp kiểu người dùng) hoặc
   *  ISO; ngày sai không commit — draft giữ nguyên để kế toán sửa tiếp. */
  const normalizeSentDate = (raw: string): string | null | undefined => {
    const text = raw.trim();
    if (text === '') return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmy) {
      const iso = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
      if (!Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) return iso;
    }
    return undefined;
  };

  const commitCell = (row: InvoiceTrackingRow, field: 'supplierName' | 'invoiceNumber' | 'invoiceSentAt' | 'invoiceAmount' | 'supplierPayment' | 'comAmount' | 'note', raw: string) => {
    // Số hóa đơn is min(1) on the wire — clearing it cannot PATCH null; the
    // edit keeps its captured number (the modal omits the field identically).
    if (field === 'invoiceNumber' && raw.trim() === '') return;
    const patch: Partial<InvoiceTrackingPatchInput> =
      field === 'invoiceAmount' || field === 'supplierPayment' || field === 'comAmount'
        ? { [field]: raw === '' ? 0 : Number(raw) }
        : { [field]: raw === '' ? null : raw };
    // COM blank means "not recorded" (null) — never a written 0 (card 384).
    if (field === 'comAmount' && raw === '') patch.comAmount = null;
    if (field === 'invoiceSentAt') {
      const iso = normalizeSentDate(raw);
      if (iso === undefined) return;
      patch.invoiceSentAt = iso;
    }
    patchMutation.mutate({ id: row.id, patch });
  };

  return (
    <div className="invoice-tracking-page">
      {dialog}
      {reasonDialog}

      <PageHeader
        title="Theo dõi hóa đơn"
        action={(
          <>
            <Btn variant="secondary" size="sm" icon={<Download size={14} />} onClick={exportExcel}>Xuất Excel</Btn>
            {canWrite && (
              <Btn variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setCreateModalOpen(true)}>
                Thêm chi phí lô hàng
              </Btn>
            )}
          </>
        )}
      />

      <SummaryRail
        ariaLabel="Tổng cộng theo kỳ"
        items={[
          { label: 'Số tiền thu', value: `${formatMoney(totals.invoice)} ₫` },
          { label: 'Số tiền trả', value: `${formatMoney(totals.paid)} ₫` },
          { label: 'Số tiền trả KH', value: `${formatMoney(totals.com)} ₫` },
          {
            label: 'Chênh lệch',
            value: `${formatMoney(totals.difference)} ₫`,
            tone: totals.difference === 0 ? undefined : 'warning',
          },
        ]}
      />

      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Khách, Số HĐ, MST, Bill, Lô, Cont...',
          ariaLabel: 'Tìm theo khách, số HĐ, MST, Bill, lô, cont',
        }}
        presets={presetNode}
        actions={(
          <>
            {canWrite && (
              <>
                <Btn
                  variant="primary"
                  size="sm"
                  icon={<EyeOff size={14} />}
                  disabled={selected.size === 0 || hideMutation.isPending}
                  title={selected.size === 0 ? 'Chọn dòng rồi ẩn ("Không lấy hóa đơn")' : `Không lấy hóa đơn — ẩn ${selected.size} dòng đã chọn`}
                  onClick={() => void handleSaveAndHide([...selected])}
                >
                  Lưu và Ẩn{selected.size > 0 ? ` (${selected.size})` : ''}
                </Btn>
                <Btn
                  variant="secondary"
                  size="sm"
                  icon={<Trash2 size={14} />}
                  disabled={selected.size === 0 || deleteMutation.isPending}
                  onClick={() => void handleDeleteSelected()}
                >
                  Xóa
                </Btn>
              </>
            )}
            <Btn variant="ghost" size="sm" icon={<RotateCcw size={13} />} disabled={!hasActiveFilters} onClick={clearFilters}>Xóa lọc</Btn>
          </>
        )}
      >
        <DateRangeFields
          id="ivt-period"
          ariaLabel="Kỳ theo dõi"
          size="sm"
          from={period.from}
          to={period.to}
          onChange={setPeriod}
        />
        <FilterDropdown count={secondaryCount} ariaLabel="Bộ lọc" dialogLabel="Bộ lọc hóa đơn" presets={presetDialogNode} onReset={resetSecondary}>
          <UuiSelectField
            label="Nhà cung cấp"
            hideLabel
            value={supplier}
            onChange={(event) => setSupplier(event.target.value)}
            options={[{ value: '', label: 'Nhà cung cấp: tất cả' }, ...supplierOptions.map((name) => ({ value: name, label: name }))]}
          />
          <UuiSelectField
            label="Chênh lệch"
            hideLabel
            value={diffOnly ? 'diff' : 'all'}
            onChange={(event) => setDiffOnly(event.target.value === 'diff')}
            options={[{ value: 'all', label: 'Tất cả' }, { value: 'diff', label: 'Chỉ xem dòng có lệch' }]}
          />
          {/* SIL-762 — the Lưu và Ẩn trace: hidden rows stay queryable. */}
          <UuiSelectField
            label="Dòng đã ẩn"
            hideLabel
            value={includeHidden ? 'hidden' : 'working'}
            onChange={(event) => setIncludeHidden(event.target.value === 'hidden')}
            options={[
              { value: 'working', label: 'Danh sách làm việc' },
              { value: 'hidden', label: 'Hiện cả dòng đã ẩn (Không lấy hóa đơn)' },
            ]}
          />
        </FilterDropdown>
      </FilterBar>

      {actionError && <p className="invoice-tracking-alert" role="alert">{actionError}</p>}

      {query.isPending && <SkeletonTable rows={8} cols={7} />}

      {!query.isPending && query.isError && (
        <p className="invoice-tracking-alert" role="alert">Không tải được dữ liệu. Vui lòng thử lại.</p>
      )}

      {!query.isPending && !query.isError && rows.length === 0 && (
        <EmptyState
          variant="compact"
          context="finance"
          title="Không tìm thấy hóa đơn nào trong kỳ đã chọn"
          description={hasActiveFilters ? undefined : 'Thêm chi phí lô hàng để bắt đầu theo dõi.'}
          action={hasActiveFilters ? <button type="button" className="btn btn--ghost btn--sm" onClick={clearFilters}>Xóa bộ lọc</button> : undefined}
        />
      )}

      {!query.isPending && !query.isError && rows.length > 0 && filtered.length === 0 && (
        <EmptyState
          variant="compact"
          context="finance"
          title="Không tìm thấy hóa đơn nào trong kỳ đã chọn"
          description="Không dòng nào khớp bộ lọc hiện tại."
          action={<button type="button" className="btn btn--ghost btn--sm" onClick={clearFilters}>Xóa bộ lọc</button>}
        />
      )}

      {!query.isPending && !query.isError && filtered.length > 0 && (
        <div className="record-table-wrap">
          <datalist id={supplierListId}>
            {supplierOptions.map((name) => <option key={name} value={name} />)}
          </datalist>
          <table className="record-table ops-table">
            <thead>
              <tr>
                {/* Cột 1 — Checkbox & STT: bulk select cho Lưu và Ẩn (read-only
                    CUS drops the column instead of rendering dead controls). */}
                {canWrite && <th aria-label="Chọn dòng" title="Chọn dòng để Lưu và Ẩn / Xóa" className="ivt-col--select" />}
                <th>STT</th>
                <th>Khách hàng &amp; Lô</th>
                <th>Cont &amp; Chứng từ</th>
                <th>Đầu vào (Mua HĐ)</th>
                <th>Đối soát số tiền</th>
                <th title={INVOICE_TRACKING_DIFF_FORMULA}>Chênh lệch</th>
                <th>Ghi chú &amp; ĐNTT</th>
                <th>Tiến độ xử lý</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, index) => {
                const transportDay = formatISODate(row.transportDate ?? row.expenseDate);
                const direction = row.tradeDirection ? TRADE_DIRECTION_LABELS[row.tradeDirection] : null;
                const typeLine = [row.containerType, direction].filter(Boolean).join(' · ') || null;
                const refLine = [row.bookingRef, row.blNumber].filter(Boolean).join(' · ') || null;
                return (
                  <tr key={row.id} data-hidden={row.hiddenAt != null || undefined}>
                    {canWrite && (
                      <td data-label="Chọn dòng" className="ivt-col--select">
                        <input
                          type="checkbox"
                          aria-label={`Chọn dòng ${row.containerNumber ?? row.invoiceNumber ?? index + 1}`}
                          checked={selected.has(row.id)}
                          onChange={(event) => toggleRow(row.id, event.target.checked)}
                        />
                        {row.hiddenAt != null && (
                          <button
                            type="button"
                            className="btn btn--ghost btn--icon btn--sm"
                            aria-label="Bỏ ẩn dòng"
                            title="Bỏ ẩn — đưa dòng trở lại danh sách làm việc"
                            disabled={unhideMutation.isPending}
                            onClick={() => unhideMutation.mutate(row.id)}
                          >
                            <Eye size={14} />
                          </button>
                        )}
                      </td>
                    )}
                    <td data-label="STT">{index + 1}</td>
                    {/* Cột 2 — KHÁCH HÀNG & LÔ (read-only, auto từ lô + Master Data). */}
                    <td data-label="Khách hàng & Lô">
                      <span className="ivt-stack">
                        <span className="ivt-stack__primary">{row.customerName ?? '—'}</span>
                        <span className="ivt-stack__sub">{[row.customerCode, row.taxCode].filter(Boolean).join(' · ') || '—'}</span>
                        <span className="ivt-stack__sub">{[row.factoryName, transportDay].filter(Boolean).join(' · ') || '—'}</span>
                      </span>
                    </td>
                    {/* Cột 3 — CONT & CHỨNG TỪ (read-only, tự nhảy khi tích Kết hợp). */}
                    <td data-label="Cont & Chứng từ">
                      <span className="ivt-stack">
                        <span className="ivt-stack__primary">
                          <span className="record-table__reference">{row.containerNumber ?? '—'}</span>
                          {typeLine && <span className="ivt-badge">{typeLine}</span>}
                        </span>
                        <span className="ivt-stack__sub">{[refLine, row.shippingLineName].filter(Boolean).join(' · ') || '—'}</span>
                      </span>
                    </td>
                    {/* Cột 4 — ĐẦU VÀO (MUA HĐ): inline-edit, commit on blur. */}
                    <td data-label="Đầu vào (Mua HĐ)">
                      {canWrite ? (
                        <span className="ivt-stack">
                          <span className="ivt-stack__primary">
                            <InlineCellInput
                              value={row.supplierName ?? ''}
                              ariaLabel={`Nhà cung cấp HĐ — ${row.containerNumber ?? index + 1}`}
                              listId={supplierListId}
                              placeholder="Nhà cung cấp HĐ"
                              onCommit={(next) => commitCell(row, 'supplierName', next)}
                            />
                          </span>
                          <span className="ivt-stack__sub ivt-inline-pair">
                            <InlineCellInput
                              value={row.invoiceNumber ?? ''}
                              ariaLabel={`Số hóa đơn — ${row.containerNumber ?? index + 1}`}
                              placeholder="Số hóa đơn"
                              onCommit={(next) => commitCell(row, 'invoiceNumber', next)}
                            />
                            <InlineCellInput
                              value={row.invoiceSentAt ?? ''}
                              ariaLabel={`Ngày gửi HĐ — ${row.containerNumber ?? index + 1}`}
                              placeholder="dd/mm/yyyy"
                              onCommit={(next) => commitCell(row, 'invoiceSentAt', next)}
                            />
                          </span>
                        </span>
                      ) : (
                        <span className="ivt-stack">
                          <span className="ivt-stack__primary">{row.supplierName ?? '—'}</span>
                          <span className="ivt-stack__sub">{[row.invoiceNumber, row.invoiceSentAt && formatISODate(row.invoiceSentAt)].filter(Boolean).join(' · ') || '—'}</span>
                        </span>
                      )}
                    </td>
                    {/* Cột 5 — ĐỐI SOÁT SỐ TIỀN: 3 đầu tiền, inline-edit. */}
                    <td data-label="Đối soát số tiền">
                      {canWrite ? (
                        <span className="ivt-stack">
                          <span className="ivt-stack__primary ivt-inline-pair">
                            <span className="ivt-money-label">Thu KH:</span>
                            <InlineCellInput
                              value={row.invoiceAmount}
                              numeric
                              ariaLabel={`Số tiền thu — ${row.containerNumber ?? index + 1}`}
                              onCommit={(next) => commitCell(row, 'invoiceAmount', next)}
                            />
                          </span>
                          <span className="ivt-stack__sub ivt-inline-pair">
                            <span className="ivt-money-label">Trả NCC:</span>
                            <InlineCellInput
                              value={row.supplierPayment}
                              numeric
                              ariaLabel={`Số tiền trả — ${row.containerNumber ?? index + 1}`}
                              onCommit={(next) => commitCell(row, 'supplierPayment', next)}
                            />
                            <span className="ivt-money-label">Trả KH:</span>
                            <InlineCellInput
                              value={row.comAmount ?? ''}
                              numeric
                              ariaLabel={`Số tiền trả KH — ${row.containerNumber ?? index + 1}`}
                              onCommit={(next) => commitCell(row, 'comAmount', next)}
                            />
                          </span>
                        </span>
                      ) : (
                        <span className="ivt-stack">
                          <span className="ivt-stack__primary">{`Thu KH: ${formatMoney(Number(row.invoiceAmount))} ₫`}</span>
                          <span className="ivt-stack__sub">{`Trả NCC: ${formatMoney(Number(row.supplierPayment))} ₫ · Trả KH: ${row.comAmount == null ? '—' : `${formatMoney(Number(row.comAmount))} ₫`}${row.comNote ? ` (${row.comNote})` : ''}`}</span>
                        </span>
                      )}
                    </td>
                    {/* Cột 6 — CHÊNH LỆCH (auto = thu − trả − trả KH). */}
                    <td data-label="Chênh lệch" className="ivt-diff" title={INVOICE_TRACKING_DIFF_FORMULA}>
                      {`${formatMoney(Number(row.invoiceAmount) - Number(row.supplierPayment) - (row.comAmount == null ? 0 : Number(row.comAmount)))} ₫`}
                    </td>
                    {/* Cột 7 — GHI CHÚ & ĐNTT. */}
                    <td data-label="Ghi chú & ĐNTT">
                      <span className="ivt-stack">
                        {canWrite ? (
                          <span className="ivt-stack__primary">
                            <InlineCellInput
                              value={row.note ?? ''}
                              ariaLabel={`Ghi chú — ${row.containerNumber ?? index + 1}`}
                              placeholder="Ghi chú"
                              onCommit={(next) => commitCell(row, 'note', next)}
                            />
                          </span>
                        ) : (
                          <span className="ivt-stack__primary">{row.note ?? '—'}</span>
                        )}
                        <span className="ivt-stack__sub">{row.dnttNumbers.length > 0 ? <span className="ivt-badge">ĐNTT: {row.dnttNumbers.join(', ')}</span> : '—'}</span>
                      </span>
                    </td>
                    {/* Cột 8 — TIẾN ĐỘ XỬ LÝ: select + nút nhanh Lưu và Ẩn. */}
                    <td data-label="Tiến độ xử lý" className="ivt-col--progress">
                      <span className="ivt-stack">
                        {canWrite ? (
                          <>
                            <UuiSelectField
                              wrapperClassName="ivt-progress-select"
                              label="Tiến độ"
                              hideLabel
                              value={progressDisplayOf(row)}
                              disabled={patchMutation.isPending || hideMutation.isPending}
                              onChange={(event) => changeProgress(row, event.target.value)}
                              options={[
                                { value: CHUA_LAY_HD, label: CHUA_LAY_HD },
                                { value: 'Đã có HĐ', label: 'Đã có HĐ' },
                                { value: 'Đã gửi HĐ', label: 'Đã gửi HĐ' },
                                { value: KHONG_LAY_HD, label: KHONG_LAY_HD },
                              ]}
                            />
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm ivt-quick-hide"
                              aria-label={`Lưu và Ẩn dòng ${row.containerNumber ?? index + 1}`}
                              title="Không lấy hóa đơn — ẩn dòng này khỏi danh sách chờ"
                              disabled={hideMutation.isPending}
                              onClick={() => void handleSaveAndHide([row.id])}
                            >
                              <EyeOff size={13} /> Lưu và Ẩn
                            </button>
                          </>
                        ) : (
                          <span className="ivt-stack__primary">{progressDisplayOf(row)}</span>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {createModalOpen && (
        <InvoiceTrackingFormModal
          mode="create"
          row={null}
          onClose={() => setCreateModalOpen(false)}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}
