import { formatVietnamDateTimeInput } from '../../../lib/shipment-operations';
import { businessDateISO } from '../../../lib/format';

export function parseDateTimeParts(value: string | null | undefined): { date: string; time: string } {
  if (!value) return { date: '', time: '' };
  // Server values are instants (…Z / ±hh:mm) — prefill as Vietnam wall-clock,
  // never the browser zone. Naive drafts from this popover's own onChange
  // ("YYYY-MM-DDTHH:mm") round-trip verbatim.
  if (/[Zz]$|[+-]\d{2}:\d{2}$/.test(value)) {
    const input = formatVietnamDateTimeInput(value);
    return input ? { date: input.slice(0, 10), time: input.slice(11, 16) } : { date: '', time: '' };
  }
  const [d = '', t = ''] = value.split('T');
  return { date: d, time: t.slice(0, 5) };
}

export function getOffsetDateString(offsetDays: number): string {
  const day = new Date(`${businessDateISO()}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + offsetDays);
  return day.toISOString().slice(0, 10);
}
