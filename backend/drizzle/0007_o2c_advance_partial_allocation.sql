ALTER TABLE "advance_settlement_requests" ADD COLUMN "allocated_amount" numeric(15, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "advance_settlements" ADD COLUMN "auto_offset_expense_id" integer;--> statement-breakpoint
UPDATE "advance_settlement_requests" AS "allocation"
SET "allocated_amount" = "request"."amount"
FROM "advance_requests" AS "request"
WHERE "request"."id" = "allocation"."advance_request_id";--> statement-breakpoint
ALTER TABLE "advance_settlements" ADD CONSTRAINT "advance_settlements_auto_offset_expense_id_trip_expenses_id_fk" FOREIGN KEY ("auto_offset_expense_id") REFERENCES "public"."trip_expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adv_settlement_req_request_idx" ON "advance_settlement_requests" USING btree ("advance_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "advance_settlements_auto_offset_expense_uniq" ON "advance_settlements" USING btree ("auto_offset_expense_id") WHERE "advance_settlements"."auto_offset_expense_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "advance_settlement_requests" ADD CONSTRAINT "adv_settlement_req_allocated_nonneg_check" CHECK ("advance_settlement_requests"."allocated_amount" >= 0);
