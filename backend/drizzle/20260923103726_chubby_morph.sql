CREATE TABLE "quotation_fees" (
	"id" serial PRIMARY KEY NOT NULL,
	"quotation_id" integer NOT NULL,
	"fee_name" varchar(120) NOT NULL,
	"sub_type" varchar(80),
	"default_amount" numeric(15, 0),
	"routing" varchar(30) DEFAULT 'OTHER_COSTS' NOT NULL,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "quotation_fees_quotation_idx" ON "quotation_fees" USING btree ("quotation_id");