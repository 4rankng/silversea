// Pod readiness — the shared e-POD photo facts for the trip detail footer
// and the e-POD screen. Law map after SIL-697's RE-OPEN (owner 07:42 27/11):
//   • The Frank 06/11 rule stands and the KB records it BẮT BUỘC (Ch.4
//     §4.2.4/§4.2.6, Ch.10 §10.4.3): at the completion layer the evidence
//     set is REQUIRED — the submit and the completion are blocked BEFORE
//     any write when a required type is missing, and the message names what
//     is missing. This supersedes the 09/11 "resolved: optional" note and
//     SIL-733's "0 ảnh vẫn hoàn thành chuyến" (22/10).
//   • The set is MODE-AWARE (SIL-1110, K3.65 — see below): hàng lẻ owes the
//     biên bản alone, FCL owes both groups.
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
  // that could disagree with it. SIL-1110 (K3.65): the verdict is read
  // against the lot's OWN set — a verdict computed over another mode's set
  // (e.g. "phiếu bãi" missing on a hàng-lẻ lot from a pre-K3.65 server) must
  // never make the foot demand a document the lot does not owe. Out-of-set
  // entries are dropped; without the field (older wire, plain test fixtures)
  // the client recomputes from the mode's required set.
  const required = requiredPodFileTypes(cargoMode);
  const wireMissing = submission?.missingRequiredFileTypes;
  if (wireMissing != null) {
    const missing: TripPodFileType[] = [];
    for (const type of required) {
      if (wireMissing.includes(type)) missing.push(type);
    }
    return missing;
  }
  const presentTypes: string[] = [];
  for (const file of submission?.files ?? []) presentTypes.push(file.fileType);
  return missingPodFileTypes(presentTypes, cargoMode);
}

/** The blocking message when the completion action or submit would go out
 *  without the mode's evidence types. Null when all of them are present.
 *  SIL-697 RE-OPEN (owner 07:42 27/11): e-POD files are BẮT BUỘC at the
 *  completion layer — the callers BLOCK on this message (no submit, no
 *  complete) and name what is missing. */
export function missingPodFilesMessage(submission: DriverTaskPodSubmission | null, cargoMode?: string | null): string | null {
  const missing = missingRequiredPodFileTypes(submission, cargoMode);
  if (missing.length === 0) return null;
  return `Thiếu ${missing.length} file e-POD — cần bổ sung đủ trước khi nộp và hoàn thành chuyến.`;
}
