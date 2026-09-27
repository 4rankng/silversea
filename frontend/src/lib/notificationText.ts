/**
 * Notification copy helpers.
 *
 * Design law §8: internal, id-derived codes must never render — only business
 * references (số Bill/Booking, biển số). The notification payload carries a
 * pre-composed `message` plus the internal `relatedEntityId` and no business
 * reference, so a message the backend built around a trip code
 * (`Chuyến TRP-202609-0001 đã được điều xe`) is displayed with that internal
 * token stripped rather than inventing a reference the payload never carried.
 * Free space left behind is collapsed.
 *
 * Shared by the bell dropdown and the /notifications page so the two surfaces
 * that render the same payload can never disagree.
 */
const INTERNAL_TRIP_CODE = /\s*TRP-\d{6}-\d+\s*/g;

export function notificationDisplayMessage(message: string): string {
  return message.replace(INTERNAL_TRIP_CODE, ' ').replace(/\s{2,}/g, ' ').trim();
}
