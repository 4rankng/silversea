# SIL-493 — Tách nhóm (Điều vận): cước trả ĐV Lô 1 không hiện lại, editor đọc 0₫

- **Ticket:** SIL-493 (board id 555, In Progress → QA)
- **Reported:** QA Glint 25/10 trên staging build `c8f68a26`
- **Severity:** P0 / money-channel · **Type:** regression case (COST dissolve)

## Bug

"Gán xe nhóm" 2 lô LCL với Cước trả ĐVVC nhập tay 1.000.000₫ (nhà xe THẾ
LUÂN, BKS 99H-004.59, Xe tải 5 tấn) → "Tách nhóm" → mở "Chỉnh sửa điều phối"
từng lô: CẢ HAI lô "Cước trả dự kiến" = 0. Dialog tách hứa "tiền cước 100%
của Lô 1 vẫn giữ nguyên trên Lô 1" nhưng không hiện ở kênh nào của ĐV.

### Root cause

"Cước trả dự kiến" trong popup điều phối là cột
`shipment_fulfillments.planned_carrier_cost` — kênh duy nhất dispatcher sửa
được, mà flow gán nhóm KHÔNG BAO GIỜ ghi vào:

- `assignLclCostGroup` → `applyPrincipalCostFreight` chỉ ghi
  `trip_carrier_info.external_freight_cost` (kênh chuyến) + cột sticky
  `shipments.cost_group_freight_manual`.
- `unmergeLclGroup` (COST) chỉ gỡ membership (`costGroupId/costGroupOrder`)
  — tiền đúng là GIỮ trên Lô 1 (kênh trip + sticky manual, luật conserva-
  tion đúng), nhưng không kênh nào feeding editor.

→ Sau tách, tiền của Lô 1 "vẫn giữ nguyên" ở đâu đó nhưng dispatcher không
thấy/sửa được qua editor — hứa không hiển thị.

## Expected

Sau "Tách nhóm" COST:

- Lô 1: "Cước trả dự kiến" = 1.000.000₫ (manual nhóm; nếu nhóm auto-trace
  thì = giá bảng đã land trên chuyến).
- Lô 2..N: giữ ước tính riêng của chính lô (chờ định giá lại khi ghép nhóm
  mới — đúng copy dialog); chưa từng có giá riêng thì để trống, không bịa 0₫.

## Fix (ONE law, mọi chỗ tiền COST "đổ bộ" lên một lô)

Helper mới `mirrorPlannedCarrierCost` (lcl-cost-group-freight.service.ts):
ghi số tiền đã LAND vào `planned_carrier_cost` của các fulfillment live của
lô giữ tiền (không có tiền ⇒ không ghi — không bịa 0₫; member chờ định giá
lại không bị mirror, giữ ước tính riêng của nó). Gọi tại 4 seam cùng luật:

1. `unmergeLclGroup` COST (tách cả nhóm): Lô 1 ← manual ?? trip freight
   (non-zero) — **fix chính của ticket**.
2. `promotePrincipalOnRemoval` COST (Hủy ghép Lô 1 / Xóa Lô 1): promotee ←
   tiền được chuyển ("nhận 100% cước trả ĐV" phải thấy được).
3. `applyPrincipalCostFreight` (Gán xe nhóm / SỬA nhóm): Lô 1 ← manual /
   giá bảng đã land.
4. `applyLclCostGroupFreightToNewTrip` (phát lệnh sau khi gán khi lô chưa
   có chuyến): Lô 1 ← manual / giá bảng đã land trên chuyến mới.

## Regression coverage

- `backend/src/tests/unit/lcl-gop-hang-money-wiring.test.ts` — source-scan
  pins mới: mirror được gọi ở cả 4 seam; mirror KHÔNG chạy cho member
  chờ định giá; không tiền ⇒ không ghi.
- Manual của nhóm vẫn sống tới phát lệnh (pins cũ giữ nguyên pass).
