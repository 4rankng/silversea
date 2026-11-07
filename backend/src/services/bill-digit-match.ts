/**
 * Bill/Booking digit-lookup LAW, pure (SIL-735).
 *
 * The "Thêm cược" lookup asks for FOUR DIGITS and must find the lot whether
 * the accountant read those digits off the Số Bill or off the Số Booking.
 * The law lives here, db-free, so the unit tree can exercise it directly —
 * no db, no app boot (BE unit-only ruling 2026-10-19). The db-bound lookup
 * (`bill-book-search.service.ts`) builds its SQL needle through
 * `billDigitsNeedle`, so the query and this law cannot drift apart.
 */
import { ApiError } from '../errors';

/** The last-four-digits match is the customer's lookup habit; shorter input is
 *  ambiguous (every "0" ending bill would qualify) and is rejected loudly. */
export const BILL_DIGITS = 4;

/**
 * The lookup takes EXACTLY four digits — the habit read off the printed
 * Bill/Booking. Anything shorter or non-numeric is refused loudly instead of
 * silently scanning the whole table.
 */
export function parseBillDigits(input: string): string {
  const digits = input.trim();
  if (!/^\d{4}$/.test(digits)) {
    throw new ApiError(400, `Nhập đúng ${BILL_DIGITS} số cuối của số Bill/Booking.`);
  }
  return digits;
}

/**
 * The SQL needle: the four digits matched as a SUBSTRING of the reference's
 * digit run (letters and separators dropped first — `FB020-R21-RB1` →
 * `020211`, `RARBOOK-1792226038601-9bzut2` → `179222603860192`).
 *
 * SIL-735: a substring, not the run's tail. The accountant reads the four
 * digits they see on the printed number — the Bill's `…0044` or the
 * Booking's `…8601` — while the run may continue past them (a `-1` sequence
 * suffix, or the digits of a letter suffix). The tail-only rule answered
 * "which run ENDS with these digits" and therefore missed the Booking side
 * whenever the printed number carried a suffix; the substring rule answers
 * "which number CONTAINS these digits" and lands both fields.
 *
 * The needle is built from validated digits only (see `parseBillDigits`), so
 * it can never carry a SQL wildcard.
 */
export function billDigitsNeedle(digits: string): string {
  return `%${digits}%`;
}
