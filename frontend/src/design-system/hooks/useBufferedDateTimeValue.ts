import { useEffect, useRef, type ChangeEvent, type FocusEventHandler, type Ref } from 'react';
import { formatDateTime24, parseDateTime24 } from '../../lib/format';

export { DATE_TIME_24_PLACEHOLDER, formatDateTime24, parseDateTime24 } from '../../lib/format';

export interface UseBufferedDateTimeValueOptions {
  /** Controlled value from the parent: '' or 'YYYY-MM-DDTHH:mm'. */
  value: string;
  /** Called when the user enters a complete datetime or clears the field. */
  onChange: (value: string) => void;
}

export interface BufferedDateTimeInputBindings {
  /** Ref for the underlying <input type="text">. */
  ref: Ref<HTMLInputElement>;
  /**
   * Initial display text. The input is uncontrolled after mount; external
   * value changes are pushed to the DOM via the ref (effect in the hook).
   */
  defaultValue: string;
  /** Native change handler; fires onChange only for complete/cleared values. */
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  /** Native blur handler that normalizes or reverts an abandoned draft. */
  onBlur: FocusEventHandler<HTMLInputElement>;
}

/**
 * Draft-buffer hook for a 24h datetime **text** input.
 *
 * The combined date + time display contract (2026-09-09 hard requirement)
 * is time-first 24-hour `HH:mm DD/MM/YYYY`. Native `datetime-local` inputs
 * render per browser locale (12h AM/PM on en-US systems) and cannot be
 * forced, so callers render a plain text input in that fixed shape and this
 * hook owns the buffering (formatters live in lib/format):
 *
 *  - the input stays uncontrolled while typing, so partial drafts never
 *    flash and disappear;
 *  - `onChange` fires only for '' (cleared) or a complete parseable entry;
 *  - blur normalizes a parseable draft to the canonical text and reverts
 *    anything incomplete to the previous value;
 *  - external value changes are pushed to the DOM formatted, tracked through
 *    `lastSyncedValueRef` so re-renders never stomp on the user's draft.
 *
 * Mirrors `useBufferedDateValue` (the native <input type="date"> sibling).
 */
export function useBufferedDateTimeValue({ value, onChange }: UseBufferedDateTimeValueOptions): BufferedDateTimeInputBindings {
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastSyncedValueRef = useRef(value);

  useEffect(() => {
    if (lastSyncedValueRef.current !== value) {
      lastSyncedValueRef.current = value;
      if (inputRef.current) {
        inputRef.current.value = formatDateTime24(value);
      }
    }
  }, [value]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    if (next === '') {
      onChangeRef.current('');
      return;
    }
    const parsed = parseDateTime24(next);
    if (parsed !== null) {
      onChangeRef.current(parsed);
    }
  };

  const handleBlur: FocusEventHandler<HTMLInputElement> = (event) => {
    const current = event.target.value;
    if (current === '' || current === formatDateTime24(valueRef.current)) return;
    const parsed = parseDateTime24(current);
    event.target.value = parsed !== null ? formatDateTime24(parsed) : formatDateTime24(valueRef.current);
  };

  return {
    ref: inputRef,
    defaultValue: formatDateTime24(value),
    onChange: handleChange,
    onBlur: handleBlur,
  };
}
