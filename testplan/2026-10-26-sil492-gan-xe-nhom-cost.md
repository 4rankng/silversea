# SIL-492 — Hồi quy: Gán xe nhóm phải hiển thị 100% cước trả ĐV trên "Chỉnh sửa điều phối"

Ngày: 2026-10-26 · SIL-492 · branch `fix-554-556-557-dispatch`

## Bug

Sau "Gán xe nhóm" với cước nhập tay (vd 1.000.000₫), popup "Chỉnh sửa điều phối"
hiện "Cước trả dự kiến" = 0/trống ở CẢ HAI lô — trong khi toast cam kết
"Lô 1 giữ 100% cước trả ĐV, các lô còn lại 0₫".

## Nguyên nhân

`assignLclCostGroup` chỉ ghi tiền lên tầng trip (`trip_carrier_info
.external_freight_cost` qua `applyPrincipalCostFreight`) + cột sticky
`shipments.cost_group_freight_manual`. Popup "Chỉnh sửa điều phối" đọc
`shipment_fulfillments.planned_carrier_cost` — cột này không bao giờ được ghi
trong luồng gán nhóm → cả hai lô trống/0.

## Fix

Luồng tiền nhóm ghi thêm `planned_carrier_cost` trên fulfillment:
- Lô 1: số nhập tay (thắng bảng giá) — hoặc giá tra bảng khi để trống; trượt
  bảng giá ⇒ GIỮ giá trị cũ (giá thiếu không bao giờ bịa 0₫, không xoá tiền).
- Lô 2..N: `'0'` ("nhảy tiền" — nhóm trả nhà xe một lần).
- Áp dụng ở cả `assignLclCostGroup` lẫn `updateLclCostGroup` (khi moneyChanged;
  omitted tiền ⇒ fulfilled cost nguyên vẹn — partial update H1).

## Trường hợp kiểm

| # | Màn hình | Trường hợp |
|---|----------|-----------|
| R1 | Kế hoạch Chi tiết · "Chỉnh sửa điều phối" | Gán nhóm 2 lô + nhập tay 1.000.000₫ ⇒ Lô 1 = 1.000.000₫, Lô 2 = 0₫ sau reload |
| R2 | Như R1 | Bỏ trống cước + có bảng giá (tuyến × loại xe × nhà xe) ⇒ Lô 1 = giá bảng, Lô 2 = 0₫ |
| R3 | Như R1 | Bỏ trống cước + KHÔNG có bảng giá ⇒ Lô 1 giữ giá trị cũ (không 0₫ bịa), Lô 2 = 0₫ |
| R4 | Sửa nhóm ĐV | `freightCost` omitted ⇒ planned cost nguyên vẹn; `null` ⇒ auto-trace lại; số ⇒ override |
| R5 | Đối soát/PI lô | Trip-level `external_freight_cost` không đổi hành vi (tiền trip = như trước fix) |

## Evidence

- Unit (BE, unit-only): `backend/src/tests/unit/lcl-cost-group-planned-cost.test.ts`
  (luật pure `lclCostGroupPlannedCosts`) + pins nguồn trong
  `lcl-gop-hang-money-wiring.test.ts` (assign/update wire qua
  `persistLclCostCarrier` với planned-cost map).
- API/UI: QA staging xác nhận lại trên build fix (popup 2 lô + reload).
