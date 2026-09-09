import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { DATE_TIME_24_PLACEHOLDER, useBufferedDateTimeValue } from '../hooks/useBufferedDateTimeValue';

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
  /** Optional helper text node rendered below the input. */
  hint?: ReactNode;
}

/**
 * Legacy design-system **24h datetime** field — the DateTimeField twin of
 * DateField, and the drop-in replacement for `<TextField type="datetime-local">`
 * where sibling fields use the ds-field family.
 *
 * The combined date+time contract (2026-09-09 hard requirement) is time-first
 * 24-hour `HH:mm DD/MM/YYYY`; a native datetime-local input renders per
 * browser locale (12h AM/PM on en-US) and cannot be forced, so this renders
 * a buffered text input in the fixed shape instead. Same value contract as
 * datetime-local ('YYYY-MM-DDTHH:mm' in, same out) — a pure input-surface
 * swap, no wall-clock semantics change. For UUI-styled surfaces use
 * BufferedUuiDateTimeInput instead.
 */
export function DateTimeField({
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
}: DateTimeFieldProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [input['aria-describedby'], errorId].filter(Boolean).join(' ') || undefined;
  const wrapperClassName = ['ds-field', error ? 'ds-field--error' : '', className].filter(Boolean).join(' ');
  const buffered = useBufferedDateTimeValue({ value, onChange });

  return (
    <div className={wrapperClassName}>
      <label htmlFor={id} className="ds-field__label">
        {label}
        {required && <span className="ds-field__required" aria-hidden="true"> *</span>}
      </label>
      <input
        {...input}
        ref={buffered.ref}
        defaultValue={buffered.defaultValue}
        onChange={buffered.onChange}
        onBlur={buffered.onBlur}
        id={id}
        type="text"
        inputMode="numeric"
        placeholder={DATE_TIME_24_PLACEHOLDER}
        maxLength={16}
        autoComplete="off"
        disabled={disabled}
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

DateTimeField.displayName = 'DateTimeField';
