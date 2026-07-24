CREATE TABLE "container_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(50) NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "container_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "fuel_price_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"unit_price" numeric(10, 0) NOT NULL,
	"effective_date" timestamp NOT NULL,
	"changed_by" integer,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ports" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(20),
	"address" text,
	"city" varchar(100) DEFAULT 'Hải Phòng',
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "trip_containers" ADD COLUMN "container_type_id" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "fuel_actual_unit_price" numeric(10, 0);--> statement-breakpoint
ALTER TABLE "fuel_price_history" ADD CONSTRAINT "fuel_price_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_containers" ADD CONSTRAINT "trip_containers_container_type_id_container_types_id_fk" FOREIGN KEY ("container_type_id") REFERENCES "public"."container_types"("id") ON DELETE no action ON UPDATE no action;