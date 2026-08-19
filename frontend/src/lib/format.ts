export function formatNumber(n: number | string | null): string {
  if (n == null) return '—';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(num)) return '—';
  return num.toLocaleString('vi-VN');
}

export function formatCompact(n: number | string | null): string {
  if (n == null) return '—';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(num)) return '—';
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + ' tỷ';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + ' tr';
  if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return num.toLocaleString('vi-VN');
}

export function formatCurrency(n: number | string | null): string {
  if (n == null) return '— ₫';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(num)) return '— ₫';
  return `${num.toLocaleString('vi-VN')} ₫`;
}

/**
 * Split a VND amount into a big numeric part and a smaller unit/suffix part,
 * so the unit ("₫", or "tr ₫" / "tỷ ₫" / "k ₫" when compact) can be rendered
 * at subtitle size next to the digits.
 *
 * - `compact: false` → full number, e.g. { num: "12.500.000", unit: "₫" }
 * - `compact: true`  → short number, e.g. { num: "12,5", unit: "tr ₫" }
 *
 * `format` is a live formatter matching the chosen scale, for counter
 * animations that write only the numeric part (unit stays static).
 */
export interface MoneyParts {
  num: string;
  unit: string;
  format: (v: number) => string;
}

export function moneyParts(amount: number, compact: boolean): MoneyParts {
  const abs = Math.abs(amount);
  if (compact && abs >= 1_000) {
    const scale = abs >= 1_000_000_000 ? 1_000_000_000 : abs >= 1_000_000 ? 1_000_000 : 1_000;
    const suffix = scale === 1_000_000_000 ? 'tỷ' : scale === 1_000_000 ? 'tr' : 'k';
    const fmt = (v: number) => (v / scale).toFixed(1).replace(/\.0$/, '');
    return { num: fmt(amount), unit: `${suffix} ₫`, format: fmt };
  }
  const fmt = (v: number) => Math.round(v).toLocaleString('vi-VN');
  return { num: fmt(amount), unit: '₫', format: fmt };
}

export function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

/**
 * Compact date-time for table cells: short date + short time, e.g. "19/8/26, 22:51".
 * Unlike formatDateTimeVN, the timezone is NOT pinned — call sites historically
 * render in the host's local zone. Invalid input renders as "—" (the raw string
 * is never echoed back).
 */
export function formatDateTimeShort(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Zero-padded dd/mm/yyyy read straight off the ISO string, no Date parsing —
 * immune to timezone shifts and valid for date-only columns ("19/08/2026").
 * Use where the source is a calendar date, not a wall-clock timestamp.
 */
export function formatISODate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [year, month, day] = iso.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : iso;
}

/**
 * Vietnamese-formatted amount with no currency symbol and no decimals — for
 * cells that render the "₫" unit in a separate element. Companion to
 * formatCurrency which always appends " ₫".
 */
export function formatMoney(n: number | string | null): string {
  if (n == null) return '—';
  const num = typeof n === 'string' ? Number(n) : n;
  if (!Number.isFinite(num)) return '—';
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(num);
}

/** Calendar date in the platform's Vietnam business timezone for date inputs. */
export function businessDateISO(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * Format a timestamp as Vietnam wall-clock (Asia/Ho_Chi_Minh) on ANY host.
 * The locale argument alone ('vi-VN') only shapes numbers/dates — it does NOT
 * set the timezone, so toLocaleString would otherwise render in the runtime's
 * local zone (e.g. a GMT+8 machine shows device time +8h). GPS "last seen" and
 * other device timestamps must always read as Vietnam time, so set timeZone
 * explicitly here. Accepts ISO string | epoch | Date | null/empty.
 */
export function formatDateTimeVN(
  value: string | number | Date | null | undefined,
): string {
  if (value == null || value === '') return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}

export function removeDiacritics(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}
