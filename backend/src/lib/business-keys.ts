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
