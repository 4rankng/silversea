import { z } from 'zod';

// ─── FB-092/093: LCL lot grouping commands (DEV SPEC Hàng lẻ §II.2.2–§II.3)
//
// Both money dimensions share one shape law: inside a group, `*_order` 1 is
// the principal lot and carries 100% of that dimension's money; members 2..N
// carry 0₫ (their live trip's money column is zeroed by the grouping service).
//   COST = cước trả ĐV (dispatch assigns the truck, FB-092)
//   REV  = cước thu khách (CUS merges the bill, FB-093, same customer only)
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
  /**
   * 161026232309 — the nhà xe (Xe ngoài) the group's truck belongs to:
   * a customers.id flagged isCarrier (the row every "Chọn nhà xe" dropdown
   * reads). Persisted on the group's lots so the choice survives a reopen.
   */
  carrierId: z.number().int().positive().optional(),
  /**
   * 161026232309 — OWN = Đội xe nội bộ SilverSea (container classes only, the
   * spec's "Cont 20'/40' → Xe nội bộ HOẶC Nhà thầu"). Derived server-side
   * when omitted: carrierId ⇒ EXTERNAL, internal-fleet plate ⇒ OWN.
   */
  carrierType: z.enum(['OWN', 'EXTERNAL']).optional(),
  /**
   * 161026232319 — Điều vận nhập tay cước trả ĐV của Lô 1 (VND). Omitted ⇒ the
   * server auto-traces the carrier price board (tuyến × loại xe × nhà xe).
   * A manual value always wins over the traced one.
   */
  freightCost: z.number().int().min(0).optional(),
});
export type AssignLclCostGroupInput = z.infer<typeof assignLclCostGroupSchema>;

/** FB-093 — CUS "Ghép cước thu khách" (rev dimension, one customer only). */
export const mergeLclRevGroupSchema = z.object({
  /** Selected lots in operator order: index 0 becomes Lô 1 (100% cước thu). */
  shipmentIds: shipmentIdList,
  /** Loại xe tính cước thu khách — vehicle_size_classes.id (FB-090 catalog). */
  vehicleSizeClassId: z.number().int().positive(),
  /** BKS ảo chung nhóm. Omitted ⇒ copies the group's actual if already set. */
  billingTruckNo: truckNo.optional(),
});
export type MergeLclRevGroupInput = z.infer<typeof mergeLclRevGroupSchema>;

/**
 * 161026232349 (DEV SPEC Hàng lẻ §II.3.2 — "Trường hợp 1 · Thu riêng từng lô")
 * — CUS picks the thu vehicle class for ONE ungrouped lot. The spec's law:
 * "CUS không cần ghép ... chọn Loại xe tính cước thu khách ... Cột CƯỚC VẬN
 * TẢI (AUTO) của từng lô sẽ nhảy 100% đơn giá của loại xe đã chọn cho lô đó."
 *
 * This is the single-lot sibling of `mergeLclRevGroupSchema`: same class
 * catalog, same customer × route × class price lane, but NO group is created
 * (`revGroupId` stays null) — a lot already inside a rev group is refused
 * (tách nhóm trước).
 */
export const setLclLotRevClassSchema = z.object({
  shipmentId: z.number().int().positive(),
  /** Loại xe tính cước thu khách — vehicle_size_classes.id (FB-090 catalog). */
  vehicleSizeClassId: z.number().int().positive(),
});
export type SetLclLotRevClassInput = z.infer<typeof setLclLotRevClassSchema>;

/** FB-092/093 — the money dimensions a lot group can live in. */
export const LCL_GROUP_DIMENSIONS = ['COST', 'REV'] as const;
export type LclGroupDimension = (typeof LCL_GROUP_DIMENSIONS)[number];

/** FB-095 — tách một lô khỏi nhóm ghép của một chiều tiền. */
export const unmergeLclLotSchema = z.object({
  shipmentId: z.number().int().positive(),
  /** Chiều tiền cần tách: COST (trả ĐV) hoặc REV (thu khách). */
  dimension: z.enum(LCL_GROUP_DIMENSIONS),
});
export type UnmergeLclLotInput = z.infer<typeof unmergeLclLotSchema>;

/** FB-093 — quick-edit of a lot's (or its whole cost group's) BKS pair. */
export const updateLclTruckSchema = z.object({
  shipmentId: z.number().int().positive(),
  actualTruckNo: truckNo.optional(),
  billingTruckNo: truckNo.optional(),
});
export type UpdateLclTruckInput = z.infer<typeof updateLclTruckSchema>;

/** Group facts every list surface renders the same way (FB-092/093 §display). */
export interface LclGroupWire {
  costGroupId: string | null;
  costGroupOrder: number | null;
  revGroupId: string | null;
  revGroupOrder: number | null;
  actualTruckNo: string | null;
  billingTruckNo: string | null;
  /** vehicle_size_classes.code, e.g. '5T' / 'CONT20' (null = chưa gán). */
  costVehicleClassCode: string | null;
  costVehicleClassName: string | null;
  costVehicleClassIsContainer: boolean | null;
}
