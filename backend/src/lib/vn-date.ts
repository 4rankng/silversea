// Vietnam-timezone date helper (Asia/Ho_Chi_Minh).
//
// Bare `new Date()` reads the server's local TZ (often UTC in containers),
// which rolls the wall-clock back a day late at night and picks the wrong
// month. Read the parts out of Intl in Asia/Ho_Chi_Minh instead, so the
// result is correct regardless of the server TZ.

interface VnParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

function vnParts(now: Date = new Date(Date.now())): VnParts {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string): number => {
    const v = parts.find((p) => p.type === type)?.value;
    return v ? Number(v) : 0;
  };
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** Today's date as YYYY-MM-DD in Vietnam. */
export function todayIsoVn(now: Date = new Date()): string {
  const { year, month, day } = vnParts(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * The [start, end) window of one Vietnam calendar month, as absolute instants
 * (the +07:00 offset is baked into the parsed wall time). Defaults to the
 * current VN month when either part is omitted. SIL-1088 (K2.85 mức 3): the
 * fleet tracking lookup is month-scoped — "công việc đã kết thúc nhưng vẫn
 * tra cứu được" — so the window must cover the whole month, never just today,
 * and the caller's month/year must never be silently ignored.
 */
export function vnMonthWindow(month?: number, year?: number): {
  start: Date;
  end: Date;
  month: number;
  year: number;
} {
  const now = vnParts();
  const m = month ?? now.month;
  const y = year ?? now.year;
  if (!Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error('Tháng phải từ 1 đến 12.');
  }
  if (!Number.isInteger(y) || y < 2000 || y > 2100) {
    throw new Error('Năm phải trong khoảng 2000–2100.');
  }
  const start = new Date(`${y}-${String(m).padStart(2, '0')}-01T00:00:00+07:00`);
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  const end = new Date(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+07:00`);
  return { start, end, month: m, year: y };
}
