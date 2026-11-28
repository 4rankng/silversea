/**
 * One display decision for business-key text (cards _38/_39/_44): the
 * business key when it exists, a dash when it does not — internal ids are
 * never fabricated into user-visible strings. Titles, notification bodies
 * and export descriptions all route through here.
 */
export function businessTitleOrDash(code: string | null | undefined): string {
  return code != null && code.trim() !== '' ? code : '—';
}

/** Bill/Booking is the transport display key; never substitute a database code. */
export function billBookingTitle(bill: string | null | undefined, booking?: string | null): string {
  return bill?.trim() || booking?.trim() || 'Chưa có số Bill/Booking';
}

/**
 * A trip-lifecycle notification body: the Bill/Booking reference the trip
 * carries when it has one, the vehicle's biển số next (SIL-1296 — the second
 * business reference; display law §8 allows bill/booking and biển số, never
 * the internal TRP-* code), the bare sentence otherwise. The internal code
 * never rides the body — the display layer (frontend stripInternalCodes)
 * removes system codes, so a body built around the code rendered
 * context-free ("Chuyến đã bị hủy") and the reader lost the one reference
 * that names the work. A trip with neither reference says less instead of
 * printing a placeholder: internal ids are never fabricated into
 * user-visible strings.
 */
export function tripEventNotificationMessage(
  verb: string,
  customerReference: string | null | undefined,
  plate?: string | null,
): string {
  const reference = customerReference?.trim();
  if (reference) return `Chuyến ${reference} ${verb}`;
  const vehicle = plate?.trim();
  return vehicle ? `Chuyến của xe ${vehicle} ${verb}` : `Chuyến ${verb}`;
}
