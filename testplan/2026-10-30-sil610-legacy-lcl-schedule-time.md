# SIL-610 (id 713) — Tổng quan lô hàng: lô lẻ cũ chỉ có ngày giao, thiếu giờ

- Nguồn: owner (frankn.sg) 30/10/2026, kèm ảnh owner + ảnh xác minh staging
  (build e9d8d9a8, vai trò CUS, lô SHP-2610-00192 / K2K45235345634).
- Link: plan.tingting.vip SIL-610.

## Tái hiện

1. Mở "Tổng quan lô hàng", tìm lô lẻ cũ K2K45235345634 (YUANFANG, Nhập lẻ,
   Đã khóa / Chờ đối soát).
2. Cột "Lịch trình & điều xe" chỉ hiện "29/10/2026 · Đã điều xe" — không có giờ.
3. Dữ liệu lô: `expectedDeliveryDate 2026-10-29`, `plannedReturnAt` trống,
   `closingAt` trống — lô tạo trước trường "Ngày giờ đóng trả" (SIL-587) nên
   chỉ có ngày; lô mới hiện "15:45 30/10/2026" (có instant).

## Nguyên nhân

SIL-586 cố ý hiển thị date-only cho lô cũ ("không bịa giờ 00:00") vì hệ thống
không có giờ nào cho lô. Giờ vận hành THẬT duy nhất lô cũ có là trên chuyến
của lô (`trips.planned_start_at` — được seed từ lịch của lô tại "Giờ chạy"),
nhưng chưa bao giờ được nối vào chuỗi fallback lịch của lô.

## Fix (backfill từ dữ liệu chuyến — display-only)

BE workspace builder thêm `derivedScheduleAt` (instant, KHÔNG persist): với lô
LCL không có `closingAt`/`plannedReturnAt` và có EDD, lấy instant của chuyến
live (`plannedStartAt`/`plannedEndAt`) **rơi đúng vào ngày EDD theo giờ ICT**,
chọn instant sớm nhất. FE `scheduleTimestamp` cài fallback: closingAt/
plannedReturnAt → `derivedScheduleAt` → `transportDate` (ngày thuần, luật
SIL-586 giữ nguyên). Chi tiết lô (CusLotView "Ngày giờ đóng/trả") đọc cùng
chuỗi. Lô đã khóa vẫn chỉ-đọc (luật 2026-09-20 không đổi); CUS mở "Chỉnh sửa
Lịch trình" trên lô chưa khóa vẫn nhập tay ngày + giờ như trước (quick-edit ghi
instant).

**Vì sao chỉ instant trong ngày EDD:** ngày hiển thị phải BẰNG ngày giao hẹn
(EDD) để ô đọc y hệt lô SIL-587 ("HH:mm DD/MM/YYYY"). Chuyến chạy khác ngày thì
KHÔNG dùng — ghép giờ của nó với ngày EDD là bịa giờ giao; hiện ngày khác lại
mâu thuẫn ngày hẹn. Lô như vậy giữ ngày-thuần trung thực.

## Kỳ vọng sau fix

- Lô lẻ cũ có chuyến chạy trong ngày EDD: tổng quan + chi tiết hiện
  "HH:mm DD/MM/YYYY" như lô mới — không bịa 00:00.
- Lô cũ không có chuyến (hoặc chuyến chạy khác ngày EDD): giữ date-only
  (SIL-586-C2).
- FCL và lô có instant thật: hiển thị KHÔNG đổi; `derivedScheduleAt` không
  bao giờ đè instant đã lưu và không bao giờ được ghi ngược vào DB.
- Cột XLSX "Lịch trình & điều xe" giữ nguyên dạng ngày (formatDate) — ngoài
  phạm vi ticket (màn hình Tổng quan).

## Case ID

- SIL-610-C1 (BE unit): LCL date-only + chuyến `plannedStartAt` cùng ngày ICT
  → derived instant; 2026-10-28T17:00:00Z (EDD 2026-10-29) → 
  "2026-10-28T17:00:00.000Z" (= 00:00 29/10 ICT, ranh giới ngày ICT).
- SIL-610-C2 (BE unit): FCL, LCL đã có closingAt/plannedReturnAt, chuyến khác
  ngày EDD, hoặc không có chuyến → null (không derived).
- SIL-610-C3 (BE unit): `plannedStartAt` null → dùng `plannedEndAt`; nhiều
  chuyến cùng ngày → chọn sớm nhất; chuyến khác ngày → loại.
- SIL-610-C4 (FE row): lô legacy + `derivedScheduleAt` → ô lịch chứa
  "HH:MM DD/MM/YYYY"; KHÔNG kèm chuỗi 00:00 bịa.
- SIL-610-C5 (FE row): legacy không có derived → vẫn date-only (guard
  SIL-586-C2); lô có instant thật → instant thắng (không đổi).
- SIL-610-C6 (FE detail): CusLotView "Ngày giờ đóng/trả" hiện giờ derived khi
  cả closingAt/plannedReturnAt trống.
