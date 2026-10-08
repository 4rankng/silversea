CREATE TABLE "vat_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"vat_rate" numeric(5, 3) DEFAULT '0.080' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
