# Case QA-2026-10-04-337 — Lỗi feed âm thầm ngoài pages/config: dialog tạo điểm vận hành, cài đặt hệ thống, dropdown form CrudTable (card 20261004_337)

- Card: 20261004_337-silent-failure-residual-batch (residual của AC4 quét lớp card 20261004_333, UI bug P3)
- Environment: local dev (:7175) cho DEV evidence; staging https://vantai.tingting.vip cho QA rung
- Account: dungnv / Abc123 (Điều vận) — hoặc tài khoản admin Khai báo
- mutates: none (read-only navigation + mở form + click "Thử lại")

## Repro (pre-fix, 3 nhóm)

1. **Nhóm 1 — dialog tạo nhà máy / kho:** DevTools → Network chặn `GET /api/customers/all` (hoặc
   `/api/catalogs/*` customers) → Khai báo → Nhà máy / Kho → bấm "Tạo mới". Hộp chọn "Khách hàng" chỉ
   còn "— Chọn khách hàng —" (giống catalog trống), không lỗi, không thử lại. Chặn tuyến đường →
   "— Chọn tuyến đường —" trống tương tự (bắt buộc với nhà máy).
2. **Nhóm 2 — Cài đặt (`/config/app-settings`):** chặn `GET /api/users/business-units` → "Phạm vi chốt
   kỳ lương" bị disable im lặng, chỉ còn "Toàn công ty" (giống "không có đơn vị"). Chặn
   `GET /api/app-settings` / OCR / email / pair-salary → form disable, lỗi chỉ là dòng chữ nhỏ sau nút
   Lưu (thô, không có "Thử lại"); hoàn toàn không có banner.
3. **Nhóm 3 — dropdown form CrudTable:** mở form Thêm/Sửa ở
   `/config/fuel-norms` (Tuyến đường), `/config/road-allowances` (Tuyến đường),
   `/config/lift-pricing` (Cảng/bãi + Loại container), `/config/pricing-tables`
   (Khách hàng + Tuyến + Loại container), `/config/freight-terms` (Khách hàng + Tuyến);
   chặn feed tương ứng (`/api/config/routes-list`, `/api/customers/all`, `/api/config/ports`,
   `/api/config/container-types`) → ô chọn trống trơn "-- Chọn --", không dấu hiệu lỗi.

## Expected (post-fix)

- Feed lỗi → **Alert lỗi + nút "Thử lại"** ngay cạnh/bên trên ô chọn; ô chọn bị disable; placeholder
  đổi sang "— Lỗi tải danh sách … —" / nhãn "Lỗi tải … — thử lại"; KHÔNG render "rỗng"/"không có lựa
  chọn" khi query lỗi.
- Nhóm 2: mỗi read-feed lỗi có banner riêng + "Thử lại" (appSettings, businessUnits, OCR, email, pair-salary,
  chính sách báo cáo, hồ sơ tài chính xe); save vẫn disable khi read lỗi.
- Đang tải → ô chọn disable + "Đang tải …" (dialog) hoặc giữ nguyên disable/loading hiện có (sections).
- Feed thành công (có dữ liệu hoặc trống) → render y nguyên như trước khi fix (AC2).
- Cùng lớp (AC4): instance còn lại ngoài 3 nhóm → bảng quét trong REPORT của card (lãnh đạo quyết định).

## Rungs

- TEST VERIFIED (red-first cho phần gap còn thiếu): `AppSettingsConfigPage.read-errors.test.tsx`
  rung pair-salary RED trước fix (feed reject → không có banner, chỉ form câm) → GREEN sau fix. Các
  rung lỗi-feed còn lại (dialog customers/routes, appSettings, businessUnits, OCR, email, finance retry,
  5 trang group-3 + feed phụ) được chứng minh "regression-adequate" bằng mutation check (bẻ nhánh lỗi
  → test đỏ) vì landing nằm ngoài cây phối hợp nên không quan sát được red-first lịch sử.
- UI DRIVEN (visual rung, lead): Network-block repro theo Expected ở trên; matrix từng surface ×
  with-data/empty/error; kiểm tra nút "Thử lại" thật sự refetch (unblock → dữ liệu về).

## Status

- [x] TEST VERIFIED rung (scoped vitest green + tsc clean) — xem REPORT card 337
- [ ] UI DRIVEN visual rung (lead) — 04/10 pending
