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
 *
 * A second law rides the same pass (SIL-1205): an unsubstituted template
 * placeholder ("(name)") must never render either — the notification body
 * has to read as a sentence, not as a template key.
 */
import { stripInternalCodes } from './internalCode';

/**
 * An unsubstituted template placeholder — a parenthesised identifier the
 * composer forgot to fill ("(name)", "(tripCode)"). SIL-1205: the port-change
 * notification shipped the raw column key this way and the lái xe read a
 * template key instead of the change. The source is fixed; this pass keeps a
 * row ALREADY stored with the placeholder readable instead of leaking the key.
 *
 * Shape: one ASCII identifier, no space, with a lowercase letter. Business
 * copy keeps its parentheses when it carries a space ("(đã quá hạn)"), a
 * diacritic ("(tấn)") or an acronym ("(USD)").
 */
const TEMPLATE_PLACEHOLDER = /\(([A-Za-z][A-Za-z0-9_]*)\)/g;

/** Remove every unsubstituted template placeholder and the empty parentheses
 *  the removal leaves behind. */
function stripTemplatePlaceholders(text: string): string {
  return text
    .replace(TEMPLATE_PLACEHOLDER, (whole, token: string) => (
      token.length >= 3 && /[a-z]/.test(token) ? '' : whole
    ))
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

export function notificationDisplayMessage(message: string): string {
  // A message that IS its code ("TRP-202609-0001") leaves nothing to say —
  // the caller renders an empty string rather than a code-shaped remnant.
  // The same pass drops an unsubstituted template placeholder ("(name)").
  return stripTemplatePlaceholders(stripInternalCodes(message) ?? '');
}
