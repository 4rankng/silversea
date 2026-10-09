import type { DispatchTruck } from '../../../api/dispatchPlanningClient';
import { LCL_PICKUP_TRAILER_TYPE } from '@tingting/shared';

/** Mirror of the backend issue gate (inferTrailerTypeFromContainerCode in
 *  dispatch-planning-utils.service.ts): a container code starting with 20
 *  uses20FT for a single load or40FT for a DOUBLE pair; larger shells use40FT. Null container info → no
 *  signal, no annotation — same "only block on a provable mismatch" stance
 *  as the backend.
 *
 *  LCL_PICKUP ('Lấy Lẻ') overrides the container code entirely: the run
 *  moves the truck's own empty 40' shell, so the lot's 20' code must not
 *  downgrade the required trailer to a 20' moóc the run will not drive. */
export function requiredTrailerTypeForContainer(label: string | null | undefined, classification?: string): '20FT' | '40FT' | null {
  if (classification === 'LCL_PICKUP') return LCL_PICKUP_TRAILER_TYPE;
  const normalized = label?.trim().toUpperCase() ?? '';
  if (!normalized) return null;
  return normalized.startsWith('20') && classification !== 'DOUBLE' ? '20FT' : '40FT';
}

/** Physical moóc length rank. Card 091026164810: the requirement is a MINIMUM
 *  length, not an exact match — the same TRAILER_LENGTH_RANK the issue-time
 *  gate uses (dispatch-planning-commands.service.ts, card 091026164500). A 20'
 *  load rides a 40' moóc legally (that is the Kẹp clamp rig); only a provably
 *  UNDERSIZED moóc — a 40' requirement on a 20' moóc — is a mismatch. Before
 *  this, the FE advisory exact-matched and warned "rơ-moóc 40FT, cần 20FT"
 *  for a pairing the gate had just been fixed to accept, so the picker told
 *  the dispatcher the opposite of the truth. Keep this in lockstep with the
 *  backend constant — advisory only, never a block. */
const TRAILER_LENGTH_RANK: Record<'20FT' | '40FT', number> = { '20FT': 1, '40FT': 2 };

export function trailerMismatchSuffix(truckTrailerType: string | null, required: '20FT' | '40FT' | null): string {
  if (required == null || truckTrailerType == null) return '';
  const truckRank = TRAILER_LENGTH_RANK[truckTrailerType as '20FT' | '40FT'];
  const requiredRank = TRAILER_LENGTH_RANK[required];
  // Unknown trailer type → stay silent, same "only warn on a provable
  // mismatch" stance as before.
  if (truckRank == null) return '';
  if (truckRank >= requiredRank) return '';
  return ` — ⚠ rơ-moóc ${truckTrailerType}, cần ${required}`;
}

/** Sort rank for the vehicle list: fitting trailers first, unknown neutral,
 *  provable mismatches last — the picker's default pick should be a truck
 *  the Phát lệnh gate will actually accept instead of one that 409s at issue
 *  time. Card 091026164810: "fits" now means "long enough", so a 40' moóc on
 *  a 20' requirement ranks as a fit (0) rather than a mismatch to sink (2) —
 *  otherwise the picker buried the very trucks the gate accepts for a Kẹp
 *  pair. */
export function trailerFitRank(trailerType: string | null, required: '20FT' | '40FT'): 0 | 1 | 2 {
  if (trailerType == null) return 1;
  const truckRank = TRAILER_LENGTH_RANK[trailerType as '20FT' | '40FT'];
  if (truckRank == null) return 1;
  return truckRank >= TRAILER_LENGTH_RANK[required] ? 0 : 2;
}

/** Load vs available capacity (AC DISP-MP-02): `capacityKg` is the vehicle's
 *  inferred payload (the truck's trailer capacity — inferredVehicleCapacityKg
 *  on the backend). Advisory only: the server keeps enforcing the same
 *  comparison (trip-pairing OVERLOAD), so the picker warns beside the option
 *  instead of disabling it. Unknown or non-positive values on either side
 *  stay silent — same "only warn on a provable overload" stance as the
 *  trailer mismatch above. */
export function exceedsCapacity(capacityKg: string | null | undefined, cargoWeightKg: string | null | undefined): boolean {
  const capacity = Number(capacityKg);
  const cargo = Number(cargoWeightKg);
  if (!Number.isFinite(capacity) || capacity <= 0) return false;
  return Number.isFinite(cargo) && cargo > capacity;
}

export function capacityOverloadSuffix(capacityKg: string | null | undefined, cargoWeightKg: string | null | undefined): string {
  return exceedsCapacity(capacityKg, cargoWeightKg) ? ' — ⚠ Vượt tải trọng khả dụng' : '';
}

/** The fit facts a picker option needs: trailer type (mismatch) and capacity
 *  (overload). DispatchTruck satisfies this structurally. */
export interface VehicleFit {
  trailerType: string | null;
  capacityKg: string | null;
}

/** One builder for the picker's advisory suffixes — trailer mismatch first,
 *  then the capacity advisory — so the two can never drift apart. */
export function vehicleWarningSuffix(fit: VehicleFit | null | undefined, required: '20FT' | '40FT' | null, cargoWeightKg: string | null | undefined): string {
  return trailerMismatchSuffix(fit?.trailerType ?? null, required)
    + capacityOverloadSuffix(fit?.capacityKg ?? null, cargoWeightKg);
}

/** Plate alone doesn't tell a dispatcher which driver they're assigning —
 *  pair it with the driver name so the picker is recognizable, plus the
 *  trailer-mismatch and capacity advisories. */
export function ownTruckLabel(truck: DispatchTruck, requiredTrailerType: '20FT' | '40FT' | null, cargoWeightKg: string | null | undefined): string {
  return `${truck.licensePlate} — ${truck.assignedDriverName ?? 'Chưa gán tài xế'}`
    + vehicleWarningSuffix(truck, requiredTrailerType, cargoWeightKg);
}
