import { useEffect, useRef, type ChangeEvent, type FocusEventHandler, type FormEventHandler, type Ref } from 'react';

/**
 * Regex matching a complete ISO 8601 date (YYYY-MM-DD). The browser's
 * <input type="date"> only emits a `value` once day, month, and year are
 * fully entered; partial strings ("1", "12", "2024-12") become "" in the DOM
 * even when React re-renders with that string, which is the root cause of the
 * "typed digits flash and disappear" bug on controlled date inputs.
 */
const COMPLETE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True when the date string is either empty (cleared) or a complete
 * YYYY-MM-DD value that the browser will accept as a controlled `value`.
 */
export function isCompleteDateString(value: string): boolean {
  return value === '' || COMPLETE_DATE_PATTERN.test(value);
}

export interface UseBufferedDateValueOptions {
  /** Controlled value from the parent. Either '' (empty) or 'YYYY-MM-DD'. */
  value: string;
  /** Called when the user finishes entering a complete date or clears the field. */
  onChange: (value: string) => void;
}

export interface BufferedDateInputBindings {
  /** Ref that must be attached to the underlying <input type="date">. */
  ref: Ref<HTMLInputElement>;
  /**
   * Initial value to render on the input via `defaultValue`. After mount the
   * input is fully uncontrolled — the browser owns the field's value while
   * the user is typing — and external value changes are pushed to the DOM
   * via the ref (see the effect inside the hook).
   */
  defaultValue: string;
  /** Native change handler that only fires onChange for complete or cleared values. */
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  /** Native input events commit complete segments before a following Enter. */
  onInput: FormEventHandler<HTMLInputElement>;
  /** Commit a complete pending value or revert an abandoned partial draft. */
  onBlur: FocusEventHandler<HTMLInputElement>;
}

/**
 * Wraps a <input type="date"> with a draft buffer so the user can type
 * day/month/year one character at a time without the browser clearing the
 * field on each keystroke.
 *
 * The input is intentionally uncontrolled. The browser's native date input
 * rejects any value that is not a complete YYYY-MM-DD string, so a controlled
 * `value` prop causes React to overwrite the user's partial typing on every
 * render — the typed digits flash and disappear. Keeping the input
 * uncontrolled means React never re-applies a value the user did not finish,
 * and partial drafts remain visible.
 *
 * Behavior:
 *  - The hook exposes a `ref` and a `defaultValue`. Spread them onto the
 *    <input type="date"> so it is uncontrolled.
 *  - `input` and `change` invoke onChange only when the new value is empty (cleared) or a
 *    complete YYYY-MM-DD value. Partial values stay in the DOM, untouched.
 *  - On blur, a complete pending date is committed once; an abandoned partial draft is reverted to the last
 *    `value` prop so a half-typed entry does not silently become the saved
 *    value.
 *  - When the parent's `value` changes externally (e.g. "Clear filters"
 *    resets the URL), the effect pushes the new value to the DOM via the
 *    ref. The last-synced value is tracked so re-renders that pass the
 *    same value do not stomp on the user's draft.
 *
 * The hook is the workhorse used by the design-system `<DateField>` and by
 * filter bars that wrap a custom or UUI input directly.
 */
export function useBufferedDateValue({ value, onChange }: UseBufferedDateValueOptions): BufferedDateInputBindings {
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Tracks the last value the effect has pushed to the DOM, so we do not
  // re-write the input's value on every render — only when the parent
  // actually changes the controlled value.
  const lastSyncedValueRef = useRef(value);
  const lastEmittedValueRef = useRef(value);

  useEffect(() => {
    if (lastSyncedValueRef.current !== value) {
      lastSyncedValueRef.current = value;
      lastEmittedValueRef.current = value;
      if (inputRef.current) {
        inputRef.current.value = value;
      }
    }
  }, [value]);

  const commitCompleteValue = (input: HTMLInputElement) => {
    const next = input.value;
    if (!input.validity?.badInput && isCompleteDateString(next) && next !== lastEmittedValueRef.current) {
      lastEmittedValueRef.current = next;
      onChangeRef.current(next);
    }
  };
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => commitCompleteValue(event.target);
  const handleInput: FormEventHandler<HTMLInputElement> = (event) => commitCompleteValue(event.currentTarget);

  const handleBlur: FocusEventHandler<HTMLInputElement> = (event) => {
    const current = event.target.value;
    // Keep native incomplete segments visible and invalid; reverting here
    // would let a following Save click reuse the previous valid parent date.
    if (event.target.validity?.badInput) return;
    if (!isCompleteDateString(current)) {
      event.target.value = valueRef.current;
    } else {
      // Some native date controls defer change until focus leaves the field.
      commitCompleteValue(event.target);
    }
  };

  return {
    ref: inputRef,
    defaultValue: value,
    onChange: handleChange,
    onInput: handleInput,
    onBlur: handleBlur,
  };
}
