// Pod readiness — single source for the mandatory e-POD photo gate shared by
// the trip detail footer and the e-POD screen. Keep in sync with the backend's
// TRIP_POD_REQUIRED_FILE_TYPES and TripPodSubmission's REQUIRED_FILE_TYPES.
import { TripPodFileType } from '@tingting/shared';
import type { DriverTaskPodSubmission } from '../api/driverClient';

export function podRequiredFilesReady(submission: DriverTaskPodSubmission | null) {
  const files = submission?.files ?? [];
  const hasYardReceipt = files.some((f) => f.fileType === TripPodFileType.YARD_OR_DROP_RECEIPT);
  const hasSignedNote = files.some((f) => f.fileType === TripPodFileType.SIGNED_DELIVERY_NOTE);
  return { hasYardReceipt, hasSignedNote, podReady: hasYardReceipt && hasSignedNote };
}
