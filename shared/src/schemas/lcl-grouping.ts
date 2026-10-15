import { z } from 'zod';

// ─── FB-092: LCL lot grouping commands (DEV SPEC Hàng lẻ §II.2.2)
//
// Grouping law (FB-092, COST dimension = cước trả ĐV): inside a group
// `cost_group_order` 1 is the principal lot and carries 100% of the vendor
// freight; members 2..N carry 0₫ (their live trip's money column is zeroed by
// the grouping service). The REV dimension (cước thu khách) lands with FB-093
// and reuses this same shape law.
//
// These schemas are the single wire contract: routes validate with them and
// the frontend clients import the inferred types.

const truckNo = z.string().trim().min(1, 'BKS không được để trống').max(20);
const shipmentIdList = z
  .array(z.number().int().positive())
  .min(2, 'Nhóm ghép cần ít nhất 2 lô');

/** FB-092 — dispatch "Gán xe nhóm" popup (cost dimension). */
export const assignLclCostGroupSchema = z.object({
  /** Selected lots in operator order: index 0 becomes Lô 1 (principal). */
  shipmentIds: shipmentIdList,
  /** Loại xe tính cước trả ĐV — vehicle_size_classes.id (FB-090 catalog). */
  vehicleSizeClassId: z.number().int().positive(),
  /** BKS thực (what runs the lane). Truck-tonnage classes must stay vendor. */
  actualTruckNo: truckNo,
  /** BKS báo khách ("xe ảo"). Omitted ⇒ server copies actualTruckNo. */
  billingTruckNo: truckNo.optional(),
});
export type AssignLclCostGroupInput = z.infer<typeof assignLclCostGroupSchema>;

/** FB-092 — the money dimensions a lot group can live in (REV lands FB-093). */
export const LCL_GROUP_DIMENSIONS = ['COST', 'REV'] as const;
export type LclGroupDimension = (typeof LCL_GROUP_DIMENSIONS)[number];

/** Group facts every list surface renders the same way (FB-092 §display). */
export interface LclGroupWire {
  costGroupId: string | null;
  costGroupOrder: number | null;
  actualTruckNo: string | null;
  billingTruckNo: string | null;
  /** vehicle_size_classes.code, e.g. '5T' / 'CONT20' (null = chưa gán). */
  costVehicleClassCode: string | null;
  costVehicleClassName: string | null;
  costVehicleClassIsContainer: boolean | null;
}
