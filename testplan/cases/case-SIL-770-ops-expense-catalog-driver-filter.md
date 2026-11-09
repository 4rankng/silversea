# SIL-770 (id 891) — Popup Khai báo chi phí Ops: lọc chi phí lái xe khỏi danh mục chọn

- Ticket: SIL-770 (board SIL, id 891, tạo 09/11/2026; priority high, CR-006).
- Nguồn: 2026.11.09.Ticket.docx Phần III Epic 2 mục 3 — "Lọc sạch danh mục chi
  phí: Loại bỏ toàn bộ các chi phí của Lái xe (vé cầu đường, tiền dầu, vá
  vỏ...) ra khỏi danh mục chọn của Ops để chống nhầm lẫn". Frank 09/11/2026:
  "khách hàng bảo thế nào thì làm thế".

## Phạm vi luật

- "Chi phí của ai người đó tự khai" giữ nguyên: danh mục lái xe (app lái xe,
  `/api/forwarder/expense-types` + fee norms) KHÔNG đổi.
- Danh mục chọn của popup "Khai báo chi phí" (Ops/CUS — `/api/ops/expense-types`)
  lọc bỏ các code thuộc bucket lái xe: `FUEL` (tiền dầu), `ROAD_REPAIR`
  (sửa chữa dọc đường/vá vỏ) — phân loại dùng chung `DRIVER_EXPENSE_TYPE_CODES`
  (shared), lọc tại `listActiveOpsExpenseTypes`.
- Lịch sử không đổi: các khoản đã khai theo code cũ giữ nguyên dữ liệu.

## Case pin (expected sau thay đổi)

1. Ops mở popup "Khai báo chi phí": dropdown "Loại phí" cả hai block (không
   hóa đơn / có hóa đơn) KHÔNG còn "Phí nhiên liệu / dầu" hay "Phí sửa chữa
   dọc đường"; còn đầy đủ các phí Ops (Kiểm hóa, Soi chiếu/Luồng đỏ, Bốc xếp,
   Nâng, Hạ, CSHT, Lưu bãi...).
2. App lái xe không đổi: lái xe vẫn khai được tiền đường/sửa chữa dọc đường
   của mình (bucket DRIVER_ROAD / danh mục forwarder không lọc).
3. Admin đổi tên loại phí không hồi sinh dòng bị lọc (lọc theo code, không
   theo tên).

## Regression evidence

- BE unit `ops-expense-type-filter.test.ts`: FUEL/ROAD_REPAIR bị lọc; các phí
  Ops giữ nguyên; endpoint pass qua bộ lọc (source pin) — 3/3 pass 2026-11-09.
- UI DRIVEN: screenshot dropdown Ops sau fix (qa/2026-11-09_r9b-ops-debit/).
