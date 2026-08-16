import { useId, type InputHTMLAttributes } from 'react';
import { useBufferedDateValue } from '../hooks/useBufferedDateValue';

export interface DateInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'defaultValue' | 'onBlur' | 'ref'> {
  /** Controlled value: '' (empty) or a complete 'YYYY-MM-DD' date string. */
  value: string;
  /** Called when the user enters a complete date or clears the field. */
  onChange: (value: string) => void;
  /** Optional id; auto-generated when omitted. */
  id?: string;
}

/**
 * Minimal unstyled wrapper around <input type="date"> that solves the
 * "typed digits flash and disappear" bug.
 *
 * The native date input rejects any value that is not a complete YYYY-MM-DD
 * string, so a controlled `value` prop causes React to overwrite the user's
 * partial typing on every render and the browser to clear the field. This
 * component renders the input as uncontrolled (via `defaultValue`) and
 * uses `useBufferedDateValue` to forward only complete (or cleared) values
 * to the parent.
 *
 * Use this when the existing markup already has its own label / error /
 * wrapper styling (e.g. pages with `<label><span>...</span><input .../></label>`
 * or a custom CSS class on the input). For form pages, prefer the design
 * system `<DateField>` which renders the standard label + error layout.
 */
export function DateInput({ value, onChange, id: providedId, ...rest }: DateInputProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const buffered = useBufferedDateValue({ value, onChange });

  return (
    <input
      {...rest}
      ref={buffered.ref}
      id={id}
      type="date"
      defaultValue={buffered.defaultValue}
      onChange={buffered.onChange}
      onBlur={buffered.onBlur}
    />
  );
}

DateInput.displayName = 'DateInput';
