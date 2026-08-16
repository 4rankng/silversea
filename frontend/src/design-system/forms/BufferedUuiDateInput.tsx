import { type ReactNode, useId } from 'react';
import { InputBase, type InputBaseProps } from '@/components/untitled-ui/base/input/input';
import { Label } from '@/components/untitled-ui/base/input/label';
import { useBufferedDateValue } from '../hooks/useBufferedDateValue';

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

/**
 * Untitled UI styled date input that uses a local draft buffer so the
 * "typed digits flash and disappear" bug is fixed.
 *
 * This wraps the shared `InputBase` (and the `Label` primitive) directly
 * instead of the higher-level `Input` component, because the latter wraps
 * React Aria's `TextField` which enforces a controlled `value` — the very
 * behavior that makes `<input type="date">` lose partial entries on every
 * keystroke. With this component the input is uncontrolled (via the
 * underlying `defaultValue`) and the `useBufferedDateValue` effect pushes
 * external value changes to the DOM via the ref.
 *
 * Use this in filter bars and toolbar UIs that already use the UUI
 * `Input`; use the design-system `<DateField>` for form pages.
 */
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
  const buffered = useBufferedDateValue({ value, onChange });

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
        type="date"
        size={size}
        defaultValue={buffered.defaultValue}
        isInvalid={isInvalid}
        isDisabled={isDisabled}
        isRequired={isRequired}
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

BufferedUuiDateInput.displayName = 'BufferedUuiDateInput';
