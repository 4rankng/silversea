// Pod readiness — the shared e-POD photo facts for the trip detail footer
// and the e-POD screen. Law map after SIL-697's resolution (09/11):
//   • ALL paths are OPTIONAL (the newest binding decisions win: card
//     261022213755a, 22/10 — "0 ảnh vẫn hoàn thành chuyến" — plus the
//     shipped SIL-733 PASS). Nothing blocks completion, and nothing blocks
//     the e-POD submit.
//   • What remains of the 06/11 block ruling is its UTILITY half: the UI
//     still says WHICH files are missing — as a soft warning before the
//     driver sends ("Thiếu N file e-POD — nên bổ sung") and as the trip-
//     detail notice. The DRAFT→SUBMITTED freeze is harmless now because
//     completion never requires e-POD and files can ride any open state.
import { TRIP_POD_REQUIRED_FILE_TYPES, TripPodFileType } from '@tingting/shared';
import type { DriverTaskPodSubmission } from '../api/driverClient';

export function podRequiredFilesReady(submission: DriverTaskPodSubmission | null) {
  const missing = missingRequiredPodFileTypes(submission);
  return {
    hasYardReceipt: !missing.includes(TripPodFileType.YARD_OR_DROP_RECEIPT),
    hasSignedNote: !missing.includes(TripPodFileType.SIGNED_DELIVERY_NOTE),
    podReady: missing.length === 0,
  };
}

export function missingRequiredPodFileTypes(submission: DriverTaskPodSubmission | null): string[] {
  const present = new Set((submission?.files ?? []).map((f) => f.fileType));
  return TRIP_POD_REQUIRED_FILE_TYPES.filter((type) => !present.has(type));
}

/** The soft pre-send warning when the completion action or submit would go
 *  out without both evidence types. Null when both required file types are
 *  present. SIL-697 resolved 09/11: e-POD files are OPTIONAL — this warns,
 *  it never blocks. */
export function missingPodFilesMessage(submission: DriverTaskPodSubmission | null): string | null {
  const missing = missingRequiredPodFileTypes(submission);
  if (missing.length === 0) return null;
  return `Thiếu ${missing.length} file e-POD — nên bổ sung.`;
}
