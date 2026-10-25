# SIL-479 — Khối "Chi tiết container" trên /shipments/:id bị khoá horizontal scroll trên desktop dù trang còn chỗ

- **Case ID:** SIL-479-REG-1
- **Ticket:** plan.tingting.vip SIL-479 (internal id 538, high) — owner frankn.sg 24/10, ảnh `/shipments/221`
- **Surface:** `CusContainerLedger` (khối "Chi tiết container") host trên trang chi tiết lô `/shipments/:id` qua `ShipmentDetailContainerManagement` → `.shipment-detail__card--flush`
- **Role:** ADMIN / MANAGER / CUS / DISPATCHER (mọi role thấy khối quản lý container)

## Reproduction

1. Mở `/shipments/:id` của một lô FCL có ≥1 container (local: `/shipments/300`, 1 cont, role `cus`) ở viewport desktop **1024 hoặc 1440**.
2. Nhìn khối "Chi tiết container": bảng 12 cột (CONTAINER · SỐ TỜ KHAI · LOẠI CONT · TUYẾN · ĐIỀU VẬN · NHÀ XE · BIỂN SỐ · NÂNG · HẠ · TRỌNG LƯỢNG · GIỜ HẸN · THAO TÁC).

## Observed (trước fix)

- Bảng có **horizontal scrollbar** dù viewport desktop còn không gian trống: wrapper page ≈1126px @1440 / ≈966px @1024 nhỏ hơn `min-width: 1238px` của `.cus-container-table` ⇒ phần bảng bên phải (từ BIỂN SỐ đi) nằm ngoài màn, phải scroll ngang mới thấy.
- Nguyên nhân nằm ở luật chung drawer FB-045 (card 201026140000): px floors 12 cột cộng đúng 1238px + wrapper `overflow-x: auto` — đúng cho drawer 1180px, nhưng host trang `/shipments/:id` dùng chung CSS nên cũng bị khoá cùng min-width dù wrapper page rộng/hẹp khác drawer.

## Expected

- Viewport **≥1024** (desktop): bảng full-row theo container trang (width 100%), **không scrollbar ngang** ở cả 1440 lẫn 1024; 12 cột co giãn theo % với floor hành vi giữ nguyên ở wrapper hẹp nhất **đo thực tế 863px @1024** (giờ hẹn 17.5% = 151px ≥ 150; Thao tác 12.4% = 107px ≥ 100 — floor hành vi re-derived, không phải px floor 164/116 của drawer).
- Viewport **<1024** (390…1023): giữ nguyên scroll ngang như cũ (luật mobile table).
- Drawer Tổng quan (host `.cus-shipment-drawer`): **không đổi** — luật scroll-x riêng của drawer (FB-045) vẫn nguyên.
- Hành vi input/dropdown/row "Chưa có số container": không đổi.

## Fix

`frontend/src/pages/ShipmentsPage.css` — block `@media (min-width: 1024px)` scoped `.shipment-detail__card--flush` (chỉ host trang): `.cus-container-table { min-width: 0 }` + 12 col width thành % (tổng 100%). `frontend/src/pages/ShipmentDetailPage.css` — cùng band: `.shipment-detail__card--flush { grid-column: 1 / -1 }` (card full-row). Luật base (px floors + 1238px) giữ nguyên cho drawer + tablet/phone.

## Lưu ý owner (ratification)

Số container ở cột CONTAINER trên band trang desktop này **bọc 2 dòng** khi cột hơn 79px (base rule `white-space: nowrap` theo user ruling 2026-09-18 chỉ giữ được ở floor 120px drawer) — nowrap ở 9.2% share sẽ tràn đè cột Số tờ khai. Cần owner xác nhận chấp nhận wrap trên host trang (drawer giữ nguyên 1 dòng).

## Regression coverage

- Pin SCSS contract: `ShipmentsPage.density.test.ts` — luật full-row page-host ≥1024 (scoped, % floors, appointment/actions floor) + luật base 1238px không bị xoá.
- Driver trước/sau: `qa/scripts/2026-10-25-sil479-container-fullrow-shots.mjs` (WIDTH=1024|1440|390) — sau fix `scrollWidth <= clientWidth` ở 1024/1440, 390 vẫn scroll.
- Screenshots: `qa/2026-10-25-sil479/`.
