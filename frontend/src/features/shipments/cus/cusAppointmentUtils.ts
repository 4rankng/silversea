import { formatVietnamDateTimeInput } from '../../../lib/shipment-operations';

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
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
