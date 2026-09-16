import { useEffect, useId, useRef, useState, type KeyboardEventHandler } from 'react';
import { InputBase } from '../../components/untitled-ui/base/input/input';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { TimePickerSurface, TIME_PICKER_MOBILE_QUERY } from './TimePickerSurface';
import './TimeInput.css';

export const isValidTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export interface TimeInputProps {
  label: string;
  value: string;
  /** Keeps incomplete text in the owning form; callers decide when to apply it. */
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  validateOnBlur?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}

/** Shared 24-hour field: exact typing and the same picker used by appointments. */
export function TimeInput({ label, value, onChange, disabled = false, autoFocus, size = 'sm', className, validateOnBlur = false, onKeyDown }: TimeInputProps) {
  const [open, setOpen] = useState(false);
  const [keyboardPicker, setKeyboardPicker] = useState(false);
  const [touched, setTouched] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const restoreFrame = useRef<number | null>(null);
  const id = useId();
  const mobile = useMediaQuery(TIME_PICKER_MOBILE_QUERY);
  const validation = value && !isValidTime(value) ? 'Nhập giờ từ 00:00 đến 23:59 (HH:mm).' : '';
  const invalid = Boolean(validation) && (!validateOnBlur || touched);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => { setTouched(false); }, [value]);
  useEffect(() => { input.current?.setCustomValidity(validation); }, [validation]);
  useEffect(() => () => { if (restoreFrame.current != null) cancelAnimationFrame(restoreFrame.current); }, []);

  const close = () => {
    setOpen(false);
    input.current?.focus();
    if (restoreFrame.current != null) cancelAnimationFrame(restoreFrame.current);
    restoreFrame.current = requestAnimationFrame(() => {
      restoreFrame.current = null;
      const focused = document.activeElement;
      if (input.current && !input.current.disabled && (!focused || focused === document.body || focused === document.documentElement)) input.current.focus();
    });
  };

  return <div className={['time-input', className].filter(Boolean).join(' ')}>
    <InputBase
      ref={input} size={size} aria-label={label} autoFocus={autoFocus}
      type="text" value={value} onChange={(event) => {
        const raw = event.target.value;
        onChange(/^\d{4}$/.test(raw) ? `${raw.slice(0, 2)}:${raw.slice(2)}` : raw);
      }}
      disabled={disabled} isDisabled={disabled} placeholder="HH:mm" maxLength={5}
      inputMode="numeric" autoComplete="off" isInvalid={invalid}
      aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined}
      aria-haspopup="dialog" aria-expanded={open && !disabled}
      aria-controls={open && !disabled ? `${id}-panel` : undefined}
      onInvalid={() => setTouched(true)}
      onBlur={(event) => {
        setTouched(true);
        if (!(mobile && open) && !panel.current?.contains(event.relatedTarget)) setOpen(false);
      }}
      onClick={() => { if (!disabled) { setKeyboardPicker(false); setOpen(true); } }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || event.nativeEvent.isComposing) return;
        if (event.key === 'ArrowDown' && !disabled) {
          event.preventDefault(); event.stopPropagation(); setKeyboardPicker(true); setOpen(true);
        } else if (event.key === 'Escape' && open) {
          event.preventDefault(); event.stopPropagation(); close();
        } else if (event.key === 'Enter') {
          setTouched(true);
          // Match the date fields: finishing the open picker must not also
          // submit its surrounding schedule editor. Invalid drafts never
          // reach a parent's Enter shortcut, even when the picker is closed.
          if (open || validation) { event.preventDefault(); event.stopPropagation(); }
          setOpen(false);
        } else if (event.key === 'Tab') setOpen(false);
      }}
    />
    {invalid && <small id={`${id}-error`} className="time-input__error">{validation}</small>}
    {open && !disabled && <TimePickerSurface id={`${id}-panel`} label={`Chọn giờ (24h) — ${label}`} value={value}
      panelRef={panel} anchorRef={input} keyboard={keyboardPicker} onDismiss={close} onExit={() => setOpen(false)}
      onPick={(next) => onChange(next)} onApply={() => close()} />}
  </div>;
}
