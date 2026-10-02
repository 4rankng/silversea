import { round2dp } from '@tingting/shared';
import { formatNumber } from '../../lib/format';

export const CATEGORY_COLORS: Record<string, string> = {
  'Sửa chữa': '#8B5CF6',
  'Phụ tùng': '#F59E0B',
  'Vật tư': '#6366F1',
  'Bảo hiểm': '#06B6D4',
  'Đăng kiểm': '#10B981',
  'Phí đường bộ': '#EC4899',
};
export const FALLBACK_COLORS = ['#8B5CF6', '#F59E0B', '#06B6D4', '#10B981', '#EC4899', '#6366F1'];

export const styles = {
  thinBar: { height: 4 },
} as const;

export function splitKpi(v: number): { num: string; suffix: string } {
  // Financial KPIs must remain exact and readable. Do not abbreviate VND
  // amounts as k/tr/tỷ; mobile cards can reflow around the full number.
  return { num: formatNumber(v), suffix: '' };
}

export function fmtMoM(current: number | null, previous: number | undefined | null): string {
  if (current == null || previous == null) return '—';
  if (previous === 0) return current !== 0 ? 'Mới' : '0%';
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

export interface MonthlyChange {
  label: string;
  direction: 'up' | 'down' | 'flat';
}

export function monthlyChange(current: number | null, previous: number | undefined | null): MonthlyChange {
  return {
    label: fmtMoM(current, previous),
    direction: current == null || previous == null || current === previous ? 'flat' : current > previous ? 'up' : 'down',
  };
}

export function previousComparisonValues(report?: {
  totalRevenue?: number | null; totalCosts?: number | null; grossProfit?: number | null; netProfit?: number | null;
}) {
  return {
    prevRevenue: report?.totalRevenue ?? null,
    prevCosts: report?.totalCosts ?? null,
    prevGross: report?.grossProfit ?? null,
    prevNet: report?.netProfit ?? null,
  };
}

/**
 * The calendar month before `month`/`year`, with January rolling back to
 * December of the prior year. Month-over-month pills must compare against
 * this period — comparing against `(month, year - 1)` silently queries the
 * same month a year ago and renders every delta as "Mới" whenever that
 * month has no data.
 */
export function previousPeriodOf(month: number, year: number): { month: number; year: number } {
  return month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year };
}

export interface PieSlice {
  label: string;
  value: number;
  color: string;
  pct: number | null;
}

export function buildPieSlices(
  slices: Array<{ label: string; value: number; color: string }>,
): { slicesWithPct: PieSlice[]; conicGradient: string; totalPie: number } {
  const visibleSlices = slices.filter(slice => Number.isFinite(slice.value) && slice.value !== 0);
  const rawTotal = visibleSlices.reduce((sum, slice) => sum + slice.value, 0);
  const totalPie = round2dp(rawTotal);
  if (totalPie <= 0 || visibleSlices.some(slice => slice.value < 0)) {
    return { slicesWithPct: visibleSlices.map(slice => ({ ...slice, pct: null })), conicGradient: 'none', totalPie };
  }
  const shares = visibleSlices.map(slice => slice.value / rawTotal * 100);
  const percentages = shares.map(Math.floor);
  const remainder = 100 - percentages.reduce((sum, pct) => sum + pct, 0);
  const order = shares.map((share, index) => ({ index, fraction: share - percentages[index] }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let index = 0; index < remainder; index++) percentages[order[index].index]++;
  const slicesWithPct = visibleSlices.map((slice, index) => ({ ...slice, pct: percentages[index] }));
  let cumulative = 0;
  const gradientStops = slicesWithPct.map(slice => {
    const start = cumulative;
    cumulative += slice.pct;
    return `${slice.color} ${start}% ${cumulative}%`;
  });
  return { slicesWithPct, conicGradient: `conic-gradient(${gradientStops.join(', ')})`, totalPie };
}
