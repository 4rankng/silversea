import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { DateInput } from './DateInput';
import './TextField.css';

export interface DateFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'className' | 'defaultValue' | 'onBlur' | 'ref'> {
  /** Field label, rendered as a real <label> for accessibility. */
  label: string;
  /** Controlled value: '' (empty) or a complete 'YYYY-MM-DD' date string. */
  value: string;
  /** Called when the user enters a complete date or clears the field. */
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
  /** Optional helper text node rendered below the input. */
  hint?: ReactNode;
  /** Focus/validity access to the actual date text input. */
  ref?: Ref<HTMLInputElement>;
}

/** Standard field layout around the shared DD/MM/YYYY date/calendar input. */
export function DateField({
  label,
  value,
  onChange,
  required,
  error,
  helpText,
  disabled,
  className,
  id: providedId,
  hint,
  ...input
}: DateFieldProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [input['aria-describedby'], errorId].filter(Boolean).join(' ') || undefined;
  const wrapperClassName = ['ds-field', error ? 'ds-field--error' : '', className].filter(Boolean).join(' ');

  return (
    <div className={wrapperClassName}>
      <label htmlFor={id} className="ds-field__label">
        {label}
        {required && <span className="ds-field__required" aria-hidden="true"> *</span>}
      </label>
      <DateInput
        {...input}
        value={value}
        onChange={onChange}
        id={id}
        disabled={disabled}
        required={required}
        className="ds-field__input"
        aria-invalid={input['aria-invalid'] ?? Boolean(error)}
        aria-describedby={describedBy}
      />
      {error ? (
        <span id={errorId} className="ds-field__msg ds-field__msg--error">{error}</span>
      ) : hint ? (
        <span className="ds-field__msg">{hint}</span>
      ) : helpText ? (
        <span className="ds-field__msg">{helpText}</span>
      ) : null}
    </div>
  );
}

DateField.displayName = 'DateField';
