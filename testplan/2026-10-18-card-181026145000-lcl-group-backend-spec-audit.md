# Card 181026145000 — LCL group backend spec-audit (Wave A, §1–§6)

Spec: `yeu-cau-tinh-nang-gan-xe-nhom-hang-le.docx` (18/10/2026). Backend-only
audit + gap fixes on branch `fix-lcl-group-backend` (base main `64c6d8e1`).
§7 (form tạo lô) is EXCLUDED — card 181026143000 owns it.

## Audit summary (chi tiết trong HANDOFF.md)

| Spec | Status | Vị trí |
|---|---|---|
| §2.4 Lô 1 = 100% cước trả, lô kia 0đ (tra bảng giá) | ĐÃ CÓ | lcl-cost-group-freight.service.ts (161026232319) |
| §2.4 tag "Lẻ · Ghép (i/N)" — API trả position/size | GAP B | list-summaries thiếu memberCount; các count/principal-ref đọc lô đã xóa |
| §2.4 cont nội bộ: tiền đường/lương 1 lần vào Lô 1 | ĐÃ CÓ | zeroMemberDriverMoney (161026232329) |
| §2.3 sourcing BKS thực + billing copy mặc định | ĐÃ CÓ | lclVehicleSourcingRule + resolveLclCostCarrier |
| §2.3 BKS báo khách sửa TỪNG lô trong nhóm | GAP A | updateLclGroupTruck đang ghi cả nhóm |
| §3 same-customer + popup + 100%/0đ + ghi chú Bill | ĐÃ CÓ | mergeLclRevGroup (fa1908a3) |
| §4 hủy ghép/xóa Lô 1 → thăng cấp; unmerge độc lập | ĐÃ CÓ | promotePrincipalOnRemoval + hook shipment-lifecycle:482 |
| §5 debit export BKS ảo bắt buộc + loại xe thu | ĐÃ CÓ | billing-export-shared AR/AP + billing-document-draft |
| §6.2 debit-close "Lẻ · Thu/Trả" + PHẢI THU/TRẢ theo nhóm | ĐÃ CÓ | accounting-debit-close + F-2 override channel |

## Case LCL-A181026145000-01 — GAP A: BKS báo khách sửa từng lô (spec §2.3)

Repro:
1. Tạo 3 lô LCL cùng khách, gán nhóm cost (Gán xe nhóm) — billing copy
   từ actual cho cả 3 lô (law đã có).
2. Quick-edit BKS báo khách của Lô 2 qua `POST /api/shipments/lcl/truck`
   `{shipmentId: lô2, billingTruckNo: '30C-999.99'}`.

Expected (spec §2.3 "Cho phép điều vận sửa lại cho từng lô trong nhóm"):
- Chỉ Lô 2 đổi billing; Lô 1, Lô 3 giữ nguyên billing cũ; BKS thực không đổi.
- `updatedShipmentIds` = [lô2]. Sửa actual thì VẪN group-wide (1 xe thực/chuyến).

Failure at base: service ghi billing cho mọi thành viên cost group.

## Case LCL-A181026145000-02 — GAP B: wire trả group position/size (spec §2.4)

Repro:
1. Gán nhóm cost 3 lô + ghép rev 2 lô (cùng khách).
2. Đọc `listShipmentsPaginated` (Kế hoạch Tổng quát /dispatch master plan).

Expected: mỗi row trả `costGroupMemberCount`/`revGroupMemberCount` (size N)
cùng `costGroupOrder`/`revGroupOrder` (position i) để FE render "Lẻ · Ghép (i/N)".
Detail-plan và debit-summary đã có đủ; list-summaries là board còn thiếu.

Failure at base: field không tồn tại trên wire list-summaries.

## Case LCL-A181026145000-03 — ghost member sau soft-delete (spec §4 + §2.4)

Repro:
1. Gán nhóm cost 3 lô (chưa có trip để được phép xóa).
2. `softDeleteShipment` lô thành viên order 3 (row giữ nguyên cost_group_id).
3. Đọc lại size/principal-ref trên: detail-plan (Kế hoạch Chi tiết),
   debit-summary (CUS Quyết toán), list-summaries (Tổng quát),
   accounting-debit-close, billing-document-draft.

Expected: mọi count/principal-ref chỉ đếm/đọc lô LIVE — nhóm 3 → size 2,
ref luôn trỏ Bill của lô live order 1 (lô đã xóa giữ id nhóm nhưng không được
tính). Tag "Lẻ · Ghép (i/2)" đúng hậu cảnh §4 (xóa lô trong nhóm).

Failure at base: các query count/principal-ref không filter `deleted_at`.

## Review findings 2026-10-18 (independent review của merge 6e6a7c18 — branch `fix-lcl-group-backend-rb1`)

## Case LCL-A181026145000-04 — HIGH: ghost order-1 principal vẫn được cite trong debt note

Repro:
1. Ghép REV nhóm 3 lô cùng khách, CHƯA trip (ràng buộc xóa đòi hỏi principal
   không có trip). Merge xong mới phát trip cho lô thành viên — note "Ghép
   cước cùng Bill X" của lô đó đi qua nhánh fallback `revPrincipalRefs`
   (không có stamp `trip_financial_state`).
2. `softDeleteShipment` Lô 1 (order 1, không trip). Spec §4: ghost giữ
   `rev_group_id` + slot order 1; Lô 2 promote order 1; Lô 3 renumber order 2.
3. Đọc `getCustomerDebtSummary` — note trên line của Lô 3 (order 2).

Expected: `freightOverrideReason` = `Ghép cước cùng Bill <Bill Lô 2>` —
principal LIVE được promote — KHÔNG bao giờ cite Bill của ghost Lô 1.

Failure at base: `customer-debt-summary.service.ts` ~239 đọc order-1 thiếu
`isNull(deletedAt)` — row ghost order-1 shadow principal live.

## Case LCL-A181026145000-05 — MEDIUM: sửa BKS thực chỉ assert lô nêu tên

Repro:
1. Gán nhóm cost 2 lô; Kế toán chốt (accounting lock) Lô 2 — KHÔNG phải lô
   nêu tên.
2. `updateLclGroupTruck({shipmentId: Lô 1, actualTruckNo: '29C-919.19'})`.

Expected: 409 "Nhóm ghép đã chốt kế toán" — BKS thực ghi MỌI thành viên nhóm
nên settled member đóng băng cả nhóm (mirror luật `assertGroupMutable` của
un-merge). Billing-only vẫn per-lot: `{shipmentId: Lô 1, billingTruckNo}`
thành công dù Lô 2 locked.

Failure at base: `updateLclGroupTruck` chỉ assert lô nêu tên (~1326) — edit
ghi cả nhóm qua lô đã khóa.

## Case LCL-A181026145000-06 — LOW: test gap ghost-order-1 deletion (debt note + debit refs)

Repro: như case 04.

Expected: debt note VÀ debit refs (`revGroupPrincipalRef` +
`freightOverrideReason` trên `getShipmentDebitSummary`) cùng cite Bill principal
promote, không cite ghost.

Failure at base: không test nào cover scenario xóa principal → ghost order-1
cùng slot với principal promote.

## Gates (review fixes)

- Scoped: `lcl-grouping.test.ts`, `customer-debt-summary.test.ts`,
  `shipment-debit-summary.test.ts` (`npx tsx --test`).
- `cd backend && npx tsc --noEmit` = 0; `pnpm lint` = 0.

## Gates

- Scoped: `lcl-grouping.test.ts`, `lcl-single-lot-rev-class.test.ts`,
  `cus-lot-flat-row.test.ts`, `accounting-debit-close.test.ts`,
  `shipment-debit-note-export.test.ts`, `shipment-debit-summary.test.ts`.
- `cd backend && npx tsc --noEmit` = 0; `pnpm lint` = 0.
