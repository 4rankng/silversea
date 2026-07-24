CREATE TABLE IF NOT EXISTS "tire_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "tire_positions_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "tires" ALTER COLUMN "status" SET DATA TYPE varchar(20);--> statement-breakpoint
ALTER TABLE "tires" ALTER COLUMN "status" SET DEFAULT 'IN_STOCK';--> statement-breakpoint
DROP TYPE IF EXISTS "public"."tire_status";