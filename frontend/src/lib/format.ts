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
 * Compact date-time for table cells, TIME FIRST on a 24h clock:
 * "HH:mm d/M/yy" e.g. "17:30 19/8/26" (combined date+time display contract,
 * frontend/docs/design-system.md). Pinned to Vietnam wall-clock
 * (Asia/Ho_Chi_Minh) on ANY host, and built from formatToParts so the
 * time-first order is explicit — toLocaleString order varies by engine
 * (Node renders vi-VN time-first; Chrome renders date-first), which a hard
 * format requirement cannot depend on. Invalid input renders as "—" (the raw
 * string is never echoed back).
 */
export function formatDateTimeShort(value: string | null | undefined): string {
  if (!value) return '—';
  // Naive draft values ("YYYY-MM-DDTHH:mm" — the editor draft wire shape,
  // Vietnam wall-clock by convention: localDateTimeToIso appends +07:00 when
  // persisting) must not ride the host timezone: a GMT+8 host parses them as
  // local and shows 13:30 as 12:30. Render by string surgery, same compact
  // shape — host-independent like the instant path below.
  if (!/[Zz]$|[+-]\d{2}:\d{2}$/.test(value)) {
    const draft = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
    if (draft) return `${draft[4]}:${draft[5]} ${Number(draft[3])}/${Number(draft[2])}/${draft[1].slice(2)}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    day: 'numeric',
    month: 'numeric',
    year: '2-digit',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  // Number() strips the engine's leading zeros ("08" → 8) so the compact
  // d/M/yy shape is deterministic across Node and browsers.
  return `${get('hour')}:${get('minute')} ${Number(get('day'))}/${Number(get('month'))}/${get('year')}`;
}

/**
 * Card-compact VN-pinned time: "HH:mm - dd/MM" (no year — journey-card
 * density). Same Asia/Ho_Chi_Minh pin as formatDateTimeShort so the board
 * card and the trip detail can never disagree on the same event timestamp,
 * whatever timezone the driver's device runs.
 */
export function formatCardTimeShort(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    day: '2-digit',
    month: '2-digit',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('hour')}:${get('minute')} - ${get('day')}/${get('month')}`;
}

/**
 * Zero-padded dd/mm/yyyy. For date-only strings ("YYYY-MM-DD"), reads
 * directly — immune to timezone shifts. For full ISO instants (…Z or
 * ±hh:mm), converts to the Vietnam business timezone first so a UTC
 * midnight-adjacent instant maps to the correct local date (KP-032).
 */
export function formatISODate(iso: string | null | undefined): string {
  if (!iso) return '—';
  // Instant with timezone suffix — convert via Intl to Vietnam date.
  if (/[Zz]$|[+-]\d{2}:\d{2}$/.test(iso)) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('day')}/${get('month')}/${get('year')}`;
  }
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

/** Calendar-day arithmetic anchored to Vietnam, independent of device timezone/DST. */
export function businessDateOffsetISO(offsetDays: number, value: Date = new Date()): string {
  const day = new Date(`${businessDateISO(value)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + offsetDays);
  return day.toISOString().slice(0, 10);
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

/**
 * Combined date + time display contract (2026-09-09, hard requirement):
 * whenever a date and a time show together, the time comes FIRST and the
 * clock is 24-hour — `HH:mm DD/MM/YYYY` (e.g. "14:30 20/08/2026"). Native
 * datetime-local inputs render per browser locale (12h AM/PM on en-US) and
 * cannot be forced, so inputs and cells both format through these helpers.
 * See frontend/docs/design-system.md.
 */

/** Placeholder for every 24h datetime text input. */
export const DATE_TIME_24_PLACEHOLDER = 'HH:mm DD/MM/YYYY';

/**
 * Formats a local datetime value ('YYYY-MM-DDTHH:mm', seconds tolerated) as
 * the canonical time-first 24h text. Returns '' for empty or malformed input.
 */
export function formatDateTime24(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value ?? '');
  if (!match) return '';
  const [, year, month, day, hour, minute] = match;
  return `${hour}:${minute} ${day}/${month}/${year}`;
}

/**
 * Parses an `HH:mm DD/MM/YYYY` entry (24h, time first; single-digit
 * hour/day/month tolerated) into a 'YYYY-MM-DDTHH:mm' local datetime string.
 * Returns null for anything incomplete, out of range (month 1-12, hour 0-23,
 * minute 0-59) or not a real calendar day.
 */
export function parseDateTime24(text: string): string | null {
  const match = /^(\d{1,2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const [, rawHour, rawMinute, rawDay, rawMonth, year] = match;
  const day = Number(rawDay);
  const month = Number(rawMonth);
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return null;
  // Reject rollover dates ("10:00 31/02/2026") by round-tripping through UTC.
  const probe = new Date(Date.UTC(Number(year), month - 1, day));
  if (probe.getUTCFullYear() !== Number(year) || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${year}-${rawMonth.padStart(2, '0')}-${rawDay.padStart(2, '0')}T${rawHour.padStart(2, '0')}:${rawMinute}`;
}
