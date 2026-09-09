import { type ReactNode, useId } from 'react';
import { InputBase, type InputBaseProps } from '@/components/untitled-ui/base/input/input';
import { Label } from '@/components/untitled-ui/base/input/label';
import { DATE_TIME_24_PLACEHOLDER, useBufferedDateTimeValue } from '../hooks/useBufferedDateTimeValue';

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
        onChange={buffered.onChange}
        onBlur={buffered.onBlur}
        inputClassName={inputClassName}
        wrapperClassName={wrapperClassName}
        {...(inputProps as Partial<InputBaseProps>)}
      />
      {hint && (
        <p className="text-sm text-tertiary group-invalid/input:text-error-primary">
          {hint}
        </p>
      )}
    </div>
  );
}

BufferedUuiDateTimeInput.displayName = 'BufferedUuiDateTimeInput';
