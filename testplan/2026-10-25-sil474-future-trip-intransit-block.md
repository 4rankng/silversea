# SIL-474 — Chuyến future IN_TRANSIT chặn nhận lệnh quá sớm

- **Case ID:** SIL-474-REG-1
- **Ticket:** plan.tingting.vip SIL-474 (id 531) — QA Glint không test được SIL-186 vì xe bị chuyến TVREQ-LX-C4 (khởi hành 28/10) chặn nhận lệnh từ 24/10
- **Surface:** BE — `transitionTripStatus` nhánh IN_TRANSIT (POST `/trips/:id/dispatch` "Xuất phát" + driver "Nhận lệnh" `ORDER_RECEIVED` auto-start) — cùng lời 409 `Xe đang chạy chuyến …`
- **Role:** DISPATCHER / DRIVER

## Reproduction

1. Xe T có chuyến A `IN_TRANSIT` với `departure_date` ở TƯƠNG LAI (ví dụ TVREQ-LX-C4 khởi hành 28/10, vào IN_TRANSIT sớm do "Xuất phát"/"Nhận lệnh" trước ngày chạy).
2. 24/10: nhận lệnh ("Nhận lệnh" driver hoặc "Xuất phát" điều phối) chuyến B khác của cùng xe T.

## Observed (trước fix)

- **409** `Xe đang chạy chuyến TVREQ-LX-C4. Vui lòng hoàn thành chuyến đó trước.`
- Deadlock: rule "ngày hoàn thành không thể trước ngày khởi hành" (đúng) khiến không thể hoàn thành chuyến A để giải phóng xe → mọi lệnh của xe T bị chặn đến 28/10.

## Root cause

Busy-gate trong `trip-status-machine.service.ts` (~L196-244) chỉ lọc `status = IN_TRANSIT` cùng truck, không xét ngày. Enum trip không có trạng thái ASSIGNED/DISPATCHED nên chuyến được xuất phát/nhận lệnh sớm đậu ở IN_TRANSIT nhiều ngày trước khi xe thực sự chạy — bị đọc nhầm thành "xe đang chạy". Flow Điều vận assign (issue/reissue trong `dispatch-planning-commands.service.ts`) KHÔNG tự đánh IN_TRANSIT (trip giữ CREATED) — không phải nguồn của trạng thái lệch.

## Expected

- Chuyến `IN_TRANSIT` có `departure_date` **tương lai** (chưa đến ngày chạy, giờ VN) → **không chặn**: nhận lệnh/xuất phát chuyến mới cùng xe đi bình thường, không 409.
- Chuyến `IN_TRANSIT` có `departure_date` **đã đến/hơn** (hôm nay hoặc quá khứ) → **vẫn chặn** (hành vi đúng giữ nguyên; gồm cả carve-out Kẹp và evidence-ready của driver-close).
- Dòng legacy thiếu ngày + đồng hồ không đọc được → giữ block bảo thủ (không âm thầm mở khóa).

## Regression coverage

`backend/src/tests/unit/trip-status-machine.test.ts` — describe "Truck availability gate — SIL-474 future IN_TRANSIT" (predicate thật `isTripRunningOnDepartureDay` từ `backend/src/services/trip-busy-gate.ts`, DB-free theo luật BE unit-only):

1. Future departure (`2026-10-28` so với hôm nay `2026-10-24`) → không running → loop skip → không 409. **Đỏ trên code trước fix** (không có điều kiện ngày).
2. Past departure → running → vẫn chặn (no-regression pin).
3. Departure = hôm nay → vẫn chặn (case thường).
4. Thiếu ngày legacy / đồng hồ null → block bảo thủ.
5. Day-boundary sweep: gate lật đúng tại departure day == today.
6. Wiring pin (source-scan): busy loop gọi `isTripRunningOnDepartureDay(candidate.departureDate, todayInBusinessZone)` và select mang `departureDate` — chống regression "ai đó gỡ điều kiện ngày".

## QA unblock (VIỆC 4)

Sau fix, SIL-186 test được ngay mà không cần đợi 28-30/10: chuyến future IN_TRANSIT (data staging cũ hoặc nhận lệnh sớm trong lúc test) không còn khoá xe.
