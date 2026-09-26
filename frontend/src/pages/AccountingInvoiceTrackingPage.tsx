// Card 20260921_18 — THEO DÕI HÓA ĐƠN KẾT HỢP. Kế toán manages combined-invoice
// tracking rows per lot trip; CUS reaches the same page read-only (server-enforced).
// Header Tổng band recomputes over the filtered rows (worked example in the card plan).

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSearch, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import {
  INVOICE_TRACKING_PROGRESS,
  INVOICE_TRACKING_PROGRESS_LABELS,
  Role,
  type InvoiceTrackingProgress,
  type InvoiceTrackingRow,
} from '@tingting/shared';
import { Btn, useConfirm } from '../components/UI';
import { useReasonPrompt } from '../components/reason-prompt';
import { DateRangePopover, type DateRangePreset, type DateRangeValue } from '../design-system/forms/DateRangePopover';
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
import { EmptyState } from '../design-system';
import './AccountingInvoiceTrackingPage.css';

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT];

/** Σ hóa đơn / Σ trả NCC / chênh lệch over the rows currently on screen —
 *  the header band recomputes on every period filter change (card worked
 *  example: 12.000.000/8.000.000 + 5.500.000/6.000.000 → 17.500.000 / 14.000.000 / 3.500.000). */
export function computeTotals(rows: ReadonlyArray<{ invoiceAmount: string; supplierPayment: string }>): {
  invoice: number;
  paid: number;
  difference: number;
} {
  let invoice = 0;
  let paid = 0;
  for (const row of rows) {
    invoice += Number(row.invoiceAmount);
    paid += Number(row.supplierPayment);
  }
  return { invoice, paid, difference: invoice - paid };
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
  const { confirm, dialog } = useConfirm();
  const { prompt, dialog: reasonDialog } = useReasonPrompt();

  const query = useQuery({
    queryKey: qk.invoiceTracking.list(from, to),
    queryFn: () => listInvoiceTracking(from, to),
  });
  const rows = query.data?.rows ?? [];
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
  const colCount = canWrite ? 14 : 13;

  const clearFilters = () => { setSearch(''); setSupplier(''); setDiffOnly(false); };
  const hasActiveFilters = Boolean(search.trim() || supplier || diffOnly);

  const exportExcel = () => {
    const headers = ['STT', 'Ngày', 'Lô hàng', 'Khách hàng', 'Cont', 'MST', 'Nhà cung cấp', 'Số hóa đơn', 'Số tiền hóa đơn', 'Số tiền trả', 'COM', 'Chênh lệch', 'Ngày gửi hđ', 'Ghi chú', 'Tiến độ'];
    const body = filtered.map((row, index) => [
      index + 1,
      formatISODate(row.expenseDate),
      row.shipmentCode ?? '',
      row.customerName ?? '',
      row.containerNumber ?? '',
      row.taxCode ?? '',
      row.supplierName ?? '',
      row.invoiceNumber ?? '',
      Number(row.invoiceAmount),
      Number(row.supplierPayment),
      row.comNote ?? '',
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

      <header className="invoice-tracking-header" aria-label="Theo dõi hóa đơn kết hợp">
        <div className="invoice-tracking-header__row">
          <h1>Theo dõi hóa đơn kết hợp</h1>
          <div className="invoice-tracking-kpi" role="status" aria-label="Tổng cộng theo kỳ">
            <span className="invoice-tracking-kpi__item">Hóa đơn: <strong className="ivt-money">{formatMoney(totals.invoice)} ₫</strong></span>
            <span className="invoice-tracking-kpi__item">Trả NCC: <strong className="ivt-money">{formatMoney(totals.paid)} ₫</strong></span>
            <span className="invoice-tracking-kpi__item">Chênh lệch: <strong className={`ivt-money ${totals.difference === 0 ? 'ivt-money--flat' : totals.difference > 0 ? 'ivt-money--over' : 'ivt-money--under'}`}>{formatMoney(totals.difference)} ₫</strong></span>
          </div>
          <div className="invoice-tracking-header__actions">
            <Btn variant="secondary" size="sm" icon={<Download size={14} />} onClick={exportExcel}>Xuất Excel</Btn>
            {canWrite && (
              <Btn variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setModal({ mode: 'create' })}>
                Thêm chi phí lô hàng
                </Btn>
            )}
          </div>
        </div>

        <div className="invoice-tracking-filters" role="search" aria-label="Bộ lọc hóa đơn">
          <DateRangePopover
            id="ivt-period"
            className="invoice-tracking-range"
            ariaLabel="Kỳ theo dõi"
            size="sm"
            value={period}
            onChange={setPeriod}
            presets={periodPresets}
          />
          <div className="invoice-tracking-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="text"
              aria-label="Tìm theo số HĐ, MST, lô, cont"
              placeholder="Số HĐ, MST, Lô, Cont..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <UuiSelectField
            wrapperClassName="invoice-tracking-supplier"
            label="Nhà cung cấp"
            hideLabel
            value={supplier}
            onChange={(event) => setSupplier(event.target.value)}
            options={[{ value: '', label: 'Nhà cung cấp: tất cả' }, ...supplierOptions.map((name) => ({ value: name, label: name }))]}
          />
          <UuiSelectField
            wrapperClassName="invoice-tracking-diff"
            label="Chênh lệch"
            hideLabel
            value={diffOnly ? 'diff' : 'all'}
            onChange={(event) => setDiffOnly(event.target.value === 'diff')}
            options={[{ value: 'all', label: 'Tất cả' }, { value: 'diff', label: 'Chỉ xem dòng có lệch' }]}
          />
          <Btn variant="ghost" size="sm" icon={<RotateCcw size={13} />} disabled={!hasActiveFilters} onClick={clearFilters}>Xóa lọc</Btn>
        </div>
      </header>

      {actionError && <p className="invoice-tracking-alert" role="alert">{actionError}</p>}

      <div className="table-scroll">
        <table className="tt-table invoice-tracking-table">
          <thead>
            <tr>
              <th>STT</th>
              <th>Ngày</th>
              <th>Thông tin lô hàng</th>
              <th>Cont</th>
              <th>MST</th>
              <th>Nhà cung cấp hđ</th>
              <th>Thông tin hđ</th>
              <th>Số tiền trả</th>
              <th>COM</th>
              <th title="Số tiền hóa đơn − Số tiền trả">Chênh lệch</th>
              <th>Ngày gửi hđ</th>
              <th>Ghi chú</th>
              <th>Tiến độ</th>
              {canWrite && <th>Thao tác</th>}
            </tr>
          </thead>
          <tbody>
            {query.isPending && (
              <tr><td colSpan={colCount}>Đang tải…</td></tr>
            )}
            {!query.isPending && query.isError && (
              <tr><td colSpan={colCount}>Không tải được dữ liệu. Vui lòng thử lại.</td></tr>
            )}
            {!query.isPending && !query.isError && rows.length === 0 && (
              <tr><td colSpan={colCount} className="invoice-tracking-empty">
                <EmptyState
                  variant="compact"
                  icon={FileSearch}
                  title="Không tìm thấy hóa đơn nào trong kỳ đã chọn"
                  description={hasActiveFilters ? undefined : 'Thêm chi phí lô hàng để bắt đầu theo dõi.'}
                  action={hasActiveFilters ? <button type="button" className="btn btn--ghost btn--sm" onClick={clearFilters}>Xóa bộ lọc ngày</button> : undefined}
                />
              </td></tr>
            )}
            {!query.isPending && !query.isError && rows.length > 0 && filtered.length === 0 && (
              <tr><td colSpan={colCount} className="invoice-tracking-empty">
                <EmptyState
                  variant="compact"
                  icon={FileSearch}
                  title="Không tìm thấy hóa đơn nào trong kỳ đã chọn"
                  description="Không dòng nào khớp bộ lọc hiện tại."
                  action={<button type="button" className="btn btn--ghost btn--sm" onClick={clearFilters}>Xóa bộ lọc ngày</button>}
                />
              </td></tr>
            )}
            {filtered.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td>{formatISODate(row.expenseDate)}</td>
                <td>
                  <span className="ivt-stack">
                    <span className="ivt-stack__primary">{formatBusinessRef(row.shipmentCode)}</span>
                    <span className="ivt-stack__sub">{formatBusinessRef(row.customerName)}</span>
                  </span>
                </td>
                <td>{formatBusinessRef(row.containerNumber)}</td>
                <td>{formatBusinessRef(row.taxCode)}</td>
                <td>{formatBusinessRef(row.supplierName)}</td>
                <td>
                  <span className="ivt-stack">
                    <span>Số hóa đơn: {formatBusinessRef(row.invoiceNumber)}</span>
                    <span>Số tiền: {formatMoney(Number(row.invoiceAmount))} ₫</span>
                  </span>
                </td>
                <td>{formatMoney(Number(row.supplierPayment))} ₫</td>
                <td>{formatBusinessRef(row.comNote)}</td>
                <td title="Số tiền hóa đơn − Số tiền trả">
                  {formatMoney(Number(row.invoiceAmount) - Number(row.supplierPayment))} ₫
                </td>
                <td>{formatISODate(row.invoiceSentAt)}</td>
                <td>{formatBusinessRef(row.note)}</td>
                <td>
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
                  <td className="invoice-tracking-actions">
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
