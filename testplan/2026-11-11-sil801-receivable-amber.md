# Card SIL-801 — Hồi quy: tiền chưa thu hiện màu vàng cảnh báo trên /shipments-debit

Ngày: 2026-11-11 · Ticket SIL-801 (id 927, medium) · KB Ch1 §1.5.8 + Ch10 §10.8.3

## Lỗi
Cột TỔNG PHẢI THU KHÁCH trên Chi phí - Quyết toán (/shipments-debit) hiện
chữ tối; tổng nhóm + tổng chân trang cũng tối. KB: tiền chưa thu = vàng
cảnh báo; xanh chỉ dùng cho hoàn thành/đã thu.

## Kỳ vọng
- Cột phải thu khách (row cell + GroupSumCell + TotalCell chân trang): giá trị
  KNOWN ≠ 0 → màu `var(--warning-text)` (token vàng chữ đã đo ≥4.5:1).
- Giá trị 0 → giữ neutral (muted) — không nợ thì không cảnh báo.
- Pending → cell rỗng (owner 24/10) — không đổi.
- Các cột thành phần (cước vận tải, chi hộ, dịch vụ) — không đổi trong ticket
  này (ticket ghi phạm vi: cột phải thu khách).

## Rủi ro hồi quy

| # | Khu vực | Rủi ro | Kiểm |
|---|---|---|---|
| R1 | Pending law (owner 24/10) | vô tình amber cả cell rỗng | pending branch không thêm class |
| R2 | Zero sum nhóm/chân trang | amber cả '0' | zero branch không thêm class |
| R3 | SIL-731 r4 (locked lot pending) | sai trạng thái pending | logic pending giữ nguyên |
| R4 | Contrast | token sai (dùng --warning chưa đo) | chỉ dùng --warning-text (đã đo 4.5:1) |

## Kiểm chứng
- Test mới `frontend/src/pages/ShipmentDebitPage.sil801-amber.test.tsx`.
- `ShipmentDebitPage.css` — thêm 3 selector --warn dùng token.
