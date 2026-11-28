import { useMonthOptional } from './useMonth';
import { useSalaryPeriod } from '../design-system/hooks/useSalaryPeriod';
import { businessDateISO } from '../lib/format';

/** Calendar-month window — the fallback while/unless the period catalog resolves. */
export function calendarMonthRange(year: number, month: number): { from: string; to: string } {
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * SIL-1295 — the header's "Kỳ làm việc" window as { from, to }.
 *
 * Derived EXACTLY like the topbar chip (useMonth + useSalaryPeriod(month,
 * year) → period.start/period.end), so a page request seeded from here can
 * never disagree with the range the header prints. The repro: the chip showed
 * "01/11 – 30/11" while page requests defaulted month-to-TODAY (…–28/11) or
 * carried no dates at all. Falls back to the calendar month when no salary
 * period is configured for the selected month.
 *
 * Provider-safe via useMonthOptional: outside a MonthProvider (isolated
 * tests, context-free surfaces) the REAL month stands in for the selected
 * one instead of crashing the page over optional context.
 */
export function usePeriodRange(): { from: string; to: string } {
  const selected = useMonthOptional();
  // The fallback month is read from the Vietnam business date — the same
  // clock the pages' old month-to-today defaults used (a UTC/local `new Date()`
  // month flips a day early vs VN and re-opens the mismatch class).
  const today = businessDateISO();
  const month = selected?.month ?? Number(today.slice(5, 7));
  const year = selected?.year ?? Number(today.slice(0, 4));
  const { data: period } = useSalaryPeriod(month, year);
  // Only a COMPLETE window may override the fallback: a partial/empty resolve
  // must never leak undefined into a page's date params.
  return period?.start && period?.end ? { from: period.start, to: period.end } : calendarMonthRange(year, month);
}
