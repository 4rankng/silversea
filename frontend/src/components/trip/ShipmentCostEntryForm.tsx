import { PhotoImage } from '../shared/PhotoImage';
import { useEffect, useRef, useState } from 'react';
import { Camera, Plus, ReceiptText, StickyNote, Trash2 } from 'lucide-react';
import {
  DRIVER_INCIDENTAL_COST_LABELS,
  NO_INVOICE_EVIDENCE_TYPE_LABELS,
  DriverIncidentalCostType,
} from '@tingting/shared';
import { driverClient, type DriverIncidentalCostView } from '../../api/driverClient';
import { NumberField, TextField, UuiSelectField, EmptyState } from '../../design-system';
import { formatCurrency, formatISODate } from '../../lib/format';
import { useAuthedPhotoUrls } from '../../lib/api/photo';
import { driverExpenseOption, requiredEvidenceTypeForExpenseCode, type DriverExpenseOption } from '../../features/driver/driver-expense-options';
import { driverLotCostRequiresReceipt } from '@tingting/shared';
import { useDriverExpenseEntry, type DriverExpenseDraft } from '../../features/driver/useDriverExpenseEntry';
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
 * the form's submit gate — a mirror of the server's single rule set
 * (`insertDriverIncidentalCostTx`), never a wider or narrower local reading.
 * SIL-769 (09/11, customer CR-006 2B — "khách hàng bảo thế nào thì làm thế"):
 * the biên lai photo is mandatory for EXACTLY the three shared lot fees
 * (Phí Nâng / Phí Hạ / Lưu vỏ — DRIVER_RECEIPT_REQUIRED_EXPENSE_TYPE_CODES);
 * every other lot row saves without a photo, superseding CP700-03's group law.
 * A required-evidence code (Sửa chữa dọc đường's hand-written receipt) still
 * needs its paper whatever the picker says.
 *
 * SIL-759 (spec_fix 09/11 Phần II Epic 1 mục 2): the [+ Thêm chi phí] form is
 * LOT-ONLY, one horizontal row per draft — the Tiền đường bucket is system
 * money (định mức tạm tính) the driver only views, with the "Ghi chú tiền
 * đường" for discrepancies, so the road options/norms are no longer offered
 * here. The evidence-kind ticks ride along: a catalog-classified lot fee's
 * paper kind follows the catalog itself (INVOICED ⇒ INVOICE, else RECEIPT) —
 * the same classification the server applies on the receivable side, whose
 * `evidenceKind === 'RECEIPT'` photo clause now guards ROAD rows only — lot
 * rows answer to the SIL-769 fee set above.
 */
function receiptStillNeeded(selected: DriverExpenseOption): boolean {
  if (requiredEvidenceTypeForExpenseCode(selected.expenseTypeCode) != null) return true;
  return driverLotCostRequiresReceipt(selected.expenseTypeCode);
}

/** Saved-row caption: the paper the row carries. Legacy rows (`evidence_kind`
 *  NULL) were never backfilled — "Chưa phân loại chứng từ"; only re-opening the
 *  lot writes a value. Card 141026230700: drivers no longer type invoice
 *  numbers, so an INVOICE row without one just says its kind (the number lives
 *  on the photographed paper for kế toán phơi phiếu). */
function evidenceCaption(entry: DriverIncidentalCostView): string {
  if (entry.evidenceKind == null) return 'Chưa phân loại chứng từ';
  if (entry.evidenceKind === 'INVOICE') return entry.invoiceNumber ? `HĐ ${entry.invoiceNumber}` : 'Hóa đơn';
  return 'Phiếu thu';
}

/** Which of the two card-141026230700 tables a SAVED row belongs to. Rows
 *  written before `costGroup` existed (NULL) follow the same fallback the
 *  write path uses: TOLL/PARKING/PER_DIEM are road money, everything else is
 *  a lot cost. */
function tableGroupOf(entry: DriverIncidentalCostView): 'DRIVER_SHIPMENT' | 'DRIVER_ROAD' {
  if (entry.costGroup === 'DRIVER_SHIPMENT' || entry.costGroup === 'DRIVER_ROAD') return entry.costGroup;
  return ([
    DriverIncidentalCostType.TOLL,
    DriverIncidentalCostType.PARKING,
    DriverIncidentalCostType.PER_DIEM,
  ] as DriverIncidentalCostType[]).includes(entry.costType) ? 'DRIVER_ROAD' : 'DRIVER_SHIPMENT';
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

/** SIL-759 — one draft row = ONE horizontal line with exactly four parts:
 *  Tên chi phí (dropdown, lot fees only) · Số tiền · camera icon · Xóa dòng.
 *  The day is system-assigned at entry time (occurredAt defaults to today);
 *  the only line below is the "Chi phí lô hàng khác" name field, the compact
 *  upload states and the CP700-03 gate. */
function CostDraftRow({ index, row, options, disabled, uploading, pendingFile, onPatch, onChooseOption, onUpload, onRemove, onDiscardPendingFile }: CostDraftRowProps) {
  const selected = driverExpenseOption(row.option, options);
  const catalogClassified = selected.expenseTypeCode != null;
  const requiredEvidence = requiredEvidenceTypeForExpenseCode(selected.expenseTypeCode);
  const requiresReceipt = requiredEvidence != null;
  const evidenceLabel = requiredEvidence == null ? '' : NO_INVOICE_EVIDENCE_TYPE_LABELS[requiredEvidence];
  const receiptMissing = receiptStillNeeded(selected) && !row.receiptStorageKey;
  // SIL-769 — the three shared lot fees keep the "(bắt buộc)" affordance and
  // name THE FEE in the blocking line; every other row shows the optional
  // label and never blocks the save.
  const cameraLabel = uploading ? 'Đang tải ảnh biên lai'
    : row.receiptStorageKey ? 'Thay ảnh biên lai — đã đính kèm'
    : requiresReceipt ? `Chụp / chọn ${evidenceLabel} (bắt buộc)`
    : receiptMissing ? 'Chụp / chọn biên lai (bắt buộc)'
    : 'Chụp / chọn biên lai';

  return (
    <section className="shipment-cost-entry__draft-row" aria-label={`Khoản chi ${index + 1}`}>
      <div className="shipment-cost-entry__draft-line">
        <UuiSelectField label="Tên chi phí" value={row.option} disabled={disabled} onChange={(event) => onChooseOption(event.target.value)}
          options={options.filter(option => option.group === 'DRIVER_SHIPMENT').map(option => ({ value: option.code, label: option.label }))} />
        <NumberField controlSize="sm" label="Số tiền" grouped signed value={row.amount} onChange={(amount) => onPatch({ amount })} min={-999_999_999_999_999} step={1} max={999_999_999_999_999} required disabled={disabled} />
        <div className="shipment-cost-entry__row-actions">
          {/* SIL-759 — the camera rides the money field as a small icon button
              (action icon, aria-labelled — house law §4), replacing the old
              full-width "Chụp / chọn biên lai" block. Attached state flips the
              glyph to the receipt icon; the compact status line below is the
              text confirmation. */}
          <label className="btn btn--secondary btn--icon btn--sm shipment-cost-entry__camera-icon" title={cameraLabel}>
            {row.receiptStorageKey ? <ReceiptText size={16} aria-hidden="true" /> : <Camera size={16} aria-hidden="true" />}
            <input type="file" accept="image/*" className="sr-only" aria-label="Chọn ảnh biên lai" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) onUpload(file); }} />
          </label>
          <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label={`Xóa dòng ${index + 1}`} title="Xóa dòng" disabled={disabled} onClick={onRemove}><Trash2 size={16} aria-hidden="true" /></button>
        </div>
      </div>
      {!catalogClassified && (
        <TextField controlSize="sm" label="Tên khoản chi" value={row.feeName} disabled={disabled} maxLength={200} placeholder={selected.label} onChange={(event) => onPatch({ feeName: event.target.value })} />
      )}
      {/* Card 20260928_181, tiêu chí 5: a negative amount is a real entry (a
          refund), and every total in the system EXCLUDES negative lines
          (sumExcludingNegative). That is invisible from the field itself, so
          the screen has to say it — and only while a negative is typed. */}
      {Number(row.amount) < 0 && (
        <p className="shipment-cost-entry__empty" data-testid="shipment-cost-negative-note">
          Số âm là khoản hoàn lại, không phải chi phí: dòng này được lưu nhưng KHÔNG cộng vào bất kỳ tổng nào.
        </p>
      )}
      {row.receiptStorageKey && <p className="shipment-cost-entry__empty" role="status">Đã đính kèm biên lai.</p>}
      {pendingFile && <div className="shipment-cost-entry__upload-retry" role="status"><span>{pendingFile.name} · Chưa tải thành công</span><button type="button" className="btn btn--secondary btn--sm" disabled={disabled} onClick={() => onUpload(pendingFile)}>Thử tải lại ảnh</button><button type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={onDiscardPendingFile}>Bỏ ảnh chưa tải</button></div>}
      {/* SIL-769 — the blocking line NAMES the fee that is missing its biên
          lai (Phí nâng / Phí hạ / Phí lưu bãi), mirroring the server's own
          refusal; a mandated-evidence code names its paper instead. The form
          blocks the submit (never silently) until the paper is attached, and
          the server refuses the row without it. */}
      {receiptMissing && <p className="shipment-cost-entry__empty" role="status" data-testid="shipment-cost-receipt-required">{requiresReceipt ? `${selected.label} phải kèm ${evidenceLabel} — kế toán phơi phiếu đối chiếu chứng từ giấy này.` : `${selected.label} phải kèm ảnh biên lai trước khi lưu.`}</p>}
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
  const blockedRow = state.drafts.some(row => receiptStillNeeded(driverExpenseOption(row.option, state.options)) && !row.receiptStorageKey);
  const hasRoadNorm = totalRoadAllowance != null && Number(totalRoadAllowance) > 0;

  const noteEditor = (
    <div className="shipment-cost-entry__section-note" data-testid="cost-note-row">
      {/* Card 20260926_29 item 14, SIL-759 wording: ONE collapsed row inside
          the Tiền đường table — "Ghi chú tiền đường" sits right under the
          system's tạm tính so the driver records the actual money + reason for
          kế toán đối soát. */}
      {noteOpen ? (
        <>
          <TextField controlSize="sm" label="Ghi chú tiền đường" value={sectionNote} maxLength={2000} disabled={readOnly || noteSaving} onChange={(event) => setSectionNote(event.target.value)} />
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
          <span>Ghi chú tiền đường</span>
        </button>
      )}
    </div>
  );

  return <section className="shipment-cost-entry" aria-label="Chi phí chuyến">
    <header className="shipment-cost-entry__head">
      <div><h2 className="shipment-cost-entry__title">Chi phí lô hàng & tiền đường</h2>
        <p className="shipment-cost-entry__subtitle">Ghi khoản thực tế bạn đã chi; kế toán đối chiếu và thanh toán riêng.</p></div>
    </header>
    {state.loadError && <div role="alert" className="shipment-cost-entry__banner--error">{state.loadError} <button type="button" className="btn btn--secondary btn--sm" onClick={() => void state.refresh()}>Thử tải lại</button></div>}
    {/* Card 141026230700 — TWO tables, "Chi phí lô hàng" and "Tiền đường",
        always both visible. SIL-759: the road table leads with the SYSTEM
        tạm tính định mức (locked, read-only — no add control in this area)
        and the "Ghi chú tiền đường" right below it; the [+ Thêm chi phí]
        button lives in the LOT table head only. */}
    {state.loading ? <p role="status">Đang tải chi phí…</p> : !state.loadError && <>
      {state.entries.length === 0 && (
        <EmptyState
          variant="compact"
          context="driver-costs"
          title="Chưa có chi phí phát sinh"
          description="Thêm khoản thực chi trong chuyến; kế toán đối chiếu và thanh toán riêng."
        />
      )}
      <div className="shipment-cost-entry__tables">
        {([['lot', 'Chi phí lô hàng', 'DRIVER_SHIPMENT', 'Chưa có chi phí lô hàng phát sinh.'], ['road', 'Tiền đường', 'DRIVER_ROAD', 'Chưa có tiền đường phát sinh.']] as const).map(([key, title, group, emptyText]) => {
          // receiptUrls is index-aligned with state.entries — pair each entry
          // with its URL BEFORE partitioning, or the split shifts the indices.
          const rows = state.entries.map((entry, index) => ({ entry, url: receiptUrls[index] })).filter(({ entry }) => tableGroupOf(entry) === group);
          return (
            <section key={group} className="shipment-cost-entry__table" aria-label={`Bảng ${title}`}>
              <div className="shipment-cost-entry__table-head">
                <h3 className="shipment-cost-entry__table-title">{title}</h3>
                {key === 'lot' && !state.open && !readOnly && <button type="button" className="btn btn--primary btn--sm" onClick={() => { state.setOpen(true); if (state.drafts.length === 0) state.addDraft(); }}><Plus size={15} /> Thêm chi phí</button>}
              </div>
              {key === 'road' && (
                <div className="shipment-cost-entry__road-norm" data-testid="shipment-cost-road-allowance">
                  {hasRoadNorm
                    ? <div className="shipment-cost-entry__road-norm-amount"><span>Tạm tính định mức</span><strong>{formatCurrency(totalRoadAllowance)}</strong></div>
                    : <p className="shipment-cost-entry__empty">Chưa có định mức tiền tuyến.</p>}
                  {noteEditor}
                </div>
              )}
              {rows.length === 0
                ? <p className="shipment-cost-entry__empty">{emptyText}</p>
                : <ul className="shipment-cost-entry__list">{rows.map(({ entry, url }) => <li key={entry.id} className="shipment-cost-entry__item">
                  {entry.receiptStorageKey && <a href={url || undefined} target="_blank" rel="noreferrer" aria-label={`Xem biên lai ${entry.feeName || DRIVER_INCIDENTAL_COST_LABELS[entry.costType]}`}><PhotoImage src={url} alt="Biên lai" className="shipment-cost-entry__thumb" /></a>}
                  <div className="shipment-cost-entry__item-body"><div className="shipment-cost-entry__item-top"><strong>{entry.feeName || DRIVER_INCIDENTAL_COST_LABELS[entry.costType]}</strong><span className="shipment-cost-entry__item-amount">{formatCurrency(entry.amount)}</span></div>
                    <div className="shipment-cost-entry__item-meta"><span>{formatISODate(entry.occurredAt)}</span><span>{evidenceCaption(entry)}</span>
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
            </section>
          );
        })}
      </div>
    </>}

    {state.open && <form className="shipment-cost-entry__form" onSubmit={(event) => void state.save(event)}>
      {/* Step 3 — draft table: rows accumulate, then ONE all-or-nothing save. */}
      <button type="button" className="btn btn--secondary btn--sm shipment-cost-entry__draft-add" disabled={disabled} onClick={state.addDraft}><Plus size={15} /> Thêm dòng</button>
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
  </section>;
}

export default ShipmentCostEntryForm;
