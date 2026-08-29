// Pod readiness — single source for the mandatory e-POD photo gate shared by
// the trip detail footer and the e-POD screen. The required-file vocabulary
// comes from the shared constant the backend gate uses.
import { TRIP_POD_REQUIRED_FILE_TYPES, TripPodFileType } from '@tingting/shared';
import type { DriverTaskPodSubmission } from '../api/driverClient';

export function podRequiredFilesReady(submission: DriverTaskPodSubmission | null) {
  const files = submission?.files ?? [];
  const present = new Set(files.map((f) => f.fileType));
  return {
    hasYardReceipt: present.has(TripPodFileType.YARD_OR_DROP_RECEIPT),
    hasSignedNote: present.has(TripPodFileType.SIGNED_DELIVERY_NOTE),
    podReady: TRIP_POD_REQUIRED_FILE_TYPES.every((type) => present.has(type)),
  };
}
