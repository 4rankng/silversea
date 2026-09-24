// Card 20260921_18 — THEO DÕI HÓA ĐƠN KẾT HỢP. Kế toán manages combined-invoice
// tracking rows per lot trip; CUS reaches the same page read-only (server-enforced).
// Header Tổng band recomputes over the filtered rows (worked example in the card plan).

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  INVOICE_TRACKING_PROGRESS,
  INVOICE_TRACKING_PROGRESS_LABELS,
  Role,
  type InvoiceTrackingProgress,
  type InvoiceTrackingRow,
} from '@tingting/shared';
import { Btn, PageHeader, useConfirm } from '../components/UI';
import { useReasonPrompt } from '../components/reason-prompt';
import { BufferedUuiDateInput } from '../design-system/forms/BufferedUuiDateInput';
import { UuiSelectField } from '../design-system/forms/UuiSelectField';
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

export default function AccountingInvoiceTrackingPage() {
  const { user } = useAuth();
  const canWrite = WRITE_ROLES.includes(getModernRole(user?.role ?? '') as Role);
  const queryClient = useQueryClient();
  const initialPeriod = useMemo(defaultPeriod, []);
  const [from, setFrom] = useState(initialPeriod.from);
  const [to, setTo] = useState(initialPeriod.to);
  const [actionError, setActionError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; row: InvoiceTrackingRow } | null>(null);
  const { confirm, dialog } = useConfirm();
  const { prompt, dialog: reasonDialog } = useReasonPrompt();

  const query = useQuery({
    queryKey: qk.invoiceTracking.list(from, to),
    queryFn: () => listInvoiceTracking(from, to),
  });
  const rows = query.data?.rows ?? [];
  const totals = computeTotals(rows);
  const colCount = canWrite ? 14 : 13;

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
      <PageHeader title="Theo dõi hóa đơn kết hợp" description="Kế toán quản lý hóa đơn kết hợp theo lô hàng; chứng từ xem chỉ-đọc." />
      {dialog}
      {reasonDialog}
      <p className="invoice-tracking-page__intro">
        Quản lý số hóa đơn, số tiền hóa đơn và số tiền trả nhà cung cấp theo từng lô hàng.
      </p>

      <section className="invoice-tracking-period" aria-label="Kỳ theo dõi">
        <div className="invoice-tracking-period__fields">
          <BufferedUuiDateInput label="Từ ngày" size="sm" value={from} max={to || undefined} onChange={setFrom} />
          <BufferedUuiDateInput label="Đến ngày" size="sm" value={to} min={from || undefined} onChange={setTo} />
        </div>
        <Btn variant="secondary" size="sm" onClick={() => void query.refetch()}>Lọc</Btn>
        {canWrite && (
          <Btn variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setModal({ mode: 'create' })}>
            Thêm chi phí lô hàng
          </Btn>
        )}
      </section>

      <section className="invoice-tracking-totals" aria-label="Tổng cộng theo kỳ">
        <div className="invoice-tracking-totals__tile">
          <span>Tổng tiền hóa đơn</span>
          <strong>{formatMoney(totals.invoice)} ₫</strong>
        </div>
        <div className="invoice-tracking-totals__tile">
          <span>Tổng trả NCC</span>
          <strong>{formatMoney(totals.paid)} ₫</strong>
        </div>
        <div className="invoice-tracking-totals__tile">
          <span>Tổng chênh lệch</span>
          <strong>{formatMoney(totals.difference)} ₫</strong>
        </div>
      </section>

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
              <tr><td colSpan={colCount}>Chưa có hóa đơn nào trong kỳ.</td></tr>
            )}
            {rows.map((row, index) => (
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
