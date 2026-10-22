# Case QA-2026-10-22-uui-select-modal — "UuiSelectField listbox không click được trong modal" = FALSE POSITIVE của QA script; luồng tạo khung giá ĐÃ hoạt động

Card 221026123031 (chuỗi NEWEB lag). Nguồn: repro `frontend/qa-repro2.mjs`
22/10, log playwright `<div role=dialog class="modal modal--operational-density
modal--polished"> intercepts pointer events`.

## Kết luận điều tra (evidence trong `qa/2026-10-22-uui-select-modal/`)

Bug sản phẩm KHÔNG tồn tại. Trên main CHƯA FIX (:7175), chọn KH trong dialog
"Tạo báo giá" và tạo khung giá end-to-end ĐỀU PASS (driver đã sửa, log
`ui-driver-green-main.log`: `201 POST /api/quotations` id 2526+2527, dialog
đóng, list chứa mẫu mới; DB proof `db-proof.log`).

Chuỗi sai của script cũ:

1. `page.locator('[role="option"]')` quét TOÀN TRANG. Trang `/config/quotations`
   có listbox hợp lệ riêng (`ul[role=listbox].quotation-frames__list` +
   `li[role=option]`, card 20261002_288) render TRƯỚC portal ở cuối body →
   `nth(1)` trúng row của TRANG, không phải option của combobox. Row đó nằm
   DƯỚI scrim modal đang mở → modal chặn click là hành vi ĐÚNG (bằng chứng
   `qa-probe-hit`: `optInPop:false`, hit-stack = `.modal` + page list).
2. Script không điền "Ngày hiệu lực" (bắt buộc) → kể cả khi chọn KH xong,
   submit vẫn bị chặn: "Chưa tạo được báo giá — chưa gửi gì đi. Kiểm tra: ngày
   hiệu lực." (log `main-unfixed` trong driver cũ của phiên này).
3. Ô ngày là segmented input DD/MM/YYYY — `fill('22/10/2026')` tràn vào segment
   DD và bị từ chối ("Nhập ngày hợp lệ theo DD/MM/YYYY") — phải type digits.

Giả thuyết z-index trong brief BỊ BÁC BỎ: react-aria `useOverlayPosition`
hardcode `zIndex: 100000` inline cho mọi popover portalled (node_modules
react-aria/dist/private/overlays/useOverlayPosition.mjs:191) — popover luôn
trên `--z-modal` (300). Không đổi Modal.css, không thêm z-index cho
`.ds-uui-select__popover` (thay đổi đó thua inline style của react-aria và
không có tác dụng).

## Expected (đã verify trên main chưa fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| UUIMODAL-R1 | Dialog "Tạo báo giá", click combobox KH, click option TRONG `.ds-uui-select__popover` | option được chọn, combobox hiện tên KH (PASS main: "CÔNG TY TNHH MTV LONG MINH") |
| UUIMODAL-R2 | Type ngày theo segment (digits), điền tên mẫu + độ trễ, submit | `201 POST /api/quotations`, dialog đóng, list có mẫu mới (PASS main id 2526/2527) |
| UUIMODAL-R3 | DB | row `quotations` mới với đúng customer/effective_date/lag (PASS — db-proof.log) |
| UUIMODAL-R4 | Script QA PHẢI scope option vào popover | `[role="option"]` trần bị listbox của trang chiếm slot — driver chuẩn `qa/scripts/2026-10-22-uui-select-modal-driver.mjs` |

## Fix scope

Không đổi product code. Đúng defect class của nó: QA harness.
- Driver chuẩn (scope popover + segmented date + đủ field bắt buộc) lưu tại
  `qa/scripts/2026-10-22-uui-select-modal-driver.mjs`.
- Evidence: `qa/2026-10-22-uui-select-modal/` (orig-repro false-positive log,
  green log, screenshots, db-proof, gates).

## Bài học

Một locator `[role=option]`/`[role=dialog]` trần trên trang có nhiều listbox +
portal là trap: phải scope vào popover/dialog thực. "modal intercepts pointer
events" khi click phần tử nằm DƯỚI scrim là chặn đúng — kiểm tra
`el.closest('.ds-uui-select__popover')` trước khi kết luận "dropdown hỏng".
