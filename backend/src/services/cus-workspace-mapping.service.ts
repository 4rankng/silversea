/**
 * CUS workspace mapping helpers — money/date parsing, billing-line math,
 * and operational summary builders for the CUS shipment workspace readers.
 * Moved verbatim from cus-shipment-workspace-reads.service.ts, which
 * re-exports every symbol so consumer imports are unchanged.
 */
import { localDateInBusinessZone } from '@tingting/shared';
import type { BillingLineRow } from './cus-shipment-workspace-reads.service';

function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const next = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(next) ? next : 0;
}

function toMoneyString(value: number): string {
  return Math.round(value).toString();
}

function sumMoney(values: Array<string | number | null | undefined>): string {
  return toMoneyString(values.reduce<number>((sum, value) => sum + toNumber(value), 0));
}

// Sums numeric strings preserving `scale` decimal places. Returns null when no
// value is present, so callers can fall back to the shipment-level figure for
// historical rows that predate per-container cargo tracking.
function sumDecimal(values: Array<string | null | undefined>, scale: number): string | null {
  const present = values.filter((value): value is string => value != null && value !== '');
  if (present.length === 0) return null;
  const total = present.reduce<number>((sum, value) => sum + toNumber(value), 0);
  return total.toFixed(scale);
}

function businessDateNow(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function deriveTransportDateFromContainerAppointments(appointments: ReadonlyArray<Date | null>): string | null {
  let earliest: string | null = null;
  for (const appointment of appointments) {
    if (appointment == null) continue;
    const localDate = localDateInBusinessZone(appointment);
    if (localDate == null) continue;
    if (earliest == null || localDate < earliest) earliest = localDate;
  }
  return earliest;
}

function effectiveBillingLineAmount(line: BillingLineRow): number {
  if (line.excluded) return 0;
  if (line.grossAmount != null) return toNumber(line.grossAmount);
  return toNumber(line.amountOverride ?? line.baseAmount);
}

/**
 * Display number for the Chứng từ cell: IMPORT shows the Bill, EXPORT shows
 * the Booking. Falls back to the other when the primary is missing so the
 * cell never hides data that exists.
 */
function billOrBookNumberFor(
  tradeDirection: 'IMPORT' | 'EXPORT' | null,
  blNumber: string | null,
  bookingRef: string | null,
): string | null {
  const bill = trimOrNull(blNumber);
  const booking = trimOrNull(bookingRef);
  return tradeDirection === 'EXPORT' ? (booking ?? bill) : (bill ?? booking);
}

export function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * SIL-610 (id 713): legacy LCL lots (created before the SIL-587 "Ngày giờ
 * đóng trả" field) hold no schedule instant — only the date-level
 * expectedDeliveryDate — so their overview renders date-only (SIL-586 law:
 * never fabricate a 00:00). The one real time such a lot owns lives on its
 * own live trips: `plannedStartAt` is seeded from the lot's schedule in the
 * issue-order dialog, so it is the operational "giờ chạy" record. Derive the
 * display instant from it.
 *
 * Only an instant that falls ON the promised day (EDD in ICT) qualifies: the
 * rendered date then equals the delivery day the customer was promised — the
 * cell reads exactly like a SIL-587 lot ("HH:mm DD/MM/YYYY"). A trip that
 * ran on another day is NOT shown: its date would contradict the promised
 * day, and pairing its time-of-day with the EDD would invent a delivery
 * time. Those lots keep the honest date-only day.
 *
 * Display-only derivation: the caller surfaces this on the wire as
 * `derivedScheduleAt`; nothing is persisted and a stored
 * closingAt/plannedReturnAt always wins (the guard below returns null).
 *
 * @param trips the reader's live-trip rows (deletedAt null, status not
 *   CANCELED — the same filter the workspace delete guard reads).
 */
export function deriveLegacyScheduleInstant(
  cargoMode: 'FCL' | 'LCL' | null | undefined,
  expectedDeliveryDate: string | null,
  closingAt: Date | null,
  plannedReturnAt: Date | null,
  trips: ReadonlyArray<{ plannedStartAt: Date | null; plannedEndAt: Date | null }>,
): string | null {
  if (cargoMode !== 'LCL') return null;
  if (closingAt != null || plannedReturnAt != null) return null;
  if (expectedDeliveryDate == null) return null;
  const promisedDayInstants = trips
    .flatMap((trip) => [trip.plannedStartAt, trip.plannedEndAt])
    .filter((value): value is Date => value != null)
    .filter((value) => localDateInBusinessZone(value) === expectedDeliveryDate)
    .sort((left, right) => left.getTime() - right.getTime());
  return promisedDayInstants[0]?.toISOString() ?? null;
}

export {
  toNumber, toMoneyString, sumMoney, sumDecimal, businessDateNow,
  effectiveBillingLineAmount, billOrBookNumberFor,
};
