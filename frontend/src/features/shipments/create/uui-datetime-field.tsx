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
  /** FB-009 (card 131026233500): raised when the "Chọn ngày giờ" dialog
   * copies the picked giờ hẹn, so the host can raise its "Đã copy" toast. */
  onCopied?: (formatted: string) => void;
  /** Card 071026204700 (FB-001): one combined ngày+giờ popup. */
  combinedPicker?: boolean;
}

/** Two independent 24h time/date controls share the existing complete ISO
 * event contract used by every shipment-create datetime consumer. A native
 * `required` is deliberately NOT forwarded (QA1-007): the save() gate reads
 * [data-split-datetime] input:invalid, so the constraint would preempt the
 * app-owned summary — the cell header carries the visible mark instead. */
export function UDateTimeField({
  id,
  label,
  value,
  onChange,
  disabled,
  error,
  hideLabel,
  onCopied,
  combinedPicker,
}: UDateTimeFieldProps) {
  return (
    <SplitDateTimeField
      id={id}
      label={label}
      hideLabel={hideLabel}
      value={value}
      onChange={(next) => onChange(asEvent(next))}
      disabled={disabled}
      error={error}
      onCopied={onCopied}
      combinedPicker={combinedPicker}
      className="csc-uui-field"
    />
  );
}
