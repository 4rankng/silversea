// Card 20260921_18 — THEO DÕI HÓA ĐƠN KẾT HỢP. Kế toán manages combined-invoice
// tracking rows per lot trip; CUS reaches the same page read-only (server-enforced).
//
// SIL-762 (id 883): the board becomes the 21-column combined sheet —
//   · auto-synced rows (lô [Kết hợp], syncSource='AUTO_COMBINED') render with
//     the "Chưa lấy HĐ" badge until the invoice facts land;
//   · lot identity columns (khách / nhà máy / Bill-tờ khai / hãng tàu / mã KH /
//     MST / ngày vận chuyển) read LIVE from the lot — never re-typed;
//   · Chênh lệch = Số tiền thu − Số tiền trả − Số tiền trả KH (SIL-762 law,
//     superseding the card-384 display rule);
//   · row checkbox → [Lưu và Ẩn] marks "Không lấy hóa đơn" and hides the rows
//     from the working list (noInvoice + hiddenAt/hiddenBy = the trace); the
//     "Dòng đã ẩn" filter brings the history back (Bỏ ẩn restores).
// The old Thao tác column is gone — the 21 columns are the contract: the (+)
// on the NCC cell opens the row editor, progress stays inline, delete rides
// the selection toolbar.

import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, EyeOff, Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  INVOICE_TRACKING_PROGRESS,
  INVOICE_TRACKING_PROGRESS_LABELS,
  INVOICE_TRACKING_PENDING_INVOICE_LABEL,
  INVOICE_TRACKING_DIFF_FORMULA,
  TRADE_DIRECTION_LABELS,
  Role,
  round2dp,
  type InvoiceTrackingProgress,
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
import { businessDateISO, formatBusinessRef, formatISODate, formatMoney } from '../lib/format';
import InvoiceTrackingFormModal from '../features/accounting/InvoiceTrackingFormModal';
import { EmptyState, FilterBar, SummaryRail } from '../design-system';
import { SkeletonTable } from '../components/shared/Skeleton';
import '../styles/record-table.css';
import '../styles/operational-table-typography.css';
import './AccountingInvoiceTrackingPage.css';

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT];

/** Σ hóa đơn (thu) / Σ trả / Σ trả KH / chênh lệch over the rows currently on
 *  screen. SIL-762 formula: Chênh lệch = thu − trả − trả KH (the profit of the
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

/** Card 2026-10-05_384 — the COM (Số tiền trả KH) cell carries the AMOUNT, and
 *  never hides the legacy note. A row created before the card has text in
 *  `comNote` and a null `comAmount`; a row created after it has the number and
 *  may still carry a note. Amount first, note underneath whenever there is
 *  one, and the house `—` only when both are empty. */
function comCellContent(row: { comAmount: string | null; comNote: string | null }): ReactNode {
  const amount = row.comAmount == null ? null : `${formatMoney(Number(row.comAmount))} ₫`;
  const note = formatBusinessRef(row.comNote);
  if (amount == null && note === '—') return '—';
  if (note === '—') return amount;
  return (
    <span className="ivt-stack">
      <span className="ivt-stack__primary">{amount ?? '—'}</span>
      <span className="ivt-stack__sub">{note}</span>
    </span>
  );
}

/** The reference cell: Booking (EXPORT) primary, Bill/tờ khai (IMPORT) rides
 *  beneath when both exist — one fact per line, no invented joiner. */
function billCellContent(row: { bookingRef: string | null; blNumber: string | null }): ReactNode {
  const booking = formatBusinessRef(row.bookingRef);
  const bill = formatBusinessRef(row.blNumber);
  if (booking === '—' && bill === '—') return '—';
  if (booking === '—') return bill;
  if (bill === '—') return booking;
  return (
    <span className="ivt-stack">
      <span className="ivt-stack__primary">{booking}</span>
      <span className="ivt-stack__sub">{bill}</span>
    </span>
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
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; row: InvoiceTrackingRow } | null>(null);
  const { confirm, dialog } = useConfirm();
  const { prompt, dialog: reasonDialog } = useReasonPrompt();

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
    if (diffOnly && Number(r.invoiceAmount) === Number(r.supplierPayment)) return false;
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      const haystack = [r.invoiceNumber, r.taxCode, r.shipmentCode, r.containerNumber, r.bookingRef, r.blNumber].map(v => (v ?? '').toLowerCase());
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

  // Card 20260927_152: the two criteria behind `Bộ lọc` — the count feeds the
  // trigger badge, `Đặt lại` clears exactly those two and nothing else.
  const secondaryCount = (supplier ? 1 : 0) + (diffOnly ? 1 : 0) + (includeHidden ? 1 : 0);
  const resetSecondary = () => { setSupplier(''); setDiffOnly(false); setIncludeHidden(false); };
  const presetNode = <DateRangePresets presets={periodPresets} value={period} onChange={setPeriod} ariaLabel="Kỳ theo dõi nhanh" />;
  const presetDialogNode = <DateRangePresetSelect presets={periodPresets} value={period} onChange={setPeriod} ariaLabel="Kỳ theo dõi nhanh" />;

  const exportExcel = () => {
    // The sheet mirrors the 21-column board (SIL-762) — same order, same
    // Vietnamese headers, and the same derived facts the cells show.
    const headers = ['STT', 'Ngày vận chuyển', 'Khách hàng', 'Nhà máy', 'Bill / Số tờ khai', 'Hãng tàu', 'Cont (20/40)', 'Xuất/Nhập', 'Số Container', 'Mã khách hàng', 'Mã số thuế', 'Nhà cung cấp HĐ', 'Số hóa đơn', 'Số tiền trả', 'Số tiền thu', 'Số tiền trả KH', 'Chênh lệch', 'Ngày gửi HĐ', 'Ghi chú', 'Tiến độ', 'Số ĐNTT'];
    const body = filtered.map((row, index) => [
      index + 1,
      formatISODate(row.transportDate ?? row.expenseDate),
      row.customerName ?? '',
      row.factoryName ?? '',
      row.bookingRef ?? row.blNumber ?? '',
      row.shippingLineName ?? '',
      row.containerType ?? '',
      row.tradeDirection ? TRADE_DIRECTION_LABELS[row.tradeDirection] : '',
      row.containerNumber ?? '',
      row.customerCode ?? '',
      row.taxCode ?? '',
      row.supplierName ?? '',
      row.invoiceNumber ?? '',
      Number(row.supplierPayment),
      Number(row.invoiceAmount),
      // A row with no COM amount exports the raw empty string — never a `0`,
      // which would read as "no deduction" instead of "not recorded".
      row.comAmount == null ? '' : Number(row.comAmount),
      // SIL-762 law: thu − trả − trả KH.
      Number(row.invoiceAmount) - Number(row.supplierPayment) - (row.comAmount == null ? 0 : Number(row.comAmount)),
      formatISODate(row.invoiceSentAt),
      row.note ?? '',
      INVOICE_TRACKING_PROGRESS_LABELS[row.progress],
      row.dnttNumbers.join(', '),
    ]);
    void downloadCSV('theo-doi-hoa-don.xlsx', headers, body, {
      title: 'THEO DÕI HÓA ĐƠN KẾT HỢP',
      subtitle: `Kỳ ${formatISODate(from)} - ${formatISODate(to)}`,
    });
  };

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: qk.invoiceTracking.all });

  const progressMutation = useMutation({
    mutationFn: ({ id, progress }: { id: number; progress: InvoiceTrackingProgress }) =>
      updateInvoiceTracking(id, { progress }),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (error: Error) => setActionError(error.message),
  });

  // SIL-762 — [Lưu và Ẩn]: each selected row ticks "Không lấy hóa đơn" and
  // leaves the working list; hiddenBy/hiddenAt keep the who/when trail.
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

  const handleSaveAndHide = async () => {
    const ids = [...selected];
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

  const toggleRow = (id: number, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  return (
    <div className="invoice-tracking-page">
      {dialog}
      {reasonDialog}

      {/* The screen's name is the sidebar label (page-heading law); the page
          header is the shared primitive, not a page-local `<header>` band. */}
      <PageHeader
        title="Theo dõi hóa đơn"
        action={(
          <>
            <Btn variant="secondary" size="sm" icon={<Download size={14} />} onClick={exportExcel}>Xuất Excel</Btn>
            {canWrite && (
              <Btn variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setModal({ mode: 'create' })}>
                Thêm chi phí lô hàng
              </Btn>
            )}
          </>
        )}
      />

      {/* Σ thu / Σ trả / Σ trả KH / chênh lệch over the filtered rows — the
          shared workboard rail recomputes on every filter change. Chênh lệch
          follows the SIL-762 formula (thu − trả − trả KH) and a non-zero value
          is the signal, so it takes the rail's warning tone. */}
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
          placeholder: 'Số HĐ, MST, Bill, Lô, Cont...',
          ariaLabel: 'Tìm theo số HĐ, MST, Bill, lô, cont',
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
                  onClick={() => void handleSaveAndHide()}
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

      {/* Shared record-table base (styles/record-table.css): sticky thead,
          neutral gated hover, and the container-query record cards below
          1100px of container width. */}
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
          <table className="record-table ops-table">
            <thead>
              <tr>
                {/* The 21-column contract (SIL-762): checkboxes only for the
                    writing roles — a read-only CUS board drops the select
                    column instead of rendering dead controls. */}
                {canWrite && <th aria-label="Chọn dòng" title="Chọn dòng để Lưu và Ẩn / Xóa" className="ivt-col--select" />}
                <th>STT</th>
                <th>Ngày vận chuyển</th>
                <th>Khách hàng</th>
                <th>Nhà máy</th>
                <th>Bill / Số tờ khai</th>
                <th>Hãng tàu</th>
                <th>Cont (20/40)</th>
                <th>Xuất / Nhập</th>
                <th>Số Container</th>
                <th>Mã khách hàng</th>
                <th>Mã số thuế</th>
                <th title="Nhà cung cấp hóa đơn — (+) mở ghi nhận/sửa dòng">Nhà cung cấp HĐ (+)</th>
                <th>Số hóa đơn</th>
                <th>Số tiền trả</th>
                <th>Số tiền thu</th>
                <th>Số tiền trả KH</th>
                <th title={INVOICE_TRACKING_DIFF_FORMULA}>Chênh lệch</th>
                <th>Ngày gửi HĐ</th>
                <th>Ghi chú</th>
                <th>Tiến độ & Số ĐNTT</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, index) => {
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
                    <td data-label="Ngày vận chuyển" className="num">{formatISODate(row.transportDate ?? row.expenseDate)}</td>
                    <td data-label="Khách hàng" className="record-table__text">{formatBusinessRef(row.customerName)}</td>
                    <td data-label="Nhà máy">{formatBusinessRef(row.factoryName)}</td>
                    <td data-label="Bill / Số tờ khai">{billCellContent(row)}</td>
                    <td data-label="Hãng tàu">{formatBusinessRef(row.shippingLineName)}</td>
                    <td data-label="Cont (20/40)">{formatBusinessRef(row.containerType)}</td>
                    <td data-label="Xuất / Nhập">{row.tradeDirection ? TRADE_DIRECTION_LABELS[row.tradeDirection] : '—'}</td>
                    <td data-label="Số Container"><span className="record-table__reference">{formatBusinessRef(row.containerNumber)}</span></td>
                    <td data-label="Mã khách hàng">{formatBusinessRef(row.customerCode)}</td>
                    <td data-label="Mã số thuế">{formatBusinessRef(row.taxCode)}</td>
                    <td data-label="Nhà cung cấp HĐ (+)">
                      <span className="ivt-supplier">
                        <span className="ivt-supplier__name">{formatBusinessRef(row.supplierName)}</span>
                        {canWrite && (
                          <button
                            type="button"
                            className="btn btn--ghost btn--icon btn--sm"
                            aria-label={`Ghi nhận hóa đơn cho cont ${row.containerNumber ?? row.id}`}
                            title="Ghi nhận / sửa hóa đơn của dòng này"
                            onClick={() => setModal({ mode: 'edit', row })}
                          >
                            <Plus size={14} />
                          </button>
                        )}
                      </span>
                    </td>
                    <td data-label="Số hóa đơn">
                      {row.invoiceNumber != null
                        ? <span className="record-table__reference">{formatBusinessRef(row.invoiceNumber)}</span>
                        : row.noInvoice
                          ? <span className="ivt-noinv">Không lấy hóa đơn</span>
                          : <span className="ivt-pending">{INVOICE_TRACKING_PENDING_INVOICE_LABEL}</span>}
                    </td>
                    {/* The numeric law's rendering: the whole amount + unit is
                        ONE template-literal text node — two adjacent JSX text
                        children give the browser two text nodes, and the ₫ can
                        break onto its own line under wrapping pressure. */}
                    <td data-label="Số tiền trả" className="num">{`${formatMoney(Number(row.supplierPayment))} ₫`}</td>
                    <td data-label="Số tiền thu" className="num">{`${formatMoney(Number(row.invoiceAmount))} ₫`}</td>
                    <td data-label="Số tiền trả KH" className="num">{comCellContent(row)}</td>
                    <td data-label="Chênh lệch" className="num" title={INVOICE_TRACKING_DIFF_FORMULA}>
                      {`${formatMoney(Number(row.invoiceAmount) - Number(row.supplierPayment) - (row.comAmount == null ? 0 : Number(row.comAmount)))} ₫`}
                    </td>
                    <td data-label="Ngày gửi HĐ" className="num">{formatISODate(row.invoiceSentAt)}</td>
                    <td data-label="Ghi chú">{formatBusinessRef(row.note)}</td>
                    <td data-label="Tiến độ & Số ĐNTT">
                      <span className="ivt-stack">
                        {canWrite ? (
                          <UuiSelectField
                            wrapperClassName="invoice-tracking-progress"
                            label="Tiến độ"
                            hideLabel
                            value={row.progress}
                            disabled={progressMutation.isPending}
                            onChange={(event) => progressMutation.mutate({ id: row.id, progress: event.target.value as InvoiceTrackingProgress })}
                            options={INVOICE_TRACKING_PROGRESS.map((value) => ({ value, label: INVOICE_TRACKING_PROGRESS_LABELS[value] }))}
                          />
                        ) : (
                          <span className="ivt-stack__primary">{INVOICE_TRACKING_PROGRESS_LABELS[row.progress]}</span>
                        )}
                        <span className="ivt-stack__sub">{row.dnttNumbers.length > 0 ? `ĐNTT: ${row.dnttNumbers.join(', ')}` : '—'}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <InvoiceTrackingFormModal
          mode={modal.mode}
          row={modal.mode === 'edit' ? modal.row : null}
          onClose={() => setModal(null)}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}
