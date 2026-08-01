// Current-period resolution in the business's timezone (Asia/Ho_Chi_Minh).
//
// The agent must default "tháng này / quý này / nay" to the REAL current period,
// not a model guess. Two earlier failure modes this exists to prevent:
//   1. The LLM had no date signal and invented `year: 2025` → reports queried a
//      non-existent period and legitimately returned zeros.
//   2. Bare `new Date()` reads the server's local TZ (often UTC in containers),
//      which rolls the wall-clock back a day late at night and picks the wrong
//      month. We read the parts out of Intl in Asia/Ho_Chi_Minh instead, so the
//      period is correct regardless of the server TZ.

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

/** Current Vietnam {month, year}. */
export function currentVnPeriod(): { month: number; year: number } {
  const { month, year } = vnParts();
  return { month, year };
}

/**
 * Current Vietnam {month, year, day}. Used when a report needs to annotate
 * month-to-date scope (the current month is always partial until it ends) so a
 * director doesn't read a mid-month P&L as a full-month result.
 */
export function currentVnDay(): { month: number; year: number; day: number } {
  const { month, year, day } = vnParts();
  return { month, year, day };
}

/** Today's date as YYYY-MM-DD in Vietnam — injected into the system prompt. */
export function todayIsoVn(): string {
  const { year, month, day } = vnParts();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Resolve the period a tool should query. When the LLM omits month/year (e.g. it
 * only said "tháng này"), fall back to the current Vietnam period. A supplied
 * month/year is honored as-is so explicit historical queries ("tháng 5/2025")
 * still work — the prompt (today's date) is what stops the model guessing.
 */
export function resolvePeriod(
  month: number | undefined,
  year: number | undefined,
): { month: number; year: number } {
  const now = currentVnPeriod();
  return { month: month ?? now.month, year: year ?? now.year };
}
