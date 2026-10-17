-- FB-103 (ticket 171026215600, verify-fail của card 141026230800) — chế độ
-- lương PER_TRIP/FLAT_MONTHLY ở mức LÁI XE. QA R21 không tìm thấy chỗ chọn
-- vì enum chỉ sống trong feature chấm công; cột này là mặc định khi mở bảng
-- chấm công tháng mới (bỏ qua salaryMode trong POST /months) và là giá trị
-- hiển thị/sửa ở dialog "Sửa lương cứng" + dialog sửa lái xe.
--
-- An toàn deployment (xem drizzle-safe-migrations):
--   1. ADD COLUMN ... NOT NULL DEFAULT 'PER_TRIP' — bảng drivers nhỏ; PG16+
--      ghi DEFAULT dạng catalog (không rewrite bảng).
--   2. Backfill theo NGHĨA của salary_type tự do ("LƯƠNG CHUYẾN" → PER_TRIP,
--      "LƯƠNG CỨNG" → FLAT_MONTHLY). Regex strip combining marks
--      (U+0300–U+036F) TRƯỚC khi so để Excel/macOS xuất tiếng Việt NFD
--      (dạng phân tách) vẫn khớp giống NFC; không khớp → giữ PER_TRIP
--      (đúng hành vi mặc định hiện tại của createTimesheetMonth, không hồi
--      tố). Idempotent: chỉ cập nhật dòng lệch (IS DISTINCT FROM).
--      salary_type gốc KHÔNG bị sửa/xóa — dữ liệu cũ giữ nguyên.
--      Ghi chú: môi trường mới chạy `make setup` (migrate trước seed) thì
--      backfill là no-op; seed-prod và master-data-import dẫn xuất
--      salary_mode bằng helper TS salaryModeFromSalaryType() cùng ánh xạ.
--   3. ADD CONSTRAINT sau backfill: mọi giá trị đều hợp lệ nên validate luôn.
-- Rollback: ALTER TABLE drivers DROP CONSTRAINT drivers_salary_mode_check;
-- DROP COLUMN salary_mode. (Không ảnh hưởng bảng khác — per-month override
-- nằm ở driver_timesheet_months.salary_mode từ trước.)
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "salary_mode" varchar(20) NOT NULL DEFAULT 'PER_TRIP';
--> statement-breakpoint
UPDATE "drivers" SET "salary_mode" = CASE
  WHEN regexp_replace("salary_type", '[\u0300-\u036F]', '', 'g') ~* 'chuy' THEN 'PER_TRIP'
  WHEN regexp_replace("salary_type", '[\u0300-\u036F]', '', 'g') ~* 'c(ứ|ư|u)ng' THEN 'FLAT_MONTHLY'
  ELSE 'PER_TRIP'
END
WHERE "salary_mode" IS DISTINCT FROM (
  CASE
    WHEN regexp_replace("salary_type", '[\u0300-\u036F]', '', 'g') ~* 'chuy' THEN 'PER_TRIP'
    WHEN regexp_replace("salary_type", '[\u0300-\u036F]', '', 'g') ~* 'c(ứ|ư|u)ng' THEN 'FLAT_MONTHLY'
    ELSE 'PER_TRIP'
  END
);
--> statement-breakpoint
ALTER TABLE "drivers" DROP CONSTRAINT IF EXISTS "drivers_salary_mode_check";
--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_salary_mode_check" CHECK ("salary_mode" in ('PER_TRIP', 'FLAT_MONTHLY'));
