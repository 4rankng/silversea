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
import { TripPodFileType, missingPodFileTypes, requiredPodFileTypes } from '@tingting/shared';
import type { DriverTaskPodSubmission } from '../api/driverClient';

// SIL-918 (KB §3.5.2/§3.6.1): the required set is MODE-AWARE — the law now
// lives in the shared package so the driver's screen and the "Nợ chứng từ"
// screen (SIL-1107) cannot disagree about what a lot owes.
export { requiredPodFileTypes };

export function podRequiredFilesReady(submission: DriverTaskPodSubmission | null, cargoMode?: string | null) {
  const missing = missingRequiredPodFileTypes(submission, cargoMode);
  return {
    hasYardReceipt: !missing.includes(TripPodFileType.YARD_OR_DROP_RECEIPT),
    hasSignedNote: !missing.includes(TripPodFileType.SIGNED_DELIVERY_NOTE),
    podReady: missing.length === 0,
  };
}

export function missingRequiredPodFileTypes(submission: DriverTaskPodSubmission | null, cargoMode?: string | null): TripPodFileType[] {
  // The API's verdict leads when the wire carries it — the server computes
  // the same shared mode-aware required set (KB §3.5.2), and the driver's
  // footers must read its answer rather than a client-side recomputation
  // that could disagree with it. Without the field (older wire, plain test
  // fixtures) the client recomputes from the mode's required set.
  const wireMissing = submission?.missingRequiredFileTypes;
  if (wireMissing != null) return wireMissing;
  return missingPodFileTypes((submission?.files ?? []).map((f) => f.fileType), cargoMode);
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
