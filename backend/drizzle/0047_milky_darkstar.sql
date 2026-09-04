ALTER TABLE "users" ADD COLUMN "employee_code" varchar(20);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "accountant_name" varchar(255);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "accountant_phone" varchar(20);--> statement-breakpoint
ALTER TABLE "operational_sites" ADD COLUMN "warehouse_contact_info" text;--> statement-breakpoint
ALTER TABLE "operational_sites" ADD COLUMN "lift_info" text;--> statement-breakpoint
ALTER TABLE "operational_sites" ADD COLUMN "drop_info" text;--> statement-breakpoint
ALTER TABLE "operational_sites" ADD COLUMN "cleaning_info" text;--> statement-breakpoint
-- "classification" already added by 0046 (guarded IF NOT EXISTS, pre-existing drift fix).
ALTER TABLE "ports" ADD COLUMN "legal_entity" varchar(255);--> statement-breakpoint
ALTER TABLE "ports" ADD COLUMN "is_lach_huyen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ports" ADD COLUMN "ops_portal_url" text;--> statement-breakpoint
ALTER TABLE "ports" ADD COLUMN "position" varchar(255);--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "code" varchar(80);--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "load_point" text;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employee_code_unique" UNIQUE("employee_code");