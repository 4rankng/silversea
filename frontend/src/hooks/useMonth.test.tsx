import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MonthProvider, useMonth } from './useMonth';

describe('working month navigation', () => {
  function setup() {
    return renderHook(useMonth, {
      wrapper: ({ children }) => <StrictMode><MonthProvider>{children}</MonthProvider></StrictMode>,
    });
  }

  it('crosses each year boundary once under StrictMode', () => {
    const { result } = setup();
    act(() => result.current.setMonthYear(1, 2026));
    act(() => result.current.goPrev());
    expect(result.current).toMatchObject({ month: 12, year: 2025 });
    act(() => result.current.goNext());
    expect(result.current).toMatchObject({ month: 1, year: 2026 });
  });

  it('keeps batched consecutive navigation consistent', () => {
    const { result } = setup();
    act(() => result.current.setMonthYear(12, 2025));
    act(() => { result.current.goNext(); result.current.goNext(); });
    expect(result.current).toMatchObject({ month: 2, year: 2026 });
    act(() => { result.current.goPrev(); result.current.goPrev(); result.current.goPrev(); });
    expect(result.current).toMatchObject({ month: 11, year: 2025 });
  });
});
