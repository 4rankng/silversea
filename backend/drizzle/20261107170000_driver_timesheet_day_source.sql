-- SIL-737 — chấm công lái xe: chuyến nội bộ "Đã hoàn thành" tự ghi ký hiệu
-- (Đ/K/Q) vào lưới /timesheet theo ngày hoàn thành.
--
-- Cột `source` đánh dấu ai đã ghi ô lưới: 'MANUAL' = Điều vận gõ tay,
-- 'AUTO' = hệ thống suy ra từ các chuyến hoàn thành trong ngày. Marker này là
-- điều kiện để auto-write KHÔNG đè lên ô Điều vận đang sở hữu, đồng thời cho
-- auto-write làm mới ô của chính nó khi ngày đó có chuyến thứ hai.
--
-- Schema-only: cột mới có DEFAULT 'MANUAL' nên các dòng sẵn có (đều do
-- Điều vận gõ tay) tự động đúng nhãn; không có backfill dữ liệu nào cần chạy.
-- Migration viết tay theo tiền lệ 20261014103000_driver_timesheet.sql: chuỗi
-- snapshot drizzle/meta đã hỏng từ trước nên `drizzle-kit generate` không dùng
-- được cho repo này.
ALTER TABLE "driver_timesheet_days" ADD COLUMN "source" varchar(6) DEFAULT 'MANUAL' NOT NULL;
--> statement-breakpoint
ALTER TABLE "driver_timesheet_days" ADD CONSTRAINT "driver_timesheet_days_source_check" CHECK ("source" in ('MANUAL', 'AUTO'));
