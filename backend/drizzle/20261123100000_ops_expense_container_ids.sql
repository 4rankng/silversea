-- SIL-881 (CR-010 E1) — khai chi phí nhiều container = 01 bản ghi: bộ cont
-- đầy đủ của một khai báo sống trên `shipment_container_ids` (mảng int).
-- K cont + tổng X lưu 01 dòng X gắn đủ K id; 1 cont giữ đồng bộ cột đơn cũ
-- (`shipment_container_id`) nên mọi join/filter hiện hữu không đổi; chung lô
-- để cả hai NULL. GIN phục vụ gate chặn trùng theo TẬP cont (`&&` giao tập).
-- Backfill: mỗi dòng cont đơn cũ mang mảng 1 phần tử để gate so tập đúng với
-- dữ liệu hiện hữu; chung lô giữ NULL (khác phạm vi, không giao nhau).
ALTER TABLE "ops_expense_entries" ADD COLUMN "shipment_container_ids" integer[];
CREATE INDEX IF NOT EXISTS "ops_expense_entries_container_ids_gin" ON "ops_expense_entries" USING gin ("shipment_container_ids");
UPDATE "ops_expense_entries"
SET "shipment_container_ids" = ARRAY["shipment_container_id"]
WHERE "shipment_container_id" IS NOT NULL AND "shipment_container_ids" IS NULL;
