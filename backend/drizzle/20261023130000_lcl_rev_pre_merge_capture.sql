-- Spec 23/10 (261023110000) review fix (C1) — "Tách nhóm" của rev group phải
-- trả tiền về ĐÚNG trạng thái trước ghép. `revenue_original` là slot M2.1
-- "first-override original" (preserve-first, trip-figure-updates) — nó đi lệch
-- khi lô đã bị ghi đè trước khi ghép (giá per-lot 21/10 hoặc sửa tay M2.1) và
-- cả khi trước ghép là NULL (bị placeholder '0' thành 0₫ trần không lý do).
-- Hai cột này là capture riêng của luật gộp: giá trị revenue NGAY TRƯỚC lúc
-- ghép + cờ đã-capture (phân biệt "trước ghép = NULL" với "chưa bao giờ ghép"
-- của nhóm legacy — nhóm đó vẫn fallback revenue_original như cũ).
--
-- An toàn deployment (drizzle-safe-migrations):
--   1. ADD COLUMN nullable + ADD COLUMN boolean DEFAULT false NOT NULL —
--      PG16+ ghi DEFAULT dạng catalog (không rewrite bảng); không backfill.
--   2. Không constraint thêm; chỉ đường gộp/tách nhóm của lcl-grouping.service
--      đọc/ghi (merge capture, restore/leaver clear).
--   3. Idempotent theo journal drizzle-kit migrate. Rollback = DROP 2 cột
--      (mất capture "trạng thái trước ghép" của nhóm tạo sau migrate — tiền
--      hiện tại không đổi).
ALTER TABLE "trip_financial_state" ADD COLUMN "revenue_pre_group" numeric(15, 0);
--> statement-breakpoint
ALTER TABLE "trip_financial_state" ADD COLUMN "revenue_pre_group_captured" boolean DEFAULT false NOT NULL;
