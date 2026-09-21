// Card 20260921_18 — THEO DÕI HÓA ĐƠN KẾT HỢP. Kế toán manages combined-invoice
// tracking rows per lot trip; CUS reaches the same page read-only (server-enforced).
// Header Tổng band recomputes over the filtered rows (worked example in the card plan).

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  INVOICE_TRACKING_PROGRESS,
  INVOICE_TRACKING_PROGRESS_LABELS,
  Role,
  type InvoiceTrackingProgress,
  type InvoiceTrackingRow,
} from '@tingting/shared';
import { Btn, FormGroup, Modal, PageHeader, useConfirm } from '../components/UI';
import { BufferedUuiDateInput } from '../design-system/forms/BufferedUuiDateInput';
import {
  createInvoiceTracking,
  deleteInvoiceTracking,
  listInvoiceTracking,
  updateInvoiceTracking,
} from '../api/invoiceTrackingClient';
import { getShipmentDetail, listShipments } from '../api/shipmentClient';
import { useAuth } from '../hooks/useAuth';
import { getModernRole } from '../lib/role-helpers';
import { businessDateISO, formatISODate, formatMoney } from '../lib/format';
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

  const query = useQuery({
    queryKey: ['invoice-tracking', from, to],
    queryFn: () => listInvoiceTracking(from, to),
  });
  const rows = query.data?.rows ?? [];
  const totals = computeTotals(rows);
  const colCount = canWrite ? 14 : 13;

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['invoice-tracking'] });

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
    mutationFn: (id: number) => deleteInvoiceTracking(id),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (error: Error) => setActionError(error.message),
  });

  const handleDelete = async (row: InvoiceTrackingRow) => {
    const ok = await confirm(
      `Xóa theo dõi hóa đơn ${row.invoiceNumber ?? ''}? Khoản "Chi phí hóa đơn" trên lô cũng sẽ bị xóa.`,
      { variant: 'danger', confirmLabel: 'Xóa' },
    );
    if (ok) deleteMutation.mutate(row.id);
  };

  return (
    <div className="invoice-tracking-page">
      <PageHeader title="Theo dõi hóa đơn kết hợp" description="Kế toán quản lý hóa đơn kết hợp theo lô hàng; chứng từ xem chỉ-đọc." />
      {dialog}
      <p className="invoice-tracking-page__intro">
        Quản lý số hóa đơn, số tiền hóa đơn và số tiền trả nhà cung cấp theo từng lô hàng.
        Vai trò Chứng từ chỉ xem, mọi thay đổi do kế toán thực hiện.
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
                    <span className="ivt-stack__primary">{row.shipmentCode ?? '—'}</span>
                    <span className="ivt-stack__sub">{row.customerName ?? ''}</span>
                    </span>
                </td>
                <td>{row.containerNumber ?? '—'}</td>
                <td>{row.taxCode ?? '—'}</td>
                <td>{row.supplierName ?? '—'}</td>
                <td>
                  <span className="ivt-stack">
                    <span>Số hóa đơn: {row.invoiceNumber ?? '—'}</span>
                    <span>Số tiền: {formatMoney(Number(row.invoiceAmount))} ₫</span>
                  </span>
                </td>
                <td>{formatMoney(Number(row.supplierPayment))} ₫</td>
                <td>{row.comNote ?? '—'}</td>
                <td title="Số tiền hóa đơn − Số tiền trả">
                  {formatMoney(Number(row.invoiceAmount) - Number(row.supplierPayment))} ₫
                </td>
                <td>{formatISODate(row.invoiceSentAt)}</td>
                <td>{row.note ?? '—'}</td>
                <td>
                  {canWrite ? (
                    <select
                      className="invoice-tracking-progress"
                      value={row.progress}
                      aria-label="Tiến độ"
                      disabled={progressMutation.isPending}
                      onChange={(event) => progressMutation.mutate({ id: row.id, progress: event.target.value as InvoiceTrackingProgress })}
                    >
                      {INVOICE_TRACKING_PROGRESS.map((value) => (
                        <option key={value} value={value}>{INVOICE_TRACKING_PROGRESS_LABELS[value]}</option>
                      ))}
                    </select>
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

interface LotOption {
  id: number;
  shipmentCode: string | null;
  customerName: string | null;
}

interface TripOption {
  tripId: number;
  label: string;
}

interface InvoiceTrackingFormModalProps {
  mode: 'create' | 'edit';
  row: InvoiceTrackingRow | null;
  onClose: () => void;
  onSaved: () => void;
}

function InvoiceTrackingFormModal({ mode, row, onClose, onSaved }: InvoiceTrackingFormModalProps) {
  const today = businessDateISO();
  const [invoiceNumber, setInvoiceNumber] = useState(row?.invoiceNumber ?? '');
  const [invoiceAmount, setInvoiceAmount] = useState(mode === 'edit' && row ? String(Number(row.invoiceAmount)) : '');
  const [supplierPayment, setSupplierPayment] = useState(mode === 'edit' && row ? String(Number(row.supplierPayment)) : '');
  const [taxCode, setTaxCode] = useState(row?.taxCode ?? '');
  const [supplierName, setSupplierName] = useState(row?.supplierName ?? '');
  const [comNote, setComNote] = useState(row?.comNote ?? '');
  const [expenseDate, setExpenseDate] = useState(row?.expenseDate ?? today);
  const [progress, setProgress] = useState<InvoiceTrackingProgress>(row?.progress ?? 'CHUA_GUI');
  const [note, setNote] = useState(row?.note ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  // Lot picker (create only): the patch schema pins the lot/trip, so the edit
  // mode renders them read-only text instead of a picker.
  const [lotQuery, setLotQuery] = useState('');
  const [lotResults, setLotResults] = useState<LotOption[]>([]);
  const [pickedLot, setPickedLot] = useState<LotOption | null>(null);
  const [tripOptions, setTripOptions] = useState<TripOption[]>([]);
  const [tripId, setTripId] = useState<number | null>(null);
  const [lotError, setLotError] = useState<string | null>(null);
  const [lotLoading, setLotLoading] = useState(false);
  const searchSeq = useRef(0);

  const searchLots = async (text: string) => {
    setLotQuery(text);
    const q = text.trim();
    if (q.length < 4) {
      setLotResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    setLotLoading(true);
    try {
      const response = await listShipments({ q, limit: 8 });
      if (searchSeq.current !== seq) return;
      setLotResults(response.items.map((item) => ({ id: item.id, shipmentCode: item.shipmentCode, customerName: item.customerName })));
    } catch {
      if (searchSeq.current === seq) setLotResults([]);
    } finally {
      if (searchSeq.current === seq) setLotLoading(false);
    }
  };

  const pickLot = async (lot: LotOption) => {
    setPickedLot(lot);
    setLotResults([]);
    setLotQuery('');
    setTripId(null);
    setTripOptions([]);
    setLotError(null);
    setLotLoading(true);
    try {
      const detail = await getShipmentDetail(lot.id);
      const seen = new Set<number>();
      const trips: TripOption[] = [];
      for (const item of detail.podReviews) {
        if (item.tripId == null || seen.has(item.tripId)) continue;
        seen.add(item.tripId);
        const label = [item.tripCode, item.containerNumber, item.tripStatus].filter(Boolean).join(' · ');
        trips.push({ tripId: item.tripId, label: label || 'Chuyến chưa có mã' });
      }
      setTripOptions(trips);
      if (trips.length === 1) setTripId(trips[0].tripId);
      if (trips.length === 0) setLotError('Lô chưa có chuyến nào để gắn chi phí hóa đơn.');
    } catch {
      setLotError('Không tải được danh sách chuyến của lô.');
    } finally {
      setLotLoading(false);
    }
  };

  const handleSubmit = async () => {
    const trimmedInvoiceNumber = invoiceNumber.trim();
    const invoiceAmountValue = Number(invoiceAmount);
    const supplierPaymentValue = Number(supplierPayment);
    const problems: string[] = [];
    if (!trimmedInvoiceNumber) problems.push('Số hóa đơn là bắt buộc.');
    if (!Number.isInteger(invoiceAmountValue) || invoiceAmountValue < 0) problems.push('Số tiền hóa đơn phải là số nguyên không âm.');
    if (!Number.isInteger(supplierPaymentValue) || supplierPaymentValue < 0) problems.push('Số tiền trả NCC phải là số nguyên không âm.');
    if (problems.length > 0) {
      setFormError(problems.join(' '));
      return;
    }
    setFormError(null);
    const payload = {
      invoiceNumber: trimmedInvoiceNumber,
      invoiceAmount: invoiceAmountValue,
      supplierPayment: supplierPaymentValue,
      taxCode: taxCode.trim() || null,
      supplierName: supplierName.trim() || null,
      comNote: comNote.trim() || null,
      expenseDate,
      progress,
      note: note.trim() || null,
    };
    try {
      if (mode === 'create') {
        if (pickedLot == null || tripId == null) {
          setFormError('Chọn lô hàng và chuyến trước khi lưu.');
          return;
        }
        await createInvoiceTracking({ ...payload, shipmentId: pickedLot.id, tripId });
      } else if (row) {
        await updateInvoiceTracking(row.id, payload);
      }
      onSaved();
      onClose();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Không lưu được thông tin hóa đơn.');
    }
  };

  return (
    <Modal isOpen title={mode === 'create' ? 'Thêm chi phí lô hàng' : 'Sửa theo dõi hóa đơn'} onClose={onClose} maxWidth={560}>
      <div className="invoice-tracking-form">
        {mode === 'create' && (
          <div className="invoice-tracking-lot-picker">
            <FormGroup label="Mã lô" htmlFor="ivt-lot">
              <input
                id="ivt-lot"
                className="input"
                value={lotQuery}
                placeholder="Nhập tối thiểu 4 ký tự để tìm lô"
                onChange={(event) => void searchLots(event.target.value)}
              />
            </FormGroup>
            {lotLoading && <p className="ivt-hint">Đang tìm lô…</p>}
            {lotResults.length > 0 && (
              <ul className="ivt-lot-results">
                {lotResults.map((lot) => (
                  <li key={lot.id}>
                    <button type="button" onClick={() => void pickLot(lot)}>
                      <span className="ivt-stack__primary">{lot.shipmentCode ?? '—'}</span>
                      <span className="ivt-stack__sub">{lot.customerName ?? ''}</span>
                    </button>
 </li>
                ))}
              </ul>
            )}
            {pickedLot && (
              <p className="ivt-hint">
                Lô đã chọn: <strong>{pickedLot.shipmentCode ?? '—'}</strong>{pickedLot.customerName ? ` — ${pickedLot.customerName}` : ''}
              </p>
            )}
            {tripOptions.length > 0 && (
              <FormGroup label="Chuyến (cont)" htmlFor="ivt-trip">
                <select id="ivt-trip" className="input" value={tripId ?? ''} onChange={(event) => setTripId(Number(event.target.value))}>
                  {tripOptions.map((trip) => (
                    <option key={trip.tripId} value={trip.tripId}>{trip.label}</option>
                  ))}
                </select>
              </FormGroup>
            )}
            {lotError && <p className="ivt-hint ivt-hint--error" role="alert">{lotError}</p>}
          </div>
        )}

        <div className="invoice-tracking-form__grid">
          <FormGroup label="Số hóa đơn" htmlFor="ivt-invoice-number">
            <input id="ivt-invoice-number" className="input" value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} />
          </FormGroup>
          <FormGroup label="Số tiền hóa đơn (₫)" htmlFor="ivt-invoice-amount">
            <input id="ivt-invoice-amount" className="input" type="number" min="0" step="1" value={invoiceAmount} onChange={(event) => setInvoiceAmount(event.target.value)} />
          </FormGroup>
          <FormGroup label="Số tiền trả NCC (₫)" htmlFor="ivt-supplier-payment">
            <input id="ivt-supplier-payment" className="input" type="number" min="0" step="1" value={supplierPayment} onChange={(event) => setSupplierPayment(event.target.value)} />
          </FormGroup>
          <FormGroup label="MST" htmlFor="ivt-tax-code">
            <input id="ivt-tax-code" className="input" value={taxCode} onChange={(event) => setTaxCode(event.target.value)} />
          </FormGroup>
          <FormGroup label="Nhà cung cấp" htmlFor="ivt-supplier-name">
            <input id="ivt-supplier-name" className="input" value={supplierName} onChange={(event) => setSupplierName(event.target.value)} />
          </FormGroup>
          <FormGroup label="COM" htmlFor="ivt-com-note">
            <input id="ivt-com-note" className="input" value={comNote} onChange={(event) => setComNote(event.target.value)} />
          </FormGroup>
          <FormGroup label="Ngày" htmlFor="ivt-expense-date">
            <input id="ivt-expense-date" className="input" type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} />
          </FormGroup>
          <FormGroup label="Tiến độ" htmlFor="ivt-progress">
            <select id="ivt-progress" className="input" value={progress} onChange={(event) => setProgress(event.target.value as InvoiceTrackingProgress)}>
              {INVOICE_TRACKING_PROGRESS.map((value) => (
                <option key={value} value={value}>{INVOICE_TRACKING_PROGRESS_LABELS[value]}</option>
              ))}
            </select>
          </FormGroup>
          <FormGroup label="Ghi chú" htmlFor="ivt-note">
            <input id="ivt-note" className="input" value={note} onChange={(event) => setNote(event.target.value)} />
          </FormGroup>
        </div>

        {formError && <p className="ivt-hint ivt-hint--error" role="alert">{formError}</p>}

        <footer className="invoice-tracking-form__footer">
          <Btn variant="secondary" size="sm" onClick={onClose}>Hủy</Btn>
          <Btn variant="primary" size="sm" onClick={() => void handleSubmit()}>Lưu</Btn>
        </footer>
      </div>
    </Modal>
  );
}
