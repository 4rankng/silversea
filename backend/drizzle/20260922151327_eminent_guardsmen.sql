CREATE TABLE "quotation_cells" (
	"id" serial PRIMARY KEY NOT NULL,
	"quotation_id" integer NOT NULL,
	"route_id" integer NOT NULL,
	"vehicle_size_class_id" integer NOT NULL,
	"he_so" numeric(8, 4) DEFAULT '1' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_version_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"quotation_id" integer NOT NULL,
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"released_by" integer,
	"released_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"template_name" varchar(120) NOT NULL,
	"effective_date" date NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_cells_uniq" ON "quotation_cells" USING btree ("quotation_id","route_id","vehicle_size_class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_version_snapshots_quotation_version_uniq" ON "quotation_version_snapshots" USING btree ("quotation_id","version");--> statement-breakpoint