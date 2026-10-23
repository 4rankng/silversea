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

/**
 * FB-092 — dispatch "Gán xe nhóm" popup (cost dimension). Spec 23/10
 * (261023110000): the ĐV popup carries EXACTLY these 4 fields (Loại xe tính
 * cước trả ĐV · Nhà xe · BKS thực · Cước trả ĐVVC) — BKS báo khách ("xe ảo")
 * is a CUS concept and is deliberately ABSENT here (unknown keys are
 * stripped; the ĐV flow never writes `billing_truck_no`).
 */
export const assignLclCostGroupSchema = z.object({
  /** Selected lots in operator order: index 0 becomes Lô 1 (principal). */
  shipmentIds: shipmentIdList,
  /** Loại xe tính cước trả ĐV — vehicle_size_classes.id (FB-090 catalog). */
  vehicleSizeClassId: z.number().int().positive(),
  /** BKS thực (what runs the lane). Truck-tonnage classes must stay vendor. */
  actualTruckNo: truckNo,
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
   * 161026232319 — Điều vận nhập tay cước trả ĐVVC của Lô 1 (VND). Omitted ⇒
   * the server auto-traces the carrier price board (tuyến × loại xe × nhà xe).
   * A manual value always wins over the traced one and survives to trip
   * issuance (ships.cost_group_freight_manual).
   */
  freightCost: z.number().int().min(0).optional(),
});
export type AssignLclCostGroupInput = z.infer<typeof assignLclCostGroupSchema>;

/**
 * Spec 23/10 (261023110000) — SỬA 4 trường của một nhóm ĐV đã gán ("API gán
 * nhóm ĐV THÊM/SỬA"). Membership is fixed (tách/gộp đổi thành viên bằng lối
 * riêng); every field is optional but at least one must be present — this is
 * a true PARTIAL update: an omitted field KEEPS its current value (Nhà xe
 * identity, BKS, loại xe and money all survive a one-field payload).
 *
 * `freightCost` is 3-state: a number = the manual "Cước trả ĐVVC" (wins over
 * the board); `null` = BLANK ⇒ auto-trace the carrier price board again (the
 * popup's blank field); omitted = keep the group's current money untouched.
 */
export const updateLclCostGroupSchema = z.object({
  /** The COST group to edit (shipments.cost_group_id, uuid). */
  groupId: z.string().uuid(),
  /** Loại xe tính cước trả ĐV — vehicle_size_classes.id (FB-090 catalog). */
  vehicleSizeClassId: z.number().int().positive().optional(),
  /** BKS thực (what runs the lane) — rewritten on every live member. */
  actualTruckNo: truckNo.optional(),
  /** Nhà xe (Xe ngoài, customers.id isCarrier). */
  carrierId: z.number().int().positive().optional(),
  /** OWN = Đội xe nội bộ SilverSea (container classes only). */
  carrierType: z.enum(['OWN', 'EXTERNAL']).optional(),
  /** Cước trả ĐVVC Lô 1 (VND). `null` = auto-trace; omitted = keep as-is. */
  freightCost: z.number().int().min(0).nullable().optional(),
}).refine(
  (value) => value.vehicleSizeClassId != null
    || value.actualTruckNo != null
    || value.carrierId != null
    || value.carrierType != null
    || value.freightCost !== undefined,
  { message: 'Không có gì để sửa — truyền ít nhất một trong 4 trường gán xe nhóm' },
);
export type UpdateLclCostGroupInput = z.infer<typeof updateLclCostGroupSchema>;

/** FB-093 — CUS "Ghép cước thu khách" (rev dimension, one customer only). */
export const mergeLclRevGroupSchema = z.object({
  /** Selected lots in operator order: index 0 becomes Lô 1 (100% cước thu). */
  shipmentIds: shipmentIdList,
  /** Loại xe tính cước thu nhóm — vehicle_size_classes.id (FB-090 catalog). */
  vehicleSizeClassId: z.number().int().positive(),
  /**
   * BKS báo khách (chung cho nhóm). Omitted/blank ⇒ every lot keeps its own
   * per-lot value and a blank lot reports the ĐV-assigned BKS thực (spec
   * 23/10 read-side fallback). A value is stamped onto every member.
   */
  billingTruckNo: truckNo.optional(),
  /**
   * Spec 23/10 — "Cước thu khách Lô 1 (đ) – nhập tay": manual override of the
   * group's 100% cước thu. Omitted ⇒ auto-trace bảng giá thu khách
   * (KH × tuyến × loại xe, ngày giao dự kiến của Lô 1).
   */
  freightRevenue: z.number().int().min(0).optional(),
});
export type MergeLclRevGroupInput = z.infer<typeof mergeLclRevGroupSchema>;

/**
 * 161026232349 (DEV SPEC Hàng lẻ §II.3.2 — "Trường hợp 1 · Thu riêng từng lô")
 * — the per-lot CUS outputs of a lot NOT in a rev group (spec 23/10 §4.1:
 * "Mặc định mỗi lô hàng lẻ được tính cước thu khách như 1 chuyến xe độc lập").
 * At least one of the two fields must be present:
 *
 *  - `vehicleSizeClassId` — Loại xe thu khách (tải trọng hoặc Cont 20'/40');
 *    with the class picked, the AUTO cước thu traces bảng giá thu khách theo
 *    loại + ngày (KH × tuyến × loại xe, ngày giao dự kiến).
 *  - `freightRevenue` — Giá cước thu khách nhập tay (VND); a manual value
 *    wins over the traced lane price (thỏa thuận với khách).
 *
 * A lot already inside a rev group is refused (tách nhóm trước): the group
 * owns its members' cước thu (merge Lô-1 100% / 0₫ law).
 */
export const setLclLotRevClassSchema = z.object({
  shipmentId: z.number().int().positive(),
  /** Loại xe tính cước thu khách — vehicle_size_classes.id (FB-090 catalog). */
  vehicleSizeClassId: z.number().int().positive().optional(),
  /** Giá cước thu khách nhập tay (VND). Omitted ⇒ auto tra bảng giá theo
   *  loại xe + ngày của chính lô này. */
  freightRevenue: z.number().int().min(0).optional(),
}).refine(
  (value) => value.vehicleSizeClassId != null || value.freightRevenue != null,
  { message: 'Cần ít nhất Loại xe thu khách hoặc Giá cước thu khách nhập tay' },
);
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

export const unmergeLclGroupSchema = z.object({
  groupId: z.string().uuid(),
  dimension: z.enum(LCL_GROUP_DIMENSIONS),
});
export type UnmergeLclGroupInput = z.infer<typeof unmergeLclGroupSchema>;

/** FB-093 — quick-edit of a lot's (or its whole cost group's) BKS pair. */
export const updateLclTruckSchema = z.object({
  shipmentId: z.number().int().positive(),
  actualTruckNo: truckNo.optional(),
  /** BKS báo khách (CUS). `null` clears it ⇒ BLANK ⇒ the lot reports the
   *  ĐV-assigned BKS thực (spec 23/10 fallback). Omitted ⇒ untouched. */
  billingTruckNo: truckNo.nullable().optional(),
});
export type UpdateLclTruckInput = z.infer<typeof updateLclTruckSchema>;

/**
 * Spec 23/10 (261023110000 §4.2) — the tag a REV-group member (Lô 2..N)
 * carries: its Giá cước thu khách is 0₫ because the whole group's cước thu
 * rides Lô 1. Returned as a field on the wire (`LclGroupWire.revMergeTag`)
 * and stamped as the member's revenue-override reason.
 */
export const LCL_REV_MERGE_TAG = 'Ghép thu cước cùng Lô 1';

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
  /** `LCL_REV_MERGE_TAG` on Lô 2..N of a rev group; null elsewhere. */
  revMergeTag: string | null;
}
