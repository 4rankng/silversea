import { type ReactNode, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { InputBase, type InputBaseProps } from '@/components/untitled-ui/base/input/input';
import { Label } from '@/components/untitled-ui/base/input/label';
import { DATE_TIME_24_PLACEHOLDER, formatDateTime24, useBufferedDateTimeValue } from '../hooks/useBufferedDateTimeValue';
import { DateTimePickerDialog } from './DateTimePickerPanels';
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
  //
  // The click handler lives on the *wrapper* div (not forwarded through
  // InputBase → AriaInput) because react-aria-components' Group wraps the
  // native <input> with overflow-hidden, and clicks that land on the Group
  // border/padding area never reach the <input>.  Placing onClick on the
  // wrapper guarantees every click in the visual field area fires openPicker.
  const openPicker = () => {
    const inputEl = document.getElementById(id) as HTMLInputElement | null;
    const rect = inputEl?.getBoundingClientRect?.() ?? null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(432, vw - 24);
    let left = 8;
    if (rect) left = Math.min(Math.max(8, rect.right - width), Math.max(8, vw - width - 8));
    // Dialog max-height = calc(100vh - 16px). Pick the side that fits:
    //   below if there's room for the full viewport-capped dialog; otherwise
    //   above the input, anchored to viewport top with 8px gutter. This used
    //   to be a fixed-380 estimate which missed the date-grid case (~420px
    //   tall) and parked the dialog off-screen at the bottom of the form.
    let top = rect ? rect.bottom + 4 : 8;
    if (rect) {
      const gapBelow = vh - rect.bottom - 4;
      const gapAbove = rect.top - 8;
      const target = vh - 16;
      if (gapBelow < target && gapAbove >= target) {
        top = Math.max(8, rect.top - Math.min(target, rect.top - 8));
      } else if (gapBelow < target && gapAbove < target) {
        // Neither side has a full viewport — anchor to the side with the
        // most space and let the dialog scroll internally (max-height).
        top = gapBelow > gapAbove
          ? Math.max(8, vh - target)
          : Math.max(8, rect.top - target);
      }
    }
    setPickerPos({ top, left });
    setPickerOpen(true);
  };
  // Guard: if picker is already open, useClickOutside's pointerdown listener
  // already closed it (same gesture).  React batches the setPickerOpen(false)
  // so pickerOpen is still true in this closure — skip the reopen to avoid a
  // close→reopen flash.
  const handleWrapperClick = () => {
    if (isDisabled || pickerOpen) return;
    openPicker();
  };
  const closePicker = () => {
    setPickerOpen(false);
    document.getElementById(id)?.focus();
  };
  useClickOutside(popoverRef, closePicker, {
    escapeKey: true,
    enabled: pickerOpen,
  });

  // The dialog owns draft editing and confirms the composed value; the
  // buffered hook parses the DISPLAY shape, so commits format the ISO
  // contract through formatDateTime24 before dispatch.
  const confirmComposed = (composed: string) => {
    buffered.onChange({ target: { value: formatDateTime24(composed) } } as unknown as Parameters<typeof buffered.onChange>[0]);
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
      onClick={handleWrapperClick}
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
          className="dtp-dialog-host"
          style={{ top: pickerPos?.top ?? 8, left: pickerPos?.left ?? 8 }}
        >
          <DateTimePickerDialog
            title={label ?? 'Chọn ngày giờ'}
            value={value}
            onConfirm={confirmComposed}
            onClose={() => { setPickerOpen(false); document.getElementById(id)?.focus(); }}
          />
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
