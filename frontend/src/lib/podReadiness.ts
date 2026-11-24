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
// SIL-918 (KB §3.5.2/§3.6.1, audit 24/11): the required set is MODE-AWARE —
// hàng lẻ has no container, so the FCL "Phiếu bãi / phiếu hạ" (phiếu hạ
// container) slot does not apply; the LCL evidence set is the biên bản
// giao nhận alone ("dùng bộ chứng từ riêng thay cho phiếu hạ container").
import { TRIP_POD_REQUIRED_FILE_TYPES, TripPodFileType } from '@tingting/shared';
import type { DriverTaskPodSubmission } from '../api/driverClient';

/** The e-POD types this trip's mode must carry. FCL (and an unknown mode —
 *  legacy payloads): both types. LCL: the signed delivery note only. */
export function requiredPodFileTypes(cargoMode?: string | null): TripPodFileType[] {
  return cargoMode === 'LCL'
    ? TRIP_POD_REQUIRED_FILE_TYPES.filter((type) => type !== TripPodFileType.YARD_OR_DROP_RECEIPT)
    : [...TRIP_POD_REQUIRED_FILE_TYPES];
}

export function podRequiredFilesReady(submission: DriverTaskPodSubmission | null, cargoMode?: string | null) {
  const missing = missingRequiredPodFileTypes(submission, cargoMode);
  return {
    hasYardReceipt: !missing.includes(TripPodFileType.YARD_OR_DROP_RECEIPT),
    hasSignedNote: !missing.includes(TripPodFileType.SIGNED_DELIVERY_NOTE),
    podReady: missing.length === 0,
  };
}

export function missingRequiredPodFileTypes(submission: DriverTaskPodSubmission | null, cargoMode?: string | null): TripPodFileType[] {
  const present = new Set((submission?.files ?? []).map((f) => f.fileType));
  return requiredPodFileTypes(cargoMode).filter((type) => !present.has(type));
}

/** The soft pre-send warning when the completion action or submit would go
 *  out without the mode's evidence types. Null when all of them are
 *  present. SIL-697 resolved 09/11: e-POD files are OPTIONAL — this warns,
 *  it never blocks. */
export function missingPodFilesMessage(submission: DriverTaskPodSubmission | null, cargoMode?: string | null): string | null {
  const missing = missingRequiredPodFileTypes(submission, cargoMode);
  if (missing.length === 0) return null;
  return `Thiếu ${missing.length} file e-POD — nên bổ sung.`;
}
