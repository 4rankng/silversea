DROP INDEX "treasury_movements_receipt_posted_uniq";--> statement-breakpoint
DROP INDEX "treasury_movements_ledger_posted_uniq";--> statement-breakpoint
DROP INDEX "treasury_movements_reversal_uniq";--> statement-breakpoint
UPDATE "treasury_movements" AS "original"
SET "status" = 'POSTED'
WHERE "original"."status" = 'REVERSED'
  AND EXISTS (
    SELECT 1
    FROM "treasury_movements" AS "reversal"
    WHERE "reversal"."reversal_of_id" = "original"."id"
      AND "reversal"."status" = 'POSTED'
  );--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_movements_receipt_posted_uniq" ON "treasury_movements" USING btree ("payment_receipt_id") WHERE "treasury_movements"."payment_receipt_id" is not null and "treasury_movements"."status" = 'POSTED' and "treasury_movements"."reversal_of_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_movements_ledger_posted_uniq" ON "treasury_movements" USING btree ("ledger_entry_id") WHERE "treasury_movements"."ledger_entry_id" is not null and "treasury_movements"."status" = 'POSTED' and "treasury_movements"."reversal_of_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_movements_reversal_uniq" ON "treasury_movements" USING btree ("reversal_of_id","source_version") WHERE "treasury_movements"."reversal_of_id" is not null;
