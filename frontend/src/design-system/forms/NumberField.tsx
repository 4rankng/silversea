import { useState } from 'react';
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
  // Card 20260929_209: a lone "-" is a legitimate INTERMEDIATE state — the user
  // is one keystroke from typing a negative. Returning without emitting made
  // the controlled field re-render the "-" away instantly, so on a desktop
  // pressing minus did nothing at all, and on a phone the numeric keypad has
  // no minus key to press. Held here in local state instead: the emitted
  // contract stays `number | ''` and no consumer has to learn a new value.
  const [pendingSign, setPendingSign] = useState(false);
  const handleChange: NonNullable<InputHTMLAttributes<HTMLInputElement>['onChange']> = (e) => {
    // Signed grouped keeps ONE leading minus. Stripping the rest of the
    // non-digits still lets a typed separator (".", ",") through harmlessly,
    // because the sign is the only character with meaning here and a second
    // one would make `Number()` produce NaN.
    const raw = grouped
      ? (signed ? e.target.value.replace(/[^\d-]/g, '').replace(/(?!^)-/g, '') : e.target.value.replace(/\D/g, ''))
      : e.target.value;
    if (raw === '-') {
      // Card 20260929_209: the sign is held here rather than emitted, so the
      // public contract stays `number | ''` and no consumer learns a new value.
      setPendingSign(true);
      return;
    }
    setPendingSign(false);
    if (raw === '') {
      if (allowEmpty) onChange('');
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) onChange(n);
  };

  // A typed sign means "I am replacing this number", so it wins over whatever
  // was in the field — including a pre-filled catalog amount, which is the case
  // on the driver's cost form and would otherwise leave the digits sitting there
  // next to the minus the user just pressed.
  const display = pendingSign
    ? '-'
    : value === '' || value === null || value === undefined
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
      // Card 20260929_209: a signed field must NOT ask for the `numeric`
      // keypad — on a phone that keypad has no minus key at all, so a
      // negative was unreachable no matter what the handler allowed.
      // `text` is the only hint that reliably offers the sign; the field
      // already filters to digits and one leading minus.
      inputMode={signed ? 'text' : grouped ? 'numeric' : 'decimal'}
      {...rest}
    />
  );
}
