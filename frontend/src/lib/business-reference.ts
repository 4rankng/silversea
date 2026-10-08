/** Bill/Booking is the visible identity; system shipment/trip codes are never fallbacks. */
export function billBookingReference(
  bill: string | null | undefined,
  booking?: string | null,
): string {
  return bill?.trim() || booking?.trim() || 'Chưa có số Bill/Booking';
}
