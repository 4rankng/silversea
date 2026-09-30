// Fake-timer lock for the Vietnam-day rollover: a workboard tab left open
// overnight must not keep showing yesterday's default date filter and
// "Hôm nay chờ phân xe" rail.
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { msUntilVietnamMidnight, useVietnamToday } from './useVietnamToday';

function TodayProbe() {
  return <span data-testid="today">{useVietnamToday()}</span>;
}

describe('useVietnamToday', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('measures the wait to the next Vietnam midnight, not the device one', () => {
    // 16:30Z = 23:30 on the UTC+7 wall clock → 30 minutes to the boundary.
    expect(msUntilVietnamMidnight(new Date('2026-09-16T16:30:00.000Z'))).toBe(30 * 60 * 1000);
    // Exactly ON the boundary the answer is a full day, never 0 — a 0 ms arm
    // would fire immediately and re-arm in a hot loop.
    expect(msUntilVietnamMidnight(new Date('2026-09-16T17:00:00.000Z'))).toBe(24 * 60 * 60 * 1000);
  });

  it('advances the business day across Vietnam midnight and keeps rolling nightly', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T16:30:00.000Z'));
    render(<TodayProbe />);
    expect(screen.getByTestId('today').textContent).toBe('2026-09-16');

    act(() => { vi.advanceTimersByTime(31 * 60 * 1000); });
    expect(screen.getByTestId('today').textContent).toBe('2026-09-17');

    // The hook re-armed itself, so the next night rolls without a remount.
    act(() => { vi.advanceTimersByTime(24 * 60 * 60 * 1000); });
    expect(screen.getByTestId('today').textContent).toBe('2026-09-18');
  });

  it('resyncs when a frozen tab returns to the foreground', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T16:30:00.000Z'));
    render(<TodayProbe />);
    expect(screen.getByTestId('today').textContent).toBe('2026-09-16');

    // Three days pass with the timer deferred (frozen tab); the next
    // visibilitychange must not wait for the armed fire.
    vi.setSystemTime(new Date('2026-09-19T02:00:00.000Z'));
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(screen.getByTestId('today').textContent).toBe('2026-09-19');
  });
});
