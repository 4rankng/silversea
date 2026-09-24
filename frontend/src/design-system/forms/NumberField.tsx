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
  /**
   * Display-only vi-VN thousand grouping ("1.200.000") for money amounts
   * (card 20260924_1, image12). A number input cannot render separators, so
   * the field switches to text, re-derives the digits on every entry, and
   * still emits `number | ''` — the stored contract never changes. Typed
   * separators are stripped and re-derived from the value; bounds stay the
   * caller's contract (save-side validation), so min/max/step never reach the
   * text input where they would be meaningless.
   */
  grouped?: boolean;
}

const viVn = new Intl.NumberFormat('vi-VN');

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
  grouped = false,
  ...rest
}: NumberFieldProps) {
  const handleChange: NonNullable<InputHTMLAttributes<HTMLInputElement>['onChange']> = (e) => {
    const raw = grouped ? e.target.value.replace(/\D/g, '') : e.target.value;
    if (raw === '') {
      if (allowEmpty) onChange('');
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) onChange(n);
  };

  const display = value === '' || value === null || value === undefined
    ? ''
    : grouped
      ? viVn.format(Number(value))
      : String(value);

  return (
    <TextField
      type={grouped ? 'text' : 'number'}
      value={display}
      onChange={handleChange}
      min={grouped ? undefined : min}
      max={grouped ? undefined : max}
      step={grouped ? undefined : step}
      prefix={prefix}
      suffix={suffix}
      placeholder={placeholder}
      inputMode={grouped ? 'numeric' : 'decimal'}
      {...rest}
    />
  );
}
