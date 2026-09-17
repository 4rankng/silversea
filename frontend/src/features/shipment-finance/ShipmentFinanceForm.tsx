import { useId, useRef, useState } from 'react';
import { qk } from '../../api/keys';
import { useQuery } from '@tanstack/react-query';
import { containerDepositSchema, shipmentInvoiceRecordSchema, type ContainerDepositRecord, type ShipmentInvoiceRecord } from '@tingting/shared';
import { shipmentFinanceClient } from '../../api/shipmentFinanceClient';
import { listShipments } from '../../api/shipmentClient';
import { Drawer } from '../../components/UI';
import { DateField, NumberField, TextField } from '../../design-system';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';

import { businessDateISO } from '../../lib/format';

export type FinanceEditor = { kind: 'invoice'; record?: ShipmentInvoiceRecord } | { kind: 'deposit'; record?: ContainerDepositRecord };

export function ShipmentFinanceForm({ editor, shipmentId, principalLocked = false, onClose, onSaved }: {
  editor: FinanceEditor; shipmentId?: number; principalLocked?: boolean; onClose: () => void; onSaved: () => void;
}) {
  const formId = useId();
  const invoice = editor.kind === 'invoice' ? editor.record : undefined;
  const deposit = editor.kind === 'deposit' ? editor.record : undefined;
  const [lot, setLot] = useState(String(editor.record?.shipmentId ?? shipmentId ?? ''));
  const [lotSearch, setLotSearch] = useState('');
  const [supplierId, setSupplierId] = useState(String(invoice?.supplierId ?? ''));
  const [invoiceNumber, setInvoiceNumber] = useState(invoice?.invoiceNumber ?? '');
  const [invoiceDate, setInvoiceDate] = useState(invoice?.invoiceDate ?? businessDateISO());
  const [faceAmount, setFaceAmount] = useState<number | ''>(invoice?.faceAmount != null ? Number(invoice?.faceAmount) : '');
  const [supplierFee, setSupplierFee] = useState<number | ''>(invoice?.supplierFeeAmount != null ? Number(invoice?.supplierFeeAmount) : '');
  const [tripId, setTripId] = useState(String(invoice?.tripId ?? ''));
  const [sourceExpenseId, setSourceExpenseId] = useState(String(invoice?.sourceExpenseId ?? ''));
  const [bill, setBill] = useState(deposit?.billNumber ?? '');
  const [shippingLine, setShippingLine] = useState(deposit?.shippingLineName ?? '');
  const [amount, setAmount] = useState<number | ''>(deposit?.amount != null ? Number(deposit?.amount) : '');
  const [depositDate, setDepositDate] = useState(deposit?.depositDate ?? businessDateISO());
  const [documentsDate, setDocumentsDate] = useState(deposit?.documentsSubmittedDate ?? '');
  const [refundDate, setRefundDate] = useState(deposit?.refundReceivedDate ?? '');
  const [recovered, setRecovered] = useState<number | ''>(deposit?.recoveredAmount != null ? Number(deposit?.recoveredAmount) : 0);
  const [note, setNote] = useState(editor.record?.note ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const command = useRef<{ payload: string; key: string } | null>(null);
  const suppliers = useQuery({ queryKey: qk.shipmentFinance.options(lot), queryFn: () => shipmentFinanceClient.options(Number(lot) || undefined), enabled: editor.kind === 'invoice' });
  const lots = useQuery({ queryKey: qk.shipmentFinance.lots(lotSearch),
    queryFn: () => listShipments({ q: lotSearch, limit: 20 }), enabled: !shipmentId && !editor.record });
  const close = () => { if (!submitting.current) onClose(); };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const id = Number(lot);
    if (!Number.isInteger(id) || id <= 0) { setError('Chọn lô hàng trước khi lưu.'); return; }
    const identity = { id: editor.record?.id, expectedVersion: editor.record?.version ?? 0, note };
    const parsed = editor.kind === 'invoice'
      ? shipmentInvoiceRecordSchema.safeParse({ ...identity, supplierId: Number(supplierId), invoiceNumber, invoiceDate,
        faceAmount, supplierFeeAmount: supplierFee, tripId: !sourceExpenseId && tripId ? Number(tripId) : undefined, sourceExpenseId: Number(sourceExpenseId) || null })
      : containerDepositSchema.safeParse({ ...identity, billNumber: bill, shippingLineName: shippingLine,
        amount, depositDate, documentsSubmittedDate: documentsDate || null,
        refundReceivedDate: refundDate || null, recoveredAmount: recovered });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Kiểm tra thông tin nhập.'); return; }
    const fingerprint = JSON.stringify({ id, kind: editor.kind, data: parsed.data });
    if (command.current?.payload !== fingerprint) command.current = { payload: fingerprint, key: crypto.randomUUID() };
    submitting.current = true; setBusy(true); setError('');
    try {
      if ('invoiceNumber' in parsed.data) await shipmentFinanceClient.saveInvoice(id, parsed.data, command.current.key);
      else await shipmentFinanceClient.saveDeposit(id, parsed.data, command.current.key);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được. Thử lại để tiếp tục cùng thao tác.');
    } finally { submitting.current = false; setBusy(false); }
  }

  return <Drawer isOpen onClose={close} title={`${editor.record ? 'Cập nhật' : 'Thêm'} ${editor.kind === 'invoice' ? 'hóa đơn kết hợp' : 'cược container'}`}
    footer={<><button type="button" className="btn btn--ghost" onClick={close} disabled={busy}>Hủy</button>
      <button type="submit" form={formId} className="btn btn--primary" disabled={busy || (editor.kind === 'invoice' && (suppliers.isPending || suppliers.isError))}>{busy ? 'Đang lưu…' : 'Lưu hồ sơ'}</button></>}>
    <form id={formId} className="shipment-finance__form" onSubmit={save}>
      {error && <p role="alert" className="shipment-finance__error">{error}</p>}
      {!shipmentId && !editor.record && <>
        <TextField controlSize="sm" label="Tìm lô hàng" value={lotSearch} onChange={(event) => setLotSearch(event.target.value)} placeholder="Mã lô, Bill hoặc khách hàng" disabled={busy} />
        <UuiSelectField label="Lô hàng" disabled={busy} required value={lot} onChange={(event) => { setLot(event.target.value); setSourceExpenseId(''); setTripId(''); }}
          options={[{ value: '', label: 'Chọn lô hàng' }, ...(lots.data?.items ?? []).map((item) => ({ value: String(item.id), label: `${item.shipmentCode ?? `Lô ${item.id}`} · ${item.blNumber ?? item.customerName ?? ''}` }))]} />
        {lots.isError && <p role="alert">Không tải được lô hàng. <button type="button" className="btn btn--ghost" onClick={() => void lots.refetch()}>Thử lại</button></p>}
      </>}
      {editor.kind === 'invoice' ? <>
        {!invoice && (suppliers.data?.expenses.length ?? 0) > 0 && <UuiSelectField label="Chi phí nguồn" disabled={busy} value={sourceExpenseId}
          onChange={(event) => {
            setSourceExpenseId(event.target.value);
            const source = suppliers.data?.expenses.find((item) => String(item.id) === event.target.value);
            if (source) { setSupplierId(String(source.supplierId ?? '')); setSupplierFee(Number(source.buyAmount)); if (source.invoiceNumber) setInvoiceNumber(source.invoiceNumber); }
          }} options={[{ value: '', label: 'Ghi chi phí hóa đơn mới' }, ...(suppliers.data?.expenses ?? []).filter((item) => item.supplierId != null).map((item) => ({
            value: String(item.id), label: `#${item.id} · ${item.invoiceNumber ?? item.expenseType} · ${Number(item.buyAmount).toLocaleString('vi-VN')} đ`,
          }))]} hint="Chọn phí đã có để liên kết, tránh ghi trùng." />}
        {!sourceExpenseId && (suppliers.data?.trips?.length ?? 0) > 1 && <UuiSelectField label="Công việc chịu chi phí" required disabled={busy || Boolean(invoice?.tripId)} value={tripId}
          onChange={event => setTripId(event.target.value)} options={[{ value: '', label: 'Chọn chuyến' }, ...(suppliers.data?.trips ?? []).map(trip => ({ value: String(trip.id), label: trip.tripCode ?? `Chuyến #${trip.id}` }))]}
          hint="Phí này được ghi một lần vào công việc đã chọn." />}
        <UuiSelectField label="Nhà cung cấp" disabled={busy} required value={supplierId} onChange={(event) => setSupplierId(event.target.value)}
          options={[{ value: '', label: 'Chọn nhà cung cấp' }, ...(suppliers.data?.suppliers ?? []).map((item) => ({ value: String(item.id), label: item.name }))]} />
        {suppliers.isError && <p role="alert">Không tải được nhà cung cấp. <button type="button" className="btn btn--ghost" onClick={() => void suppliers.refetch()}>Thử lại</button></p>}
        <div className="shipment-finance__pair">
          <TextField controlSize="sm" label="Số hóa đơn" required value={invoiceNumber} maxLength={100} onChange={event => setInvoiceNumber(event.target.value)} disabled={busy} />
          <DateField controlSize="sm" label="Ngày hóa đơn" value={invoiceDate} onChange={setInvoiceDate} required disabled={busy} />
          <NumberField controlSize="sm" label="Giá trị hóa đơn (đ)" value={faceAmount} onChange={setFaceAmount} min={0} step={1} max={999_999_999_999_999} required disabled={busy} />
          <NumberField controlSize="sm" label="Phí nhà cung cấp (đ)" value={supplierFee} onChange={setSupplierFee} min={0} step={1} max={999_999_999_999_999} required disabled={busy} />
        </div>
        <p className="shipment-finance__hint">Chỉ phí nhà cung cấp được ghi vào chi phí hóa đơn. Lưu hồ sơ không tạo phiếu chi.</p>
        {invoice?.sourceExpenseId && <p className="shipment-finance__hint">Đã liên kết chi phí nguồn #{invoice.sourceExpenseId}; không ghi thêm phí.</p>}
      </> : <>
        {principalLocked && <p className="shipment-finance__hint">Lô đã chốt chi phí. Bạn vẫn có thể bổ sung hồ sơ và cập nhật tiền hoàn; thông tin cược ban đầu được giữ nguyên.</p>}
        <div className="shipment-finance__pair">
          <TextField controlSize="sm" label="Số Bill" required value={bill} maxLength={100} onChange={event => setBill(event.target.value)} disabled={busy || principalLocked} />
          <TextField controlSize="sm" label="Hãng tàu" required value={shippingLine} maxLength={255} onChange={event => setShippingLine(event.target.value)} disabled={busy || principalLocked} />
          <NumberField controlSize="sm" label="Tiền cược (đ)" value={amount} onChange={setAmount} min={1} step={1} max={999_999_999_999_999} required disabled={busy || principalLocked} />
          <DateField controlSize="sm" label="Ngày cược" value={depositDate} onChange={setDepositDate} required disabled={busy || principalLocked} />
          <DateField controlSize="sm" label="Ngày nộp chứng từ" value={documentsDate} onChange={setDocumentsDate} disabled={busy} />
          <DateField controlSize="sm" label="Ngày nhận tiền hoàn" value={refundDate} onChange={setRefundDate} disabled={busy} />
          <NumberField controlSize="sm" label="Đã nhận hoàn (đ)" value={recovered} onChange={setRecovered} min={0} step={1} max={999_999_999_999_999} required disabled={busy} />
        </div>
        <p className="shipment-finance__hint">Để trống ngày chưa xảy ra. Hồ sơ theo dõi cược không thay thế phiếu thu tiền.</p>
        {((documentsDate && documentsDate < depositDate) || (refundDate && refundDate < (documentsDate || depositDate))) && <p role="status" className="shipment-finance__hint">Các mốc ngày đang khác thứ tự thông thường. Kiểm tra lại ngày thực tế trước khi lưu.</p>}
      </>}
      <label className="ds-field__label">Ghi chú<textarea className="ds-field__input" disabled={busy} rows={3} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
    </form>
  </Drawer>;
}
