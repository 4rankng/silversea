CREATE TABLE "settlement_expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"settlement_id" integer NOT NULL,
	"trip_expense_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settlement_expenses" ADD CONSTRAINT "settlement_expenses_settlement_id_advance_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."advance_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_expenses" ADD CONSTRAINT "settlement_expenses_trip_expense_id_trip_expenses_id_fk" FOREIGN KEY ("trip_expense_id") REFERENCES "public"."trip_expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_expense_unique_idx" ON "settlement_expenses" USING btree ("settlement_id","trip_expense_id");