ALTER TABLE "trip_expenses" ADD COLUMN "lift_pricing_id" integer;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD COLUMN "lift_pricing_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_lift_pricing_id_lift_pricing_id_fk" FOREIGN KEY ("lift_pricing_id") REFERENCES "public"."lift_pricing"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_expenses_lift_pricing_id_idx" ON "trip_expenses" USING btree ("lift_pricing_id");
