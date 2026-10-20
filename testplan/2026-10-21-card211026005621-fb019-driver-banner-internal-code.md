# Card 211026005621 — FB-019: app lái xe banner lỗi lộ mã lô "TRP…" (regression case)

Case ID: TC-211026005621-01
Feature: màn Chi tiết lệnh lái xe (`/my-trips/:id`) — banner cảnh báo "xe đang chạy chuyến khác" khi bấm Nhận lệnh / ghi mốc tiến độ bị backend từ chối 409.

## Repro (trước khi sửa)
1. Đăng nhập Lái xe, xe đang có chuyến chưa hoàn thành.
2. Mở một lệnh mới → bấm "Nhận lệnh vận chuyển".
3. Backend từ chối: `409 "Xe đang chạy chuyến TRP-2026…-…. Vui lòng hoàn thành chuyến đó trước."` (backend/src/services/trip-status-machine.service.ts).
4. FE tách mã TRP khỏi message và render banner `role="alert"`:
   `Xe đang chạy chuyến TRP-2026…-… — hoàn thành chuyến đó trước khi nhận lệnh mới.`
   Kèm toast lỗi hiển thị message gốc (đưa mã TRP vào toast).
5. Lái xe thấy mã nội bộ TRP-… — vi phạm luật internal-ids (CHIEF 26/09): lái xe định danh chuyến bằng Số Bill/Booking, mã TRP không bao giờ render trên màn lái xe.

## Nguyên nhân (đã đối chiếu mã nguồn)
- Backend trả message 409 nhúng `tripCode` (TRP-…) — giữ nguyên vì các surface điều vận đọc mã này.
- `handleMilestone` (frontend/src/pages/DriverTripDetailPage.tsx) parse mã từ message vào state `blockingTripCode` và banner render thẳng state đó. Card 20260916_8 cho phép message chạm lái xe qua toast + banner, nhưng ra TRƯỚC luật internal-ids (CHIEF 26/09, card 20260927_1) — nội dung hiển thị phải theo luật sau.
- FE đã có đúng dữ liệu thay thế: `driverClient.getJourneyBoard()` trả `blNumber`/`bookingRef` cho lệnh thuộc về tài xế (board hiện có để dựng link "Mở chuyến đang chạy").

## Expected (sau khi sửa)
- Banner (khi có Bill/Booking từ board): `Xe đang chạy chuyến <Số Bill/Booking> — hoàn thành chuyến đó trước khi nhận lệnh mới.`
- Banner (không tìm thấy lệnh trên board của tài xế — xe bận do lệnh của lái xe khác): `Xe đang có chuyến chưa hoàn thành — …` + dòng "Liên hệ điều vận…" như cũ. KHÔNG bao giờ render mã TRP, không bịa reference.
- Toast vẫn mang đủ lý do (nguyên tắc 2 surface của card 20260916_8) nhưng không chứa mã TRP.
- Banner tự đóng khi thao tác sau thành công (lý do không còn đúng).

## Automated pins
- `frontend/src/pages/DriverTripDetailPage.test.tsx` — busy-trip recovery:
  (1) owned: banner chứa Số Bill, KHÔNG chứa mã TRP; toast không chứa mã; link "Mở chuyến đang chạy" giữ nguyên;
  (2) not-owned: banner dùng câu chung "chưa hoàn thành", không mã TRP, không link, giữ dòng "Liên hệ điều vận";
  (3) chấp nhận lại thành công → banner biến mất.

## Not covered bởi hồ sơ này
- Toast điều vận desktop cũng hiển thị message 409 gốc (có mã TRP) — ngoài phạm vi thẻ (FB-019 là app lái xe); điều vận dùng mã TRP là định danh chính của họ.
- Message khác của backend nếu vô tình chứa mã lô ở surface khác — chỉ sweep đúng class lỗi này tại surface lái xe.
