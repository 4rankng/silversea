ALTER TABLE "billing_documents"
  ADD COLUMN "ledger_adjustment_amount" numeric(15, 0) DEFAULT '0' NOT NULL;
--> statement-breakpoint
WITH ranked AS (
  SELECT "id",
         row_number() OVER (
           PARTITION BY "type", "entity_type", "entity_id", "range_from", "range_to"
           ORDER BY "updated_at" DESC, "id" DESC
         ) AS rn
  FROM "billing_documents"
  WHERE "deleted_at" IS NULL AND "type" = 'DEBIT_NOTE'
)
UPDATE "billing_documents" AS doc
SET "deleted_at" = now(), "updated_at" = now()
FROM ranked
WHERE doc."id" = ranked."id" AND ranked.rn > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_documents_active_period_unique"
  ON "billing_documents" USING btree ("type", "entity_type", "entity_id", "range_from", "range_to")
  WHERE "billing_documents"."deleted_at" IS NULL AND "billing_documents"."type" = 'DEBIT_NOTE';
