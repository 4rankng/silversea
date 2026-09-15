import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { isCompleteDateString, useBufferedDateValue } from './useBufferedDateValue';

describe('isCompleteDateString', () => {
  it('accepts the empty string as a valid cleared value', () => {
    expect(isCompleteDateString('')).toBe(true);
  });

  it('accepts only full YYYY-MM-DD strings', () => {
    expect(isCompleteDateString('2024-12-15')).toBe(true);
    expect(isCompleteDateString('2024-12-31')).toBe(true);
  });

  it('rejects partial dates, malformed strings, and other shapes', () => {
    expect(isCompleteDateString('1')).toBe(false);
    expect(isCompleteDateString('12')).toBe(false);
    expect(isCompleteDateString('2024')).toBe(false);
    expect(isCompleteDateString('2024-12')).toBe(false);
    expect(isCompleteDateString('2024-12-')).toBe(false);
    expect(isCompleteDateString('12/15/2024')).toBe(false);
    expect(isCompleteDateString('2024-12-15T10:00:00')).toBe(false);
    expect(isCompleteDateString('hello')).toBe(false);
  });
});

describe('useBufferedDateValue', () => {
  function makeChangeEvent(value: string) {
    return { target: { value } } as unknown as React.ChangeEvent<HTMLInputElement>;
  }
  function makeBlurEvent(value: string) {
    return { target: { value } } as unknown as React.FocusEvent<HTMLInputElement>;
  }

  it('exposes the controlled value as the initial defaultValue', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useBufferedDateValue({ value: '2024-12-15', onChange }));
    expect(result.current.defaultValue).toBe('2024-12-15');
  });

  it('does not fire onChange for a partial value (the flash bug fix)', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useBufferedDateValue({ value: '', onChange }));

    act(() => result.current.onChange(makeChangeEvent('1')));
    expect(onChange).not.toHaveBeenCalled();

    act(() => result.current.onChange(makeChangeEvent('12')));
    expect(onChange).not.toHaveBeenCalled();

    act(() => result.current.onChange(makeChangeEvent('2024')));
    expect(onChange).not.toHaveBeenCalled();

    act(() => result.current.onChange(makeChangeEvent('2024-12')));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('fires onChange exactly once with a complete YYYY-MM-DD value', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useBufferedDateValue({ value: '', onChange }));

    act(() => result.current.onChange(makeChangeEvent('1')));
    act(() => result.current.onChange(makeChangeEvent('12')));
    act(() => result.current.onChange(makeChangeEvent('2024-12-15')));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('2024-12-15');
  });

  it('fires onChange with empty string when the field is cleared', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useBufferedDateValue({ value: '2024-12-15', onChange }));

    act(() => result.current.onChange(makeChangeEvent('')));

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('reverts an abandoned partial draft to the controlled value on blur', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useBufferedDateValue({ value: '2024-12-15', onChange }));

    const blurEvent = makeBlurEvent('1');
    act(() => result.current.onBlur(blurEvent));

    expect(blurEvent.target.value).toBe('2024-12-15');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('commits a complete pending value on blur without clearing its display', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useBufferedDateValue({ value: '', onChange }));

    const blurEvent = makeBlurEvent('2024-12-15');
    act(() => result.current.onBlur(blurEvent));

    expect(blurEvent.target.value).toBe('2024-12-15');
    expect(onChange).toHaveBeenCalledWith('2024-12-15');
  });

  it('commits input before change and deduplicates subsequent change and blur events', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useBufferedDateValue({ value: '', onChange }));
    const input = document.createElement('input');
    input.type = 'date';
    input.value = '2026-09-23';
    act(() => result.current.onInput({ currentTarget: input } as unknown as React.FormEvent<HTMLInputElement>));
    act(() => result.current.onChange(makeChangeEvent(input.value)));
    act(() => result.current.onBlur(makeBlurEvent(input.value)));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('2026-09-23');
  });

  it('keeps incomplete native segments buffered instead of treating badInput as a clear', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useBufferedDateValue({ value: '2026-09-15', onChange }));
    const input = { value: '', validity: { badInput: true } } as HTMLInputElement;
    act(() => result.current.onInput({ currentTarget: input } as unknown as React.FormEvent<HTMLInputElement>));
    expect(onChange).not.toHaveBeenCalled();
    act(() => result.current.onBlur({ target: input } as unknown as React.FocusEvent<HTMLInputElement>));
    expect(input.value).toBe('');
  });

  it('clears a partial draft on blur when the controlled value is empty', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useBufferedDateValue({ value: '', onChange }));

    const blurEvent = makeBlurEvent('1');
    act(() => result.current.onBlur(blurEvent));

    expect(blurEvent.target.value).toBe('');
  });

  it('pushes external value changes to the input via the ref', () => {
    const onChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useBufferedDateValue({ value, onChange }),
      { initialProps: { value: '' } },
    );
    const input = document.createElement('input');
    input.type = 'date';
    (result.current.ref as React.MutableRefObject<HTMLInputElement>).current = input;

    rerender({ value: '2025-01-02' });
    expect(input.value).toBe('2025-01-02');

    rerender({ value: '' });
    expect(input.value).toBe('');
  });

  it('does not overwrite the input on re-render with the same value', () => {
    const onChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useBufferedDateValue({ value, onChange }),
      { initialProps: { value: '2025-01-02' } },
    );
    const input = document.createElement('input');
    input.type = 'date';
    input.value = '2025-01-02';
    (result.current.ref as React.MutableRefObject<HTMLInputElement>).current = input;

    // User typing mid-stream — the input shows what the user typed, not
    // the controlled value. The hook must not stomp on that.
    input.value = '2025-01-03';
    rerender({ value: '2025-01-02' });
    expect(input.value).toBe('2025-01-03');
  });

  it('exposes a ref consumers can attach to the input', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useBufferedDateValue({ value: '', onChange }));
    // The ref is a useRef object — attaching it to a DOM input must work.
    const ref = result.current.ref as { current: HTMLInputElement | null };
    expect(ref).toHaveProperty('current');
    expect(ref.current).toBeNull();
  });
});
