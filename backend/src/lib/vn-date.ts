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
