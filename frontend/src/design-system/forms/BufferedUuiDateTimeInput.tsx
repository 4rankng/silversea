import { type ReactNode, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { InputBase, type InputBaseProps } from '@/components/untitled-ui/base/input/input';
import { Label } from '@/components/untitled-ui/base/input/label';
import { DATE_TIME_24_PLACEHOLDER, formatDateTime24, useBufferedDateTimeValue } from '../hooks/useBufferedDateTimeValue';
import { DatePanel, TimePanel } from './DateTimePickerPanels';
import { useClickOutside } from '../../hooks/useClickOutside';

export interface BufferedUuiDateTimeInputProps
  extends Omit<InputBaseProps, 'value' | 'onChange' | 'type' | 'onBlur' | 'defaultValue' | 'ref' | 'isRequired' | 'isInvalid' | 'placeholder' | 'inputClassName' | 'wrapperClassName' | 'hint'> {
  /** Field label, rendered above the input (matches the shared UUI Input API). */
  label?: string;
  /** Controlled value: '' (empty) or 'YYYY-MM-DDTHH:mm' (seconds tolerated). */
  value: string;
  /** Called when the user enters a complete datetime or clears the field. */
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

/**
 * Untitled UI styled **24h datetime** input.
 *
 * Hard requirement (2026-09-09 customer report): whenever a date and a time
 * display together, the time comes first and the clock is 24-hour
 * (`HH:mm DD/MM/YYYY`). Native `datetime-local` inputs render per
 * browser locale (12h AM/PM on en-US systems) and cannot be forced, so this
 * is a plain uncontrolled text input in the fixed `HH:mm DD/MM/YYYY` shape
 * with `useBufferedDateTimeValue` providing the same draft-buffer behavior
 * as `useBufferedDateValue`: partial drafts stay visible while typing, only
 * complete entries reach `onChange`, and blur normalizes or reverts the
 * draft.
 *
 * Use this wherever the UUI `Input` would otherwise render a locale-formatted
 * datetime picker (e.g. the shipment-create workspace container grid).
 */
export function BufferedUuiDateTimeInput({
  label,
  value,
  onChange,
  isRequired,
  isInvalid,
  isDisabled,
  size = 'sm',
  className,
  wrapperClassName,
  inputClassName,
  groupRef,
  hint,
  inputProps,
  ...rest
}: BufferedUuiDateTimeInputProps) {
  const generatedId = useId();
  const id = rest.id ?? generatedId;
  const buffered = useBufferedDateTimeValue({ value, onChange });

  // Designed picker popover (card _39): separate date + time panels, strictly
  // 24h. Selection composes the buffered 'YYYY-MM-DDTHH:mm' contract exactly
  // like a complete typed entry; the raw browser picker is gone.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // Card _39 (spec pass 3): no calendar button — clicking the input itself
  // opens the designed panels. The popover portals to document.body with
  // position:fixed because the absolute panel was clipped by the create
  // grid's scrollable table body. Position derives from the input's rect:
  // below it, horizontally clamped, flipped above near the viewport bottom.
  const openPicker = () => {
    const inputEl = document.getElementById(id) as HTMLInputElement | null;
    const rect = inputEl?.getBoundingClientRect?.() ?? null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(432, vw - 24);
    let left = 8;
    if (rect) left = Math.min(Math.max(8, rect.right - width), Math.max(8, vw - width - 8));
    let top = rect ? rect.bottom + 4 : 8;
    if (top + 380 > vh - 8 && rect) top = Math.max(8, rect.top - 384);
    setPickerPos({ top, left });
    setPickerOpen(true);
  };
  const closePicker = () => {
    setPickerOpen(false);
    document.getElementById(id)?.focus();
  };
  useClickOutside(popoverRef, closePicker, {
    escapeKey: true,
    enabled: pickerOpen,
  });

  const currentDate = value ? value.split('T')[0] ?? '' : '';
  const currentTime = value ? (value.split('T')[1] ?? '').slice(0, 5) : '';

  const applyComposed = (date: string, time: string) => {
    const composed = date && time ? `${date}T${time}` : '';
    // The buffered hook parses the DISPLAY shape (HH:mm DD/MM/YYYY), so the
    // ISO contract is formatted through formatDateTime24 before dispatch.
    buffered.onChange({ target: { value: formatDateTime24(composed) } } as unknown as Parameters<typeof buffered.onChange>[0]);
  };
  const handleDatePick = (date: string) => applyComposed(date, currentTime || '08:00');
  const handleTimePick = (time: string) => {
    applyComposed(currentDate || new Date().toISOString().slice(0, 10), time);
    setPickerOpen(false);
    document.getElementById(id)?.focus();
  };

  // InputBase forwards its onChange/onBlur straight to the native input, so
  // the hook's event-shaped handlers wire up directly without wrapping.
  return (
    <div
      data-input-wrapper
      data-input-size={size}
      className={['group flex h-max w-full flex-col items-start justify-start gap-1.5', className].filter(Boolean).join(' ')}
    >
      {label && (
        <Label isRequired={isRequired} isInvalid={isInvalid} htmlFor={id}>
          {label}
        </Label>
      )}
      <InputBase
        {...rest}
        ref={buffered.ref}
        groupRef={groupRef}
        id={id}
        type="text"
        size={size}
        defaultValue={buffered.defaultValue}
        isInvalid={isInvalid}
        isDisabled={isDisabled}
        isRequired={isRequired}
        placeholder={DATE_TIME_24_PLACEHOLDER}
        maxLength={16}
        autoComplete="off"
        onClick={openPicker}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
        onChange={buffered.onChange}
        onBlur={buffered.onBlur}
        inputClassName={inputClassName}
        wrapperClassName={wrapperClassName}
        {...(inputProps as Partial<InputBaseProps>)}
      />
      {pickerOpen && createPortal(
        <div
          ref={popoverRef}
          className="dtp-popover dtp-popover--portal"
          role="dialog"
          aria-label="Chọn ngày giờ"
          style={{ top: pickerPos?.top ?? 8, left: pickerPos?.left ?? 8 }}
        >
          <DatePanel value={currentDate} onChange={handleDatePick} />
          <TimePanel value={currentTime} onPick={handleTimePick} />
        </div>,
        document.body,
      )}
      {hint && (
        <p className="text-xs leading-[1.5] text-tertiary group-invalid/input:text-error-primary">
          {hint}
        </p>
      )}
    </div>
  );
}

BufferedUuiDateTimeInput.displayName = 'BufferedUuiDateTimeInput';
