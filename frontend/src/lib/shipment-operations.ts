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

/** SIL-483: the drawer's ghost appointment mask reads "HH:mm DD/MM" — the
 *  year is context the lot already carries, so the cell drops it and the full
 *  "HH:mm DD/MM/YYYY" rides the title/aria text instead. Pure formatter over
 *  the naive "YYYY-MM-DDTHH:mm" the popover drafts carry — no zone math, the
 *  same parse contract as the shared formatDateTime24. */
export function formatTimeShortDate(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value ?? '');
  if (!match) return '';
  const [, , month, day, hour, minute] = match;
  return `${hour}:${minute} ${day}/${month}`;
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
 * editor + hướng dẫn tách nhóm trước»): a lot inside ANY merge group — the
 * CUS rev group (rev_group_id «Ghép thu») or the ĐV cost group
 * (cost_group_id «Ghép») — keeps the GROUP's outputs, so the editor fields
 * disable with the tách-nhóm hint. ONE rule for every surface that renders
 * the editor (Chi tiết lô hàng in-cell editor + /shipments-debit strip) so
 * the lock can never diverge between them again.
 */
export function revOutputGroupLock(row: {
  revGroupId?: string | null;
  costGroupId?: string | null;
}): { locked: boolean; hint: string } {
  if (row.revGroupId != null) {
    return {
      locked: true,
      hint: 'Lô đã thuộc nhóm ghép cước thu khách — tách nhóm (Hủy ghép) trước khi chọn loại xe riêng cho lô này.',
    };
  }
  if (row.costGroupId != null) {
    return {
      locked: true,
      hint: 'Lô đã thuộc nhóm gộp xe (ghép cước trả ĐVVC) — tách nhóm (Hủy ghép) trước khi sửa cước thu khách riêng cho lô này.',
    };
  }
  return {
    locked: false,
    hint: 'CƯỚC VẬN TẢI (AUTO) của lô = 100% đơn giá của loại xe đã chọn.',
  };
}
