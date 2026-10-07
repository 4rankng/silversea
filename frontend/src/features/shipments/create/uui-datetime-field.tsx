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
  /** Card 071026204700 (FB-001): one combined ngày+giờ popup. */
  combinedPicker?: boolean;
}

/** Two independent 24h time/date controls share the existing complete ISO
 * event contract used by every shipment-create datetime consumer. */
export function UDateTimeField({
  id,
  label,
  value,
  onChange,
  disabled,
  error,
  hideLabel,
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
      combinedPicker={combinedPicker}
      className="csc-uui-field"
    />
  );
}
