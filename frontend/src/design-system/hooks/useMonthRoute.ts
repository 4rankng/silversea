import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * URL-state-backed replacement for `useMonth()`.
 *
 * The previous MonthProvider was a React context that wrapped the entire
 * app — refreshing any page would reset the selected month, deep links
 * like `/trips?month=5&year=2026` were impossible, and the browser's
 * back-button did not restore the previous month selection.
 *
 * Storing month/year in the query string (using `replace: true` so a quick
 * scroll through months doesn't pollute history) fixes all three:
 *
 *   const { month, year, goPrev, goNext, setMonthYear } = useMonthRoute();
 *
 *   <button onClick={goPrev}>‹</button>
 *   <button onClick={goNext}>›</button>
 *
 * Existing components that consume the context will continue to work via
 * the legacy `useMonth()` re-export (see `useMonth.tsx`).
 */

function clampMonth(m: number): number {
  if (!Number.isFinite(m)) return 1;
  if (m < 1) return 12;
  if (m > 12) return 1;
  return m;
}

function clampYear(y: number): number {
  if (!Number.isFinite(y)) return new Date().getFullYear();
  return Math.max(2000, Math.min(2100, Math.trunc(y)));
}

export interface MonthRouteValue {
  month: number;   // 1-12
  year: number;    // 4-digit
  goPrev: () => void;
  goNext: () => void;
  setMonthYear: (month: number, year: number) => void;
}

export function useMonthRoute(): MonthRouteValue {
  const [params, setParams] = useSearchParams();
  const now = new Date();

  const rawMonth = Number(params.get('m'));
  const rawYear = Number(params.get('y'));
  const month = Number.isFinite(rawMonth) && rawMonth >= 1 && rawMonth <= 12
    ? rawMonth
    : now.getMonth() + 1;
  const year = Number.isFinite(rawYear) && rawYear >= 2000
    ? rawYear
    : now.getFullYear();

  const setMonthYear = useCallback((m: number, y: number) => {
    const next = new URLSearchParams(params);
    next.set('m', String(clampMonth(m)));
    next.set('y', String(clampYear(y)));
    setParams(next, { replace: true });
  }, [params, setParams]);

  const goPrev = useCallback(() => {
    if (month === 1) setMonthYear(12, year - 1);
    else setMonthYear(month - 1, year);
  }, [month, year, setMonthYear]);

  const goNext = useCallback(() => {
    if (month === 12) setMonthYear(1, year + 1);
    else setMonthYear(month + 1, year);
  }, [month, year, setMonthYear]);

  return { month, year, goPrev, goNext, setMonthYear };
}
