# SIL-586 (id 686) — CUS Tổng quan lô hàng: hàng lẻ không hiển thị ngày giờ

- Nguồn: khách hàng (b_d. Phạm Trung Kiên) 29/10/2026, kèm ảnh chụp màn hình.
- Link: plan.tingting.vip SIL-586.

## Tái hiện

1. Mở CUS "Tổng quan lô hàng" (`/shipments`).
2. Xem dòng lô hàng lẻ (LCL), ví dụ YUANFANG K2K45235345634, LONG MINH K2K32143352.
3. Ô "Lịch trình & điều xe" không có ngày giờ; dòng FCL bên cạnh có
   ("09:00 25/08/2026 · Nhà máy · 1x40HC").

## Nguyên nhân

LCL không có container nên `appointmentGroups` luôn rỗng; ô lịch chỉ còn
fallback `scheduleTimestamp(item)` = closingAt (Xuất) / plannedReturnAt (Nhập).
Lô lẻ tạo từ form "Tạo lô hàng" chỉ ghi `expectedDeliveryDate` (ngày, không
giờ) nên cả hai instant đều null → ô trống.

## Kỳ vọng sau fix

- Lô lẻ có closingAt/plannedReturnAt: hiển thị "HH:mm DD/MM/YYYY" theo giờ VN
  (ICT), cùng dạng dòng FCL.
- Lô lẻ cũ chỉ có expectedDeliveryDate: hiển thị ngày "DD/MM/YYYY" (không bịa
  giờ 00:00).
- Lô lẻ chưa có ngày nào: giữ nguyên "Chưa chốt ngày" (không đổi).

## Case ID

- SIL-586-C1: row LCL có closingAt (instant có suffix Z/+07:00) → cell chứa
  "HH:mm DD/MM/YYYY" chuyển đổi theo Asia/Ho_Chi_Minh (pin: 2026-10-28T17:00:00Z
  → "00:00 29/10/2026").
- SIL-586-C2: row LCL chỉ có transportDate (EDD) → cell chứa "DD/MM/YYYY", không
  chứa ":00" hay giờ bịa.
- SIL-586-C3: row LCL không có gì → "Chưa chốt ngày", không crash.
