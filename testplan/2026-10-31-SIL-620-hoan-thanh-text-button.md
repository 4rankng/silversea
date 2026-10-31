# SIL-620 (ticket 724) — Nút "Hoàn thành" ở cột TRẠNG THÁI bị gói 2 dòng trong pill — đổi thành text button

Ngày: 2026-10-31 · Ticket SIL-620 (board id 724) · Worktree fix-sil-620

## Hiện tượng (bug)

Trên bảng tổng quan và Chi tiết lô hàng (`/shipments-detail` và drawer `CusLotView`), tại cột TRẠNG THÁI:
Ô trạng thái có trạng thái "Đã tạo chuyến" kèm nút "Hoàn thành" đang hiển thị xấu:
- Chữ "Hoàn thành" bị gói thành 2 dòng ("Hoàn" / "thành") trong pill bo tròn (`btn btn--secondary btn--sm`).
- Ô thừa khoảng trống theo chiều dọc trong khi chiều ngang bị co cụm bởi padding và border của pill box.

## Nguyên nhân

Ticket SIL-592 dùng class `btn btn--secondary btn--sm` kết hợp với `white-space: normal;` trong `ExternalTripCompleteAction.css`. Khi cột TRẠNG THÁI co hẹp (cột 8%), độ rộng của nút có padding + border không đủ chứa chữ trên 1 dòng nên bị break giữa "Hoàn" và "thành", tạo thành pill bo tròn 2 dòng.

## Giải pháp (Expected)

Đổi nút "Hoàn thành" thành TEXT BUTTON (chữ bấm thuần, không pill/box):
1. **Kiểu dáng text button:** Bỏ class `btn btn--secondary btn--sm`. Thiết lập `background: transparent; border: 0; padding: 0; margin: 0; box-shadow: none;`.
2. **Gọn 1 dòng:** `white-space: nowrap;` hiển thị gọn trên 1 dòng, không wrap.
3. **Màu sắc & Contrast AA:** Sử dụng house token emerald `var(--brand)` (`#005A2D`, contrast ratio 8.42:1 trên nền trắng `#FFFFFF`, vượt xa chuẩn WCAG AA 4.5:1). Hover: `var(--brand-hover)` (`#00361B`, contrast 13.5:1) có gạch chân (`text-decoration: underline`).
4. **Focus & Accessibility:** Giữ nguyên accessible focus ring (`outline: 2px solid var(--brand); outline-offset: 2px;`), giữ nguyên `aria-label`, `title`, và `disabled` state.
5. **Hành vi (chức năng SIL-592):** Giữ nguyên toàn bộ logic click → ConfirmDialog ("Hoàn thành chuyến với xe ngoài ...") → gọi API `complete-external` → toast + refetch.
6. **Doctrine cấm truncate:** Nút không sử dụng `overflow: hidden` hay `text-overflow: ellipsis`. Bố cục text button gọn gàng tự nhiên vừa vặn trên 1 dòng.

## Regression test cases

- **C1 (Text button styling):** Nút `.external-trip-complete` có `background: transparent`, `border: 0`, `padding: 0`, không có box/pill bao quanh.
- **C2 (Single line nowrap):** Nút mang `white-space: nowrap`, không wrap thành 2 dòng "Hoàn" / "thành".
- **C3 (No truncation):** CSS không chứa `text-overflow: ellipsis` hay `overflow: hidden`, đảm bảo hiển thị trọn vẹn nhãn text.
- **C4 (Hành vi click & dialog):** Bấm nút mở ConfirmDialog; confirm thực thi `onComplete` và đóng dialog; lỗi giữ dialog mở.
- **C5 (Gate hiển thị):** Chỉ hiển thị cho chuyến xe ngoài (EXTERNAL) còn sống (CREATED/IN_TRANSIT) đã có biển số và ngày khởi hành hợp lệ; ẩn đối với xe nhà (OWN) hoặc chuyến đã hoàn thành.

## Pins & bằng chứng

- `frontend/src/pages/ShipmentContainersPage.no-truncation.styles.test.ts`
- `frontend/src/features/shipments/detail/ShipmentContainerLedger.external-close.test.tsx`
- `frontend/src/features/shipments/cus/CusLotView.external-close.test.tsx`
- Screenshots trước/sau: `qa/2026-10-31_sil620_before_*.png`, `qa/2026-10-31_sil620_after_*.png`.
