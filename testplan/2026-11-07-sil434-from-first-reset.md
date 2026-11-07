# SIL-434 — From-first date edit reset về hôm nay (/shipments-detail)

Ticket: SIL-434 (id 467). QA wave-2 FAIL trên ca0e72b9 (07/11/2026): nhập
From 10/11/2026 TRƯỚC rồi To 10/11/2026 → request cuối
`transportDateFrom=2026-11-07` (hôm nay) thay vì 10/11 — 93 dòng thay vì 26.
To-first thì đúng. Defect giống hệt trên 8f29bea4 — các lần fix trước
(4fb989e5 backend lot-day filter; 04627a9a F2 bỏ cross-bound trong
DateRangeFields, bị revert bởi ac470f42 theo CHIEF 2026-09-27) chưa chạm root.

## Root cause

`ShipmentContainersPage` nạp default scope (today..today) vào GIÁ TRỊ của hai
field (`from={dateFrom} to={dateTo}` với `dateTo = parsedDateTo || today`).
`DateRangeFields` kẹp chéo min/max (CHIEF 2026-09-27, pinned) — vậy lúc load,
field Từ mang `max=today`: mọi Từ sau hôm nay bị REFUSED trước khi emit (draft
vẫn hiển thị, request không đổi). Edit Đến sau đó emit cặp với Từ STALE
(= today) → `transportDateFrom=<today>`. Hiển thị và filter áp dụng lệch nhau.

## Case TC-SIL-434-FROM-FIRST-FUTURE

- **Steps:** mở /shipments-detail (fresh, không param ngày) → gõ Từ = ngày
  tương lai (+3 ngày) → gõ Đến = cùng ngày (hoặc xa hơn).
- **Expected:** request cuối `transportDateFrom=<+3>&transportDateTo=<+3>`
  (From-first tự đóng tại mốc operator chọn vì > today); field hiển thị ≡
  query; không bao giờ xuất hiện `transportDateFrom=<today>` thay giá trị đã gõ.
- **Pin:** `ShipmentContainersPage.test.tsx` → describe
  `SIL-434 — first-pick date edits are never reset to the scope default`,
  case 1 ("keeps a future Từ typed first…").

## Case TC-SIL-434-TO-FIRST

- **Steps:** fresh load → gõ Đến = +3 ngày trước, rồi Từ = +3 ngày.
- **Expected:** sau edit Đến: `transportDateFrom=<today>&transportDateTo=<+3>`
  (mốc thiếu lấy scope end, cặp luôn có thứ tự); sau edit Từ:
  `transportDateFrom=<+3>&transportDateTo=<+3>` (26 dòng).
- **Pin:** cùng describe, case 2.

## Case TC-SIL-434-CLEAR-REFILL

- **Steps:** URL `?transportDateFrom=<+3>&transportDateTo=<+3>` → xoá trắng Từ.
- **Expected:** mốc bị xoá được điền lại bằng scope end (today) NGAY LẬP TỨC
  và hiển thị trong field — range không bao giờ implicit (comment case
  "applies date, customer…" trong cùng test file).
- **Pin:** cùng describe, case 3.

## Fix shape

1. Fields nhận `fieldDateFrom`/`fieldDateTo` (giá trị operator của URL; rỗng
   lúc load và khi URL inverted) — scope default không bao giờ thành min/max
   bound. CHIEF bounding GIỮ NGUYÊN trong shared `DateRangeFields` (revert
   ac470f42 là đúng; F2 đổi nhầm lớp).
2. `writeDateRange` đóng cặp sau mỗi field edit: mốc thiếu lấy scope end
   (today) nếu giữ được thứ tự, ngược lại lấy mốc operator vừa gõ — range
   luôn đóng, có thứ tự, không bao giờ drop giá trị đã gõ.
