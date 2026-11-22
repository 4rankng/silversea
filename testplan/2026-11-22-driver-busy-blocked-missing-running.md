# Driver `Nhận lệnh vận chuyển` 409 `Xe đang chạy chuyến ...` while `Đã nhận 0`

## Case — `DRIVER-BUSY-01`: Phantom/hidden `IN_TRANSIT` trip blocks truck accept while `Đã nhận` is `0`

- **Reported (2026-11-22, mobile video on `vantai.tingting.vip`):**
  Tài khoản lái xe **Nguyễn Huy Vương** (`15E-019.80`) mở `Hành trình của tôi`:
  `Lệnh mới 10` | `Đã nhận 0` ("Không có chuyến nào đang chạy.") | `Lịch sử 6`.
  Mở lệnh `MATS2396814000` → bấm `Nhận lệnh vận chuyển` → hệ thống báo lỗi:
  `Xe đang chạy chuyến QA1107C2-704K2. Vui lòng hoàn thành chuyến đó trước.`
  Driver không thấy chuyến nào trong `Đã nhận` để ấn hoàn tất.
- **Root causes:**
  1. **Backend visibility gap (`trip-status-machine.service.ts` `busyTrips`):**
     `SIL-666 round-2` (`tripHolderVisibilitySql()`) đã lọc các chuyến thuộc lô đã xóa (`shipments.deleted_at`), tác vụ đã hủy (`shipment_fulfillments.canceled_at`), hoặc lô phi-operational (`DRAFT`/`PENDING_DATE`/`CANCELED`) khỏi cả 3 cổng điều phối (`assertPlanRowRigAvailable`, `assertTripRigAvailable`, `assertResourceAvailability`), và `getDriverJourneyBoard` cũng ẩn các chuyến có `canceledAt` / `deletedAt`. Tuy nhiên truy vấn `busyTrips` trong `transitionTripStatus` (`trip-status-machine.service.ts`) chưa áp `...tripHolderVisibilitySql()`, nên một chuyến `IN_TRANSIT` thuộc lô đã xóa / tác vụ đã hủy vẫn chặn `Nhận lệnh vận chuyển` với 409 `DRIVER_TRIP_BLOCKED`.
  2. **Cross-driver / unowned blocking copy & off-screen banner (`trip-status-machine.service.ts` + `DriverTripDetailPage.tsx`):**
     Khi chuyến `IN_TRANSIT` đang giữ xe `15E-019.80` thuộc về **tài xế khác** (`driverId !== trip.driverId` hoặc `driverId IS NULL`), `getDriverJourneyBoard(driverId)` đúng là trả về `Đã nhận 0`, và server trả `driverOwned: false, blockingTripId: null`. Tuy nhiên:
     - Cả backend 409 message (`trip-status-machine.service.ts`) và frontend toast (`DriverTripDetailPage.tsx`) đều bỏ qua `driverOwned`, vẫn nhắn `"Vui lòng hoàn thành chuyến đó trước."` khiến lái xe tìm lệnh hoàn tất trong `Đã nhận`.
     - Banner `data-testid="blocking-trip-banner"` (chứa link `Mở chuyến đang chạy` hoặc hướng dẫn `Liên hệ điều vận để xử lý chuyến đang chạy`) bị đặt ở cuối trang bên dưới thanh sticky cố định nên bị khuất khỏi màn hình điện thoại khi lái xe bấm `Nhận lệnh vận chuyển`.
- **Expected:**
  1. `busyTrips` trong `transitionTripStatus` áp `...tripHolderVisibilitySql()`: chuyến của tác vụ đã hủy / lô đã xóa / lô phi-operational không chặn nhận lệnh; chuyến thật (và tác vụ không gắn fulfillment như BULK) vẫn chặn bình thường.
  2. Khi `driverOwned === false`: thông báo 409 + toast + banner nêu rõ chuyến đang chạy **không thuộc danh sách lệnh của bạn** và hướng dẫn **liên hệ điều vận để xử lý**, không bảo lái xe đi hoàn thành chuyến đó.
  3. `blocking-trip-banner` hiển thị ngay vùng đầu màn hình (dưới `driver-task-progress`) và cuộn vào tầm nhìn để lái xe thấy ngay nút `Mở chuyến đang chạy` (khi `driverOwned`) hoặc hướng dẫn liên hệ điều vận (khi `!driverOwned`).
