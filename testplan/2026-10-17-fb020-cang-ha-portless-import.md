# Card 171026205400 — FB-020: IMPORT Cảng hạ trống + Địa chỉ giao hàng đíp địa chỉ nhà máy (R21 verify-fail, REGRESSION)

Case IDs: TC-FB020-001, TC-FB020-002, TC-FB020-003
Feature: driver trip detail `/my-trips/:id` — THÔNG TIN LỆNH grid, rows
"Cảng hạ" và "Địa chỉ giao hàng" (shared chain: `backend/src/services/delivery-stage.ts`,
consumers: driver fulfillment detail + driver journey-board card).

## Bối cảnh thẻ (R21 verify-fail)

QA R21 regression trên trip `E2EROLE001` (`/my-trips/135`, staging: bqhuong,
IMPORT FCL, shipment 326, container 256): "Cảng hạ" = "Chưa có cảng hạ" trong
khi "Địa chỉ giao hàng" = "Nhà máy Long Minh - Võ Cường, Khu 2, Phường Võ
Cường, Tỉnh Bắc Ninh" → tài xế hiểu nhầm địa điểm. Staging census
(2026-10-17, API read-only): container 256 KHÔNG có port (dropoff_port_id
null, raw_dropoff_port_name null), `shipments.deliveryLocation` null,
`trips.canonical_destination` null — nguồn dữ liệu hạ duy nhất của lệnh là
siteSnapshot.deliverySite = "LM Võ Cường" (điểm trả hàng của tác vụ, ghi tại
decompose từ operational site của container).

## Root cause

Chain `resolveDeliveryStage` (ruling 2026-09-18, port-first) chỉ đọc
cảng container → free-text điều vận; khi cả hai rỗng nó trả null — màn hình
rơi "Chưa có cảng hạ" dù tác vụ vẫn mang điểm trả hàng trong snapshot của
chính nó. PRD `ManHinhLaiXe.md` §2.3 (restated 2026-10-09, `1a1a227e`):
"điểm hạ thật của công việc … theo dữ liệu điều vận; điểm giao hàng/nhà máy
không dùng **thay** cho điểm hạ, **khi hai điểm là cùng một nơi thì hai hàng
cùng tên**" — và directive 2026-10-17 (`liftDropPoints.ts`, FB-105 §3):
IMPORT: Hạ = Nhà máy (Điểm trả hàng). Snapshot deliverySite chính là dữ liệu
điều vận của điểm trả — nó đóng chuỗi khi không có cảng/free-text, không bao
giờ thay thế cảng/free-text đã ghi (lỗi "Hạ NEWEB-1" 2026-09-18 vẫn chết).

## Expected (sau khi sửa)

- TC-FB020-001 — IMPORT, KHÔNG port, KHÔNG free-text, CÓ snapshot
  deliverySite (hình trip 135): "Cảng hạ" hiển thị tên điểm trả (snapshot
  name), "Địa chỉ giao hàng" hiển thị `<factory full name>, <factory
  address>` — hai hàng cùng tên chỗ, mỗi nhãn đúng nghĩa; journey card "Hạ"
  chip cùng giá trị.
- TC-FB020-002 — IMPORT có cảng hạ ghi nhận (port hoặc free-text): "Cảng hạ"
  = cảng/điểm điều vận, "Địa chỉ giao hàng" = nhà máy — ĐÚNG RIÊNG, không đổ
  lẫn (FB-082 card 121026141020 giữ nguyên).
- TC-FB020-003 — IMPORT thiếu hẳn (không port, không free-text, không
  snapshot): "Cảng hạ" = "Chưa có cảng hạ" (không đổ địa chỉ khách vào);
  "Địa chỉ giao hàng" vẫn theo dữ liệu nhà máy (ẩn khi không có — FB-082).
- EXPORT: branch không đổi — export drops at the port (1f1133ae), snapshot
  factory không bao giờ đóng chuỗi EXPORT.

## Reproduction steps (TC-FB020-001)

1. Local stack (`make dev`) + seed/hoặc tạo lô IMPORT FCL có container với
   operational site (không chọn cảng hạ), decompose + phát lệnh cho tài xế.
2. Đăng nhập driver → `/my-trips/:id`.
3. Before: "Cảng hạ" = "Chưa có cảng hạ". After: "Cảng hạ" = tên điểm trả
   (site), "Địa chỉ giao hàng" = tên đầy đủ + địa chỉ nhà máy.
