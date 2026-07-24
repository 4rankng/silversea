import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useDirtyGuard } from './useDirtyGuard';

describe('useDirtyGuard', () => {
  it('is not dirty at the baseline (ready=true)', () => {
    const { result } = renderHook(({ deps, ready }) => useDirtyGuard(deps, ready), {
      initialProps: { deps: [1] as unknown[], ready: true },
    });
    expect(result.current.isDirty()).toBe(false);
  });

  it('is dirty after deps change once ready', () => {
    const { result, rerender } = renderHook(({ deps, ready }) => useDirtyGuard(deps, ready), {
      initialProps: { deps: [1] as unknown[], ready: true },
    });
    rerender({ deps: [2], ready: true });
    expect(result.current.isDirty()).toBe(true);
  });

  it('ignores changes while not ready, then baselines on the ready flip (async populate pass)', () => {
    const { result, rerender } = renderHook(({ deps, ready }) => useDirtyGuard(deps, ready), {
      initialProps: { deps: [1] as unknown[], ready: false },
    });
    // Server data arrives while the form isn't populated/ready yet — NOT dirty.
    rerender({ deps: [2], ready: false });
    expect(result.current.isDirty()).toBe(false);
    // Ready flips: the current (populated) value becomes the clean baseline.
    rerender({ deps: [2], ready: true });
    expect(result.current.isDirty()).toBe(false);
    // A genuine edit afterwards is detected.
    rerender({ deps: [3], ready: true });
    expect(result.current.isDirty()).toBe(true);
  });

  it('markClean re-baselines to the current snapshot', () => {
    const { result, rerender } = renderHook(({ deps, ready }) => useDirtyGuard(deps, ready), {
      initialProps: { deps: [1] as unknown[], ready: true },
    });
    rerender({ deps: [2], ready: true });
    expect(result.current.isDirty()).toBe(true);
    act(() => result.current.markClean());
    expect(result.current.isDirty()).toBe(false);
    rerender({ deps: [2], ready: true }); // unchanged → still clean
    expect(result.current.isDirty()).toBe(false);
    rerender({ deps: [3], ready: true });
    expect(result.current.isDirty()).toBe(true);
  });
});
