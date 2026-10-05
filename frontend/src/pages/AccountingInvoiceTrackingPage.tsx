// Card 20260921_18 — THEO DÕI HÓA ĐƠN KẾT HỢP. Kế toán manages combined-invoice
// tracking rows per lot trip; CUS reaches the same page read-only (server-enforced).
// Header Tổng band recomputes over the filtered rows (worked example in the card plan).

import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  INVOICE_TRACKING_PROGRESS,
  INVOICE_TRACKING_PROGRESS_LABELS,
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

/** Σ hóa đơn / Σ trả NCC / chênh lệch over the rows currently on screen —
 *  the header band recomputes on every period filter change (card worked
 *  example: 12.000.000/8.000.000 + 5.500.000/6.000.000 → 17.500.000 / 14.000.000 / 3.500.000).
 *  Card 2026-10-05_384 adds Σ COM as a FOURTH, independent box: COM is a
 *  customer-side deduction, so it is deliberately NOT folded into `difference`,
 *  which stays `invoice − paid`. A row with no `comAmount` (every pre-card row)
 *  contributes 0, never `NaN`. */
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
  return { invoice, paid, difference: invoice - paid, com: round2dp(com) };
}

/** First-of-month..today, Vietnam business timezone (house date helpers). */
function defaultPeriod(): { from: string; to: string } {
  const today = businessDateISO();
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** Preset ranges evaluated at click time so they stay today-anchored. */
function buildPeriodPresets(): DateRangePreset[] {
  const today = businessDateISO();
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const last = (y2: number, m2: number) => new Date(Date.UTC(y2, m2 - 1, 0)).getUTCDate();
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

/** Card 2026-10-05_384 — the COM cell carries the AMOUNT, and never hides the
 *  legacy note. A row created before the card has text in `comNote` and a null
 *  `comAmount`; a row created after it has the number and may still carry a
 *  note. So: amount first (the money is what the column is now for), note
 *  underneath whenever there is one, and the house `—` only when both are
 *  empty. Neither field is ever dropped because the other is present. */
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
  const [actionError, setActionError] = useState<string | null>(null);
  const { from, to } = period;
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; row: InvoiceTrackingRow } | null>(null);
  const { dialog } = useConfirm();
  const { prompt, dialog: reasonDialog } = useReasonPrompt();

  const query = useQuery({
    queryKey: qk.invoiceTracking.list(from, to),
    queryFn: () => listInvoiceTracking(from, to),
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
      const haystack = [r.invoiceNumber, r.taxCode, r.shipmentCode, r.containerNumber].map(v => (v ?? '').toLowerCase());
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
  };
  const hasActiveFilters = Boolean(periodChanged || search.trim() || supplier || diffOnly);

  // Card 20260927_152: the two criteria behind `Bộ lọc` — the count feeds the
  // trigger badge, `Đặt lại` clears exactly those two and nothing else.
  const secondaryCount = (supplier ? 1 : 0) + (diffOnly ? 1 : 0);
  const resetSecondary = () => { setSupplier(''); setDiffOnly(false); };
  const presetNode = <DateRangePresets presets={periodPresets} value={period} onChange={setPeriod} ariaLabel="Kỳ theo dõi nhanh" />;
  const presetDialogNode = <DateRangePresetSelect presets={periodPresets} value={period} onChange={setPeriod} ariaLabel="Kỳ theo dõi nhanh" />;

  const exportExcel = () => {
    // Card 20261005_383: "Loại cont" and "Xuất/Nhập" are derived beside the
    // container number, so the sheet carries the same three facts as the cell.
    // Card 2026-10-05_384: the pre-existing `COM` column is now the AMOUNT, and
    // the legacy free text moves to its own `Ghi chú COM` column right beside
    // it — so an old note is never lost and the amount is never a word.
    const headers = ['STT', 'Ngày', 'Lô hàng', 'Khách hàng', 'Cont', 'Loại cont', 'Xuất/Nhập', 'MST', 'Nhà cung cấp', 'Số hóa đơn', 'Số tiền hóa đơn', 'Số tiền trả', 'COM', 'Ghi chú COM', 'Chênh lệch', 'Ngày gửi hđ', 'Ghi chú', 'Tiến độ'];
    const body = filtered.map((row, index) => [
      index + 1,
      formatISODate(row.expenseDate),
      row.shipmentCode ?? '',
      row.customerName ?? '',
      row.containerNumber ?? '',
      row.containerType ?? '',
      row.tradeDirection ? TRADE_DIRECTION_LABELS[row.tradeDirection] : '',
      row.taxCode ?? '',
      row.supplierName ?? '',
      row.invoiceNumber ?? '',
      Number(row.invoiceAmount),
      Number(row.supplierPayment),
      // A row with no COM amount exports the raw empty string — never a `0`,
      // which would read as "no commission" instead of "not recorded".
      row.comAmount == null ? '' : Number(row.comAmount),
      row.comNote ?? '',
      // Card 2026-10-05_384: `Chênh lệch` is UNCHANGED — COM is not folded in.
      Number(row.invoiceAmount) - Number(row.supplierPayment),
      formatISODate(row.invoiceSentAt),
      row.note ?? '',
      INVOICE_TRACKING_PROGRESS_LABELS[row.progress],
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

  const deleteMutation = useMutation({
    mutationFn: (input: { id: number; reason: string }) => deleteInvoiceTracking(input.id, input.reason),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (error: Error) => setActionError(error.message),
  });

  const handleDelete = async (row: InvoiceTrackingRow) => {
    // Q10 (card 20260922_78): the delete soft-voids the tracker AND its
    // mirrored lot-fee row — the prompt captures the mandatory free-text
    // reason; cancel aborts without any request.
    const reason = await prompt(
      `Xóa theo dõi hóa đơn ${formatBusinessRef(row.invoiceNumber)}? Khoản "Chi phí hóa đơn" trên lô cũng sẽ được hủy kèm lý do (đối chiếu được).`,
      { confirmLabel: 'Xóa' },
    );
    if (reason == null) return;
    deleteMutation.mutate({ id: row.id, reason });
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

      {/* Σ hóa đơn / Σ trả NCC / chênh lệch over the filtered rows — the shared
          workboard rail recomputes on every period filter change (card worked
          example: 12.000.000/8.000.000 + 5.500.000/6.000.000 →
          17.500.000 / 14.000.000 / 3.500.000). A non-zero difference is the
          signal, so it takes the rail's warning tone. */}
      <SummaryRail
        ariaLabel="Tổng cộng theo kỳ"
        items={[
          { label: 'Hóa đơn', value: `${formatMoney(totals.invoice)} ₫` },
          { label: 'Trả NCC', value: `${formatMoney(totals.paid)} ₫` },
          // Card 2026-10-05_384: the strip grew from 3 boxes to 4 with Σ COM.
          // It sits between Trả NCC and Chênh lệch — the three pre-existing
          // boxes keep their values and their relative order (Hóa đơn → Trả NCC
          // → Chênh lệch) unchanged.
          { label: 'Tổng COM', value: `${formatMoney(totals.com)} ₫` },
          {
            label: 'Chênh lệch',
            value: `${formatMoney(totals.difference)} ₫`,
            tone: totals.difference === 0 ? undefined : 'warning',
          },
        ]}
      />

      {/* Card 20260927_152: the shared bar owns the strip layout. Period
          fields, quick ranges and reset are the primary controls;
          `Nhà cung cấp` / `Chênh lệch` render INLINE while the strip still
          fits two rows and only collapse into `Bộ lọc (N)` when the width
          leaves no other choice. */}
      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Số HĐ, MST, Lô, Cont...',
          ariaLabel: 'Tìm theo số HĐ, MST, lô, cont',
        }}
        presets={presetNode}
        actions={(
          <Btn variant="ghost" size="sm" icon={<RotateCcw size={13} />} disabled={!hasActiveFilters} onClick={clearFilters}>Xóa lọc</Btn>
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
        </FilterDropdown>
      </FilterBar>

      {actionError && <p className="invoice-tracking-alert" role="alert">{actionError}</p>}

      {/* Shared record-table base (styles/record-table.css): sticky thead,
          neutral gated hover, and the container-query record cards below
          1100px of container width. The page declares no table skin, no column
          floor, no breakpoint and no scroll wrapper — the base's own
          `overflow-wrap: anywhere` on every cell is what keeps 14 columns
          inside the desktop canvas instead of forcing a horizontal scroll. */}
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
                <th>STT</th>
                <th>Ngày</th>
                <th>Lô hàng</th>
                <th>Cont</th>
                <th>MST</th>
                <th>Nhà cung cấp</th>
                <th>Hóa đơn</th>
                <th>Số tiền trả</th>
                <th>COM</th>
                <th title="Số tiền hóa đơn − Số tiền trả">Chênh lệch</th>
                <th>Ngày gửi</th>
                <th>Ghi chú</th>
                <th>Tiến độ</th>
                {canWrite && <th>Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, index) => (
                <tr key={row.id}>
                  <td data-label="STT">{index + 1}</td>
                  <td data-label="Ngày" className="num">{formatISODate(row.expenseDate)}</td>
                  <td data-label="Lô hàng">
                    <span className="ivt-stack">
                      <span className="ivt-stack__primary">{formatBusinessRef(row.shipmentCode)}</span>
                      <span className="ivt-stack__sub">{formatBusinessRef(row.customerName)}</span>
                    </span>
                  </td>
                  {/* Card 20261005_383: three derived facts, one column — số
                      cont / loại cont / xuất–nhập. The stacked furniture is the
                      same one the lot and invoice cells already use, and every
                      missing part falls back to the house `—`. */}
                  <td data-label="Cont">
                    <span className="ivt-stack">
                      <span className="ivt-stack__primary">{formatBusinessRef(row.containerNumber)}</span>
                      <span className="ivt-stack__sub">{formatBusinessRef(row.containerType)}</span>
                      <span className="ivt-stack__sub">{row.tradeDirection ? TRADE_DIRECTION_LABELS[row.tradeDirection] : '—'}</span>
                    </span>
                  </td>
                  <td data-label="MST">{formatBusinessRef(row.taxCode)}</td>
                  <td data-label="Nhà cung cấp">{formatBusinessRef(row.supplierName)}</td>
                  <td data-label="Hóa đơn">
                    <span className="ivt-stack">
                      <span className="ivt-stack__primary">Số hóa đơn: {formatBusinessRef(row.invoiceNumber)}</span>
                      {/* The money line is the shared law's business: one text
                          node, one line — the sub class carries the nowrap. */}
                      <span className="ivt-stack__sub">{`Số tiền: ${formatMoney(Number(row.invoiceAmount))} ₫`}</span>
                    </span>
                  </td>
                  {/* The numeric law's rendering: the whole amount + unit is
                      ONE template-literal text node — two adjacent JSX text
                      children give the browser two text nodes, and the ₫ can
                      break onto its own line under wrapping pressure (the
                      staging defect's token-walker signature). */}
                  <td data-label="Số tiền trả" className="num">{`${formatMoney(Number(row.supplierPayment))} ₫`}</td>
                  <td data-label="COM" className="num">{comCellContent(row)}</td>
                  <td data-label="Chênh lệch" className="num" title="Số tiền hóa đơn − Số tiền trả">
                    {`${formatMoney(Number(row.invoiceAmount) - Number(row.supplierPayment))} ₫`}
                  </td>
                  <td data-label="Ngày gửi" className="num">{formatISODate(row.invoiceSentAt)}</td>
                  <td data-label="Ghi chú">{formatBusinessRef(row.note)}</td>
                  <td data-label="Tiến độ">
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
                      <span>{INVOICE_TRACKING_PROGRESS_LABELS[row.progress]}</span>
                    )}
                  </td>
                  {canWrite && (
                    <td data-label="Thao tác" className="invoice-tracking-actions record-table__action">
                      <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label="Sửa" onClick={() => setModal({ mode: 'edit', row })}>
                        <Pencil size={14} />
                      </button>
                      <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label="Xóa" onClick={() => void handleDelete(row)}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
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
