# SIL-1222 (id 1405) — /ops/orders mở chi tiết lô: affordance + đích /shipments/:id (regression case)

Case ID: TC-SIL1222-01
Feature: /ops/orders "Kế hoạch làm hàng" → chi tiết lô: click thân dòng / mã Bill-Booking, đích `/shipments/:id` (`ShipmentDetailPage` → `ShipmentCreateWorkspace` viewMode).

## Đặc tả (nguồn: thẻ SIL-1222 + comment QA 28/11, build 61999831)
- Trước fix: click dòng (body cell) hoặc mã BILL (vd EGLV149607019409) không phản hồi; danh sách 675 dòng chỉ có 2 thao tác (ghim + Khai chi phí); không route tới `/shipments/:id`.
- Mong đợi: có đường xem chi tiết đơn từ danh sách (click dòng/mã → chi tiết lô hàng).
- QA fail lần 2 (comment 10488, build 61999831): affordance ĐÃ có — click đưa tới `/shipments/2`, URL ổn định (0,5s/1s/2s/3s) — nhưng đích chỉ hiện trạng thái trống "Chưa có khách hàng — Cần ít nhất một khách hàng trước khi tạo lô hàng." với vai Ops (hoangnh). API `/api/ops/orders` trả đúng lô id 2; `/api/shipments/2` 200 đủ dữ liệu cho vai Ops; cùng URL vai Chứng từ xem bình thường. 390/360px cùng trạng thái trống.

## Nguyên nhân (chẩn đoán 28/11)
- "Chưa có khách hàng" là precondition catalog của luồng TẠO (`ShipmentCreateWorkspace.tsx:1065`) — trước fix gate không có hạn chế `createMode &&` nên nuốt luôn route chi tiết khi catalog customers rỗng.
- Catalog customers rỗng với vai Ops vì `/catalogs/bootstrap` còn policy thời FORWARDER (sau đổi tên OPS): `bootstrapForRole` (`backend/src/services/config.service.ts`) cắt subset portal (customers: []) cho OPS — chỉ DRIVER đáng được strip.

## Fix đã land (không phải commit của lane này)
- `d8f87018` (SIL-1266, 28/11): gate `createMode && !catalogs?.customers.length` (create-only — không bao giờ hiện trên route chi tiết/view-edit) + `bootstrapForRole` chỉ strip DRIVER; OPS đọc catalog đầy đủ.
- Affordance `/ops/orders` (`OpsOrdersPage.tsx`): Bill/Booking là link THẬT tới `/shipments/:id` (bàn phím tới được, hover hiện URL, mở tab mới); thân dòng mở chi tiết; control của dòng (ghim, [Khai chi phí]) giữ hành vi riêng — selector guard theo pattern nhà MasterPlanGrid (FB-014).

## Automated pins (chạy 29/11, xanh)
- `frontend/src/pages/ShipmentDetailPage.render.test.tsx` — SIL-1222 C1 vai Ops mở đích thấy "Chi tiết lô hàng", không blank state (mock bootstrap `{customers: [], routes: []}` đúng shape QA); C2 CUS parity; C3 `/shipments/new` giữ gate create khi thiếu customers (negative control); C4 edit context (Sửa lô full-page + SIL-1150 drawer) render lô.
- `frontend/src/pages/OpsOrdersPage.row-detail-navigation.test.tsx` — link Bill/Booking + click thân dòng mở chi tiết; control của dòng không mở.
- Scoped run 29/11: 15/15 tests (2 file trên) · backend `src/tests/unit/catalog-bootstrap-role-shape.test.ts` 3/3 (DRIVER strip subset; OPS + staff full blob) · `npx tsc -b` (frontend) 0 lỗi · `npx tsc --noEmit` (backend) 0 lỗi.

## Quy tắc hiển thị (shipmate-uiux doctrine)
- §6 Empty states: informational, đúng ngữ cảnh — gate create-only; empty state không bao giờ thay chi tiết đã tải.
- Affordance link thật đọc được là link (mực brand + gạch chân — block SIL-1222 trong `OpsOrdersPage.css`); không truyền meaning bằng màu alone.

## Not covered bởi hồ sơ này
- Rung 3 UI DRIVEN trên staging build mới thuộc cột QA theo chỉ đạo lane "Scoped tests + tsc" — QA retest click dòng/mã trên build chứa `a7311651` với vai Ops (build 61999831 CŨ hơn cả 2 fix).
- Cột "Hoàn thành" không action (ticket ghi hợp lý) — không đổi.
