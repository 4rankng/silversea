import { SplitDateTimeField } from '../../../design-system/forms/SplitDateTimeField';

type HtmlInputEvent = { target: { value: string } };

function asEvent(value: string): HtmlInputEvent {
  return { target: { value } };
}

interface UDateTimeFieldProps {
  id?: string;
  label: string;
  value: string;
  onChange: (event: HtmlInputEvent) => void;
  disabled?: boolean;
  error?: string;
  hideLabel?: boolean;
  /** QA1-007 law, ported to the split datetime host: visual-only required
   *  mark on the label — never a native `required`, which would preempt the
   *  workspace's app-owned validation paint (the [data-split-datetime]
   *  :invalid gate stays the incomplete-draft backstop). */
  requiredMark?: boolean;
  /** FB-009 (card 131026233500): raised when the "Chọn ngày giờ" dialog
   *  copies the picked giờ hẹn, so the host can raise its "Đã copy" toast. */
  onCopied?: (formatted: string) => void;
  /** Card 071026204700 (FB-001): one combined ngày+giờ popup. */
  combinedPicker?: boolean;
}

/** Two independent 24h time/date controls share the existing complete ISO
 *  event contract used by every shipment-create datetime consumer. A native
 *  `required` is deliberately NOT forwarded (QA1-007): the save() gate reads
 *  [data-split-datetime] input:invalid, so the constraint would preempt the
 *  app-owned summary — the cell header carries the visible mark instead. */
export function UDateTimeField({
  id,
  label,
  value,
  onChange,
  disabled,
  error,
  hideLabel,
  requiredMark,
  onCopied,
  combinedPicker,
}: UDateTimeFieldProps) {
  return (
    <>
      {requiredMark && !hideLabel && (
        <span className="split-datetime__label">
          {label}
          {/* SIL-1239 (QA 28/11): the mark uses the form's error red
              (--fg-error, the same star the sibling create fields paint) —
              the ds rose `.ds-field__required` (#A0444E) read as a DIM star
              beside the bright #d92d20 marks, so a counted field looked
              uncounted. Same shape as uui-searchable-field's mark. */}
          <span aria-hidden="true" style={{ color: 'var(--fg-error, #d92d20)' }}> *</span>
        </span>
      )}
      <SplitDateTimeField
        id={id}
        label={label}
        /* requiredMark owns the visible label (mark included) — the field's
         * own label span must not render twice. The group aria-label and the
         * segment labels still carry the plain label. */
        hideLabel={hideLabel || Boolean(requiredMark)}
        value={value}
        onChange={(next) => onChange(asEvent(next))}
        disabled={disabled}
        error={error}
        onCopied={onCopied}
        combinedPicker={combinedPicker}
        className="csc-uui-field"
      />
    </>
  );
}
