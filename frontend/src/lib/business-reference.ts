/** Label naming the missing fact instead of substituting an internal code
 *  (QA-AUDIT-ID-02). */
const MISSING_BILL_BOOKING = 'Chưa có số Bill/Booking';

/**
 * The customer-facing shipment identity: the Bill (Số Bill) when present,
 * else the Booking reference, else the label naming the missing fact.
 *
 * Whitespace-only values count as missing and both inputs are trimmed, so a
 * `'  BL-001 '` arrives as `BL-001` (tripHelpers.test keeps this contract).
 * Callers pass `trip.customerReference`, `row.billOrBooking`, or the
 * `(blNumber, bookingRef)` pair a shipment row carries.
 */
export function billBookingReference(
  bill: string | null | undefined,
  booking?: string | null,
): string {
  return bill?.trim() || booking?.trim() || MISSING_BILL_BOOKING;
}
