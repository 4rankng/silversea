-- SIL-764 (id 885) — Bảng Theo dõi hoàn cược: trường phân loại
-- [Cược container] | [Tạm thu sửa chữa].
--
-- Kế toán theo dõi khoản tạm thu sửa chữa vỏ container (tài xế/KT đã nộp tại
-- cảng) chung một bảng với tiền cược, lọc được theo phân loại. Dòng sẵn có
-- mặc định 'CUOC_CONTAINER' — không dòng cũ nào bị đổi nghĩa. Migration viết
-- tay theo tiền lệ 20261107170000_driver_timesheet_day_source (chuỗi snapshot
-- drizzle/meta đã hỏng từ trước; re-run an toàn nhờ IF NOT EXISTS).
ALTER TABLE "deposit_refund_trackers" ADD COLUMN IF NOT EXISTS "category" text DEFAULT 'CUOC_CONTAINER' NOT NULL;
--> statement-breakpoint
ALTER TABLE "deposit_refund_trackers" ADD CONSTRAINT "deposit_refund_trackers_category_check" CHECK ("category" in ('CUOC_CONTAINER', 'TAM_THU_SUA_CHUA'));
