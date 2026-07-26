CREATE TABLE "fuel_recon_explanations" (
	"id" serial PRIMARY KEY NOT NULL,
	"supplier_id" integer NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"explanation_text" text NOT NULL,
	"resolved_variance" numeric(15, 0) NOT NULL,
	"created_by" integer,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fuel_recon_explanations" ADD CONSTRAINT "fuel_recon_explanations_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_recon_explanations" ADD CONSTRAINT "fuel_recon_explanations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_recon_explanations_supplier_period_uniq" ON "fuel_recon_explanations" USING btree ("supplier_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "fuel_recon_explanations_supplier_idx" ON "fuel_recon_explanations" USING btree ("supplier_id");