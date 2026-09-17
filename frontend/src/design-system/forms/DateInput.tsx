import { type InputHTMLAttributes, type Ref, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { formatDateInput, useBufferedDateTextValue } from '../hooks/useBufferedDateTextValue';
import { DatePickerSurface } from './DatePickerSurface';
import './BufferedUuiDateInput.css';

export interface DateInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'defaultValue'> {
  /** Controlled date; callbacks and form submission use YYYY-MM-DD. */
  value: string;
  onChange: (value: string) => void;
  ref?: Ref<HTMLInputElement>;
}

/** Date input for callers that already own their label and input styling.
 * Uses the same DD/MM/YYYY draft and calendar as the UUI date field. */
export function DateInput({ value, onChange, id: providedId, ref, name, ...rest }: DateInputProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const blurFrame = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const active = open && !rest.disabled && !rest.readOnly;
  const min = String(rest.min ?? '');
  const max = String(rest.max ?? '');
  const { draft, setDraft, setTouched, parsed, validation, message, emit, update } = useBufferedDateTextValue({ value, onChange, min, max, inputRef });
  const describedBy = [rest['aria-describedby'], message ? `${id}-date-error` : undefined].filter(Boolean).join(' ') || undefined;
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);
  useEffect(() => { if (rest.disabled || rest.readOnly) setOpen(false); }, [rest.disabled, rest.readOnly]);
  useEffect(() => () => { if (blurFrame.current != null) cancelAnimationFrame(blurFrame.current); }, []);
  const dismiss = () => { setOpen(false); inputRef.current?.focus(); };
  const closeWhenFocusLeaves = (next: Node | null) => {
    if (!inputRef.current?.contains(next) && !panelRef.current?.contains(next)) {
      setOpen(false);
      setTouched(true);
    }
  };

  return <>
    <input
      {...rest}
      ref={inputRef}
      id={id}
      type="text"
      data-date-input
      value={draft}
      placeholder="DD/MM/YYYY"
      maxLength={10}
      autoComplete="off"
      aria-invalid={rest['aria-invalid'] || Boolean(message)}
      aria-describedby={describedBy}
      aria-haspopup="dialog"
      aria-expanded={active}
      aria-controls={active ? `${id}-calendar` : undefined}
      onChange={(event) => update(event.target.value)}
      onClick={(event) => {
        rest.onClick?.(event);
        if (!event.defaultPrevented && !rest.disabled && !rest.readOnly) { setKeyboard(false); setOpen(true); }
      }}
      onInvalid={(event) => { setTouched(true); rest.onInvalid?.(event); }}
      onFocus={(event) => {
        if (blurFrame.current != null) cancelAnimationFrame(blurFrame.current);
        blurFrame.current = null;
        rest.onFocus?.(event);
      }}
      onBlur={(event) => {
        if (blurFrame.current != null) cancelAnimationFrame(blurFrame.current);
        const next = event.relatedTarget as Node | null;
        if (next) closeWhenFocusLeaves(next);
        else blurFrame.current = requestAnimationFrame(() => {
          blurFrame.current = null;
          closeWhenFocusLeaves(document.activeElement);
        });
        if (!panelRef.current?.contains(next)) {
          setTouched(true);
          if (!validation && parsed) setDraft(formatDateInput(parsed));
        }
        rest.onBlur?.(event);
      }}
      onKeyDown={(event) => {
        rest.onKeyDown?.(event);
        if (event.defaultPrevented || event.nativeEvent.isComposing) return;
        if (event.altKey && event.key === 'ArrowDown' && !rest.disabled && !rest.readOnly) {
          event.preventDefault(); event.stopPropagation(); setKeyboard(true); setOpen(true);
        } else if (event.key === 'Escape' && active) {
          event.preventDefault(); event.stopPropagation(); dismiss();
        } else if (event.key === 'Enter') {
          setTouched(true);
          if (active || validation) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
        }
      }}
    />
    {name && <input type="hidden" name={name} value={value} disabled={rest.disabled} form={rest.form} />}
    {message && <span id={`${id}-date-error`} role="alert" className="uui-date-hint uui-date-hint--error">{message}</span>}
    {active && <DatePickerSurface id={`${id}-calendar`} label="Chọn ngày" value={parsed ?? ''} min={min} max={max}
      panelRef={panelRef} anchorRef={inputRef} keyboard={keyboard}
      onExit={() => { setOpen(false); setTouched(true); }} onDismiss={dismiss}
      onPick={(next) => { setDraft(formatDateInput(next)); setTouched(false); emit(next); dismiss(); }} />}
  </>;
}

DateInput.displayName = 'DateInput';
