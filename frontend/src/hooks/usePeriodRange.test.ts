/**
 * SIL-1295 (id 1595) — the header chip printed "01/11 – 30/11" while page
 * requests defaulted month-to-TODAY (…–28/11) or carried no dates at all.
 * usePeriodRange derives { from, to } EXACTLY like the chip (useMonth +
 * useSalaryPeriod), so seeded requests cannot disagree with the header.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { calendarMonthRange } from './usePeriodRange';
import { businessDateISO } from '../lib/format';

const state = vi.hoisted(() => ({
  month: 11,
  year: 2026,
  noProvider: false,
  period: undefined as { start: string; end: string } | undefined,
}));

vi.mock('./useMonth', () => ({ useMonthOptional: () => (state.noProvider ? null : { month: state.month, year: state.year }) }));
vi.mock('../design-system/hooks/useSalaryPeriod', () => ({ useSalaryPeriod: () => ({ data: state.period }) }));

import { usePeriodRange } from './usePeriodRange';

describe('calendarMonthRange — the no-period fallback', () => {
  it('covers the full calendar month, leap February included', () => {
    expect(calendarMonthRange(2026, 11)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(calendarMonthRange(2024, 2)).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(calendarMonthRange(2026, 2)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(calendarMonthRange(2026, 12)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('usePeriodRange — the header window', () => {
  it('falls back to the calendar month while no salary period is configured', () => {
    state.period = undefined;
    const { result } = renderHook(() => usePeriodRange());
    expect(result.current).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  });

  it('returns the configured period window verbatim — the chip cannot disagree', () => {
    state.period = { start: '2026-11-01', end: '2026-11-30' };
    const { result } = renderHook(() => usePeriodRange());
    expect(result.current).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    // A non-calendar configured window (e.g. a 26th–25th salary cycle) must
    // win over the month fallback — the chip prints THIS, the pages use THIS.
    state.period = { start: '2026-10-26', end: '2026-11-25' };
    const { result: second } = renderHook(() => usePeriodRange());
    expect(second.current).toEqual({ from: '2026-10-26', to: '2026-11-25' });
    state.period = undefined;
  });

  it('never crashes outside a MonthProvider — the Vietnam business month stands in', () => {
    state.noProvider = true;
    const { result } = renderHook(() => usePeriodRange());
    const today = businessDateISO();
    expect(result.current).toEqual(calendarMonthRange(Number(today.slice(0, 4)), Number(today.slice(5, 7))));
    state.noProvider = false;
  });
});
