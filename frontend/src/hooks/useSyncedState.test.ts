import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useSyncedState, useDerivedState } from './useSyncedState';

describe('useSyncedState', () => {
  it('1. initializes to defaultValue when externalValue is undefined', () => {
    const { result } = renderHook(() => useSyncedState<string>(undefined, 'fallback'));
    expect(result.current[0]).toBe('fallback');
  });

  it('1b. initializes to defaultValue when externalValue is null', () => {
    const { result } = renderHook(() => useSyncedState<string>(null, 'fallback'));
    expect(result.current[0]).toBe('fallback');
  });

  it('2. initializes to transform(externalValue) when externalValue is defined', () => {
    const transform = (raw: string) => raw.toUpperCase();
    const { result } = renderHook(() => useSyncedState('hello', 'fallback', transform));
    expect(result.current[0]).toBe('HELLO');
  });

  it('2b. initializes to externalValue (no transform) when externalValue is defined', () => {
    const { result } = renderHook(() => useSyncedState<number>(42, 0));
    expect(result.current[0]).toBe(42);
  });

  it('3. re-syncs from an externalValue change when NOT dirty', () => {
    let external = 'a';
    const { result, rerender } = renderHook(() => useSyncedState(external, 'fallback'));
    expect(result.current[0]).toBe('a');
    expect(result.current[2].isDirty).toBe(false);

    external = 'b';
    rerender();
    expect(result.current[0]).toBe('b');
    expect(result.current[2].isDirty).toBe(false);
  });

  it('4. does NOT re-sync from an externalValue change when dirty (after setValue)', () => {
    let external = 'a';
    const { result, rerender } = renderHook(() => useSyncedState(external, 'fallback'));

    act(() => {
      result.current[1]('user-typed');
    });
    expect(result.current[0]).toBe('user-typed');
    expect(result.current[2].isDirty).toBe(true);

    external = 'b';
    rerender();
    expect(result.current[0]).toBe('user-typed'); // unchanged — user owns the field
    expect(result.current[2].isDirty).toBe(true);
  });

  it('5. markSynced() re-enables sync (a later externalValue change updates value)', () => {
    let external = 'a';
    const { result, rerender } = renderHook(() => useSyncedState(external, 'fallback'));

    act(() => {
      result.current[1]('user-typed');
    });
    expect(result.current[2].isDirty).toBe(true);

    external = 'b'; // ignored, dirty
    rerender();
    expect(result.current[0]).toBe('user-typed');

    act(() => {
      result.current[2].markSynced();
    });
    expect(result.current[2].isDirty).toBe(false);
    // value stays as user's last input until next external change
    expect(result.current[0]).toBe('user-typed');

    external = 'c';
    rerender();
    expect(result.current[0]).toBe('c');
    expect(result.current[2].isDirty).toBe(false);
  });

  it('6. updater-form setValue((prev) => …) works', () => {
    const { result } = renderHook(() => useSyncedState<number>(10, 0));
    act(() => {
      result.current[1]((prev) => prev + 5);
    });
    expect(result.current[0]).toBe(15);
    expect(result.current[2].isDirty).toBe(true);
  });

  it('7. transform receives the NEW external value on re-sync (not the old one)', () => {
    const transform = vi.fn((raw: string) => `t(${raw})`);
    let external = 'old';
    const { result, rerender } = renderHook(() => useSyncedState(external, 'fallback', transform));

    // Initial mount: transform called with 'old' (count may vary across React
    // versions' lazy-init re-invocations — assert the last call, not the count)
    expect(transform).toHaveBeenLastCalledWith('old');
    expect(result.current[0]).toBe('t(old)');

    external = 'new';
    rerender();
    // Re-sync effect runs transform with the NEW value
    expect(transform).toHaveBeenLastCalledWith('new');
    expect(result.current[0]).toBe('t(new)');
  });

  it('7b. transform is NOT applied to user setValue (only to external values)', () => {
    const transform = (raw: string) => raw.toUpperCase();
    const { result } = renderHook(() => useSyncedState('init', 'fallback', transform));

    act(() => {
      result.current[1]('lowercase');
    });
    // user value passes through unchanged — transform only runs on external
    expect(result.current[0]).toBe('lowercase');
  });

  it('does not reset to default when externalValue transitions to null while dirty', () => {
    let external: string | null = 'x';
    const { result, rerender } = renderHook(() => useSyncedState(external, 'fallback'));

    act(() => {
      result.current[1]('user');
    });
    external = null;
    rerender();
    expect(result.current[0]).toBe('user');
  });
});

describe('useDerivedState', () => {
  it('8. always mirrors the external value with no dirty state', () => {
    let external: number | undefined = 1;
    const { result, rerender } = renderHook(() => useDerivedState(external, 0));
    expect(result.current).toBe(1);

    external = 2;
    rerender();
    expect(result.current).toBe(2);

    external = undefined;
    rerender();
    expect(result.current).toBe(0);
  });

  it('8b. applies transform to the external value', () => {
    const transform = (raw: number) => raw * 10;
    let external: number | undefined = 3;
    const { result, rerender } = renderHook(() => useDerivedState(external, 0, transform));
    expect(result.current).toBe(30);

    external = 4;
    rerender();
    expect(result.current).toBe(40);
  });
});
