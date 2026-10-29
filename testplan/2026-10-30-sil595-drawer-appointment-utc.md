# SIL-595 (id 695) — Drawer chi tiết container hiển thị giờ theo UTC, lệch 7 giờ so với tổng quan

- Nguồn: QA Glint (ticket SIL-595) 29/10/2026 — staging vantai.tingting.vip, build c2d740c5.
- Link: plan.tingting.vip SIL-595.

## Tái hiện (báo cáo ban đầu)

1. Tổng quan lô 291 (booking QA592W-001): 14:30 30/10/2026.
2. Mở drawer "Chi tiết container" của lô.
3. Cột "ĐÓNG / TRẢ" của drawer hiện "07:30 30/10" — lệch đúng 7 giờ (UTC thay vì ICT).

QA tái kiểm trên c2d740c5 không thấy triệu chứng ở drawer /dispatch (cột
"GIỜ HẸN ĐÓNG/TRẢ" hiện 14:30 đúng ICT) và yêu cầu dev xác định đúng biến thể
drawer/trường giờ bị lệch.

## Nguyên nhân (evidence 30/10 — ĐÃ xác định biến thể)

Surface lệch giờ là **drawer CUS "Chi tiết lô" (CusLotView)** — bảng container
("Thông tin hàng") có cột **"Đóng / trả"** + dòng "Lịch cont":

- `CusLotView.tsx` cột "Đóng / trả" render
  `formatTimeShortDate(line.customerAppointmentAt)`.
- Backend serialize `customerAppointmentAt` = `Date.toISOString()` — chuỗi
  instant **Z (UTC)**: `2026-10-30T07:30:00.000Z` cho 14:30 ICT.
- `formatTimeShortDate` (lib/shipment-operations.ts) là formatter naive
  string-surgery với regex `^YYYY-MM-DDTHH:mm` **không anchor cuối chuỗi** —
  nuốt chửng prefix giờ UTC của instant Z ⇒ render "07:30 30/10" (đúng mặt
  bằng triệu chứng: HH:mm DD/MM không năm). "+07:00"-suffixed strings vô tình
  đúng (digits là giờ VN); Z-suffixed thì lệch −7h.
- Cùng cơ chế ở dòng "Lịch cont" (`formatTimeShortDate(group.at)` — group.at
  cũng là instant ISO Z).
- Các mặt khác đã đúng (audit toàn bộ fallback chain
  closingAt/plannedReturnAt/transportDate):
  - `CusLotView` FactCell "Ngày giờ đóng/trả" → `formatDateTimeShort` (pin
    Asia/Ho_Chi_Minh, có test).
  - `cusUtils.scheduleTimestamp`/`scheduleTime` (SIL-586) → pin VN.
  - `CusShipmentRow` schedule cell (SIL-586 tests pin ICT).
  - Drawer /dispatch `ContainerLineAppointmentCell` →
    `formatVietnamDateTimeInput` trước khi format (đúng).
  - `MasterPlanCellValues`/`MasterPlanGrid.cutoff-tz.repro.test` pin VN.

## Kỳ vọng sau fix

- Mọi mặt hiển thị giờ hẹn đóng/trả dùng giờ ICT và khớp nhau: cột "Đóng / trả"
  và "Lịch cont" của drawer CUS render 14:30 30/10 cho instant 07:30Z.
- Formatter dùng chung nhận biết instant (Z/±hh:mm) và render wall-clock VN;
  naive draft ("YYYY-MM-DDTHH:mm") giữ nguyên contract string-surgery.

## Case ID

- SIL-595-C1: `formatTimeShortDate('2026-10-30T07:30:00.000Z')` = '14:30 30/10'
  (ICT), KHÔNG phải '07:30 30/10'.
- SIL-595-C2: instant `+07:00` giữ nguyên giờ digits; naive draft giữ nguyên
  contract cũ ('2026-09-11T09:05' → '09:05 11/09').
- SIL-595-C2b: naive có giây vẫn string surgery ('2026-10-30T14:30:00' →
  '14:30 30/10'); offset không dấu hai chấm ('+0000') vẫn là instant thật
  (review finding 4).
- SIL-595-C3: drawer CUS — cột "Đóng / trả" render giờ ICT từ
  customerAppointmentAt (regression pin trên CusLotView).
- SIL-595-C4: "Lịch cont" group line render giờ ICT từ group.at.
