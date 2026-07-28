CREATE TABLE "fuel_period_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"governance_action_id" integer NOT NULL,
	"fuel_invoice_id" integer NOT NULL,
	"source_period_lock_id" integer NOT NULL,
	"source_period" varchar(7) NOT NULL,
	"target_period" varchar(7) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_period_adjustments_source_target_check" CHECK ("fuel_period_adjustments"."source_period" <> "fuel_period_adjustments"."target_period")
);
--> statement-breakpoint
ALTER TABLE "fuel_period_adjustments" ADD CONSTRAINT "fuel_period_adjustments_governance_action_id_governance_actions_id_fk" FOREIGN KEY ("governance_action_id") REFERENCES "public"."governance_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_period_adjustments" ADD CONSTRAINT "fuel_period_adjustments_fuel_invoice_id_fuel_invoices_id_fk" FOREIGN KEY ("fuel_invoice_id") REFERENCES "public"."fuel_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_period_adjustments" ADD CONSTRAINT "fuel_period_adjustments_source_period_lock_id_period_locks_id_fk" FOREIGN KEY ("source_period_lock_id") REFERENCES "public"."period_locks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_period_adjustments_action_source_uniq" ON "fuel_period_adjustments" USING btree ("governance_action_id","source_period_lock_id");--> statement-breakpoint
CREATE INDEX "fuel_period_adjustments_invoice_idx" ON "fuel_period_adjustments" USING btree ("fuel_invoice_id","created_at");--> statement-breakpoint
CREATE INDEX "fuel_period_adjustments_source_idx" ON "fuel_period_adjustments" USING btree ("source_period","created_at");--> statement-breakpoint
CREATE INDEX "fuel_period_adjustments_target_idx" ON "fuel_period_adjustments" USING btree ("target_period","created_at");