# SIL-939 — Chặn xe nội bộ cho lô LCL đường bộ: gate cost-only bỏ sót lô chưa ghép nhóm (REPEAT FAIL round 3)

Case ID: SIL-939-R3 (QA 25/11 05:15 + 06:10 SGT, staging vantai build c1150c99, role dungnv — Điều vận, /dispatch-detail, 11/2026).

## Reproduction (verbatim QA)

Lot R4B-A14-EMPTY2 — SHP-2611-00431 (Long Minh, ASKEY-XƯỞNG 1, 'Lẻ 10 Pallet 5 tấn',
TK-A8-1106, Lẻ, Chưa phân xe):

1. Sign in dungnv → /dispatch-detail → search R4B-A14-EMPTY2.
2. Row menu → 'Sửa điều phối'.
3. Nhà xe dropdown shows 'SilverSea — xe nội bộ' pre-selected (first option).
4. Select plate 15E-016.26 — Nguyễn Duy Tuấn → 'Lưu thay đổi'.

**Observed:** no block anywhere — green toast 'Lô SHP-2611-00431 đã phân xe đủ.', lot thành
'Đã điều xe' với SilverSea / 15E-016.26 / Nguyễn Duy Tuấn / 0979697258.

**Expected:** hàng lẻ đi xe tải (class tấn) 100% xe ngoài — chặn đội xe nội bộ ở chọn, lưu,
và mọi đường API (KB §9.2 K9.9, FB-090).

## Root cause (round 3 — disproves the round-2 "missing-deploy artifact" claim)

The round-1/2 guard judged the lot's class through the COST side only, on every layer:

- BE `updateDispatchDetailPlanInTx`: `shipment.costVehicleClassId != null` trước khi phán;
- FE editor gate: `row.lcl?.group?.vehicleClassCode` (= `costVehicleClassCode`).

Live DB (vantai staging, shipment 934 / fulfillment 895): `cargo_mode='LCL'`,
**`cost_group_id = NULL`, `cost_vehicle_class_id = NULL`** — lô chưa từng qua 'Gán xe nhóm';
class 5T (id 11, `is_container = f`) chỉ tồn tại ở **`rev_vehicle_class_id`** (class ghi lúc
tạo lô, SIL-846 "Trọng tải — Loại xe tính cước"). Cả hai gate đọc cost-only ⇒ null ⇒ luật
bị skip lặng lẽ, save thành công.

## Fix law (landed)

Một luật, mọi đường ghi của hộp thoại 'Sửa điều phối' trên /dispatch-detail:

1. **Pure decision** `backend/src/services/dispatch-lcl-sourcing.ts` —
   `lclTruckInternalFleetRefusal(carrierType, {cargoMode}, classRow)`: OWN + LCL + class
   `isContainer=false` → 400 'Hàng lẻ xe tải 100% xe ngoài — không thể chọn Đội xe nội bộ
   (loại xe …). Chọn Nhà xe (xe ngoài).'; class container giữ cả 2 nguồn; EXTERNAL/FCL/không
   có class không phán xét (never guess the kind).
2. **BE** `assertLclTruckExternalOnly` chạy trong tx TRƯỚC mọi write trên cả 3 đường của
   surface điều phối từng lô — atomic plan save (`updateDispatchDetailPlanInTx`), legacy
   `/carrier` (`assignFulfillmentCarrierInTx`), legacy `/plate` (`assignFulfillmentPlateInTx`,
   exempt chỉ `clear=true` — write đưa row về 'chưa phân xe' phải còn đường thoát cho dòng
   OWN cũ). Class resolve **cost trước, rev sau** (`costVehicleClassId ?? revVehicleClassId`).
3. **Wire cho FE** — read service trả `lcl.sourcingVehicleClassCode` (cost ?? rev, join bảng
   vehicle_size_classes lần 2 bằng alias; cả nhánh fulfillment-less). Editor gate đọc field
   này: ẩn option SilverSea, reset dòng OWN cũ kèm cảnh báo, không nạp đội xe nội bộ khi
   chưa chọn nhà xe, chặn lưu FE.

Không đụng: pair Ghép/Kết hợp, cơ chế group 'Gán xe nhóm' (SIL-545, đã guard sẵn trong
lcl-grouping.service.ts), bước phát lệnh trên lô OWN lưu từ trước luật (concern round 1,
ngoài scope ticket).

## Biên giới còn mở (recorded — cần owner ruling, không thuộc scope ticket này)

Review độc lập (code-reviewer, 25/11) quét TẤT CẢ writer của `planned_carrier_type` và xác
nhận 2 đường VẪN ghi OWN ngoài 3 đường đã gate — cần ticket follow-up trước khi QAround 4:

1. **Phát lệnh / phát lại** — `issueOrderCreateOrUpdate`
   (backend/src/services/dispatch-planning-commands.service.ts:925) persists OWN không gate:
   (a) lô OWN cũ từ trước luật vẫn phát tiếp qua Phát lệnh; (b) ruling issue-time
   'điều vận được phép đổi xe' (:446-449) cho phép đổi sang OWN NGAY BƯỚC phát trên lô
   planned-EXTERNAL. FE `useIssueOrder` replay carrierType đã lưu nên (a) là đường sống.
2. **Intake / master-plan 'Phân bổ nhà xe' LCL** — `assignShipmentCarriers`
   (backend/src/services/shipment-intake.service.ts:141-149) persists OWN pre-dispatch;
   popover `DispatchAllocationPopover.tsx` còn default `carrierType: ?? 'OWN'` (:193).

Cần chốt: issue-time đổi xe có được miễn FB-090 không (luật KB 'không thể planned' nghiêng
về KHÔNG miễn). Cả 2 đường đều route được qua cùng pure law — việc gate là nhỏ, quyết định
scope là của owner.

## Verification

- BE scoped: `npx tsx --test src/tests/unit/sil939-lcl-truck-external-only.test.ts` — 8/8
  (3 behavior test thật trên pure decision + 5 wiring scan); mutation check: gãy fallback
  rev → suite đỏ 7/8.
- FE scoped: `pnpm exec vitest run src/features/dispatch/detailed-plan/DispatchPlanEditorCell.sil939-lcl-truck-external.test.tsx`
  — 9/9, gồm 3 test mới pin đúng shape repro QA (group null, class rev-only; class-less
  không phán xét; OWN cũ rev-only bị reset).
- `tsc --noEmit` backend + frontend (`tsc -b` lẫn `--noEmit`): 0 errors.
- Regression: full BE unit suite 422/422 + toàn bộ `detailed-plan/` FE suite 58 files
  601/601 PASS.
- Edge đã review, giữ nguyên: class bị soft-delete — BE vẫn phán xét (kind là fact lịch sử),
  FE catalog không còn row → FE offers/BE refuses 400; hướng BE là đúng (không cho class
  đã xoá lách luật).
- UI DRIVEN sau deploy (QA): lô R4B-A14-EMPTY2 mở 'Sửa điều phối' không còn 'SilverSea — xe
  nội bộ'; POST /plan với carrierType OWN trên class tấn → 400; lot đã probe trong repro QA
  đã được restore về 'Chưa phân xe' (comment 22:15Z).
