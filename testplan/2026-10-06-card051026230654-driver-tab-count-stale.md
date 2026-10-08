# Card 051026230654 — Driver: tab "Lệnh mới" không refresh sau khi hoàn thành chuyến (regression case)

Case ID: TC-051026230654-01
Feature: màn "Hành trình của tôi" (/my-trips) của Lái xe — badge đếm trên các tab (Lệnh mới / Đã nhận / Lịch sử) và danh sách thẻ lệnh.

## Repro (trước khi sửa)
1. Đăng nhập Lái xe → /my-trips → mở một chuyến IN_TRANSIT → màn e-POD (/my-trips/:id/pod).
2. Đủ 2 ảnh e-POD → bấm "HOÀN THÀNH CHUYẾN".
3. Quay về /my-trips: chuyến chưa sang "Lịch sử", badge "Lệnh mới" vẫn đếm cũ.
4. Phải chờ poll 15s (hoặc thao tác chuyển tab) dữ liệu mới đúng.

## Nguyên nhân (đã đối chiếu mã nguồn)
`handleCompleteTrip` (frontend/src/pages/DriverTripPodPage.tsx) gọi `completeTrip` rồi `navigate('/my-trips')` mà KHÔNG invalidates bất kỳ query nào. Danh sách + badge đọc từ `qk.driver.journeyBoard` và chip "Lệnh trong ngày" đọc từ `qk.driver.twoOrders` (frontend/src/hooks/useDriverQueries.ts); QueryClient toàn app có `staleTime: 5 phút` (frontend/src/main.tsx) nên khi trang /my-trips mount lại, cache còn "tươi" và không refetch.

## Expected (sau khi sửa)
- Ngay sau khi `completeTrip` thành công, trước khi điều hướng về /my-trips: invalidate `qk.driver.journeyBoard` và `qk.driver.twoOrders` → trang mount lại refetch ngay, badge + danh sách + chip "Lệnh trong ngày" đúng lập tức.
- Khi `completeTrip` THẤT (hoặc submit POD thất bại trước đó): không invalidate gì — dữ liệu trên board không bị đổi.

## Automated pins
- `frontend/src/pages/DriverTripPodPage.test.tsx` —
  (1) hoàn thành chuyến gọi `invalidateQueries` với đúng 2 key (journeyBoard, twoOrders) trước khi điều hướng;
  (2) hoàn thành thất bại thì không gọi invalidate cho 2 key đó.

## Not covered bởi hồ sơ này
- Rung 3 UI DRIVEN trên staging: cần tài khoản lái xe có chuyến IN_TRANSIT đủ POD để bấm hoàn thành thật (phiên này chỉ dừng ở unit pin + đối chiếu mã nguồn; staging READ-ONLY theo phạm vi thẻ).
- Khoảng cửa trễ ≤15s do `refetchInterval: 15_000` của board vẫn tồn tại cho các thay đổi từ nguồn khác (điều vận gán xe mới); thẻ này chỉ xử lý sau-mutation hoàn thành.
