-- SIL-1091 (K3.103) — snapshot tên nhà máy trên lô. Đổi tên trong danh mục
-- Nhà máy không được lặng lẽ đổi tên nơi giao/nhận trên các lô đang chạy:
-- lô giữ nguyên tên lúc tạo. Hai cột đóng băng nhãn hiển thị (short name
-- ưu tiên, cùng luật operationalName) tại thời điểm gán nhà máy; reference
-- operational_site_id giữ nguyên cho tìm kiếm/lọc. Backfill ĐÓNG BĂNG TÊN
-- HIỆN TẠI của dòng cũ — không đổi tên gì trên lô đã có dữ liệu (chỉ chặn
-- rename sau này trượt vào). drizzle/meta đã hỏng từ trước; viết tay + re-run
-- an toàn nhờ IF NOT EXISTS / WHERE ... IS NULL (house convention, giống
-- 20261126150000_sil1073).
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "factory_name_snapshot" varchar(255);--> statement-breakpoint
ALTER TABLE "shipment_containers" ADD COLUMN IF NOT EXISTS "factory_name_snapshot" varchar(255);--> statement-breakpoint
UPDATE "shipments" SET "factory_name_snapshot" = (
  SELECT coalesce(nullif(btrim(os.short_name), ''), os.name)
  FROM "operational_sites" os
  WHERE os.id = "shipments"."operational_site_id"
)
WHERE "operational_site_id" IS NOT NULL AND "factory_name_snapshot" IS NULL;--> statement-breakpoint
UPDATE "shipment_containers" SET "factory_name_snapshot" = (
  SELECT coalesce(nullif(btrim(os.short_name), ''), os.name)
  FROM "operational_sites" os
  WHERE os.id = "shipment_containers"."operational_site_id"
)
WHERE "operational_site_id" IS NOT NULL AND "factory_name_snapshot" IS NULL;
