# SIL-665 — Trang chuyến lái xe: khung ảnh Cont/Seal phải bấm được, bỏ 2 nút 'Thêm ảnh' thừa

- **Ngày báo cáo:** 03/11/2026
- **Mức:** UI/UX bug — driver portal touch surface defect
- **Branch:** `fix/sil665-trip-photo-frame`

## Hiện trạng (trước fix)
Mục Hình ảnh trên trang chuyến lái xe (`/my-trips/:id`):
Khung placeholder Cont và Seal là thẻ tĩnh (`div.dcc-bento__thumb-empty`), không bấm được — tài xế chạm vào khung không có phản hồi.
Phía dưới khung có 2 nút riêng "Thêm ảnh cont" và "Thêm ảnh seal" (cùng nút "Thêm ảnh biên bản"). Chỉ 2 nút riêng này mới mở hộp thoại chọn ảnh ("Chụp ảnh / Chọn từ thư viện / Hủy").

## Mong đợi
1. Bấm vào KHUNG placeholder Cont → mở hộp thoại chọn ảnh của Cont (Chụp ảnh / Chọn từ thư viện / Hủy).
2. Bấm vào KHUNG placeholder Seal → mở hộp thoại chọn ảnh của Seal (đúng mục, không nhầm sang Cont).
3. Bỏ 2 nút riêng 'Thêm ảnh cont' / 'Thêm ảnh seal' thừa ở mục Hình ảnh sau khi khung đã bấm được.
4. Nút "Thêm ảnh biên bản" (và các mục ảnh khác nếu có) giữ nguyên.
5. Vùng chạm tối thiểu 44×44 (khung 96×96 đáp ứng tiêu chuẩn touch mobile, click handler trên toàn khung).
6. Luồng upload/preview sau khi chọn ảnh giữ nguyên: khi đã có ảnh, bấm vào ảnh mở photo viewer; aria-label hợp lý ("Thêm ảnh cont" / "Thêm ảnh seal" khi rỗng, "Xem ảnh cont" / "Xem ảnh seal" khi đã có ảnh).

## Regression case & Test plan
1. `DriverContainerCard.test.tsx`:
   - TC1: Bấm khung Cont rỗng trong saved bento view mở action sheet với title "Thêm ảnh cont".
   - TC2: Bấm khung Seal rỗng trong saved bento view mở action sheet với title "Thêm ảnh seal".
   - TC3: Hai nút thừa 'Thêm ảnh cont' và 'Thêm ảnh seal' không còn trong bento view; chỉ còn nút "Thêm ảnh biên bản".
   - TC4: Khi ảnh đã có (cont/seal photo present), khung chuyển thành nút xem ảnh ("Xem ảnh cont" / "Xem ảnh seal") mở PhotoViewer; không có nút "Thêm ảnh cont/seal".
   - TC5: Luồng upload ảnh cont/seal thông qua input file khi trigger từ khung giữ nguyên.
2. `DriverTripDetailPage.test.tsx`:
   - Tất cả các tests hiện hữu tiếp tục pass.
3. UI drive verification (Rung 3):
   - Chạy puppeteer script giả lập tài xế bqhuong đăng nhập local dev, mở chi tiết chuyến có container, chụp ảnh trước và sau khi click vào khung placeholder để chứng minh action sheet mở lên trực tiếp từ khung.

## Kết quả thực tế & Bằng chứng kiểm thử (Evidence)
- **Vitest**: `cd frontend && pnpm test src/components/trip/DriverContainerCard.test.tsx src/pages/DriverTripDetailPage.test.tsx`
  - 2 test files, 93 passed (100% green), exit code 0.
  - Log: `qa/2026-11-03_sil665/vitest-scoped.log`.
- **TypeScript**: `pnpm exec tsc -p frontend/tsconfig.json --noEmit`
  - 0 errors, exit code 0.
  - Log: `qa/2026-11-03_sil665/tsc.log`.
- **ESLint**: `pnpm eslint frontend/src/components/trip/DriverContainerCard.tsx frontend/src/components/trip/DriverTripPhotos.tsx frontend/src/components/trip/DriverContainerCard.test.tsx`
  - 0 errors, exit code 0.
  - Log: `qa/2026-11-03_sil665/eslint.log`.
- **UI Driver Rung 3 (Local dev)**:
  - Script: `qa/scripts/2026-11-03-sil665-trip-photo-frame-ui.mjs`.
  - Log: `qa/2026-11-03_sil665/2026-11-03_sil665_ui-driver.log`.
  - Artifacts:
    - `qa/2026-11-03_sil665/2026-11-03_sil665_ui-01-bento-photos-before-click-390.png`: Hiển thị 2 khung Cont và Seal (class `dcc-bento__tile-btn--empty`) và chỉ còn duy nhất 1 nút "Thêm ảnh biên bản" bên dưới (đã loại bỏ 2 nút thừa).
    - `qa/2026-11-03_sil665/2026-11-03_sil665_ui-02-cont-dialog-opened-from-frame-390.png`: Bấm khung Cont mở hộp thoại "Thêm ảnh cont" với các lựa chọn "Chụp ảnh", "Chọn từ thư viện", "Hủy".
    - `qa/2026-11-03_sil665/2026-11-03_sil665_ui-03-seal-dialog-opened-from-frame-390.png`: Bấm khung Seal mở hộp thoại "Thêm ảnh seal" đúng mục.
    - `qa/2026-11-03_sil665/2026-11-03_sil665_ui-04-bento-desktop-1440.png`: Giao diện bento desktop 1440px.
    - `qa/2026-11-03_sil665/2026-11-03_sil665_ui-05-cont-dialog-desktop-1440.png`: Desktop bấm khung Cont mở hộp thoại thành công.

