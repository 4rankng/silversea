import { PhotoImage } from '../shared/PhotoImage';
import { useEffect, useRef, useState } from 'react';
import { Camera, Plus, ReceiptText, StickyNote } from 'lucide-react';
import {
  DRIVER_INCIDENTAL_COST_LABELS,
  NO_INVOICE_EVIDENCE_TYPE_LABELS,
  DriverIncidentalCostType,
} from '@tingting/shared';
import { driverClient } from '../../api/driverClient';
import { NumberField, DateField, TextField, UuiSelectField, Tabs, EmptyState } from '../../design-system';
import { formatCurrency, formatISODate } from '../../lib/format';
import { useAuthedPhotoUrls } from '../../lib/api/photo';
import { driverExpenseOption, driverExpenseOptionInvoiceClass, requiredEvidenceTypeForExpenseCode } from '../../features/driver/driver-expense-options';
import { useDriverExpenseEntry } from '../../features/driver/useDriverExpenseEntry';
import './ShipmentCostEntryForm.css';
import { DriverSavedExpenseProofs } from './DriverSavedExpenseProofs';
import { DriverExpenseCorrection } from './DriverExpenseCorrection';

export interface ShipmentCostEntryFormProps {
  tripId: number;
  totalRoadAllowance: string | null;
  costSubmissionNote?: string | null;
  readOnly?: boolean;
  /** Card 20260926_30 item 16: the page's top progress strip shows the saved
   *  cost-entry count without scrolling — the form owns the entry list, so it
   *  reports the count up whenever it changes. */
  onEntriesCountChange?: (count: number) => void;
}

export function ShipmentCostEntryForm({ tripId, totalRoadAllowance, costSubmissionNote = null, readOnly = false, onEntriesCountChange }: ShipmentCostEntryFormProps) {
  const state = useDriverExpenseEntry(tripId, readOnly);

  useEffect(() => {
    onEntriesCountChange?.(state.entries.length);
  }, [state.entries.length, onEntriesCountChange]);

  const disabled = readOnly || state.busy || state.uploading;
  // DRV-DET-08: receipt evidence loads with the Authorization header (blob),
  // never a ?token= query string. Index-aligned with state.entries; the draft
  // preview is a single value (a fresh local `blob:` pick passes through).
  const receiptUrls = useAuthedPhotoUrls(state.entries.map((entry) => entry.receiptStorageKey));
  const draftReceiptUrl = useAuthedPhotoUrls([state.draft.receiptStorageKey])[0] ?? '';
  const selected = driverExpenseOption(state.draft.option, state.options);
  // Card 20260928_163/164 — the picked fee's CATALOG class decides whether Số
  // hóa đơn is asked for and whether a free-text name exists at all (a
  // catalog-classified fee takes its name from the catalog row).
  const invoiceClass = driverExpenseOptionInvoiceClass(selected);
  const catalogClassified = selected.expenseTypeCode != null;
  // Card 20260928_165 — one rule for the whole row: an expense code in the
  // shared receipt map carries a hand-written receipt as its document.
  const requiredEvidence = requiredEvidenceTypeForExpenseCode(selected.expenseTypeCode);
  const requiresReceipt = requiredEvidence != null;
  const evidenceLabel = requiredEvidence == null ? '' : NO_INVOICE_EVIDENCE_TYPE_LABELS[requiredEvidence];
  const showInvoiceFields = selected.group === 'DRIVER_SHIPMENT' && invoiceClass !== 'NO_INVOICE';
  const [sectionNote, setSectionNote] = useState(costSubmissionNote ?? '');
  const [savedNote, setSavedNote] = useState(costSubmissionNote ?? '');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const noteLock = useRef(false);
  // Card 20260926_29 item 14: the note row starts collapsed (the editor
  // opens on tap; a saved note previews as one line).
  const [noteOpen, setNoteOpen] = useState(Boolean(costSubmissionNote));
  async function saveNote() {
    if (disabled || noteLock.current) return;
    noteLock.current = true; setNoteSaving(true); setNoteError(null);
    try { await driverClient.updateCostSubmissionNote(tripId, sectionNote); setSavedNote(sectionNote); setNoteOpen(false); }
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
    {state.loading ? <p role="status">Đang tải chi phí…</p> : state.entries.length === 0 ? (!state.loadError && (
      <EmptyState
        variant="compact"
        context="driver-costs"
        title="Chưa có chi phí phát sinh"
        description="Thêm khoản thực chi trong chuyến; kế toán đối chiếu và thanh toán riêng."
      />
    )) :
      <ul className="shipment-cost-entry__list">{state.entries.map((entry, index) => <li key={entry.id} className="shipment-cost-entry__item">
        {entry.receiptStorageKey && <a href={receiptUrls[index] || undefined} target="_blank" rel="noreferrer" aria-label={`Xem biên lai ${entry.feeName || DRIVER_INCIDENTAL_COST_LABELS[entry.costType]}`}><PhotoImage src={receiptUrls[index]} alt="Biên lai" className="shipment-cost-entry__thumb" /></a>}
        <div className="shipment-cost-entry__item-body"><div className="shipment-cost-entry__item-top"><strong>{entry.feeName || DRIVER_INCIDENTAL_COST_LABELS[entry.costType]}</strong><span className="shipment-cost-entry__item-amount">{formatCurrency(entry.amount)}</span></div>
          <div className="shipment-cost-entry__item-meta"><span>{formatISODate(entry.occurredAt)}</span><span>{entry.payerKind === 'COMPANY' ? 'Công ty đã trả' : 'Tôi chi'}</span>{entry.costGroup && <span>{entry.costGroup === 'DRIVER_ROAD' ? 'Tiền đường' : 'Chi phí lô hàng'}</span>}{entry.invoiceNumber && <span>HĐ {entry.invoiceNumber}</span>}
          {/* Card 081026091900 — trip 79 showed a TOLL pair (-30.000 then +30.000),
              BOTH captioned "Tôi chi / Tiền đường". A negative row is an
              adjusting entry, not a spend: ruling 20260928_197, shipped and
              QA PASSED on the Ops wallet (071026210530). That fix reached only
              that surface — the driver list is the same defect class. Reusing the
              already-approved wording keeps one rule across both screens. */}
          {Number(entry.amount) < 0 && (
            <span
              className="shipment-cost-entry__item-adjustment"
              title="Dòng âm là bút toán điều chỉnh — tương đương bỏ/bớt khoản, KHÔNG phải một khoản chi, và không được cộng vào tổng."
            >
              — bút toán điều chỉnh (dòng âm)
            </span>
          )}
        </div>
          {entry.note && <span className="shipment-cost-entry__item-note">{entry.note}</span>}
          <DriverSavedExpenseProofs expenseId={entry.id} />
          {!readOnly && <DriverExpenseCorrection expenseId={entry.id} onSaved={state.refresh} />}
        </div>
      </li>)}</ul>}

    {state.open && <form className="shipment-cost-entry__form" onSubmit={(event) => void state.save(event)}>
      <Tabs ariaLabel="Nhóm chi phí lái xe" value={selected.group} onChange={(group) => state.chooseOption(state.options.find(option => option.group === group)!.code)}
        tabs={[{ id: 'DRIVER_SHIPMENT', label: 'Chi phí lô hàng' }, { id: 'DRIVER_ROAD', label: 'Tiền đường' }]} />
      {state.norms.isError && <div role="alert" className="shipment-cost-entry__banner--error">Không tải được định mức tiền đường. Bạn vẫn có thể nhập khoản thực chi bằng các loại phí chung. <button type="button" className="btn btn--secondary btn--sm" onClick={() => void state.norms.refetch()}>Thử tải lại định mức</button></div>}
      {state.norms.isPending && <p role="status">Đang tải định mức tiền đường…</p>}
      {state.error && <div className="shipment-cost-entry__banner--error" role="alert">{state.error}</div>}
      <div className="shipment-cost-entry__fields">
        <UuiSelectField label="Loại chi phí" value={state.draft.option} disabled={disabled} onChange={(event) => state.chooseOption(event.target.value)}
          options={state.options.filter(option => option.group === selected.group).map(option => ({ value: option.code, label: option.label }))} />
        {catalogClassified
          ? <p className="shipment-cost-entry__empty" data-testid="shipment-cost-catalog-fee">{`Tên khoản chi: ${selected.label} (theo danh mục phí).`}</p>
          : <TextField controlSize="sm" label="Tên khoản chi" value={state.draft.feeName} disabled={disabled} maxLength={200} placeholder={selected.label} onChange={(event) => state.patch({ feeName: event.target.value })} />}
        <NumberField controlSize="sm" label="Thực chi (VND)" grouped signed value={state.draft.amount} onChange={(amount) => state.patch({ amount })} min={-999_999_999_999_999} step={1} max={999_999_999_999_999} required disabled={disabled}
          helpText={selected.amount ? `Gợi ý ${formatCurrency(selected.amount)}; sửa theo khoản thực tế. Chưa lưu thì chưa phát sinh tiền.` : undefined} />
        {/* Card 20260928_181, tiêu chí 5: a negative amount is a real entry (a
            refund), and every total in the system EXCLUDES negative lines
            (sumExcludingNegative). That is invisible from the field itself, so
            the screen has to say it — and only while a negative is typed, or the
            line becomes noise on every other entry. */}
        {Number(state.draft.amount) < 0 && (
          <p className="shipment-cost-entry__empty" data-testid="shipment-cost-negative-note">
            Số âm là khoản hoàn lại, không phải chi phí: dòng này được lưu nhưng KHÔNG cộng vào bất kỳ tổng nào.
          </p>
        )}
        <UuiSelectField label="Người chi" value={state.draft.payerKind} disabled={disabled} onChange={event => state.patch({ payerKind: event.target.value as 'USER' | 'COMPANY' })} options={[{ value: 'USER', label: 'Tôi chi' }, { value: 'COMPANY', label: 'Công ty đã trả' }]} />
        <DateField controlSize="sm" label="Ngày chi" value={state.draft.occurredAt} onChange={(occurredAt) => state.patch({ occurredAt })} required disabled={disabled} />
        {showInvoiceFields && <>
          <TextField controlSize="sm" label="Số hóa đơn" value={state.draft.invoiceNumber} onChange={(event) => state.patch({ invoiceNumber: event.target.value })} maxLength={100} disabled={disabled} placeholder={invoiceClass === 'INVOICED' ? 'Bắt buộc với khoản có hóa đơn' : 'Để trống nếu không có hóa đơn'} />
          <DateField controlSize="sm" label="Ngày hóa đơn" value={state.draft.invoiceDate} onChange={(invoiceDate) => state.patch({ invoiceDate })} disabled={disabled} />
        </>}
      </div>
      <TextField controlSize="sm" label="Ghi chú khoản chi" value={state.draft.note} onChange={(event) => state.patch({ note: event.target.value })} maxLength={2000} disabled={disabled} />
      {requiresReceipt && <p className="shipment-cost-entry__empty">Chứng từ: {evidenceLabel}.</p>}
      {selected.type === DriverIncidentalCostType.ROAD_ALLOWANCE && <p className="shipment-cost-entry__empty">Khoản đã thỏa thuận được giữ trong định mức chuyến; chứng từ này không cộng thêm phụ cấp lần nữa.</p>}
      <p className="shipment-cost-entry__empty">{selected.group === 'DRIVER_ROAD' ? 'Tiền đường không thu thêm khách hàng.' : 'Kế toán đối chiếu hóa đơn và số thu khách. Khoản không hóa đơn được theo dõi là chi phí xe.'}</p>
      <label className="btn btn--secondary shipment-cost-entry__camera-btn"><Camera size={16} /> {state.uploading ? 'Đang tải…' : state.draft.receiptStorageKey ? 'Thay ảnh chứng từ' : requiresReceipt ? `Chụp / chọn ${evidenceLabel} (bắt buộc)` : 'Chụp / chọn biên lai'}
        <input type="file" accept="image/*" className="sr-only" aria-label="Chọn ảnh biên lai" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) void state.upload(file); }} />
      </label>
      {state.pendingFile && !state.uploading && <div className="shipment-cost-entry__upload-retry" role="status"><span>{state.pendingFile.name} · Chưa tải thành công</span><button type="button" className="btn btn--secondary btn--sm" disabled={disabled} onClick={() => { if (state.pendingFile) void state.upload(state.pendingFile); }}>Thử tải lại ảnh</button><button type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={state.discardPendingFile}>Bỏ ảnh chưa tải</button></div>}
      {state.draft.receiptStorageKey && <div className="shipment-cost-entry__receipt-preview"><PhotoImage src={draftReceiptUrl} alt="Biên lai đã chọn" /><span><ReceiptText size={14} /> Ảnh sẽ gắn với khoản chi này</span></div>}
      {/* Card 20260928_165 — the road-repair fee's document is the hand-written
          receipt; the form blocks the submit (never silently) until it is
          attached, and the server refuses the entry without it. */}
      {requiresReceipt && !state.draft.receiptStorageKey && <p className="shipment-cost-entry__empty" role="status" data-testid="shipment-cost-receipt-required">{`${selected.label} phải kèm ${evidenceLabel} — kế toán phơi phiếu đối chiếu chứng từ giấy này.`}</p>}
      <div className="shipment-cost-entry__form-actions"><button type="button" className="btn btn--secondary" disabled={state.busy || state.uploading} onClick={state.cancel}>Hủy</button><button type="submit" className="btn btn--primary" disabled={disabled || (requiresReceipt && !state.draft.receiptStorageKey)}>{state.busy ? 'Đang lưu…' : 'Lưu chi phí'}</button></div>
    </form>}
    <div className="shipment-cost-entry__section-note" data-testid="cost-note-row">
      {/* Card 20260926_29 item 14: the accountant note is ONE collapsed row —
          a ghost "+ Thêm ghi chú cho kế toán" when empty, a tappable one-line
          preview when saved; it expands to the editor, with Lưu visible only
          while editing. */}
      {noteOpen ? (
        <>
          <TextField controlSize="sm" label="Ghi chú cho kế toán" value={sectionNote} maxLength={2000} disabled={readOnly || noteSaving} onChange={(event) => setSectionNote(event.target.value)} />
          {noteError && <p role="alert" className="shipment-cost-entry__banner--error">{noteError}</p>}
          {!readOnly && <button type="button" className="btn btn--secondary btn--sm" disabled={disabled || noteSaving || sectionNote === savedNote} onClick={() => void saveNote()}>{noteSaving ? 'Đang lưu…' : 'Lưu ghi chú'}</button>}
        </>
        ) : savedNote ? (
        <button type="button" className="shipment-cost-entry__note-collapsed" onClick={() => setNoteOpen(true)} title={savedNote}>
          <StickyNote size={14} aria-hidden="true" />
          <span className="shipment-cost-entry__note-text">{savedNote}</span>
        </button>
      ) : (
        <button type="button" className="shipment-cost-entry__note-collapsed" onClick={() => setNoteOpen(true)}>
          <Plus size={14} aria-hidden="true" />
          <span>Thêm ghi chú cho kế toán</span>
        </button>
      )}
    </div>
  </section>;
}

export default ShipmentCostEntryForm;
