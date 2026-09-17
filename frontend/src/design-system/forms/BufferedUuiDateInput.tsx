import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { InputBase, type InputBaseProps } from '@/components/untitled-ui/base/input/input';
import { Label } from '@/components/untitled-ui/base/input/label';
import { formatDateInput as formatDate, useBufferedDateTextValue } from '../hooks/useBufferedDateTextValue';
import { DatePickerSurface } from './DatePickerSurface';
import './BufferedUuiDateInput.css';

export interface BufferedUuiDateInputProps
  extends Omit<InputBaseProps, 'value' | 'onChange' | 'type' | 'onBlur' | 'defaultValue' | 'ref' | 'isRequired' | 'isInvalid' | 'placeholder' | 'inputClassName' | 'wrapperClassName' | 'hint'> {
  /** Field label, rendered above the input (matches the shared UUI Input API). */
  label?: string;
  /** Controlled value: '' (empty) or a complete 'YYYY-MM-DD' date string. */
  value: string;
  /** Called when the user enters a complete date or clears the field. */
  onChange: (value: string) => void;
  /** Mark the field as required. */
  isRequired?: boolean;
  /** Mark the field as invalid. */
  isInvalid?: boolean;
  /** Disable the input. */
  isDisabled?: boolean;
  /** Helper text rendered below the input (used for error/hint messages). */
  hint?: ReactNode;
  /** Optional wrapper class (the label/input column). */
  className?: string;
  /** Optional class on the input group. */
  wrapperClassName?: string;
  /** Optional class on the input element. */
  inputClassName?: string;
  /** Extra attributes forwarded to the underlying <input> element. */
  inputProps?: Record<string, unknown>;
}

/** Shared DD/MM/YYYY field with a local draft and the existing calendar.
 * Complete dates emit ISO values; partial text stays visible and invalid. */
export function BufferedUuiDateInput({
  label,
  value,
  onChange,
  isRequired,
  isInvalid,
  isDisabled,
  size = 'md',
  className,
  wrapperClassName,
  inputClassName,
  groupRef,
  hint,
  inputProps,
  ...rest
}: BufferedUuiDateInputProps) {
  const generatedId = useId();
  const id = rest.id ?? generatedId;
  const nativeProps = inputProps as Partial<InputBaseProps> | undefined;
  const [open, setOpen] = useState(false);
  const [keyboardPicker, setKeyboardPicker] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const blurFrame = useRef<number | null>(null);
  const disabled = Boolean(isDisabled || nativeProps?.disabled || rest.disabled);
  const readOnly = Boolean(nativeProps?.readOnly || rest.readOnly);
  const required = Boolean(isRequired || nativeProps?.isRequired || nativeProps?.required || rest.required);
  const active = open && !disabled && !readOnly;
  const min = String(nativeProps?.min ?? rest.min ?? '');
  const max = String(nativeProps?.max ?? rest.max ?? '');
  const name = nativeProps?.name ?? rest.name;
  const { draft, setDraft, setTouched, parsed, validation, message, emit, update } = useBufferedDateTextValue({ value, onChange, min, max, inputRef });
  const describedBy = [nativeProps?.['aria-describedby'] ?? rest['aria-describedby'], (message || hint) ? `${id}-hint` : undefined].filter(Boolean).join(' ') || undefined;
  const dismiss = () => { setOpen(false); inputRef.current?.focus(); };

  useEffect(() => { if (disabled || readOnly) setOpen(false); }, [disabled, readOnly]);
  useEffect(() => () => { if (blurFrame.current != null) cancelAnimationFrame(blurFrame.current); }, []);

  const closeWhenFocusLeaves = (next: Node | null) => {
    if (!fieldRef.current?.contains(next) && !panelRef.current?.contains(next)) {
      setOpen(false);
      setTouched(true);
    }
  };

  const showCalendar = (keyboard = false) => {
    if (!disabled && !readOnly) { setKeyboardPicker(keyboard); setOpen(true); }
  };

  return (
    <div
      ref={fieldRef}
      onFocusCapture={() => {
        if (blurFrame.current != null) cancelAnimationFrame(blurFrame.current);
        blurFrame.current = null;
      }}
      onBlurCapture={(event) => {
        if (blurFrame.current != null) cancelAnimationFrame(blurFrame.current);
        const next = event.relatedTarget as Node | null;
        if (next) {
          blurFrame.current = null;
          closeWhenFocusLeaves(next);
        } else {
          // Some pointer focus transfers have no relatedTarget. Let the new
          // calendar button receive focus before deciding it left the field.
          blurFrame.current = requestAnimationFrame(() => {
            blurFrame.current = null;
            closeWhenFocusLeaves(document.activeElement);
          });
        }
      }}
      data-input-wrapper
      data-input-size={size}
      className={['group flex h-max w-full flex-col items-start justify-start gap-1.5', className].filter(Boolean).join(' ')}
    >
      {label && <Label isRequired={required} isInvalid={isInvalid || Boolean(message)} htmlFor={id}>{label}</Label>}
      <InputBase
        {...rest}
        {...nativeProps}
        ref={inputRef}
        groupRef={groupRef}
        id={id}
        type="text"
        name={undefined}
        data-date-input
        size={size}
        value={draft}
        placeholder="DD/MM/YYYY"
        maxLength={10}
        autoComplete="off"
        isInvalid={isInvalid || Boolean(message)}
        isDisabled={disabled}
        disabled={disabled}
        readOnly={readOnly}
        isRequired={required}
        aria-invalid={isInvalid || Boolean(message) || nativeProps?.['aria-invalid'] || rest['aria-invalid']}
        aria-describedby={describedBy}
        aria-haspopup="dialog"
        aria-expanded={active}
        aria-controls={active ? `${id}-calendar` : undefined}
        onChange={(event) => update(event.target.value)}
        onClick={(event) => { (nativeProps?.onClick ?? rest.onClick)?.(event); if (!event.defaultPrevented) showCalendar(); }}
        onInvalid={(event) => { setTouched(true); (nativeProps?.onInvalid ?? rest.onInvalid)?.(event); }}
        onBlur={(event) => {
          if (!panelRef.current?.contains(event.relatedTarget as Node | null)) {
            setTouched(true);
            if (!validation && parsed) setDraft(formatDate(parsed));
          }
          nativeProps?.onBlur?.(event);
        }}
        onKeyDown={(event) => {
          (nativeProps?.onKeyDown ?? rest.onKeyDown)?.(event);
          if (event.defaultPrevented || event.nativeEvent.isComposing) return;
          if (event.altKey && event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); showCalendar(true); }
          else if (event.key === 'Escape' && active) { event.preventDefault(); event.stopPropagation(); dismiss(); }
          else if (event.key === 'Enter') {
            setTouched(true);
            if (active || validation) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
          }
        }}
        inputClassName={inputClassName}
        wrapperClassName={wrapperClassName}
      />
      {name && <input type="hidden" name={name} value={value} disabled={disabled} form={nativeProps?.form ?? rest.form} />}
      {(message || hint) && <p id={`${id}-hint`} role={message ? 'alert' : undefined} className={message ? 'uui-date-hint uui-date-hint--error' : 'uui-date-hint'}>{message || hint}</p>}
      {active && <DatePickerSurface id={`${id}-calendar`} label={`Chọn ngày${label ? ` — ${label}` : ''}`}
        value={parsed ?? ''} min={min} max={max} panelRef={panelRef} anchorRef={inputRef} additionalRefs={[fieldRef]} keyboard={keyboardPicker}
        onExit={() => { setOpen(false); setTouched(true); }} onDismiss={dismiss}
        onPick={(next) => { setDraft(formatDate(next)); setTouched(false); emit(next); dismiss(); }} />}
    </div>
  );
}

BufferedUuiDateInput.displayName = 'BufferedUuiDateInput';
