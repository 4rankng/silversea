/**
 * SIL-664 — parse the `?date` query of GET /driver/me/two-orders.
 *
 * Absent, null, or empty → undefined (the service keeps its historical
 * default: today). Anything else must be a strict YYYY-MM-DD calendar date:
 * the two-orders view is date-keyed, so a malformed value is a client error
 * (HTTP 400), never a silent fallback to today.
 *
 * Kept import-free on purpose so driver-app unit tests can pin the endpoint
 * wiring without opening a DB/HTTP handle (backend tests are unit-only).
 */

/** Thrown for a non-empty `?date` that is not a valid YYYY-MM-DD calendar date. */
export class DriverTwoOrdersDateParamError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'DriverTwoOrdersDateParamError';
  }
}

const DATE_PARAM_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDriverTwoOrdersDateParam(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string') {
    throw new DriverTwoOrdersDateParamError('Tham số date phải có định dạng YYYY-MM-DD.');
  }
  const match = DATE_PARAM_PATTERN.exec(raw);
  if (!match) {
    throw new DriverTwoOrdersDateParamError('Tham số date phải có định dạng YYYY-MM-DD.');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  const isRealCalendarDay = asUtc.getUTCFullYear() === year
    && asUtc.getUTCMonth() === month - 1
    && asUtc.getUTCDate() === day;
  if (!isRealCalendarDay) {
    throw new DriverTwoOrdersDateParamError('Tham số date phải là ngày hợp lệ (YYYY-MM-DD).');
  }
  return raw;
}
