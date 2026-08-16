import { useCallback, useMemo } from 'react';

/**
 * Period filter for the AR/AP detail ledger tab. Two modes:
 *   - "month": pick a month (T1–T12) and year; resolves to [first day, last day].
 *   - "range": two <input type="date"> (Từ ngày / Đến ngày).
 *
 * Both modes emit a { dateFrom, dateTo } range via `onChange` so the parent can
 * feed it directly into `useCustomerStatement(id, range)` /
 * `useSupplierStatement(id, range)`.
 *
 * Uses daisyUI's `d-` prefixed classes (per tokens.css daisyUI config) so it
 * cannot collide with the project's existing `.btn`/`.input` BEM classes.
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

  const handleMonth = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    onMonthYearChange({ month: Number(e.target.value), year });
  }, [year, onMonthYearChange]);

  const handleYear = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    onMonthYearChange({ month, year: Number(e.target.value) });
  }, [month, onMonthYearChange]);

  return (
    <div
      className="period-filter border-y border-base-300 py-4"
      role="group"
      aria-label="Bộ lọc thời gian"
    >
      <fieldset className="d-fieldset">
        <legend className="d-fieldset-legend text-xs">Kỳ xem sổ</legend>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          {/* Mode switch — two segmented buttons inside a join */}
          <div className="d-join d-join-vertical w-full shrink-0 lg:w-auto lg:d-join-horizontal" role="tablist" aria-label="Chế độ lọc">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'month'}
              className={`d-btn d-btn-sm d-join-item w-full lg:w-auto ${mode === 'month' ? 'd-btn-primary' : 'd-btn-outline'}`}
              onClick={() => onModeChange('month')}
            >
              Theo tháng
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'range'}
              className={`d-btn d-btn-sm d-join-item w-full lg:w-auto ${mode === 'range' ? 'd-btn-primary' : 'd-btn-outline'}`}
              onClick={() => onModeChange('range')}
            >
              Theo khoảng
            </button>
          </div>

          {mode === 'month' ? (
            <div className="d-join d-join-vertical w-full shrink-0 lg:w-auto lg:d-join-horizontal">
              <select
                className="d-select d-select-sm d-join-item w-full lg:w-auto"
                value={month}
                onChange={handleMonth}
                aria-label="Chọn tháng"
              >
                {MONTH_LABELS.map((label, i) => (
                  <option key={i + 1} value={i + 1}>{label}</option>
                ))}
              </select>
              <select
                className="d-select d-select-sm d-join-item w-full lg:w-auto"
                value={year}
                onChange={handleYear}
                aria-label="Chọn năm"
              >
                {yearOptions.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
              <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
                <span className="text-base-content">Từ ngày</span>
                <input
                  type="date"
                  className="d-input d-input-sm w-full"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={e => onRangeChange({ dateFrom: e.target.value })}
                />
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
                <span className="text-base-content">Đến ngày</span>
                <input
                  type="date"
                  className="d-input d-input-sm w-full"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={e => onRangeChange({ dateTo: e.target.value })}
                />
              </label>
            </div>
          )}
          <button
            type="button"
            className="d-btn d-btn-primary d-btn-sm w-full shrink-0 lg:w-auto"
            onClick={onApply}
            disabled={isApplyDisabled}
          >
            {isApplying && <span className="d-loading d-loading-spinner d-loading-xs" aria-hidden="true" />}
            {isApplying ? 'Đang lọc…' : 'Lọc dữ liệu'}
          </button>
        </div>
      </fieldset>
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
