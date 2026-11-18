-- Nhóm CUS (team-based access control cho phân hệ CUS) — lô hàng + debit.
-- Thành viên cùng nhóm ACTIVE thấy lô hàng/debit của nhau (shipments.created_by);
-- ngoài nhóm chỉ thấy lô của mình + fallback (created_by NULL hoặc do vai
-- không phải CUS tạo). Một luật duy nhất: backend/src/services/cus-visibility.service.ts.
--
-- Migration viết tay theo tiền lệ 20261109090000_shipment_pickup_warehouses.sql:
-- chuỗi snapshot drizzle/meta đã hỏng từ trước nên `drizzle-kit generate`
-- không dùng được cho repo này. Định nghĩa khớp schema/core.ts (cus_groups,
-- cus_group_members) từng cột.
CREATE TABLE "cus_groups" (
	"id" serial PRIMARY KEY,
	"name" varchar(120) NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cus_groups_name_uniq_idx" ON "cus_groups" ("name");
--> statement-breakpoint
CREATE INDEX "cus_groups_status_idx" ON "cus_groups" ("status");
--> statement-breakpoint
CREATE TABLE "cus_group_members" (
	"id" serial PRIMARY KEY,
	"group_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cus_group_members_group_user_uniq_idx" ON "cus_group_members" ("group_id", "user_id");
--> statement-breakpoint
CREATE INDEX "cus_group_members_user_idx" ON "cus_group_members" ("user_id");
