import { PhotoImage } from '../shared/PhotoImage';
import { useEffect, useRef, useState } from 'react';
import { Camera, Plus, ReceiptText, StickyNote } from 'lucide-react';
import {
  DRIVER_INCIDENTAL_COST_LABELS,
  NO_INVOICE_EVIDENCE_TYPE_LABELS,
  DriverIncidentalCostType,
} from '@tingting/shared';
import { driverClient, type DriverIncidentalCostView } from '../../api/driverClient';
import { NumberField, DateField, TextField, UuiSelectField, Tabs, EmptyState } from '../../design-system';
import { formatCurrency, formatISODate } from '../../lib/format';
import { useAuthedPhotoUrls } from '../../lib/api/photo';
import { driverExpenseOption, driverExpenseOptionInvoiceClass, requiredEvidenceTypeForExpenseCode, type DriverExpenseOption } from '../../features/driver/driver-expense-options';
import { useDriverExpenseEntry, type DriverExpenseDraft } from '../../features/driver/useDriverExpenseEntry';
import { ExpenseEvidenceFields } from '../../features/expense-accounting/ExpenseEvidenceFields';
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

/**
 * The ONE photo rule for a draft row, shared by the row's reminder/disable and
 * the form's submit gate (card 20260928_165 mechanism, widened by step 2):
 * a "Phiếu thu" lot cost is a cash spend whose biên lai photo IS its evidence,
 * and a required-evidence code needs its paper whatever the picker says.
 */
function receiptStillNeeded(selected: DriverExpenseOption, row: DriverExpenseDraft): boolean {
  return requiredEvidenceTypeForExpenseCode(selected.expenseTypeCode) != null
    || (selected.group === 'DRIVER_SHIPMENT' && row.evidenceKind === 'RECEIPT');
}

/** Saved-row caption: the paper the row carries (or still needs). Legacy rows
 *  (`evidence_kind` NULL) were never backfilled — "Chưa phân loại chứng từ";
 *  only re-opening the lot writes a value. */
function evidenceCaption(entry: DriverIncidentalCostView): string {
  if (entry.evidenceKind == null) return 'Chưa phân loại chứng từ';
  if (entry.evidenceKind === 'INVOICE') return entry.invoiceNumber ? `HĐ ${entry.invoiceNumber}` : 'Cần số hóa đơn';
  return 'Cần chụp biên lai';
}

interface CostDraftRowProps {
  index: number;
  row: DriverExpenseDraft;
  options: DriverExpenseOption[];
  disabled: boolean;
  /** This row's photo upload is in flight. */
  uploading: boolean;
  /** This row's upload failed; the file is kept so "Thử tải lại ảnh" can replay it. */
  pendingFile: File | null;
  onPatch: (next: Partial<DriverExpenseDraft>) => void;
  onChooseOption: (code: string) => void;
  onUpload: (file: File) => void;
  onRemove: () => void;
  onDiscardPendingFile: () => void;
}

/** One draft row of the step-3 table — exactly the old single-row input block,
 *  plus its own remove button. Controlled by the parent's indexed draft API. */
function CostDraftRow({ index, row, options, disabled, uploading, pendingFile, onPatch, onChooseOption, onUpload, onRemove, onDiscardPendingFile }: CostDraftRowProps) {
  const receiptUrl = useAuthedPhotoUrls([row.receiptStorageKey])[0] ?? '';
  const selected = driverExpenseOption(row.option, options);
  // Card 20260928_163/164 — the catalog class no longer decides WHETHER the
  // invoice fields appear (step 2: the driver picks Loại chứng từ for every lot
  // cost); it still carries the "invoice-bearing fee" hint on the number field,
  // and the server keeps enforcing the invoiced-catalog rule itself.
  const invoiceClass = driverExpenseOptionInvoiceClass(selected);
  const catalogClassified = selected.expenseTypeCode != null;
  const requiredEvidence = requiredEvidenceTypeForExpenseCode(selected.expenseTypeCode);
  const requiresReceipt = requiredEvidence != null;
  const evidenceLabel = requiredEvidence == null ? '' : NO_INVOICE_EVIDENCE_TYPE_LABELS[requiredEvidence];
  const lotCost = selected.group === 'DRIVER_SHIPMENT';
  const receiptMissing = receiptStillNeeded(selected, row) && !row.receiptStorageKey;
  const cameraLabel = uploading ? 'Đang tải…'
    : row.receiptStorageKey ? 'Thay ảnh chứng từ'
    : lotCost && row.evidenceKind === 'RECEIPT' ? 'Chụp / chọn biên lai'
    : requiresReceipt ? `Chụp / chọn ${evidenceLabel} (bắt buộc)`
    : 'Chụp / chọn biên lai';

  return (
    <section className="shipment-cost-entry__draft-row" aria-label={`Khoản chi ${index + 1}`}>
      <div className="shipment-cost-entry__draft-row-head">
        <strong>Khoản {index + 1}</strong>
        <button type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={onRemove}>Xóa dòng</button>
      </div>
      <Tabs ariaLabel="Nhóm chi phí lái xe" value={selected.group} onChange={(group) => onChooseOption(options.find(option => option.group === group)!.code)}
        tabs={[{ id: 'DRIVER_SHIPMENT', label: 'Chi phí lô hàng' }, { id: 'DRIVER_ROAD', label: 'Tiền đường' }]} />
      <div className="shipment-cost-entry__fields">
        <UuiSelectField label="Loại chi phí" value={row.option} disabled={disabled} onChange={(event) => onChooseOption(event.target.value)}
          options={options.filter(option => option.group === selected.group).map(option => ({ value: option.code, label: option.label }))} />
        {catalogClassified
          ? <p className="shipment-cost-entry__empty" data-testid="shipment-cost-catalog-fee">{`Tên khoản chi: ${selected.label} (theo danh mục phí).`}</p>
          : <TextField controlSize="sm" label="Tên khoản chi" value={row.feeName} disabled={disabled} maxLength={200} placeholder={selected.label} onChange={(event) => onPatch({ feeName: event.target.value })} />}
        <NumberField controlSize="sm" label="Thực chi (VND)" grouped signed value={row.amount} onChange={(amount) => onPatch({ amount })} min={-999_999_999_999_999} step={1} max={999_999_999_999_999} required disabled={disabled}
          helpText={selected.amount ? `Gợi ý ${formatCurrency(selected.amount)}; sửa theo khoản thực tế. Chưa lưu thì chưa phát sinh tiền.` : undefined} />
        {/* Card 20260928_181, tiêu chí 5: a negative amount is a real entry (a
            refund), and every total in the system EXCLUDES negative lines
            (sumExcludingNegative). That is invisible from the field itself, so
            the screen has to say it — and only while a negative is typed, or the
            line becomes noise on every other entry. */}
        {Number(row.amount) < 0 && (
          <p className="shipment-cost-entry__empty" data-testid="shipment-cost-negative-note">
            Số âm là khoản hoàn lại, không phải chi phí: dòng này được lưu nhưng KHÔNG cộng vào bất kỳ tổng nào.
          </p>
        )}
        <DateField controlSize="sm" label="Ngày chi" value={row.occurredAt} onChange={(occurredAt) => onPatch({ occurredAt })} required disabled={disabled} />
        {lotCost && <ExpenseEvidenceFields
          kind={row.evidenceKind}
          onKindChange={(evidenceKind) => onPatch({ evidenceKind })}
          invoiceNumber={row.invoiceNumber}
          onInvoiceNumber={(invoiceNumber) => onPatch({ invoiceNumber })}
          invoiceDate={row.invoiceDate}
          onInvoiceDate={(invoiceDate) => onPatch({ invoiceDate })}
          required={invoiceClass === 'INVOICED'}
          disabled={disabled}
        />}
      </div>
      <TextField controlSize="sm" label="Ghi chú khoản chi" value={row.note} onChange={(event) => onPatch({ note: event.target.value })} maxLength={2000} disabled={disabled} />
      {requiresReceipt && <p className="shipment-cost-entry__empty">Chứng từ: {evidenceLabel}.</p>}
      {selected.type === DriverIncidentalCostType.ROAD_ALLOWANCE && <p className="shipment-cost-entry__empty">Khoản đã thỏa thuận được giữ trong định mức chuyến; chứng từ này không cộng thêm phụ cấp lần nữa.</p>}
      <p className="shipment-cost-entry__empty">{selected.group === 'DRIVER_ROAD' ? 'Tiền đường không thu thêm khách hàng.' : 'Kế toán đối chiếu hóa đơn và số thu khách. Khoản không hóa đơn được theo dõi là chi phí xe.'}</p>
      <label className="btn btn--secondary shipment-cost-entry__camera-btn"><Camera size={16} /> {cameraLabel}
        <input type="file" accept="image/*" className="sr-only" aria-label="Chọn ảnh biên lai" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) onUpload(file); }} />
      </label>
      {pendingFile && <div className="shipment-cost-entry__upload-retry" role="status"><span>{pendingFile.name} · Chưa tải thành công</span><button type="button" className="btn btn--secondary btn--sm" disabled={disabled} onClick={() => onUpload(pendingFile)}>Thử tải lại ảnh</button><button type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={onDiscardPendingFile}>Bỏ ảnh chưa tải</button></div>}
      {row.receiptStorageKey && <div className="shipment-cost-entry__receipt-preview"><PhotoImage src={receiptUrl} alt="Biên lai đã chọn" /><span><ReceiptText size={14} /> Ảnh sẽ gắn với khoản chi này</span></div>}
      {/* Card 20260928_165 — the supporting paper cannot exist without the
          entry: the form blocks the submit (never silently) until it is
          attached, and the server refuses the row without it. Step 2 widens
          the same mechanism to every "Phiếu thu" lot cost. */}
      {receiptMissing && <p className="shipment-cost-entry__empty" role="status" data-testid="shipment-cost-receipt-required">{lotCost && row.evidenceKind === 'RECEIPT' ? 'Chọn Phiếu thu thì phải chụp biên lai trước khi lưu.' : `${selected.label} phải kèm ${evidenceLabel} — kế toán phơi phiếu đối chiếu chứng từ giấy này.`}</p>}
    </section>
  );
}

export function ShipmentCostEntryForm({ tripId, totalRoadAllowance, costSubmissionNote = null, readOnly = false, onEntriesCountChange }: ShipmentCostEntryFormProps) {
  const state = useDriverExpenseEntry(tripId, readOnly);

  useEffect(() => {
    onEntriesCountChange?.(state.entries.length);
  }, [state.entries.length, onEntriesCountChange]);

  const disabled = readOnly || state.busy || state.uploading;
  // DRV-DET-08: receipt evidence loads with the Authorization header (blob),
  // never a ?token= query string. Index-aligned with state.entries.
  const receiptUrls = useAuthedPhotoUrls(state.entries.map((entry) => entry.receiptStorageKey));
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
  // The submit gate reads the same per-row photo rule the rows display.
  const blockedRow = state.drafts.some(row => receiptStillNeeded(driverExpenseOption(row.option, state.options), row) && !row.receiptStorageKey);

  return <section className="shipment-cost-entry" aria-label="Chi phí chuyến">
    <header className="shipment-cost-entry__head">
      <div><h2 className="shipment-cost-entry__title">Chi phí lô hàng & tiền đường</h2>
        <p className="shipment-cost-entry__subtitle">Ghi khoản thực tế bạn đã chi; kế toán đối chiếu và thanh toán riêng.</p></div>
      {!state.open && !readOnly && <button type="button" className="btn btn--primary btn--sm" onClick={() => { state.setOpen(true); if (state.drafts.length === 0) state.addDraft(); }}><Plus size={15} /> Thêm chi phí</button>}
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
          <div className="shipment-cost-entry__item-meta"><span>{formatISODate(entry.occurredAt)}</span>{entry.costGroup && <span>{entry.costGroup === 'DRIVER_ROAD' ? 'Tiền đường' : 'Chi phí lô hàng'}</span>}<span>{evidenceCaption(entry)}</span>
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
          {/* Card 20261005 — dòng hệ thống tự ghi nhận bị khóa với lái xe:
              "Tiền đường" (ROAD_ALLOWANCE, hệ thống chép từ bảng giá
              `road_allowances` vào tổng chuyến) và "Phí nâng/hạ theo vùng"
              (LIFT_DROP_ZONE, giá cấu hình theo cảng). Không nút sửa, không nút
              chứng từ — sửa sẽ trùng số liệu hệ thống; kế toán điều chỉnh tại
              màn hình phơi phiếu. Các loại phí khác giữ nguyên nút sửa/chứng từ. */}
          {entry.costType === DriverIncidentalCostType.ROAD_ALLOWANCE || entry.costType === DriverIncidentalCostType.LIFT_DROP_ZONE ? (
            <p className="shipment-cost-entry__item-note">Hệ thống tự ghi nhận — Kế toán điều chỉnh tại màn hình phơi phiếu.</p>
          ) : (
            <>
              <DriverSavedExpenseProofs expenseId={entry.id} />
              {!readOnly && <DriverExpenseCorrection expenseId={entry.id} onSaved={state.refresh} />}
            </>
          )}
        </div>
      </li>)}</ul>}

    {state.open && <form className="shipment-cost-entry__form" onSubmit={(event) => void state.save(event)}>
      {/* Step 3 — draft table: rows accumulate, then ONE all-or-nothing save. */}
      <button type="button" className="btn btn--secondary btn--sm shipment-cost-entry__draft-add" disabled={disabled} onClick={state.addDraft}><Plus size={15} /> Thêm dòng</button>
      {state.norms.isError && <div role="alert" className="shipment-cost-entry__banner--error">Không tải được định mức tiền đường. Bạn vẫn có thể nhập khoản thực chi bằng các loại phí chung. <button type="button" className="btn btn--secondary btn--sm" onClick={() => void state.norms.refetch()}>Thử tải lại định mức</button></div>}
      {state.norms.isPending && <p role="status">Đang tải định mức tiền đường…</p>}
      {state.error && <div className="shipment-cost-entry__banner--error" role="alert">{state.error}</div>}
      {state.drafts.map((row, index) => <CostDraftRow
        key={index}
        index={index}
        row={row}
        options={state.options}
        disabled={disabled}
        uploading={state.uploadingIndex === index}
        pendingFile={!state.uploading && state.pendingFile?.index === index ? state.pendingFile.file : null}
        onPatch={(next) => state.patchDraft(index, next)}
        onChooseOption={(code) => state.chooseOptionFor(index, code)}
        onUpload={(file) => void state.upload(file, index)}
        onRemove={() => state.removeDraft(index)}
        onDiscardPendingFile={state.discardPendingFile}
      />)}
      <div className="shipment-cost-entry__form-actions"><button type="button" className="btn btn--secondary" disabled={state.busy || state.uploading} onClick={state.cancel}>Hủy</button><button type="submit" className="btn btn--primary" disabled={disabled || state.drafts.length === 0 || blockedRow}>{state.busy ? 'Đang lưu…' : `Lưu tất cả (${state.drafts.length} dòng)`}</button></div>
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
