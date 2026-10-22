// Pod readiness — the shared e-POD photo facts for the trip detail footer
// and the e-POD screen. Card 261022213755a (owner ruling 22/10): the photos
// are OPTIONAL evidence — these facts feed informational counters and hints
// only, never a completion gate (the backend gate is milestone-only). The
// required-file vocabulary comes from the shared constant the backend review
// flow uses.
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
