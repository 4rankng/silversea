-- SIL-1114 — snapshot tên cảng nâng/hạ trên container (cùng luật SIL-1091
-- factory_name_snapshot). Đổi tên trong danh mục Cảng/Bãi không được lặng lẽ
-- đổi nhãn cảng trên các lô đang chạy hoặc đã khóa: container giữ nguyên tên
-- lúc gán cảng (short_name ưu tiên, fallback name). Backfill đóng băng tên hiện
-- tại của dòng cũ; re-run an toàn nhờ IF NOT EXISTS / WHERE ... IS NULL.
ALTER TABLE "shipment_containers" ADD COLUMN IF NOT EXISTS "pickup_port_name_snapshot" varchar(255);--> statement-breakpoint
ALTER TABLE "shipment_containers" ADD COLUMN IF NOT EXISTS "dropoff_port_name_snapshot" varchar(255);--> statement-breakpoint
UPDATE "shipment_containers" SET "pickup_port_name_snapshot" = (
  SELECT coalesce(nullif(btrim(p.short_name), ''), p.name)
  FROM "ports" p
  WHERE p.id = "shipment_containers"."pickup_port_id"
)
WHERE "pickup_port_id" IS NOT NULL AND "pickup_port_name_snapshot" IS NULL;--> statement-breakpoint
UPDATE "shipment_containers" SET "dropoff_port_name_snapshot" = (
  SELECT coalesce(nullif(btrim(p.short_name), ''), p.name)
  FROM "ports" p
  WHERE p.id = "shipment_containers"."dropoff_port_id"
)
WHERE "dropoff_port_id" IS NOT NULL AND "dropoff_port_name_snapshot" IS NULL;
