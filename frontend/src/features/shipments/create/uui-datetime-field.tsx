import { BufferedUuiDateTimeInput } from '../../../design-system/forms/BufferedUuiDateTimeInput';

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
  required?: boolean;
  error?: string;
  hideLabel?: boolean;
}

/**
 * Untitled UI styled **24h datetime** field for the workspace grid.
 *
 * Hard requirement (2026-09-09 customer report): whenever a date and a time
 * display together the time comes first on a 24-hour clock
 * (`HH:mm DD/MM/YYYY`), which a native `datetime-local` input cannot
 * guarantee (browser locale controls it). This adapter renders the
 * design-system buffered text input in that fixed shape and keeps the legacy
 * event-shaped onChange + `getByLabelText` contracts used by the workspace
 * tests. Lives beside (not inside) uui-fields.tsx so that adapter file stays
 * under the structure-guard new-file ceiling.
 */
export function UDateTimeField({
  id,
  label,
  value,
  onChange,
  disabled,
  required,
  error,
  hideLabel,
}: UDateTimeFieldProps) {
  return (
    <BufferedUuiDateTimeInput
      id={id}
      label={hideLabel ? undefined : label}
      aria-label={hideLabel ? label : undefined}
      size="sm"
      value={value}
      onChange={(next) => onChange(asEvent(next))}
      isDisabled={disabled}
      isRequired={required}
      isInvalid={Boolean(error)}
      hint={error}
      className="csc-uui-field csc-control-boundary"
    />
  );
}
