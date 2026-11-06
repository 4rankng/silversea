// Pod readiness — the shared e-POD photo facts for the trip detail footer
// and the e-POD screen. SIL-697 (owner decision Frank 06/11, board id 809)
// supersedes card 261022213755a for the submit/complete flow: both required
// file types must exist BEFORE the "Hoàn thành chuyến" action submits the
// draft — a missing type blocks the action with a message naming it. The
// required-file vocabulary comes from the shared constant the backend review
// flow uses.
import { TRIP_POD_REQUIRED_FILE_TYPES, TripPodFileType } from '@tingting/shared';
import type { DriverTaskPodSubmission } from '../api/driverClient';

export const POD_FILE_TYPE_LABELS: Record<string, string> = {
  [TripPodFileType.YARD_OR_DROP_RECEIPT]: 'Phiếu bãi / phiếu hạ',
  [TripPodFileType.SIGNED_DELIVERY_NOTE]: 'Biên bản giao nhận có ký nhận',
};

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

/** The driver-facing refusal when the completion action would submit an
 *  incomplete e-POD. Null when both required file types are present. */
export function missingPodFilesMessage(submission: DriverTaskPodSubmission | null): string | null {
  const missing = missingRequiredPodFileTypes(submission);
  if (missing.length === 0) return null;
  return `Chưa đủ chứng từ giao hàng. Còn thiếu: ${missing.map((type) => POD_FILE_TYPE_LABELS[type]).join(', ')}. Vui lòng bổ sung đủ hai loại trước khi hoàn thành chuyến.`;
}
