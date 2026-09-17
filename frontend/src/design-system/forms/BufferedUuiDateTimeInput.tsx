import { type ComponentProps, type ReactNode, useId } from 'react';
import { type InputBaseProps } from '@/components/untitled-ui/base/input/input';
import { SplitDateTimeField } from './SplitDateTimeField';

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


/** Compatibility adapter for the UUI string-value API. All datetime editing
 * uses the same compact split inputs and shared time/calendar surfaces. */
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
  const attributes = { ...rest, ...inputProps } as Partial<InputBaseProps>;
  const id = attributes.id ?? generatedId;
  const hintId = hint ? `${id}-hint` : undefined;
  const { min, max, name, readOnly, disabled, required, ...nativeProps } = attributes;
  const invalid = isInvalid ?? attributes.isInvalid;
  const error = invalid && typeof hint === 'string' ? hint : undefined;
  const describedBy = [attributes['aria-describedby'], !error && hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div data-input-wrapper data-input-size={size} className={['group flex h-max w-full flex-col items-start justify-start gap-1.5', className].filter(Boolean).join(' ')}>
      <SplitDateTimeField
        id={id}
        label={label ?? attributes['aria-label'] ?? 'Ngày giờ'}
        hideLabel={!label}
        value={value}
        onChange={onChange}
        required={isRequired ?? attributes.isRequired ?? required}
        disabled={isDisabled ?? attributes.isDisabled ?? disabled}
        readOnly={readOnly}
        error={error}
        min={min == null ? undefined : String(min)}
        max={max == null ? undefined : String(max)}
        name={name}
        size={attributes.size ?? size}
        groupRef={attributes.groupRef ?? groupRef}
        wrapperClassName={attributes.wrapperClassName ?? wrapperClassName}
        inputClassName={attributes.inputClassName ?? inputClassName}
        inputProps={{ ...nativeProps, 'aria-invalid': invalid ?? attributes['aria-invalid'], 'aria-describedby': describedBy } as ComponentProps<typeof SplitDateTimeField>['inputProps']}
      />
      {!error && hint && <p id={hintId} className={`text-xs leading-[1.5] ${invalid ? 'text-error-primary' : 'text-tertiary'}`}>{hint}</p>}
    </div>
  );
}

BufferedUuiDateTimeInput.displayName = 'BufferedUuiDateTimeInput';
