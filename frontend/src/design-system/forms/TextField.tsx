import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import './TextField.css';

export interface BaseFieldProps {
  label: string;
  required?: boolean;
  error?: string;
  helpText?: string;
  disabled?: boolean;
}

export interface TextFieldProps extends BaseFieldProps, Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'prefix'> {
  prefix?: ReactNode;
  suffix?: ReactNode;
  className?: string;
}

export function TextField({
  label,
  required,
  error,
  helpText,
  prefix,
  suffix,
  className,
  ...input
}: TextFieldProps) {
  const generatedId = useId();
  const id = input.id ?? generatedId;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [input['aria-describedby'], errorId].filter(Boolean).join(' ') || undefined;
  const cls = ['ds-field', error ? 'ds-field--error' : '', className].filter(Boolean).join(' ');

  return (
    <div className={cls}>
      <label htmlFor={id} className="ds-field__label">
        {label}
        {required && <span className="ds-field__required" aria-hidden="true"> *</span>}
      </label>
      {prefix || suffix ? (
        <div className="ds-field__input-group">
          {prefix && <span className="ds-field__affix">{prefix}</span>}
          <input {...input} id={id} className="ds-field__input" aria-invalid={input['aria-invalid'] ?? Boolean(error)} aria-describedby={describedBy} />
          {suffix && <span className="ds-field__affix">{suffix}</span>}
        </div>
      ) : (
        <input {...input} id={id} className="ds-field__input" aria-invalid={input['aria-invalid'] ?? Boolean(error)} aria-describedby={describedBy} />
      )}
      {error ? (
        <span id={errorId} className="ds-field__msg ds-field__msg--error">{error}</span>
      ) : helpText ? (
        <span className="ds-field__msg">{helpText}</span>
      ) : null}
    </div>
  );
}
