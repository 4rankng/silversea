/**
 * SIL-939 (KB §9.2 K9.9, FB-090 sourcing law) — the LCL truck sourcing gate
 * as ONE pure law shared by every write path of the per-lot dispatch plan
 * (atomic plan save, legacy carrier endpoint, legacy plate endpoint), so the
 * /dispatch-detail "Sửa điều phối" surface cannot bypass the refusal the
 * "Gán xe nhóm" dialog (SIL-545) already carries in lcl-grouping.service.ts.
 * NOT yet gated here (recorded boundary, see testplan 2026-11-25): the
 * Phát lệnh issue/reissue write (dispatch-planning-commands.service.ts) and
 * the intake/master-plan LCL allocation (shipment-intake.service.ts).
 * DB access stays in the callers; this module imports only the shared rule
 * and is safe for the unit-only test tree.
 */
import { lclVehicleSourcingRule, LclVehicleSourcing } from '@tingting/shared';

/** The lot-level facts the gate judges. */
export interface LclSourcingLot {
  cargoMode: string | null;
  costVehicleClassId: number | null;
  revVehicleClassId: number | null;
}

/** The vehicle_size_classes row the caller resolved for the lot's class id. */
export interface LclSourcingClass {
  isContainer: boolean;
  code: string;
}

/**
 * The 400 message when the internal fleet (Đội xe nội bộ SilverSea) may not
 * be planned on this lot, null when the write may proceed. Truck-tonnage
 * classes are 100% xe ngoài; container classes keep both sources; a lot
 * whose class is unknown is not judged (never guess the kind); an EXTERNAL
 * pick never refuses.
 */
export function lclTruckInternalFleetRefusal(
  carrierType: 'OWN' | 'EXTERNAL',
  lot: Pick<LclSourcingLot, 'cargoMode'>,
  vehicleClass: LclSourcingClass | null | undefined,
): string | null {
  if (carrierType !== 'OWN' || lot.cargoMode !== 'LCL' || vehicleClass == null) return null;
  if (lclVehicleSourcingRule(vehicleClass.isContainer) !== LclVehicleSourcing.EXTERNAL_ONLY) return null;
  return `Hàng lẻ xe tải 100% xe ngoài — không thể chọn Đội xe nội bộ (loại xe ${vehicleClass.code}). Chọn Nhà xe (xe ngoài).`;
}
