import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DATE_TIME_24_PLACEHOLDER, formatDateTime24, parseDateTime24, useBufferedDateTimeValue } from './useBufferedDateTimeValue';

describe('formatDateTime24', () => {
  it('formats ISO local datetime as date-first 24h text (DD/MM/YYYY HH:mm)', () => {
    expect(formatDateTime24('2026-08-20T14:30')).toBe('20/08/2026 14:30');
    expect(formatDateTime24('2026-09-09T08:05')).toBe('09/09/2026 08:05');
  });

  it('tolerates an ISO string carrying seconds', () => {
    expect(formatDateTime24('2026-08-20T14:30:45')).toBe('20/08/2026 14:30');
  });

  it('returns empty string for empty or malformed input', () => {
    expect(formatDateTime24('')).toBe('');
    expect(formatDateTime24('not-a-date')).toBe('');
    expect(formatDateTime24(null)).toBe('');
    expect(formatDateTime24(undefined)).toBe('');
  });
});

describe('parseDateTime24', () => {
  it('parses date-first 24h entry into ISO local datetime', () => {
    expect(parseDateTime24('20/08/2026 14:30')).toBe('2026-08-20T14:30');
    expect(parseDateTime24('09/09/2026 08:05')).toBe('2026-09-09T08:05');
    // Tolerates legacy time-first format
    expect(parseDateTime24('14:30 20/08/2026')).toBe('2026-08-20T14:30');
  });

  it('accepts single-digit hour/date/month and zero-pads the ISO result', () => {
    expect(parseDateTime24('9/9/2026 9:30')).toBe('2026-09-09T09:30');
    expect(parseDateTime24('1/1/2026 0:05')).toBe('2026-01-01T00:05');
    expect(parseDateTime24('9:30 9/9/2026')).toBe('2026-09-09T09:30');
  });

  it('rejects out-of-range and impossible entries', () => {
    expect(parseDateTime24('31/02/2026 10:00')).toBeNull();
    expect(parseDateTime24('20/13/2026 10:00')).toBeNull();
    expect(parseDateTime24('20/08/2026 24:00')).toBeNull();
    expect(parseDateTime24('20/08/2026 10:60')).toBeNull();
    expect(parseDateTime24('20/08/2026 10:00 AM')).toBeNull();
    expect(parseDateTime24('2026-08-20 10:00')).toBeNull();
    expect(parseDateTime24('20/08/26 10:00')).toBeNull();
    expect(parseDateTime24('')).toBeNull();
  });
});

describe('useBufferedDateTimeValue', () => {
  function makeChangeEvent(value: string) {
    return { target: { value } } as unknown as React.ChangeEvent<HTMLInputElement>;
  }
  function makeBlurEvent(value: string) {
    return { target: { value } } as unknown as React.FocusEvent<HTMLInputElement>;
  }

  it('exposes the controlled value formatted date-first 24h', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useBufferedDateTimeValue({ value: '2026-08-20T14:30', onChange }));
    expect(result.current.defaultValue).toBe('20/08/2026 14:30');
  });

  it('does not fire onChange for a partial or invalid draft', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useBufferedDateTimeValue({ value: '', onChange }));

    act(() => result.current.onChange(makeChangeEvent('20')));
    act(() => result.current.onChange(makeChangeEvent('20/08')));
    act(() => result.current.onChange(makeChangeEvent('20/08/2026 14:30'.slice(0, 10))));
    act(() => result.current.onChange(makeChangeEvent('20/08/2026 14')));
    act(() => result.current.onChange(makeChangeEvent('31/02/2026 10:00')));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('fires onChange once with the ISO value when the entry completes', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useBufferedDateTimeValue({ value: '', onChange }));

    act(() => result.current.onChange(makeChangeEvent('20/08/2026 14:30')));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('2026-08-20T14:30');
  });

  it('fires onChange with empty string when the field is cleared', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useBufferedDateTimeValue({ value: '2026-08-20T14:30', onChange }));

    act(() => result.current.onChange(makeChangeEvent('')));

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('reverts an abandoned draft to the previous value on blur', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useBufferedDateTimeValue({ value: '2026-08-20T14:30', onChange }));

    const blurEvent = makeBlurEvent('20/08/2026 14:3');
    act(() => result.current.onBlur(blurEvent));

    expect(blurEvent.target.value).toBe('20/08/2026 14:30');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('normalizes a loose but parseable draft to the canonical text on blur', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useBufferedDateTimeValue({ value: '', onChange }));

    const blurEvent = makeBlurEvent('9/9/2026 9:30');
    act(() => result.current.onBlur(blurEvent));

    expect(blurEvent.target.value).toBe('09/09/2026 09:30');
  });

  it('pushes external value changes to the input via the ref, date-first 24h', () => {
    const onChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useBufferedDateTimeValue({ value, onChange }),
      { initialProps: { value: '' } },
    );
    const input = document.createElement('input');
    input.type = 'text';
    (result.current.ref as React.MutableRefObject<HTMLInputElement>).current = input;

    rerender({ value: '2026-09-09T08:05' });
    expect(input.value).toBe('09/09/2026 08:05');

    rerender({ value: '' });
    expect(input.value).toBe('');
  });

  it('does not overwrite the input on re-render with the same value', () => {
    const onChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useBufferedDateTimeValue({ value, onChange }),
      { initialProps: { value: '2026-08-20T14:30' } },
    );
    const input = document.createElement('input');
    input.type = 'text';
    input.value = '20/08/2026 14:30';
    (result.current.ref as React.MutableRefObject<HTMLInputElement>).current = input;

    input.value = '20/08/2026 15:00';
    rerender({ value: '2026-08-20T14:30' });
    expect(input.value).toBe('20/08/2026 15:00');
  });

  it('pins the date-first 24h placeholder shape', () => {
    expect(DATE_TIME_24_PLACEHOLDER).toBe('DD/MM/YYYY HH:mm');
  });
});
