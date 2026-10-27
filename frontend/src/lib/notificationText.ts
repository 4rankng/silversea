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
 * The strip covers EVERY internal code shape (canonical TRP-YYYYMM-NNNN, the
 * seeded TRP-YYYY-MM-NNNN, legacy TRP-/TRIP-/CN-/BULK-TR- rows, SHP- shipment
 * codes) — see lib/internalCode.ts, the shared owner. A driver-targeted
 * notification is a driver-facing surface under the PRD ruling (card
 * 261022201006c): the raw code must not reach the bell dropdown or
 * /notifications either.
 *
 * Shared by the bell dropdown and the /notifications page so the two surfaces
 * that render the same payload can never disagree.
 */
import { stripInternalCodes } from './internalCode';

export function notificationDisplayMessage(message: string): string {
  // A message that IS its code ("TRP-202609-0001") leaves nothing to say —
  // the caller renders an empty string rather than a code-shaped remnant.
  return stripInternalCodes(message) ?? '';
}
