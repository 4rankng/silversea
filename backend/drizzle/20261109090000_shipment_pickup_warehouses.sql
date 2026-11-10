-- SIL-765 (spec 09/11 Phần VI Epic 5.2) — một lô hàng lẻ có thể bốc hàng ở
-- NHIỀU kho lấy hàng. Điểm kho ĐẦU TIÊN giữ nguyên trên shipments.pickup_warehouse_site_id
-- (cùng cột location free-text theo hướng hàng) để mọi consumer đơn-điểm hiện
-- có giữ nguyên ý nghĩa; các dòng trong bảng này là các điểm BỔ SUNG (2..N)
-- theo thứ tự hiển thị. Cùng hợp đồng hybrid với điểm chính: site danh mục
-- HOẶC tên gõ tay (XOR chuẩn hóa ở tầng service; DB chỉ chặn "dòng phải tên
-- một điểm").
--
-- Migration viết tay theo tiền lệ 20261107170000_driver_timesheet_day_source.sql:
-- chuỗi snapshot drizzle/meta đã hỏng từ trước nên `drizzle-kit generate`
-- không dùng được cho repo này.
CREATE TABLE "shipment_pickup_warehouses" (
	"id" serial PRIMARY KEY,
	"shipment_id" integer NOT NULL,
	"site_id" integer,
	"name" varchar(255),
	"position" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_pickup_warehouses_point_check" CHECK (("shipment_pickup_warehouses"."site_id" is not null or "shipment_pickup_warehouses"."name" is not null)),
	CONSTRAINT "shipment_pickup_warehouses_position_check" CHECK ("shipment_pickup_warehouses"."position" >= 1)
);
--> statement-breakpoint
CREATE INDEX "shipment_pickup_warehouses_shipment_id_idx" ON "shipment_pickup_warehouses" ("shipment_id");
