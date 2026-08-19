-- Dispatch-zone taxonomy becomes data (user decision 2026-08-19): port
-- clusters are maintained in the database, not code constants. Adding a new
-- cluster (e.g. Ninh Bình) is a seed row + ADMIN port classification — no
-- deploy, no enum/constant change.
--
-- ports.dispatch_zone stays a plain varchar (no FK, per repo rule); the
-- application validates writes against this table. Codes are stable
-- cross-environment keys; labels are operator-facing Vietnamese.
CREATE TABLE "dispatch_zones" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"label" varchar(100) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispatch_zones_code_unique" UNIQUE ("code")
);--> statement-breakpoint
-- Seed the two verified Hải Phòng clusters. Idempotent: re-running (or the
-- app seeder) refreshes label/order but never duplicates.
INSERT INTO "dispatch_zones" ("code", "label", "sort_order", "is_active")
VALUES
	('LACH_HUYEN', 'Lạch Huyện', 10, true),
	('HAI_PHONG', 'Cảng Hải Phòng', 20, true)
ON CONFLICT ("code") DO UPDATE SET
	"label" = EXCLUDED."label",
	"sort_order" = EXCLUDED."sort_order";
