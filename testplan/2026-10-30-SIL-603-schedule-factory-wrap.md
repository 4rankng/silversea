# SIL-603 (id 706) — Tổng quan lô hàng: cột Lịch trình & Điều xe cắt text nhà máy (NEWEB…)

## Báo cáo
Owner 30/10/2026 (screenshot staging f667f55f→8f376365): trên Tổng quan lô hàng
(/shipments), cột LỊCH TRÍNH & ĐIỀU XE hiển thị dòng "21:20 28/10/2026 · NEWEB…"
— tên nhà máy bị CẮT ellipsis, không đọc được tên đầy đủ. Vi phạm luật SIL-515
(owner 26/10: "CẤM truncate TOÀN BẢNG") áp cho bảng workboard CUS.

## Nguyên nhân (đã đối chiếu mã nguồn)
- `CusShipmentRow.tsx` packing cả 3 fact (giờ+ngày · nhà máy · tổng cont) vào
  MỘT text run "09:00 25/08/2026 · Sunrise · 1x40HC" trong một span.
- `ShipmentsPage.css` khối FB-043 (card 201026164000, media ≥1000px) ép
  `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` lên mọi con
  trực tiếp của schedule cell (`…td[data-label='Lịch trình & điều xe']
  .cus-inline-trigger > *`) → dòng quá cột bị cắt thành "21:20 28/10/2026 ·
  NEWEB…".

## Tái hiện
1. Đăng nhập (bất kỳ role đọc được /shipments), tạo lô FCL có appointment group
   với tên nhà máy dài (vd "NEWEB - KHO 1 CÔNG TY TNHH NEWEB VIỆT NAM").
2. Mở Tổng quan lô hàng, nhìn cột LỊCH TRÍNH & ĐIỀU XE ở width desktop (≥1000px,
   canvas hẹp hơn tổng chiều dài dòng lịch trình).
3. Dòng lịch trình kết thúc bằng "…" — tên nhà máy cụt.

## Expected (sau khi sửa — owner 30/10)
- KHÔNG cắt. Mỗi fact một dòng, wrap full (pattern các cell khác trong cùng bảng):
  "21:20 28/10/2026" một dòng; tên nhà máy xuống dòng riêng, hiển thị ĐẦY ĐỦ
  (tên càng dài càng wrap thêm dòng, không ellipsis, không hidden overflow);
  tổng cont dòng kế tiếp.
- Không có dấu `·` đóng gói fact vào một dòng trong DOM (SIL-517: separator chỉ
  tồn tại để nhồi nhiều fact lên một dòng).
- Hover (title) vẫn đọc được cả dòng đầy đủ.
- Lot-fallback (lô lẻ instant/EDD) vẫn một dòng riêng, không cắt.
- Dòng điều xe (trạng thái phân xe + chip phát lệnh) giữ nguyên luật FB-043
  một dòng (không thuộc defect class này).

## Automated pins
- `CusShipmentRow.cus-cards.test.tsx` — SIL-603 describe: tên nhà máy dài nằm
  nguyên vẹn trong DOM (span riêng `cus-schedule-group__factory`), giờ+ngày là
  span riêng `cus-schedule-group__when`, title mang full line; CSS pin: luật
  schedule cell wrap (normal + overflow-wrap anywhere), cấm quay lại
  nowrap/ellipsis/overflow hidden trên dòng lịch trình.
- `ShipmentsPage.test.tsx` — các assert cũ pin chuỗi packed
  "09:30 12/08/2026 · Nhà máy ABC · 1x40HC" được cập nhật theo layout mới.
