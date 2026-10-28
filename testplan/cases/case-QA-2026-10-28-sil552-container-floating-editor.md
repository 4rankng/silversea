# Case: SIL-552 — Drawer Thông tin hàng: ô SỐ CONTAINER chỉ nhãn + giá trị, editor NỔI

- **Ticket:** SIL-552 (board id 626) — Owner 28/10: bảng "Thông tin hàng" (drawer
  CusLotView) — ô SỐ CONTAINER render vỡ: nhãn SỐ / LOẠI / TRỌNG LƯỢNG rời rạc,
  placeholder "Nhập kg" gãy thành chữ dọc ("Nh\nập\nkg"), cả khối lệch baseline
  so với SỐ TỜ KHAI.
- **Date:** 2026-10-28
- **Branch:** fix-626-tthang (off main 48469837)
- **Surface:** `frontend/src/features/shipments/cus/CusLotView.tsx` (ô SỐ CONTAINER
  + editor nổi) + `frontend/src/pages/ShipmentsPage.css` (hình học sheet + panel)
  + `frontend/src/hooks/usePopoverPosition.ts` (tuỳ chọn align 'left') +
  `frontend/src/components/control-density.styles.test.ts` (scope sanctioned).

## Bug (trước)

1. Ô SỐ CONTAINER nhét editor NGAY TRONG Ô: editor bị cột 240px bóp →
   placeholder "Nhập kg" vỡ thành chữ dọc, nhãn lệch khỏi control, cả khối lệch
   baseline so với ô SỐ TỜ KHAI (control 36px vs nhãn 20px lệch dải).
2. Sheet không có hình học cột cố định: auto layout bóp nhóm SỐ CONTAINER
   (~120px), "20DC" bị vendor cắt thành "20…".
3. Ô SỐ TỜ KHAI: hint "Nhập số tờ khai…" bị cắt giữa chữ trong hộp mono 11ch.

## Owner rulings (2 lần, 28/10)

1. **Design lock:** bảng `table-fixed` + `<colgroup>` [56, 240, 160, 180, 180,
   160, 120, 120, 120, 120] = sàn 1456px, wrapper `overflow-x-auto`; mỗi dòng
   field = 1 hàng 36px, nhãn `shrink-0` + `nowrap` + leading-5, control lane
   theo ch; td `align-top`, cột text `break-words` KHÔNG truncate.
2. **Quyết định lần 2 (thay đổi cách làm):** "instead of having input component
   occupy the cell (which already limited width) we just put the label, click to
   show floating input component" — ô CHỈ giữ nhãn + giá trị; editor NỔI trên
   bảng nên bề rộng editor không còn bị cột bóp.

## Expected behavior (AC)

1. **Ô SỐ CONTAINER:** 3 dòng (SỐ / LOẠI / TRỌNG LƯỢNG), mỗi dòng = nhãn +
   giá trị; ô KHÔNG chứa input/select/combobox nào. Mỗi dòng là một ghost
   trigger (SIL-483): click mở editor nổi.
2. **Editor nổi:** panel `role="dialog"` portalled ra `document.body` (wrapper
   bảng `overflow-x:auto` ⇒ `overflow-y` cũng auto ⇒ panel trong bảng bị cắt),
   `position: fixed`, neo theo dòng đang sửa, rộng 300px tự do (không bị cột
   giới hạn), mũi tên trỏ về dòng + viền accent để chủ panel rõ, shadow nhẹ,
   `overflow: clip` + `overflow-clip-margin` (không cắt mũi tên, không cắt
   listbox react-aria).
3. **Commit:** Enter hoặc nút "Lưu" commit ngay qua container-line command;
   commit `false` → panel vẫn mở (giữ draft, lỗi do host toast); Escape hoặc
   click ngoài → hoàn draft, đóng panel; Escape/commit → focus quay lại trigger.
   LOẠI commit ngay khi chọn (contract SIL-508 giữ nguyên).
4. **Tên truy cập phân biệt:** trigger = HÀNH ĐỘNG ("Chỉnh sửa trọng lượng —
   dòng 1"), input nổi = TRƯỜNG ("Trọng lượng — dòng 1"), panel = "Chỉnh sửa
   thông tin container — dòng 1".
5. **Sheet:** colgroup 10 cột + `table-layout: fixed` + sàn 1456px, cuộn ngang
   TRONG card (không cuộn trang), td `align-top`, cột text không truncate.
6. **Số tờ khai:** hint hiện trọn trong hộp mono 11ch ("Số tờ khai").

## Out of scope

- Các cột khác của sheet (NHÀ MÁY / TUYẾN / CẢNG / ĐÓNG-TRẢ / TRẠNG THÁI) vẫn
  read-only trong drawer (luật SIL-485).
- Không đổi luật gate 2 lớp (gate trang + `fieldAccess.<field>.mode === 'DIRECT'`).
- Không đụng form tạo lô (ClerkShipmentCreatePage) — ô SỐ CONTAINER của form
  tạo lô là surface khác, không nằm trong ticket này.

## Regression evidence

- Unit: `frontend/src/features/shipments/cus/CusLotView.sil552-geometry.test.tsx`
  (7 case: nhãn + giá trị cùng dòng; ô KHÔNG chứa input; colgroup 10 cột; panel
  nổi role=dialog + ngoài bảng + ô số + kg + mũi tên; panel SỐ mono; panel LOẠI
  có select; hint SỐ TỜ KHAI trọn) + `CusLotView.container-group.test.tsx`
  (8 case SIL-508, cập nhật theo panel nổi) + `ShipmentsPage.density.test.ts`
  (hình học colgroup/table/lane/panel) + `control-density.styles.test.ts`
  (scope sanctioned cho select value).
- Rung-3: `qa/2026-10-28_sil552-tthang/` — driver `drive.mjs` (admin, token-inject
  trước SPA load): ảnh 1280 (ô + cả bảng + editor nổi), đo hình học từng dòng
  (baselineDelta = 0px cho cả 3 dòng, không control nào < 60px ⇒ không cắt chữ
  dọc), sheet cuộn trong card (scrollWidth 1456 > clientWidth 1127) + trang KHÔNG
  cuộn (1280 = 1280), edit-flow: POST `/cus-workspace/303/containers/347` 200 →
  toast "Đã lưu trọng lượng" → GET đọc lại `cargoWeightKg = 13579.00` → restore
  về giá trị gốc (200).
