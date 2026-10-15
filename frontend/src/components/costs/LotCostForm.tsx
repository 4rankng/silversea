import { Camera, ReceiptText } from 'lucide-react';
import type { ReactNode } from 'react';
import { DateField, NumberField, Tabs, TextField, UuiSelectField } from '../../design-system';
import { PhotoImage } from '../shared/PhotoImage';
import './LotCostForm.css';
/**
 * LotCostForm — the shared ONE-ROW entry form for a lot cost / road-money
 * line (cost-doc redesign, accountant doc §2.3: the driver captures the
 * amount and the supporting-document PHOTO; number-level reconciliation is
 * the accountant's side). Wave B (driver panel) is the first consumer; the
 * later waves mount the same base inside their own surfaces and MUST NOT
 * fork it — new field needs = a new prop here, then every host inherits.
 *
 * Design provenance: the document-kind control is the sanctioned segmented
 * primitive `Tabs variant="boxed"` (operator ruling 2026-09-27, design-system
 * 02 — boxed Tabs collapse to the shared select at phone widths / coarse
 * pointers, QA-AUDIT-UI-91). Consulted Untitled UI PRO v8 `base/radio-buttons`
 * for the segmented anatomy; not installed — the house primitive owns the
 * pattern and a second segmented system is banned by the one-answer rule.
 *
 * The base is CONTROLLED and data-only: it owns no fetching, no payload, no
 * group state. The host supplies options/value/patches and derives the
 * document kind (catalog class decides for classified fees — cards
 * 20260928_163/164 — so the host passes `documentKindLocked` there).
 */

/** What the attached photo IS — the split the accountant's voucher fund
 *  source depends on (QuyTrinhO2C §7: invoice rows vs receipt rows). */
export type LotCostDocumentKind = 'RECEIPT' | 'INVOICE';

export const LOT_COST_DOCUMENT_KIND_LABELS: Record<LotCostDocumentKind, string> = {
  RECEIPT: 'Phiếu thu',
  INVOICE: 'Hóa đơn',
};

export interface LotCostFormOption {
  /** Stable option code (host namespace — catalog refs, fee norms, legacy codes). */
  code: string;
  label: string;
  /** Suggested amount pre-filled on pick (fee norms); the real value stays editable. */
  amount?: number;
}

export interface LotCostFormValue {
  optionCode: string;
  amount: number | '';
  occurredAt: string;
  documentKind: LotCostDocumentKind;
  /** Free-text fee name; the host hides it when the picked option's name is
   *  catalog-owned (placeholder label renders instead). */
  feeName: string;
  note: string;
  receiptStorageKey: string | null;
}

export interface LotCostFormReceiptState {
  required: boolean;
  /** Evidence label for the required receipt (e.g. "Phiếu thu / biên nhận / vé lẻ"). */
  requiredLabel?: string;
  uploading: boolean;
  pendingFile: File | null;
  /** Authed blob/object URL for the uploaded draft receipt, when loaded. */
  previewUrl?: string;
}

export interface LotCostFormProps {
  idPrefix: string;
  options: Array<LotCostFormOption>;
  value: LotCostFormValue;
  onPatch: (patch: Partial<LotCostFormValue>) => void;
  /** Option pick — the HOST applies the option's defaults (amount, name,
   *  document kind) so classified-fee rules stay in one place per feature. */
  onPickOption: (code: string) => void;
  disabled?: boolean;
  /** Selected-option label when the name is catalog-owned (no free-text field). */
  catalogFeeLabel?: string;
  showDateField?: boolean;
  showNoteField?: boolean;
  /** Document-kind segmented locked (catalog decides for classified fees). */
  documentKindLocked?: boolean;
  /** Road-money rows carry no document-kind tag (driver gets picker + amount). */
  showDocumentKind?: boolean;
  /** Road-money rows carry no receipt capture at all (accountant adjusts). */
  showReceiptSection?: boolean;
  /** Suggestion copy under the amount field (fee-norm pre-fill), e.g.
   *  "Gợi ý 100.000 ₫; sửa theo khoản thực tế. Chưa lưu thì chưa phát sinh tiền." */
  amountHint?: string;
  receipt: LotCostFormReceiptState;
  onReceiptFile: (file: File) => void;
  onRetryReceipt?: () => void;
  onDiscardReceipt?: () => void;
  /** Host-owned hint lines rendered under the fields (group-specific copy). */
  hints?: ReactNode;
  error?: string | null;
  submitLabel: string;
  busy?: boolean;
  onSubmit: () => void;
  onCancel?: () => void;
  cancelLabel?: string;
  /** Continuous entry: the host's "chain another row" action in the footer. */
  footerExtra?: ReactNode;
}

export function LotCostForm({
  idPrefix, options, value, onPatch, onPickOption, disabled = false,
  catalogFeeLabel, showDateField = true, showNoteField = true,
  documentKindLocked = false, showDocumentKind = true, showReceiptSection = true, amountHint,
  receipt, onReceiptFile, onRetryReceipt, onDiscardReceipt,
  hints, error, submitLabel, busy = false, onSubmit, onCancel, cancelLabel = 'Hủy',
  footerExtra,
}: LotCostFormProps) {
  const blocked = Boolean(disabled || busy);
  // The receipt gate is the host's submit contract (host disables submit);
  // the base renders the visible marking + status so the reason is never silent.
  const receiptMissing = receipt.required && !value.receiptStorageKey;
  return (
    <form className="lot-cost-form" aria-label={submitLabel} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      {error && <div className="lot-cost-form__banner--error" role="alert">{error}</div>}
      <div className="lot-cost-form__fields">
        <UuiSelectField
          label="Loại chi phí" value={value.optionCode} disabled={blocked}
          onChange={(event) => onPickOption(event.target.value)}
          options={options.map((option) => ({ value: option.code, label: option.label }))}
        />
        {catalogFeeLabel
          ? <p className="lot-cost-form__hint" data-testid={`${idPrefix}-catalog-fee`}>{`Tên khoản chi: ${catalogFeeLabel} (theo danh mục phí).`}</p>
          : <TextField controlSize="sm" label="Tên khoản chi" value={value.feeName} disabled={blocked} maxLength={200}
              onChange={(event) => onPatch({ feeName: event.target.value })} />}
        <NumberField controlSize="sm" label="Thực chi (VND)" grouped signed value={value.amount}
          onChange={(amount) => onPatch({ amount })} min={-999_999_999_999_999} step={1} max={999_999_999_999_999}
          required disabled={blocked} helpText={amountHint} />
        {showDateField && (
          <DateField controlSize="sm" label="Ngày chi" value={value.occurredAt}
            onChange={(occurredAt) => onPatch({ occurredAt })} required disabled={blocked} />
        )}
        {showDocumentKind && (
          <div className="lot-cost-form__kind" data-testid={`${idPrefix}-document-kind`}>
            <span className="lot-cost-form__kind-label" id={`${idPrefix}-kind-label`}>Chứng từ kèm theo</span>
            <Tabs
              ariaLabel="Chứng từ kèm theo" variant="boxed" value={value.documentKind}
              onChange={(kind) => { if (!documentKindLocked) onPatch({ documentKind: kind as LotCostDocumentKind }); }}
              tabs={[
                { id: 'RECEIPT', label: LOT_COST_DOCUMENT_KIND_LABELS.RECEIPT, disabled: documentKindLocked && value.documentKind !== 'RECEIPT' },
                { id: 'INVOICE', label: LOT_COST_DOCUMENT_KIND_LABELS.INVOICE, disabled: documentKindLocked && value.documentKind !== 'INVOICE' },
              ]}
            />
          </div>
        )}      </div>
      {showNoteField && (
        <TextField controlSize="sm" label="Ghi chú khoản chi" value={value.note} disabled={blocked} maxLength={2000}
          onChange={(event) => onPatch({ note: event.target.value })} />
      )}
      {hints}
      {showReceiptSection && (
        <div className="lot-cost-form__receipt">
        <label className="btn btn--secondary lot-cost-form__camera-btn">
          <Camera size={16} />
          {receipt.uploading
            ? 'Đang tải…'
            : value.receiptStorageKey
              ? 'Thay ảnh chứng từ'
              : receipt.required
                ? `Chụp / chọn ${receipt.requiredLabel ?? 'biên lai'} (bắt buộc)`
                : 'Chụp / chọn biên lai'}
          <input
            type="file" accept="image/*" className="sr-only" aria-label="Chọn ảnh biên lai"
            disabled={blocked}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = '';
              if (file) onReceiptFile(file);
            }}
          />
        </label>
        {receipt.pendingFile && !receipt.uploading && (
          <div className="lot-cost-form__upload-retry" role="status">
            <span>{receipt.pendingFile.name} · Chưa tải thành công</span>
            {onRetryReceipt && <button type="button" className="btn btn--secondary btn--sm" disabled={blocked} onClick={onRetryReceipt}>Thử tải lại ảnh</button>}
            {onDiscardReceipt && <button type="button" className="btn btn--ghost btn--sm" disabled={blocked} onClick={onDiscardReceipt}>Bỏ ảnh chưa tải</button>}
          </div>
        )}
        {value.receiptStorageKey && (
          <div className="lot-cost-form__receipt-preview">
            <PhotoImage src={receipt.previewUrl} alt="Biên lai đã chọn" />
            <span><ReceiptText size={14} /> Ảnh sẽ gắn với khoản chi này</span>
          </div>
        )}
        {receiptMissing && (
          <p className="lot-cost-form__hint" role="status" data-testid={`${idPrefix}-receipt-required`}>
            {`Khoản chi phải kèm ${receipt.requiredLabel ?? 'ảnh biên lai'} — kế toán đối chiếu chứng từ giấy này.`}
          </p>
        )}
        </div>
      )}
      <div className="lot-cost-form__actions">
        {footerExtra}
        <span className="lot-cost-form__actions-spacer" />
        {onCancel && <button type="button" className="btn btn--secondary" disabled={blocked} onClick={onCancel}>{cancelLabel}</button>}
        <button type="submit" className="btn btn--primary" disabled={blocked || receiptMissing}>{busy ? 'Đang lưu…' : submitLabel}</button>
      </div>
    </form>
  );
}
