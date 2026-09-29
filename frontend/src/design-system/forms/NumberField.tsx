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
  /**
   * Allow a leading minus in `grouped` mode. OFF by default, deliberately.
   *
   * Grouped mode strips every non-digit on entry, so a user cannot type a
   * negative however the caller sets `min` — in grouped mode `min`/`max`/
   * `step` are not even forwarded to the input, they are meaningless on a
   * text field. Card 20260928_197 (the PM's "mọi màn hình nhập chi phí … cho
   * phép nhập số DƯƠNG và số ÂM") needs the driver's cost form to take a
   * negative, and that form is grouped.
   *
   * This is opt-in rather than a change to `grouped` itself because plenty of
   * money fields are genuinely unsigned — quantities, rates, counts — and
   * silently letting a minus into those would be a new defect. The display is
   * unaffected either way: `viVn.format(-30000)` is already "-30.000", so the
   * value renders signed the moment it can be entered.
   */
  signed?: boolean;
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
  signed = false,
  ...rest
}: NumberFieldProps) {
  const handleChange: NonNullable<InputHTMLAttributes<HTMLInputElement>['onChange']> = (e) => {
    // Signed grouped keeps ONE leading minus. Stripping the rest of the
    // non-digits still lets a typed separator (".", ",") through harmlessly,
    // because the sign is the only character with meaning here and a second
    // one would make `Number()` produce NaN.
    const raw = grouped
      ? (signed ? e.target.value.replace(/[^\d-]/g, '').replace(/(?!^)-/g, '') : e.target.value.replace(/\D/g, ''))
      : e.target.value;
    if (raw === '' || raw === '-') {
      if (allowEmpty && raw === '') onChange('');
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
