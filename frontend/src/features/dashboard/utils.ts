import { formatCompact } from '../../lib/format';

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
  const s = formatCompact(v);
  if (s.endsWith('k')) return { num: s.slice(0, -1), suffix: 'k' };
  const i = s.lastIndexOf(' ');
  if (i === -1) return { num: s, suffix: '' };
  return { num: s.slice(0, i), suffix: s.slice(i + 1) };
}

export function fmtMoM(current: number, previous: number | undefined | null): string {
  if (previous == null) return '—';
  if (previous === 0) return current > 0 ? 'Mới' : '0%';
  const pct = ((current - previous) / previous) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

export interface PieSlice {
  label: string;
  value: number;
  color: string;
  pct: number;
}

export function buildPieSlices(
  slices: Array<{ label: string; value: number; color: string }>,
): { slicesWithPct: PieSlice[]; conicGradient: string; totalPie: number } {
  const visibleSlices = slices.filter(sl => sl.value > 0.5);
  const totalPie = visibleSlices.reduce((s, sl) => s + sl.value, 0) || 1;
  const p = (v: number) => Math.round((v / totalPie) * 100);
  let usedPct = 0;
  const slicesWithPct = visibleSlices.map((sl, i) => {
    const pct = i === visibleSlices.length - 1 ? Math.max(0, 100 - usedPct) : p(sl.value);
    usedPct += pct;
    return { ...sl, pct };
  });
  let cumPct = 0;
  const gradientStops = slicesWithPct.map(sl => {
    const start = cumPct;
    cumPct += sl.pct;
    return `${sl.color} ${start}% ${cumPct}%`;
  });
  const conicGradient = `conic-gradient(${gradientStops.join(', ')})`;
  return { slicesWithPct, conicGradient, totalPie };
}
