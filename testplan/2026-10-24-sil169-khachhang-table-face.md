# SIL-169 — Hồi quy: mặt ≥640 của Khách hàng & Đối tác phải là bảng thật (visual-gate re-dispatch 24/10)

Ngày: 2026-10-24 · Ticket: SIL-169 (board comment 1314 "⛔ VISUAL GATE FAIL") · Agent: opencode/GLM

## Lỗi gốc (từ audit 1440px)

Band thẻ của `record-table.css` bám vào **chiều rộng CONTAINER** (`@container ≤1100px`): ở viewport 1440,
sidebar app chừa lại ~1095px cho bảng nên band thẻ kích hoạt cả trên desktop — ô dính nhãn
`data-label` xếp tầng ("MÃ SỐ THUẾ …"), dòng mã LONGMINH bị đường kẻ thẻ cắt ngang, row 230-240px
kèm band trống 60-80px, ô công nợ trôi một mình. Chip tên viết tắt render raw ("LOG COM" lẫn "Long Minh").

## Trường hợp hồi quy

| # | Trường hợp | Kỳ vọng |
|---|---|---|
| R1 | /customers ≥1024px | BẢNG thật 7 cột (260/110/180/180/96/120/32), row 56px, header 1 lần đầu bảng, không nhãn xếp tầng |
| R2 | /customers 640–1023px | Cùng bảng, cuộn ngang trên sàn 978px (`record-table-wrap--scroll` + `min-width: 978px`), không nén cột |
| R3 | /customers <640px | Giữ card-list di động (đã PASS — không đụng) |
| R4 | Mã KH dòng 2 (LONGMINH) | Không bị cắt: nội dung 2 dòng ~52px nằm trọn trong row 56px |
| R5 | Chip viết tắt | `titleCaseVn(shortName)` trên cả 3 chỗ (bảng /customers, card <640, /config/customers): "Log Com" |
| R6 | /config/customers ≥640 | Cùng bảng thật (cùng key `.cus-table`) |

## Pin tự động

`frontend/src/pages/CustomersPage.table-face.styles.test.ts` — khoá geometry ≥640, sàn 978px,
row 56px 2 mặt, và title-case chip ở cả 2 file tsx.

## Đã xác minh bằng UI

`qa/2026-10-24-khachhang-redesign/after-{customers,config-customers}-{390,768,1024,1440}.png`
+ assertion DOM trong `after-driver.log` (display: table-row, row ≈56px, thead hiển thị 1 lần).
