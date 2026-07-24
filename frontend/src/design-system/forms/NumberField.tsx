import type { InputHTMLAttributes, ReactNode } from 'react';
import { TextField, type TextFieldProps } from './TextField';

export interface NumberFieldProps
  extends Omit<TextFieldProps, 'value' | 'onChange' | 'type' | 'prefix' | 'suffix'> {
  value: number | '';
  onChange: (n: number | '') => void;
  min?: number;
  max?: number;
  step?: number;
  prefix?: ReactNode;
  suffix?: ReactNode;
  /** Optional placeholder (e.g. "0"). */
  placeholder?: string;
  /** Allow empty string as a valid value (default: true). */
  allowEmpty?: boolean;
}

/**
 * Numeric input that always emits a number (or empty string) to its
 * onChange. Eliminates the `e.target.value` → `Number()` boilerplate that
 * every form in the codebase hand-rolled.
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step,
  prefix,
  suffix,
  placeholder = '0',
  allowEmpty = true,
  ...rest
}: NumberFieldProps) {
  const handleChange: NonNullable<InputHTMLAttributes<HTMLInputElement>['onChange']> = (e) => {
    const raw = e.target.value;
    if (raw === '') {
      if (allowEmpty) onChange('');
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) onChange(n);
  };

  const display = value === '' || value === null || value === undefined
    ? ''
    : String(value);

  return (
    <TextField
      type="number"
      value={display}
      onChange={handleChange}
      min={min}
      max={max}
      step={step}
      prefix={prefix}
      suffix={suffix}
      placeholder={placeholder}
      inputMode="decimal"
      {...rest}
    />
  );
}
