# Case: SIL-508 — Drawer Tổng quan: cột SỐ CONTAINER group 3 dòng click-to-edit + SỐ TỜ KHAI 11 chars + bỏ h-scroll

- **Ticket:** SIL-508 (board id 570) — Owner 26/10: bảng Thông tin hàng (drawer
  CusLotView) — LOẠI + TRỌNG LƯỢNG gộp vào cột SỐ CONTAINER (3 dòng, click
  từng dòng edit riêng theo pattern SIL-483); SỐ TỜ KHAI width đúng 11 ký tự;
  bỏ horizontal scrollbar ở viewport chuẩn.
- **Date:** 2026-10-26
- **Branch:** fix-508-cols (off main 183a901c)
- **Surface:** `frontend/src/features/shipments/cus/CusLotView.tsx` (drawer
  Thông tin hàng) + `frontend/src/pages/ShipmentsPage.tsx` (wire) +
  `frontend/src/pages/ShipmentsPage.css`.

## Bug (trước)

1. LOẠI + TRỌNG LƯỢNG là 2 cột đứng riêng → bảng 12 cột, `min-width: 1200px`
   → h-scroll trong drawer ở 1440/1280.
2. Ô SỐ TỜ KHAI `min-width: 180px` → "ô input phình".
3. SỐ/LOẠI/TRỌNG LƯỢNG read-only hoàn toàn — sửa phải mở form Sửa (toàn trang).

## Expected behavior (AC)

1. **SỐ CONTAINER group**: cell stacks 3 dòng micro-label —
   `SỐ` (mono, click-to-edit text), `LOẠI` (UuiSelectField listbox từ
   `detail.selectors.containerTypes`, chọn là lưu ngay), `TRỌNG LƯỢNG`
   (click-to-edit số, lọc ký tự, seed giá trị raw). Mỗi dòng commit qua
   `POST /shipments/cus-workspace/:shipmentId/containers/:containerId`
   (container-line command) với đúng một field (`containerNumber` /
   `containerTypeId` / `cargoWeightKg`) + `expectedShipmentVersion`;
   thành công → toast "Đã lưu …" + detail force-reload; thất bại → editor
   giữ mở, toast lỗi (host). Escape/outside hoàn draft.
2. **Gate hai lớp**: gate trang (intake-mutation role + không khóa kế toán +
   detail loaded) VÀ `line.fieldAccess.<field>.mode === 'DIRECT'`. Line bị
   chặn render plain text, không bao giờ quảng cáo edit.
3. **Bảng 10 cột** (bỏ header `Loại`, `Trọng lượng`), `width: 100%` không
   `min-width` → không h-scroll ở 1440/1280 (bảng + drawer + page
   `scrollWidth === clientWidth`). Canvas hẹp (≤768) vẫn scroll trong card
   (không tràn drawer/trang) — ladder SIL-485 giữ nguyên.
4. **SỐ TỜ KHAI**: input mono `11ch` (~82px), không còn min-width 180px.
5. Dòng SỐ trống (read-only) nêu thiếu bằng chữ "Chưa có số cont"
   (QA-AUDIT-UI-08); dòng editable trống hiển thị placeholder "Nhập số cont".

## Out of scope

- NHÀ XE/BKS, CẢNG NÂNG/HẠ, TUYẾN, ĐÓNG/TRẢ: vẫn read-only trong drawer
  (SIL-485 law — chỉ tờ khai SIL-498 và nhóm SỐ CONTAINER SIL-508 là ngoại
  lệ inline).
- Xóa/clear LOẠI về trống qua select (owner không yêu cầu; placeholder chỉ
  hiện khi line chưa có loại).

## Regression evidence

- Unit: `frontend/src/features/shipments/cus/CusLotView.container-group.test.tsx`
  (8 case: 10 cột, 3 dòng, empty-text, Enter commit + retry-on-false,
  Escape revert, LOẠI commit-on-change, fieldAccess chặn từng dòng, gate đóng).
- Rung-3: `qa/2026-10-26_sil508-cols/` — driver `drive.mjs` (cus/Abc123,
  token-inject trước SPA load), screenshots 1440/1280 (+390/768 narrow),
  DOM assertions (headers, group lines, scrollWidth), edit-flow: POST 200
  `/cus-workspace/349/containers/368` → toast "Đã lưu trọng lượng" →
  GET đọc lại `cargoWeightKg=13579.00` → restore về giá trị gốc (200).
