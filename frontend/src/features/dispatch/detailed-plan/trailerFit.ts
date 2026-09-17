import type { DispatchTruck } from '../../../api/dispatchPlanningClient';

/** Mirror of the backend issue gate (inferTrailerTypeFromContainerCode in
 *  dispatch-planning-utils.service.ts): a container code starting with 20
 *  uses20FT for a single load or40FT for a DOUBLE pair; larger shells use40FT. Null container info → no
 *  signal, no annotation — same "only block on a provable mismatch" stance
 *  as the backend. */
export function requiredTrailerTypeForContainer(label: string | null | undefined, classification?: string): '20FT' | '40FT' | null {
  const normalized = label?.trim().toUpperCase() ?? '';
  if (!normalized) return null;
  return normalized.startsWith('20') && classification !== 'DOUBLE' ? '20FT' : '40FT';
}

export function trailerMismatchSuffix(truckTrailerType: string | null, required: '20FT' | '40FT' | null): string {
  if (required == null || truckTrailerType == null || truckTrailerType === required) return '';
  return ` — ⚠ rơ-moóc ${truckTrailerType}, cần ${required}`;
}

/** Sort rank for the vehicle list: fitting trailers first, unknown neutral,
 *  provable mismatches last — the picker's default pick should be a truck
 *  the Phát lệnh gate will actually accept instead of one that 409s at issue
 *  time on every 20' container. */
export function trailerFitRank(trailerType: string | null, required: '20FT' | '40FT'): 0 | 1 | 2 {
  if (trailerType == null) return 1;
  return trailerType === required ? 0 : 2;
}

/** Plate alone doesn't tell a dispatcher which driver they're assigning —
 *  pair it with the driver name so the picker is recognizable. */
export function ownTruckLabel(truck: DispatchTruck, requiredTrailerType: '20FT' | '40FT' | null): string {
  return `${truck.licensePlate} — ${truck.assignedDriverName ?? 'Chưa gán tài xế'}`
    + trailerMismatchSuffix(truck.trailerType, requiredTrailerType);
}
