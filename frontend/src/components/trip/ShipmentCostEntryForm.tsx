import { useRef, useState } from 'react';
import { Camera, Plus, ReceiptText } from 'lucide-react';
import { DRIVER_INCIDENTAL_COST_LABELS, DriverIncidentalCostType } from '@tingting/shared';
import { driverClient } from '../../api/driverClient';
import { NumberField, DateField, TextField, UuiSelectField, Tabs } from '../../design-system';
import { formatCurrency, formatISODate } from '../../lib/format';
import { photoSrc } from '../../lib/api/photo';
import { DRIVER_EXPENSE_OPTIONS, driverExpenseOption } from '../../features/driver/driver-expense-options';
import { useDriverExpenseEntry } from '../../features/driver/useDriverExpenseEntry';
import './ShipmentCostEntryForm.css';

export interface ShipmentCostEntryFormProps {
  tripId: number;
  totalRoadAllowance: string | null;
  costSubmissionNote?: string | null;
  readOnly?: boolean;
}

export function ShipmentCostEntryForm({ tripId, totalRoadAllowance, costSubmissionNote = null, readOnly = false }: ShipmentCostEntryFormProps) {
  const state = useDriverExpenseEntry(tripId, readOnly);
  const disabled = readOnly || state.busy || state.uploading;
  const selected = driverExpenseOption(state.draft.option);
  const [sectionNote, setSectionNote] = useState(costSubmissionNote ?? '');
  const [savedNote, setSavedNote] = useState(costSubmissionNote ?? '');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const noteLock = useRef(false);
  async function saveNote() {
    if (disabled || noteLock.current) return;
    noteLock.current = true; setNoteSaving(true); setNoteError(null);
    try { await driverClient.updateCostSubmissionNote(tripId, sectionNote); setSavedNote(sectionNote); }
    catch (cause) { setNoteError(cause instanceof Error ? cause.message : 'Chưa lưu được ghi chú.'); }
    finally { noteLock.current = false; setNoteSaving(false); }
  }

  return <section className="shipment-cost-entry" aria-label="Chi phí chuyến">
    <header className="shipment-cost-entry__head">
      <div><h2 className="shipment-cost-entry__title">Chi phí lô hàng & tiền đường</h2>
        <p className="shipment-cost-entry__subtitle">Ghi khoản thực tế bạn đã chi; kế toán đối chiếu và thanh toán riêng.</p></div>
      {!state.open && !readOnly && <button type="button" className="btn btn--primary btn--sm" onClick={() => state.setOpen(true)}><Plus size={15} /> Thêm chi phí</button>}
    </header>
    {state.loadError && <div role="alert" className="shipment-cost-entry__banner--error">{state.loadError} <button type="button" className="btn btn--secondary btn--sm" onClick={() => void state.refresh()}>Thử tải lại</button></div>}
    <p className="shipment-cost-entry__empty" data-testid="shipment-cost-route-reference">
      {totalRoadAllowance != null && Number(totalRoadAllowance) > 0
        ? `Tiền tuyến tham chiếu: ${formatCurrency(totalRoadAllowance)}. Chỉ ghi khoản phát sinh thực tế, không cộng thêm nếu đã có trong danh sách.`
        : 'Chưa có định mức tiền tuyến. Nhập số tiền thực tế; chưa có định mức không có nghĩa là 0đ.'}
    </p>
    {state.loading ? <p role="status">Đang tải chi phí…</p> : state.entries.length === 0 ? <p className="shipment-cost-entry__empty">Chưa có chi phí phát sinh nào.</p> :
      <ul className="shipment-cost-entry__list">{state.entries.map(entry => <li key={entry.id} className="shipment-cost-entry__item">
        {entry.receiptStorageKey && <a href={photoSrc(entry.receiptStorageKey)} target="_blank" rel="noreferrer" aria-label={`Xem biên lai ${entry.feeName || DRIVER_INCIDENTAL_COST_LABELS[entry.costType]}`}><img src={photoSrc(entry.receiptStorageKey)} alt="Biên lai" className="shipment-cost-entry__thumb" /></a>}
        <div className="shipment-cost-entry__item-body"><div className="shipment-cost-entry__item-top"><strong>{entry.feeName || DRIVER_INCIDENTAL_COST_LABELS[entry.costType]}</strong><span className="shipment-cost-entry__item-amount">{formatCurrency(entry.amount)}</span></div>
          <div className="shipment-cost-entry__item-meta"><span>{formatISODate(entry.occurredAt)}</span><span>{entry.payerKind === 'COMPANY' ? 'Công ty đã trả' : 'Tôi chi'}</span>{entry.costGroup && <span>{entry.costGroup === 'DRIVER_ROAD' ? 'Tiền đường' : 'Chi phí lô hàng'}</span>}{entry.invoiceNumber && <span>HĐ {entry.invoiceNumber}</span>}</div>
          {entry.note && <span className="shipment-cost-entry__item-note">{entry.note}</span>}
        </div>
      </li>)}</ul>}

    {state.open && <form className="shipment-cost-entry__form" onSubmit={(event) => void state.save(event)}>
      <Tabs ariaLabel="Nhóm chi phí lái xe" value={selected.group} onChange={(group) => state.chooseOption(DRIVER_EXPENSE_OPTIONS.find(option => option.group === group)!.code)}
        tabs={[{ id: 'DRIVER_SHIPMENT', label: 'Chi phí lô hàng' }, { id: 'DRIVER_ROAD', label: 'Tiền đường' }]} />
      {state.error && <div className="shipment-cost-entry__banner--error" role="alert">{state.error}</div>}
      <div className="shipment-cost-entry__fields">
        <UuiSelectField label="Loại chi phí" value={state.draft.option} disabled={disabled} onChange={(event) => state.chooseOption(event.target.value)}
          options={DRIVER_EXPENSE_OPTIONS.filter(option => option.group === selected.group).map(option => ({ value: option.code, label: option.label }))} />
        <TextField controlSize="sm" label="Tên khoản chi" value={state.draft.feeName} disabled={disabled} maxLength={200} placeholder={selected.label} onChange={(event) => state.patch({ feeName: event.target.value })} />
        <NumberField controlSize="sm" label="Thực chi (VND)" value={state.draft.amount} onChange={(amount) => state.patch({ amount })} min={1} step={1} max={999_999_999_999_999} required disabled={disabled}
          helpText={selected.amount ? `Gợi ý ${formatCurrency(selected.amount)}; sửa theo khoản thực tế. Chưa lưu thì chưa phát sinh tiền.` : undefined} />
        <UuiSelectField label="Người chi" value={state.draft.payerKind} disabled={disabled} onChange={event => state.patch({ payerKind: event.target.value as 'USER' | 'COMPANY' })} options={[{ value: 'USER', label: 'Tôi chi' }, { value: 'COMPANY', label: 'Công ty đã trả' }]} />
        <DateField controlSize="sm" label="Ngày chi" value={state.draft.occurredAt} onChange={(occurredAt) => state.patch({ occurredAt })} required disabled={disabled} />
        {selected.group === 'DRIVER_SHIPMENT' && <>
          <TextField controlSize="sm" label="Số hóa đơn" value={state.draft.invoiceNumber} onChange={(event) => state.patch({ invoiceNumber: event.target.value })} maxLength={100} disabled={disabled} placeholder="Để trống nếu không có hóa đơn" />
          <DateField controlSize="sm" label="Ngày hóa đơn" value={state.draft.invoiceDate} onChange={(invoiceDate) => state.patch({ invoiceDate })} disabled={disabled} />
        </>}
      </div>
      <TextField controlSize="sm" label="Ghi chú khoản chi" value={state.draft.note} onChange={(event) => state.patch({ note: event.target.value })} maxLength={2000} disabled={disabled} />
      {selected.type === DriverIncidentalCostType.ROAD_ALLOWANCE && <p className="shipment-cost-entry__empty">Khoản đã thỏa thuận được giữ trong định mức chuyến; chứng từ này không cộng thêm phụ cấp lần nữa.</p>}
      <p className="shipment-cost-entry__empty">{selected.group === 'DRIVER_ROAD' ? 'Tiền đường không thu thêm khách hàng.' : 'Kế toán đối chiếu hóa đơn và số thu khách. Khoản không hóa đơn được theo dõi là chi phí xe.'}</p>
      <label className="btn btn--secondary shipment-cost-entry__camera-btn"><Camera size={16} /> {state.uploading ? 'Đang tải…' : state.draft.receiptStorageKey ? 'Thay ảnh biên lai' : 'Chụp / chọn biên lai'}
        <input type="file" accept="image/*" className="sr-only" aria-label="Chọn ảnh biên lai" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) void state.upload(file); }} />
      </label>
      {state.pendingFile && !state.uploading && <div className="shipment-cost-entry__upload-retry" role="status"><span>{state.pendingFile.name} · Chưa tải thành công</span><button type="button" className="btn btn--secondary btn--sm" disabled={disabled} onClick={() => { if (state.pendingFile) void state.upload(state.pendingFile); }}>Thử tải lại ảnh</button><button type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={state.discardPendingFile}>Bỏ ảnh chưa tải</button></div>}
      {state.draft.receiptStorageKey && <div className="shipment-cost-entry__receipt-preview"><img src={photoSrc(state.draft.receiptStorageKey)} alt="Biên lai đã chọn" /><span><ReceiptText size={14} /> Ảnh sẽ gắn với khoản chi này</span></div>}
      <div className="shipment-cost-entry__form-actions"><button type="button" className="btn btn--secondary" disabled={state.busy || state.uploading} onClick={state.cancel}>Hủy</button><button type="submit" className="btn btn--primary" disabled={disabled}>{state.busy ? 'Đang lưu…' : 'Lưu chi phí'}</button></div>
    </form>}
    <div className="shipment-cost-entry__section-note">
      <TextField controlSize="sm" label="Ghi chú cho kế toán" value={sectionNote} maxLength={2000} disabled={readOnly || noteSaving} onChange={(event) => setSectionNote(event.target.value)} />
      {noteError && <p role="alert" className="shipment-cost-entry__banner--error">{noteError}</p>}
      {!readOnly && <button type="button" className="btn btn--secondary btn--sm" disabled={disabled || noteSaving || sectionNote === savedNote} onClick={() => void saveNote()}>{noteSaving ? 'Đang lưu…' : 'Lưu ghi chú'}</button>}
    </div>
  </section>;
}

export default ShipmentCostEntryForm;
