/**
 * Demo billing formatters (SIL-160). Whole-VND money per house rule —
 * fixtures are integers, so sums are exact integer arithmetic and never
 * need float rounding. Grouping follows vi-VN ("4.800.000").
 */

/** 'YYYY-MM' period key of a 'YYYY-MM-DD' working date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** '24/10/2026' from '2026-10-24' — complete date, unambiguous in CSV. */
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

/** Whole-VND grouping, vi-VN style: 4800000 → '4.800.000'. */
export function formatVnd(amount: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(amount);
}

/** '2026-10' → 'Tháng 10/2026' for board headings and CSV-free contexts. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `Tháng ${Number(m)}/${y}`;
}
