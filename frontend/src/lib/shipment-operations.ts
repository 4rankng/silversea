const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const VIETNAM_OFFSET_MINUTES = 7 * 60;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function getVietnamParts(value: string | Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const lookup = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const year = Number(lookup.year);
  const month = Number(lookup.month);
  const day = Number(lookup.day);
  const hour = Number(lookup.hour);
  const minute = Number(lookup.minute);
  if ([year, month, day, hour, minute].some((component) => !Number.isInteger(component))) {
    return null;
  }
  return { year, month, day, hour, minute };
}

export function formatVietnamDateInput(value: string | Date | null | undefined): string {
  if (value == null || value === '') return '';
  const parts = getVietnamParts(value);
  if (!parts) return '';
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function formatVietnamDateTimeInput(value: string | Date | null | undefined): string {
  if (value == null || value === '') return '';
  const parts = getVietnamParts(value);
  if (!parts) return '';
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function localDateTimeToIso(value: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) {
    throw new Error('Thời gian vận hành không hợp lệ.');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0) - VIETNAM_OFFSET_MINUTES * 60_000;
  const roundTrip = formatVietnamDateTimeInput(new Date(utcMs));
  if (roundTrip !== trimmed) {
    throw new Error('Thời gian vận hành không hợp lệ.');
  }
  return `${trimmed}:00+07:00`;
}
