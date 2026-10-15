import { PhotoImage } from '../shared/PhotoImage';
import { useEffect, useState } from 'react';
import { Plus, StickyNote } from 'lucide-react';
import {
  DRIVER_INCIDENTAL_COST_LABELS,
  NO_INVOICE_EVIDENCE_TYPE_LABELS,
  DriverIncidentalCostType,
} from '@tingting/shared';
import { driverClient } from '../../api/driverClient';
import { TextField, EmptyState } from '../../design-system';
import { formatCurrency, formatISODate } from '../../lib/format';
import { useAuthedPhotoUrls } from '../../lib/api/photo';
import { driverExpenseOptionInvoiceClass, requiredEvidenceTypeForExpenseCode } from '../../features/driver/driver-expense-options';
import { useDriverExpenseEntry, type DriverExpenseEntryRow } from '../../features/driver/useDriverExpenseEntry';
import { LotCostForm } from '../costs/LotCostForm';
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

/** Cost-doc redesign (accountant doc §2.3): the end-of-lot panel keeps BOTH
 *  cost tables — "Chi phí lô hàng" and "Tiền đường" — as separate record
 *  tables. Legacy rows carry no costGroup; the server's own default rule
 *  (road bucket = TOLL/PARKING/PER_DIEM) decides their table. */
function groupOf(entry: DriverExpenseEntryRow): 'DRIVER_ROAD' | 'DRIVER_SHIPMENT' {
  if (entry.costGroup === 'DRIVER_ROAD' || entry.costGroup === 'DRIVER_SHIPMENT') return entry.costGroup;
  return ['TOLL', 'PARKING', 'PER_DIEM'].includes(entry.costType) ? 'DRIVER_ROAD' : 'DRIVER_SHIPMENT';
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
  const lotEntries = state.entries.filter((entry) => groupOf(entry) === 'DRIVER_SHIPMENT');
  const roadEntries = state.entries.filter((entry) => groupOf(entry) === 'DRIVER_ROAD');
  const selected = state.openGroup == null ? undefined : state.options.find((option) => option.code === state.draft.optionCode && option.group === state.openGroup);
  // Card 20260928_163/164 — the picked fee's CATALOG class decides the
  // document kind and locks the selector (a classified fee cannot contradict
  // its catalog row; unclassified fees leave the choice to the driver).
  const kindLocked = driverExpenseOptionInvoiceClass(selected) !== 'UNCLASSIFIED';
  // Card 20260928_165 — an expense code in the shared receipt map carries a
  // hand-written receipt as its document.
  const requiredEvidence = requiredEvidenceTypeForExpenseCode(selected?.expenseTypeCode);
  const requiresReceipt = requiredEvidence != null;
  const evidenceLabel = requiredEvidence == null ? '' : NO_INVOICE_EVIDENCE_TYPE_LABELS[requiredEvidence];
  const catalogClassified = selected?.expenseTypeCode != null;

  const [sectionNote, setSectionNote] = useState(costSubmissionNote ?? '');
  const [savedNote, setSavedNote] = useState(costSubmissionNote ?? '');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  // Card 20260926_29 item 14: the note row starts collapsed (the editor
  // opens on tap; a saved note previews as one line).
  const [noteOpen, setNoteOpen] = useState(Boolean(costSubmissionNote));
  async function saveNote() {
    if (disabled || noteSaving) return;
    setNoteSaving(true); setNoteError(null);
    try { await driverClient.updateCostSubmissionNote(tripId, sectionNote); setSavedNote(sectionNote); setNoteOpen(false); }
    catch (cause) { setNoteError(cause instanceof Error ? cause.message : 'Chưa lưu được ghi chú.'); }
    finally { setNoteSaving(false); }
  }

  return <section className="shipment-cost-entry" aria-label="Chi phí chuyến">
    <header className="shipment-cost-entry__head">
      <div><h2 className="shipment-cost-entry__title">Chi phí lô hàng &amp; tiền đường</h2>
        <p className="shipment-cost-entry__subtitle">Ghi khoản thực tế bạn đã chi; kế toán đối chiếu và thanh toán riêng.</p></div>
    </header>
    {state.loadError && <div role="alert" className="shipment-cost-entry__banner--error">{state.loadError} <button type="button" className="btn btn--secondary btn--sm" onClick={() => void state.refresh()}>Thử tải lại</button></div>}
    <p className="shipment-cost-entry__empty" data-testid="shipment-cost-route-reference">
      {totalRoadAllowance != null && Number(totalRoadAllowance) > 0
        ? `Tiền tuyến tham chiếu: ${formatCurrency(totalRoadAllowance)}. Chỉ ghi khoản phát sinh thực tế, không cộng thêm nếu đã có trong danh sách.`
        : 'Chưa có định mức tiền tuyến. Nhập số tiền thực tế; chưa có định mức không có nghĩa là 0đ.'}
    </p>
    {state.loading ? <p role="status">Đang tải chi phí…</p> : <>
      {state.entries.length === 0 && !state.loadError && (
        <EmptyState
          variant="compact"
          context="driver-costs"
          title="Chưa có chi phí phát sinh"
          description="Thêm khoản thực chi trong chuyến; kế toán đối chiếu và thanh toán riêng."
        />
      )}
      <CostTable
        title="Chi phí lô hàng" caption="Chi phí lô hàng bạn đã ghi"
        entries={lotEntries} receiptUrls={receiptUrls} readOnly={readOnly}
        emptyText="Chưa có khoản lô hàng nào."
        addLabel="Thêm khoản lô hàng" onAdd={() => state.openGroupEntry('DRIVER_SHIPMENT')}
        onRefresh={state.refresh} />
      <CostTable
        title="Tiền đường" caption="Tiền đường bạn đã ghi"
        entries={roadEntries} receiptUrls={receiptUrls} readOnly={readOnly}
        emptyText="Chưa có khoản tiền đường nào."
        addLabel="Thêm khoản tiền đường" onAdd={() => state.openGroupEntry('DRIVER_ROAD')}
        onRefresh={state.refresh} />

      {state.openGroup === 'DRIVER_SHIPMENT' && (
        <LotCostForm
          idPrefix="shipment-cost"
          options={state.options.filter((option) => option.group === 'DRIVER_SHIPMENT')}
          value={state.draft} onPatch={state.patch} onPickOption={state.chooseOption}
          disabled={disabled}
          catalogFeeLabel={catalogClassified ? selected?.label : undefined}
          documentKindLocked={kindLocked}
          amountHint={selected?.amount ? `Gợi ý ${formatCurrency(selected.amount)}; sửa theo khoản thực tế. Chưa lưu thì chưa phát sinh tiền.` : undefined}
          receipt={{ required: requiresReceipt, requiredLabel: evidenceLabel || undefined, uploading: state.uploading, pendingFile: state.pendingFile, previewUrl: draftReceiptUrl }}
          onReceiptFile={(file) => void state.upload(file)}
          onRetryReceipt={() => { if (state.pendingFile) void state.upload(state.pendingFile); }}
          onDiscardReceipt={state.discardPendingFile}
          hints={<LotCostHints state={state} selected={selected} evidenceLabel={evidenceLabel} requiresReceipt={requiresReceipt} />}
          error={state.error} submitLabel="Lưu chi phí" busy={state.busy}
          onSubmit={() => void state.save()} onCancel={state.cancel} />
      )}
      {state.openGroup === 'DRIVER_ROAD' && (
        <LotCostForm
          idPrefix="shipment-cost-road"
          options={state.options.filter((option) => option.group === 'DRIVER_ROAD')}
          value={state.draft} onPatch={state.patch} onPickOption={state.chooseOption}
          disabled={disabled}
          catalogFeeLabel={selected?.feeNormCode != null ? selected?.label : undefined}
          showDateField={false} showNoteField={false} showDocumentKind={false} showReceiptSection={false}
          amountHint={selected?.amount ? `Gợi ý ${formatCurrency(selected.amount)}; sửa theo khoản thực tế. Chưa lưu thì chưa phát sinh tiền.` : undefined}
          receipt={{ required: false, uploading: state.uploading, pendingFile: state.pendingFile, previewUrl: draftReceiptUrl }}
          onReceiptFile={(file) => void state.upload(file)}
          onRetryReceipt={() => { if (state.pendingFile) void state.upload(state.pendingFile); }}
          onDiscardReceipt={state.discardPendingFile}
          hints={<LotCostHints state={state} selected={selected} evidenceLabel={evidenceLabel} requiresReceipt={requiresReceipt} />}
          error={state.error} submitLabel="Lưu chi phí" busy={state.busy}
          onSubmit={() => void state.save()} onCancel={state.cancel} />
      )}
    </>}

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

/** Host-owned hint copy for the open entry form (group rules, norms state,
 *  and the negative-amount explanation). */
function LotCostHints({ state, selected, evidenceLabel, requiresReceipt }: {
  state: ReturnType<typeof useDriverExpenseEntry>;
  selected: ReturnType<typeof useDriverExpenseEntry>['options'][number] | undefined;
  evidenceLabel: string; requiresReceipt: boolean;
}) {
  const negativeAmountTyped = Number(state.draft.amount) < 0;
  return <>
    {state.openGroup === 'DRIVER_ROAD' && state.norms.isError && <div role="alert" className="shipment-cost-entry__banner--error">Không tải được định mức tiền đường. Bạn vẫn có thể nhập khoản thực chi bằng các loại phí chung. <button type="button" className="btn btn--secondary btn--sm" onClick={() => void state.norms.refetch()}>Thử tải lại định mức</button></div>}
    {state.openGroup === 'DRIVER_ROAD' && state.norms.isPending && <p role="status">Đang tải định mức tiền đường…</p>}
    {/* Card 20260928_181, tiêu chí 5: a negative amount is a real entry (a
        refund), and every total in the system EXCLUDES negative lines
        (sumExcludingNegative). That is invisible from the field itself, so
        the screen has to say it — and only while a negative is typed, or the
        line becomes noise on every other entry. */}
    {negativeAmountTyped && (
      <p className="shipment-cost-entry__empty" data-testid="shipment-cost-negative-note">
        Số âm là khoản hoàn lại, không phải chi phí: dòng này được lưu nhưng KHÔNG cộng vào bất kỳ tổng nào.
      </p>
    )}
    {requiresReceipt && <p className="shipment-cost-entry__empty">Chứng từ: {evidenceLabel}.</p>}
    {selected?.type === DriverIncidentalCostType.ROAD_ALLOWANCE && <p className="shipment-cost-entry__empty">Khoản đã thỏa thuận được giữ trong định mức chuyến; chứng từ này không cộng thêm phụ cấp lần nữa.</p>}
    <p className="shipment-cost-entry__empty">{state.openGroup === 'DRIVER_ROAD' ? 'Tiền đường không thu thêm khách hàng.' : 'Kế toán đối chiếu chứng từ và số thu khách.'}</p>
  </>;
}

/** One cost table (record-table band; the shared `@container` collapse turns
 *  each row into a labelled record card on the driver's phone). */
function CostTable({ title, caption, entries, receiptUrls, readOnly, emptyText, addLabel, onAdd, onRefresh }: {
  title: string; caption: string;
  entries: DriverExpenseEntryRow[];
  /** Index-aligned with `entries` (authed blob URLs). */
  receiptUrls: Array<string | null>;
  readOnly: boolean;
  emptyText: string;
  addLabel?: string;
  onAdd?: () => void;
  onRefresh: () => Promise<void>;
}) {
  return <div className="shipment-cost-entry__table">
    <div className="shipment-cost-entry__table-head">
      <h3 className="shipment-cost-entry__table-title">{title}</h3>
      {!readOnly && onAdd && <button type="button" className="btn btn--secondary btn--sm" onClick={onAdd}><Plus size={15} /> {addLabel ?? 'Thêm'}</button>}
    </div>
    <div className="record-table-wrap record-table-wrap--table">
      <table className="record-table ops-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr><th>Khoản chi</th><th>Chứng từ</th><th className="num">Số tiền</th><th><span className="sr-only">Thao tác</span></th></tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr><td colSpan={4} className="shipment-cost-entry__empty-cell" data-testid="shipment-cost-table-empty">{emptyText}</td></tr>
          ) : entries.map((entry, index) => (
            <tr key={entry.id}>
              <td data-label="Khoản chi" className="record-table__text">
                <strong>{entry.feeName || DRIVER_INCIDENTAL_COST_LABELS[entry.costType]}</strong>
                <span className="shipment-cost-entry__cell-meta">{formatISODate(entry.occurredAt)}</span>
                {entry.note && <span className="shipment-cost-entry__item-note">{entry.note}</span>}
                {/* Card 081026091900 — a negative row is an adjusting entry, not
                    a spend: ruling 20260928_197 (shipped + QA PASSED on the Ops
                    wallet). Same wording, same rule, now in the table band. */}
                {Number(entry.amount) < 0 && (
                  <span
                    className="shipment-cost-entry__item-adjustment"
                    title="Dòng âm là bút toán điều chỉnh — tương đương bỏ/bớt khoản, KHÔNG phải một khoản chi, và không được cộng vào tổng."
                  >
                    — bút toán điều chỉnh (dòng âm)
                  </span>
                )}
              </td>
              <td data-label="Chứng từ">
                {entry.receiptStorageKey
                  ? <a href={receiptUrls[index] || undefined} target="_blank" rel="noreferrer" aria-label={`Xem biên lai ${entry.feeName || DRIVER_INCIDENTAL_COST_LABELS[entry.costType]}`} className="shipment-cost-entry__receipt-cell">
                      <PhotoImage src={receiptUrls[index] ?? undefined} alt="Biên lai" className="shipment-cost-entry__thumb" />
                    </a>
                  : <span className="shipment-cost-entry__cell-meta">—</span>}
                {entry.invoiceNumber && <span className="shipment-cost-entry__cell-meta">HĐ {entry.invoiceNumber}</span>}
              </td>
              <td data-label="Số tiền" className="num">{formatCurrency(entry.amount)}</td>
              <td data-label="" className="record-table__action shipment-cost-entry__cell-actions">
                <DriverSavedExpenseProofs expenseId={entry.id} />
                {!readOnly && <DriverExpenseCorrection expenseId={entry.id} onSaved={onRefresh} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>;
}
