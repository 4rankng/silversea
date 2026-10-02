import { useCallback, useMemo } from 'react';
import { DateRangeFields, Tabs, UuiSelectField } from '../../design-system';
import type { TabItem } from '../../design-system';
import './PeriodFilter.css';

/**
 * Period filter for the AR/AP detail ledger tab. Two modes:
 *   - "month": pick a month (T1–T12) and year; resolves to [first day, last day].
 *   - "range": the shared `DateRangeFields` group (Từ ngày / Đến ngày).
 *
 * Both modes emit a { dateFrom, dateTo } range via `onChange` so the parent can
 * feed it directly into `useCustomerStatement(id, range)` /
 * `useSupplierStatement(id, range)`.
 *
 * Card 20260927_152: the group is ONE item of the shared filter strip, so its
 * parts ride the ONE row discipline (`.filter-bar`, FilterBar.css): the boxed
 * mode switch, the month/year selects or the shared from/to date group, and the
 * Áp dụng action pack into as few lines as the width allows and every part
 * keeps the width its value asks for. This component declares no filter layout,
 * no control width and no control height of its own — the page-local
 * `flex/grid` stack, the `fieldset` chrome and the full-width stretch that used
 * to live here are deleted (law §4). Props/API are unchanged: both detail pages
 * keep rendering it exactly as before.
 */

export type PeriodMode = 'month' | 'range';

export interface PeriodRange {
  dateFrom: string;
  dateTo: string;
}

export interface PeriodFilterProps {
  mode: PeriodMode;
  onModeChange: (mode: PeriodMode) => void;
  month: number;        // 1–12
  year: number;
  onMonthYearChange: (next: { month: number; year: number }) => void;
  dateFrom: string;     // ISO yyyy-mm-dd
  dateTo: string;       // ISO yyyy-mm-dd
  onRangeChange: (next: Partial<PeriodRange>) => void;
  onApply?: () => void;
  isApplying?: boolean;
  isApplyDisabled?: boolean;
}

/** Mode switch — the shared boxed segmented group (one group shape app-wide,
 *  operator ruling 2026-09-27). Ids match PeriodMode so the switch maps
 *  straight through. */
const MODE_TABS: TabItem[] = [
  { id: 'month', label: 'Theo tháng' },
  { id: 'range', label: 'Theo khoảng' },
];

const MONTH_LABELS = [
  'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
  'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12',
];

/** Year options = current year ± 3 (covers recent history + next year). */
function useYearOptions(): number[] {
  return useMemo(() => {
    const now = new Date().getFullYear();
    const years: number[] = [];
    for (let y = now - 3; y <= now + 1; y++) years.push(y);
    return years;
  }, []);
}

export function PeriodFilter(props: PeriodFilterProps) {
  const {
    mode,
    onModeChange,
    month,
    year,
    onMonthYearChange,
    dateFrom,
    dateTo,
    onRangeChange,
    onApply = () => {},
    isApplying = false,
    isApplyDisabled = false,
  } = props;
  const yearOptions = useYearOptions();

  const handleMonth = useCallback((value: string) => {
    onMonthYearChange({ month: Number(value), year });
  }, [year, onMonthYearChange]);

  const handleYear = useCallback((value: string) => {
    onMonthYearChange({ month, year: Number(value) });
  }, [month, onMonthYearChange]);

  return (
    <div className="filter-bar period-filter" role="group" aria-label="Bộ lọc thời gian">
      {/* Mode switch — the shared boxed segmented group */}
      <Tabs
        variant="boxed"
        tabs={MODE_TABS}
        value={mode}
        onChange={(id) => onModeChange(id as PeriodMode)}
        ariaLabel="Chế độ lọc"
      />

      {mode === 'month' ? (
        <>
          <UuiSelectField
            id="period-month-select"
            label="Chọn tháng"
            value={String(month)}
            onChange={(e) => handleMonth(e.target.value)}
            options={MONTH_LABELS.map((label, i) => ({
              value: String(i + 1),
              label,
            }))}
            hideLabel
            inline
          />
          <UuiSelectField
            id="period-year-select"
            label="Chọn năm"
            value={String(year)}
            onChange={(e) => handleYear(e.target.value)}
            options={yearOptions.map(y => ({
              value: String(y),
              label: String(y),
            }))}
            hideLabel
            inline
          />
        </>
      ) : (
        // The shared from/to group: two independent fields, cross-clamped by
        // each other's min/max, in ONE control group (CHIEF 2026-09-27:
        // "choose from and to separately instead of one long control").
        <DateRangeFields
          id="period-range"
          ariaLabel="Khoảng ngày"
          from={dateFrom}
          to={dateTo}
          onChange={({ from, to }) => onRangeChange({ dateFrom: from, dateTo: to })}
        />
      )}

      <button
        type="button"
        className="d-btn d-btn-primary d-btn-sm"
        onClick={onApply}
        disabled={isApplyDisabled}
      >
        {isApplying && <span className="d-loading d-loading-spinner d-loading-xs" aria-hidden="true" />}
        {isApplying ? 'Đang lọc…' : 'Lọc dữ liệu'}
      </button>
    </div>
  );
}

/**
 * Resolve the active mode + inputs into a single { dateFrom, dateTo } range
 * the parent can pass into the API hook. Kept here so both detail pages share
 * one source of truth for "first/last day of month" math.
 */
export function resolvePeriodRange(opts: {
  mode: PeriodMode;
  month: number;
  year: number;
  dateFrom: string;
  dateTo: string;
}): PeriodRange {
  if (opts.mode === 'range') {
    return { dateFrom: opts.dateFrom, dateTo: opts.dateTo };
  }
  return monthToRange(opts.year, opts.month);
}

/** [first day, last day] of the given (year, month 1–12), as ISO yyyy-mm-dd. */
export function monthToRange(year: number, month: number): PeriodRange {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0); // day 0 of next month = last day
  const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { dateFrom: toIso(firstDay), dateTo: toIso(lastDay) };
}

/**
 * Handle a mode switch so the two modes stay in sync:
 *   - Switching TO range: seed the date inputs from the current month/year so
 *     the user starts from a sensible range rather than whatever stale custom
 *     range was last entered.
 *   - Switching TO month: nothing to re-derive (month mode reads month/year).
 */
export function applyModeSwitch(
  prev: { mode: PeriodMode; month: number; year: number; dateFrom: string; dateTo: string },
  nextMode: PeriodMode,
): { mode: PeriodMode; month: number; year: number; dateFrom: string; dateTo: string } {
  if (nextMode === prev.mode) return prev;
  if (nextMode === 'range') {
    const seeded = monthToRange(prev.year, prev.month);
    return { ...prev, mode: 'range', dateFrom: seeded.dateFrom, dateTo: seeded.dateTo };
  }
  return { ...prev, mode: 'month' };
}

/** Default initial state for a detail page's period filter (current month). */
export function initialPeriodState() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1–12
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    mode: 'month' as PeriodMode,
    month,
    year,
    dateFrom: toIso(firstDay),
    dateTo: toIso(lastDay),
  };
}
