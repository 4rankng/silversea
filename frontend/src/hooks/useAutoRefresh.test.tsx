import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAutoRefresh } from './useAutoRefresh';

describe('useAutoRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom defaults to visibilityState="visible" so the timer starts.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('polls the loader on the configured cadence while the tab is visible', async () => {
    const loader = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutoRefresh(loader, 1_000));

    expect(loader).toHaveBeenCalledTimes(0);

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(loader).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it('refetches immediately when the tab regains visibility', async () => {
    const loader = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutoRefresh(loader, 60_000));

    // Tab becomes hidden — timer should stop.
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(loader).not.toHaveBeenCalled();

    // Tab regains visibility — must refetch immediately.
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('does not poll while the tab is hidden, even if the interval elapses', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    const loader = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutoRefresh(loader, 1_000));

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(loader).not.toHaveBeenCalled();
  });

  it('stops polling and detaches listeners on unmount', async () => {
    const loader = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useAutoRefresh(loader, 1_000));
    unmount();

    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    expect(loader).not.toHaveBeenCalled();
  });

  it('always uses the latest loader (does not capture a stale closure)', async () => {
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ fn }) => useAutoRefresh(fn, 1_000), {
      initialProps: { fn: first },
    });

    rerender({ fn: second });

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('no-op when intervalMs is non-positive', async () => {
    const loader = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutoRefresh(loader, 0));
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(loader).not.toHaveBeenCalled();
  });
});
