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

/** SIL-483: the drawer's ghost appointment mask reads "DD/MM HH:mm" (SIL-613) — the
 *  year is context the lot already carries, so the cell drops it and the full
 *  "DD/MM/YYYY HH:mm" rides the title/aria text instead.
 *  SIL-595 (id 695): the callers feed BOTH shapes — naive drafts
 *  ("YYYY-MM-DDTHH:mm" — string surgery, host-independent) AND raw server
 *  instants (Z/±hh:mm — `Date.toISOString()`). A zone-suffixed value is a real
 *  instant and must render the Vietnam wall-clock: string-surgery on its UTC
 *  digits showed "07:30 30/10" for a 14:30 ICT appointment. */
export function formatTimeShortDate(value: string | null | undefined): string {
  const raw = value ?? '';
  // Zone suffix = a real instant (Z, +07:00 or the colon-less +0700 form).
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const parts = getVietnamParts(raw);
    if (!parts) return '';
    return `${pad(parts.day)}/${pad(parts.month)} ${pad(parts.hour)}:${pad(parts.minute)}`;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(raw);
  if (!match) return '';
  const [, , month, day, hour, minute] = match;
  return `${day}/${month} ${hour}:${minute}`;
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

/**
 * SIL-548 (id 615, QA fail round 3) — the per-lot CƯỚC THU KHÁCH editor's
 * group lock (spec 23/10 §4.1 point 3, owner law «lô đã ghép phải KHÓA
 * editor»): a lot inside ANY merge group — the CUS rev group (rev_group_id
 * «Ghép thu») or the ĐV cost group (cost_group_id «Ghép») — keeps the
 * GROUP's outputs, so the editor fields disable. ONE rule for every surface
 * that renders the editor (Chi tiết lô hàng in-cell editor + /shipments-debit
 * strip) so the lock can never diverge between them again.
 *
 * SIL-621 (id 725, owner 30/10): the tách-nhóm guidance TEXT is gone — a
 * locked lot disables its fields and shows no lecturing copy (the debit
 * strip's NHÓM GHÉP block and the server's refusal message still name the
 * step). The rev-group hint predates the ruling and only the debit strip
 * still renders it.
 */
export function revOutputGroupLock(row: {
  revGroupId?: string | null;
  costGroupId?: string | null;
}): { locked: boolean; hint: string | null } {
  if (row.revGroupId != null) {
    return {
      locked: true,
      hint: 'Lô đã thuộc nhóm ghép cước thu khách — tách nhóm (Hủy ghép) trước khi chọn loại xe riêng cho lô này.',
    };
  }
  if (row.costGroupId != null) {
    return { locked: true, hint: null };
  }
  return {
    locked: false,
    hint: 'CƯỚC VẬN TẢI (AUTO) của lô = 100% đơn giá của loại xe đã chọn.',
  };
}
