# case-SIL-786 — /shipments: bấm dòng mở drawer chi tiết lô (CUS)

## Repro (staging dc930964, 10/11, vai tiepvv)
- Bấm dòng / bấm ô trên /shipments → hộp thoại sửa ô ("Chỉnh sửa Phân loại &
  hãng tàu") thay vì drawer; "Chi tiết" lúc QA báo đổi trang /shipments-detail.
- Đối chiếu Ops (hoangnh): cùng thao tác mở drawer `aside.drawer.cus-shipment-drawer`
  kèm [+ Khai chi phí].

## Root cause
SIL-699 r2 (2475db92, QA PASS 08/11) định tuyến theo Ô: ô được phép sửa với vai
đó mở quick-edit; ô chỉ-đọc mở drawer. CUS ghi được Phân loại/Hãng tàu/Chứng từ
→ bấm vào phần thân ô = bấm vào BUTTON cả ô → quick-edit. Ops bị 403 ở cùng ô →
drawer. `<tr>` không có onClick — bấm vùng trống/hàng không mở gì.

## Fix (tuân KB Ch10 §10.1.1: danh sách phẳng + drawer, bấm dòng mở drawer)
- `<tr onClick>` mở drawer cho MỌI vai (SIL-786); tất cả trigger ô có nhãn
  ("Sửa ô …", "Chi tiết") stopPropagation giữ đúng hành vi đã QA-passed 08/11.
- Chi tiết không đổi trang: drawer mở trên /shipments; "Mở bảng kê container"
  là hành động riêng trong footer (SIL-699 law) — không tự navigate.

## Pins
- `CusShipmentRow.cus-cards.test.tsx` → `SIL-786`: (1) click tr(row) gọi
  onOpenDetail đúng 1 lần; (2) ô có nhãn sửa không double-fire drawer;
  (3) ô chỉ-đọc trả drawer đúng 1 lần (guard chặn bong bóng).

## Coverage limit
Repro "bấm GIỮA ô có nhãn sửa" (vào chữ ô) vẫn mở quick-edit — hành vi
r2 08/11 (cần ruling owner mới nếu muốn đổi); "Chi tiết đổi trang
/shipments-detail" không tái hiện được ở HEAD (Chi tiết mở drawer) — nghi
staging bundle cũ; đã drive lại trên build mới.
