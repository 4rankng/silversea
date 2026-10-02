import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { SplitDateTimeField } from './SplitDateTimeField';

export interface DateTimeFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'className' | 'defaultValue' | 'onBlur' | 'ref'> {
  /** Field label, rendered as a real <label> for accessibility. */
  label: string;
  /** Controlled value: '' (empty) or a complete 'YYYY-MM-DDTHH:mm' local datetime. */
  value: string;
  /** Called when the user enters a complete datetime or clears the field. */
  onChange: (value: string) => void;
  /** Mark the field as required in the rendered label. */
  required?: boolean;
  /** Validation error message, rendered below the input and linked via aria-describedby. */
  error?: string;
  /** Helper text rendered below the input when no error is set. */
  helpText?: string;
  /** Disable the input. */
  disabled?: boolean;
  /** Optional class on the outer wrapper. */
  className?: string;
  /** Completeness signal forwarded from the underlying split field. */
  onCompletenessChange?: (state: 'complete' | 'empty' | 'incomplete') => void;
  /** Optional helper text node rendered below the input. */
  hint?: ReactNode;
}

/** Compatibility field for callers that use the design-system value contract.
 * Both time and date use the shared compact selectors; values stay local ISO. */
export function DateTimeField({
  label,
  value,
  onChange,
  onCompletenessChange,
  required,
  error,
  helpText,
  disabled,
  className,
  id: providedId,
  hint,
  min,
  max,
  name,
  readOnly,
  ...input
}: DateTimeFieldProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const help = hint ?? helpText;
  const hintId = !error && help ? `${id}-hint` : undefined;
  const describedBy = [input['aria-describedby'], hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={['ds-field', error ? 'ds-field--error' : '', className].filter(Boolean).join(' ')}>
      <SplitDateTimeField
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        onCompletenessChange={onCompletenessChange}
        required={required}
        error={error}
        disabled={disabled}
        readOnly={readOnly}
        name={name}
        min={min == null ? undefined : String(min)}
        max={max == null ? undefined : String(max)}
        inputProps={{ ...input, 'aria-describedby': describedBy }}
      />
      {!error && help && <span id={hintId} className="ds-field__msg">{help}</span>}
    </div>
  );
}

DateTimeField.displayName = 'DateTimeField';
