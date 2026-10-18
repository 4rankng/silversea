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
  /** Fires once a TYPED entry reaches a complete valid HH:mm — the
   * single-box analog of the segmented fields' complete-segment advance
   * (SplitDateTimeField focuses its date half); hosts move focus onward. */
  onComplete?: () => void;
}

/** Shared 24-hour field: exact typing and the same picker used by appointments. */
export function TimeInput({ label, value, onChange, disabled = false, autoFocus, size = 'sm', className, validateOnBlur = false, onKeyDown, onComplete }: TimeInputProps) {
  const [open, setOpen] = useState(false);
  const [keyboardPicker, setKeyboardPicker] = useState(false);
  const [touched, setTouched] = useState(false);
  // FB-002 (181026000027 round 22): focusing this field by CLICK opens the
  // picker, so the picker-open Enter swallow below used to eat the only Enter
  // a hand-typing user ever pressed — the host's save never ran. A draft the
  // user TYPED while the picker was open now flows through to the host on
  // Enter (the same contract 5ef5ace7 gave SplitDateTimeField hosts); picker
  // finishing (pick, then Enter) keeps the swallow so finishing an open
  // picker must not also submit its surrounding editor.
  const [typedSinceOpen, setTypedSinceOpen] = useState(false);
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
        if (open) setTypedSinceOpen(true);
        const next = /^\d{4}$/.test(raw) ? `${raw.slice(0, 2)}:${raw.slice(2)}` : raw;
        onChange(next);
        // Fires only for TYPED completion (raw 4-digit entry), never for
        // picker picks or programmatic values.
        if (onComplete && /^\d{4}$/.test(raw) && isValidTime(next)) onComplete();
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
      onClick={() => { if (!disabled) { setKeyboardPicker(false); setTypedSinceOpen(false); setOpen(true); } }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || event.nativeEvent.isComposing) return;
        // FB-002 case 2 (181026000027): ANY printable keystroke is
        // hand-typing — even when the browser later drops it (maxLength on a
        // full field) or it never reaches onChange. The picker-open Enter must
        // still count as the user's save key, not picker finishing. Modifier
        // chords (Ctrl+A…, per the DateTimeSegments.tsx keydown law) type
        // nothing and must NOT count (review nit 2026-10-18).
        if (open && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) setTypedSinceOpen(true);
        // Type-over restart (the card 326/061026172803 segmented contract,
        // single-box form): a digit typed into a FULL field with a collapsed
        // caret must restart the entry — maxLength would otherwise swallow
        // the keystroke, so editing a prefilled giờ by click+type was a dead
        // field (FB-002 round 22: the QA lot already carried a time).
        const collapsed = (event.currentTarget.selectionStart ?? 0) === (event.currentTarget.selectionEnd ?? 0);
        if (/^[0-9]$/.test(event.key) && collapsed && event.currentTarget.value.length >= event.currentTarget.maxLength) {
          event.preventDefault();
          onChange(event.key);
          return;
        }
        if (event.key === 'ArrowDown' && !disabled) {
          event.preventDefault(); event.stopPropagation(); setKeyboardPicker(true); setTypedSinceOpen(false); setOpen(true);
        } else if (event.key === 'Escape' && open) {
          event.preventDefault(); event.stopPropagation(); close();
        } else if (event.key === 'Enter') {
          setTouched(true);
          // FB-002 case 2 (181026000027): normalize a 4-digit HHmm draft
          // ("1430") BEFORE the swallow decision — an unnormalized draft used
          // to fail validation and the invalid-draft law swallowed the user's
          // save key until a second Enter. The DOM value is the truth at key
          // time; emit the canonical form so the host saves it as well.
          const raw = event.currentTarget.value;
          const normalized = /^\d{4}$/.test(raw) ? `${raw.slice(0, 2)}:${raw.slice(2)}` : raw;
          if (normalized !== value) onChange(normalized);
          const draftValidation = normalized && !isValidTime(normalized) ? 'Nhập giờ từ 00:00 đến 23:59 (HH:mm).' : '';
          // Match the date fields: finishing the open picker must not also
          // submit its surrounding schedule editor. Invalid drafts never
          // reach a parent's Enter shortcut, even when the picker is closed.
          // A hand-TYPED draft is the exception (FB-002): the click that
          // focused the field opened this picker, so swallowing Enter here
          // would swallow the user's save key — let it reach the host. An
          // ERASED draft counts too: '' is a cleared value hosts accept
          // (DispatchTimeFilterField clears via ''), so type-then-erase +
          // Enter still saves the clear (base-equivalent rule, now pinned).
          const handTypedWhileOpen = open && typedSinceOpen && !draftValidation;
          if ((open && !handTypedWhileOpen) || draftValidation) { event.preventDefault(); event.stopPropagation(); }
          setOpen(false);
          setTypedSinceOpen(false);
        } else if (event.key === 'Tab') setOpen(false);
      }}
    />
    {invalid && <small id={`${id}-error`} className="time-input__error">{validation}</small>}
    {open && !disabled && <TimePickerSurface id={`${id}-panel`} label={`Chọn giờ (24h) — ${label}`} value={value}
      panelRef={panel} anchorRef={input} keyboard={keyboardPicker} onDismiss={close} onExit={() => setOpen(false)}
      onPick={(next) => { setTypedSinceOpen(false); onChange(next); }} onApply={() => close()} />}
  </div>;
}
