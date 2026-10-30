# case-SIL-613 — Đảo thứ tự hiển thị ngày giờ thành Ngày trước Giờ sau (DD/MM/YYYY HH:mm) toàn app

- **Board:** SIL-613 (id 717) — "[BUG] Hiển thị ngày giờ đang giờ-trước-ngày-sau toàn app → phải đảo NGÀY-TRƯỚC-GIỜ-SA (chuẩn Việt Nam DD/MM/YYYY HH:MM), áp cho cả hiển thị (owner law 30/10)"
- **Reported:** 2026-10-30, audit trên staging (17 chuỗi / 4 mặt kiểm chứng): mọi giá trị ngày giờ hiển thị đang giờ-trước-ngày-sau (`HH:mm DD/MM/YYYY`).
- **Owner ruling 30/10:** Luật thống nhất của owner: ngày trước, giờ sau khắp nơi, chuẩn Việt Nam `DD/MM/YYYY HH:MM` — áp dụng cho cả hiển thị (read-only render) và ô nhập.
- **Phạm vi:** Các formatter hiển thị dùng chung (`formatDateTimeShort`, `formatDateTime24`, `formatAppointmentGroupLine`, `formatTimeShortDate`, `ShipmentContainerLedger` schedule cell).

## Evidence audit (trước fix)

1. `/dispatch-detail` — bảng Kế hoạch Tổng quát, cột THỜI GIAN & LỊCH TRÌNH (vai Điều vận): `00:52 30/10/2026`, `15:45 31/10/2026`, v.v.
2. `/shipments-detail` (vai CUS): `08:00 30/10/2026`, v.v.
3. `/my-trips` (vai Lái xe): `08:00 30/10/2026`.
4. `/shipments` — tìm 'RT592' (vai CUS): `15:45 30/10/2026`, `15:45 31/10/2026`.

## Expected (sau fix)

1. `formatDateTimeShort(iso)` render `DD/MM/YYYY HH:mm` (ví dụ `30/10/2026 00:52`, `31/10/2026 15:45`).
2. `formatDateTime24(localIso)` render `DD/MM/YYYY HH:mm` (ví dụ `30/10/2026 08:00`).
3. `formatAppointmentGroupLine(at, localDate)` render `DD/MM/YYYY HH:mm`.
4. `formatTimeShortDate(iso)` render `DD/MM HH:mm`.
5. `/shipments-detail` cột Lịch trình render `[formatISODate, scheduleTime]` → `30/10/2026 08:00`.
6. Tất cả unit test pin format cũ được cập nhật sang thứ tự ngày trước giờ sau.
7. Thêm unit test pin mới khẳng định định dạng ngày trước giờ sau.
