# SIL-1255 (id 1532) — Ô Khách hàng 67px / Hãng tàu 54px trên form lô (regression case)

Case ID: TC-SIL1255-01
Feature: Form lô hàng — section "Nhận diện lô" (`ShipmentCreateIdentitySection` trong `ClerkShipmentCreatePage`/`ClerkShipmentCreateEditPage`/`ShipmentCreateWorkspace`), ô combobox Khách hàng (`USearchableField`/`ComboBox`) và Hãng tàu (+✎).

## Đặc tả (nguồn: thẻ SIL-1255, build 61999831, staging 28/11/2026, vai Chứng từ/tiepvv, 1440px)
- Trước fix: ô nhập Khách hàng 67px (tên "Long Minh" cắt "Lo…"), ô Hãng tàu 54px (placeholder cắt), trong khi ô Số Bill/Booking cùng section rộng 567px; nút ✎ hãng tàu trôi ~540px khỏi ô nhập. 390px: cùng ô Khách hàng 358px, hiện đủ tên — chỉ desktop bị bóp.
- Mong đợi: ô Khách hàng và ô Hãng tàu rộng bằng ô Số Bill/Booking (đầy cột của nó), tên đã chọn hiện đủ.

## Nguyên nhân (chẩn đoán 28/11)
- Chuỗi bề rộng của ComboBox là `w-full` thuần phần trăm, intrinsic width KHAI BÁO THẤP (tiền lệ house: ListFilterBar.css "65px sliver"); root ComboBox (`combobox.tsx`) không có width.
- Block label-beside `@media (min-width: 1280px)` (`ClerkShipmentCreatePage.onescreen.css` — AstraQA2 28/11) đặt control lane `flex: 1 1 auto` (basis auto → intrinsic under-report) + label nowrap (`flex: 0 0 auto`) + gap 10px là claimant cố định; `min-width: 0` (combobox.css) biến input gốc thành sink co giãn → crush về padding box (10+44=54px đúng số đo Hãng tàu; 67px = floor + sliver).
- Kèm: lane hint/error (`flex: 1 1 100%`) bị rule `.csc-uui-field > :not(label)` (specificity cao hơn) nuốt — hint ngồi chung dòng control, giành thêm bề rộng.

## Thiết kế đã chọn
- Control lane đổi `flex: 1 1 auto` → **`flex: 1 1 0`** (basis 0 tất định: control lấy TRỌN phần còn lại của dòng, bất kể intrinsic khai báo thấp) ở cả hai rule (wrapper `.csc-uui-field`/`.ds-uui-select__control` và con `> :not(label)`).
- `:not(label)` → `:not(label, [slot='description'], [slot='errorMessage'], .ds-uui-select__hint, .ds-uui-select__error, .csc-field-warning)` — lane validation giữ `flex: 1 1 100%` (dòng riêng), không bao giờ chia bề rộng control.
- Layout label-beside (AstraQA2, cùng ngày, audit lever "single-column stacks → tighter rows") GIỮ NGUYÊN — chỉ sửa bề rộng control; label + trailing action (＋/✎) vẫn cạnh control, nút hết trôi ra mép.
- Không sửa ComboBox internals (w-full chain) — shared kit; fix ở owner layout (onescreen.css) theo "correct the value".

## Automated pins
- `frontend/src/features/shipments/create/ShipmentCreateWorkspace.onescreen.styles.test.ts` (khối AstraQA2):
  - cả hai control lane = `flex: 1 1 0` (red tại HEAD — đang `1 1 auto`);
  - `:not(...)` loại trừ lane validation (red tại HEAD — chỉ `:not(label)`);
  - pin cũ "Labels never shrink... controls take the remaining width" cập nhật theo selector mới.
- Kế cận (re-run): `ShipmentCreateIdentitySection.*`, `ClerkShipmentCreatePage.test.tsx`, `uui-searchable-field.*`, `ShipmentCreateIdentitySection.sil681-trailing.test.tsx` (trailing ＋/✎ không đổi).

## Quy tắc hiển thị (shipmate-uiux doctrine)
- Trigger truncated content (nội dung nhập bị cắt không đường xem): tên đã chọn "Long Minh" hiện đủ; placeholder "Gõ chọn hoặc nhập hãng tàu" không cắt.
- Layout.md: flex child giữ text dài → `min-width: 0` + basis tất định (không fixed dimensions).
- Label-beside AstraQA2 + SIL-681 trailing trong ô giữ nguyên (không đảo ruling cùng ngày).

## Not covered bởi hồ sơ này
- Rung 3 UI DRIVEN (đo px trên staging build mới) thuộc cột QA theo chỉ đạo lane "Scoped tests + tsc" (QA đo giúp tại 1440: input Khách hàng/Hãng tàu ≈ đầy cột, tên "Long Minh" đủ).
- Dải ≤1279 (tower label-over-control) không đổi — 390px đã đúng theo ticket.
