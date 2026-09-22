import { useRef, useState } from 'react';
import { INVOICE_TRACKING_PROGRESS, INVOICE_TRACKING_PROGRESS_LABELS, type InvoiceTrackingProgress, type InvoiceTrackingRow } from '@tingting/shared';
import { Btn, FormGroup, Modal } from '../../components/UI';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
import { createInvoiceTracking, updateInvoiceTracking } from '../../api/invoiceTrackingClient';
import { getShipmentDetail, listShipments } from '../../api/shipmentClient';
import { businessDateISO } from '../../lib/format';

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

export default function InvoiceTrackingFormModal({ mode, row, onClose, onSaved }: InvoiceTrackingFormModalProps) {
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
  const [searchLoading, setSearchLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const searchSeq = useRef(0);
  const detailSeq = useRef(0);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const command = useRef<{ payload: string; key: string } | null>(null);
  const closeWhenIdle = () => { if (!savingRef.current) onClose(); };

  const searchLots = async (text: string) => {
    const seq = ++searchSeq.current;
    setLotQuery(text);
    const q = text.trim();
    if (q.length < 4) {
      setLotResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    try {
      const response = await listShipments({ q, limit: 8 });
      if (searchSeq.current !== seq) return;
      setLotResults(response.items.map((item) => ({ id: item.id, shipmentCode: item.shipmentCode, customerName: item.customerName })));
    } catch {
      if (searchSeq.current === seq) setLotResults([]);
    } finally {
      if (searchSeq.current === seq) setSearchLoading(false);
    }
  };

  const pickLot = async (lot: LotOption) => {
    const seq = ++detailSeq.current;
    ++searchSeq.current;
    setSearchLoading(false);
    setPickedLot(lot);
    setLotResults([]);
    setLotQuery('');
    setTripId(null);
    setTripOptions([]);
    setLotError(null);
    setDetailLoading(true);
    try {
      const detail = await getShipmentDetail(lot.id);
      if (detailSeq.current !== seq) return;
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
      if (detailSeq.current === seq) setLotError('Không tải được danh sách chuyến của lô.');
    } finally {
      if (detailSeq.current === seq) setDetailLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (savingRef.current) return;
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
    if (mode === 'create' && (pickedLot == null || tripId == null)) {
      setFormError('Chọn lô hàng và chuyến trước khi lưu.');
      return;
    }
    const fingerprint = JSON.stringify({ mode, id: row?.id, shipmentId: pickedLot?.id, tripId, ...payload });
    if (command.current?.payload !== fingerprint) command.current = { payload: fingerprint, key: crypto.randomUUID() };
    savingRef.current = true;
    setSaving(true);
    try {
      if (mode === 'create' && pickedLot != null && tripId != null) {
        await createInvoiceTracking({ ...payload, shipmentId: pickedLot.id, tripId }, command.current.key);
      } else if (row) {
        await updateInvoiceTracking(row.id, payload, command.current.key);
      }
      onSaved();
      onClose();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Không lưu được thông tin hóa đơn.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Modal isOpen title={mode === 'create' ? 'Thêm chi phí lô hàng' : 'Sửa theo dõi hóa đơn'} onClose={closeWhenIdle} maxWidth={560}>
      <fieldset className="invoice-tracking-form" disabled={saving} aria-busy={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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
            {(searchLoading || detailLoading) && <p className="ivt-hint">Đang tìm lô…</p>}
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
              <UuiSelectField
                id="ivt-trip"
                label="Chuyến (cont)"
                value={tripId != null ? String(tripId) : ''}
                onChange={(event) => setTripId(Number(event.target.value))}
                options={tripOptions.map((trip) => ({ value: String(trip.tripId), label: trip.label }))}
              />
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
          <UuiSelectField
            id="ivt-progress"
            label="Tiến độ"
            value={progress}
            onChange={(event) => setProgress(event.target.value as InvoiceTrackingProgress)}
            options={INVOICE_TRACKING_PROGRESS.map((value) => ({ value, label: INVOICE_TRACKING_PROGRESS_LABELS[value] }))}
          />
          <FormGroup label="Ghi chú" htmlFor="ivt-note">
            <input id="ivt-note" className="input" value={note} onChange={(event) => setNote(event.target.value)} />
          </FormGroup>
        </div>

        {formError && <p className="ivt-hint ivt-hint--error" role="alert">{formError}</p>}

        <footer className="invoice-tracking-form__footer">
          <Btn variant="secondary" size="sm" onClick={closeWhenIdle} disabled={saving}>Hủy</Btn>
          <Btn variant="primary" size="sm" onClick={() => void handleSubmit()} disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu'}</Btn>
        </footer>
      </fieldset>
    </Modal>
  );
}
