
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'ADVANCE_SETTLEMENT_APPROVED';

CREATE TABLE IF NOT EXISTS "trip_expense_completion_scopes" (
  "id" serial PRIMARY KEY,
  "trip_id" integer NOT NULL REFERENCES "trips"("id") ON DELETE CASCADE,
  "trip_container_id" integer REFERENCES "trip_containers"("id") ON DELETE CASCADE,
  "status" varchar(20) NOT NULL DEFAULT 'IN_PROGRESS',
  "completed_by" integer REFERENCES "users"("id"),
  "completed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "trip_expense_scope_container_unq"
  ON "trip_expense_completion_scopes" ("trip_container_id")
  WHERE "trip_container_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "trip_expense_scope_general_unq"
  ON "trip_expense_completion_scopes" ("trip_id")
  WHERE "trip_container_id" IS NULL;
CREATE INDEX IF NOT EXISTS "trip_expense_scope_trip_idx"
  ON "trip_expense_completion_scopes" ("trip_id");

ALTER TABLE "settlement_expenses"
  ADD COLUMN IF NOT EXISTS "original_buy_amount" numeric(15,0),
  ADD COLUMN IF NOT EXISTS "adjusted_buy_amount" numeric(15,0),
  ADD COLUMN IF NOT EXISTS "submitted_sell_amount" numeric(15,0),
  ADD COLUMN IF NOT EXISTS "original_snapshot" jsonb,
  ADD COLUMN IF NOT EXISTS "adjusted_snapshot" jsonb,
  ADD COLUMN IF NOT EXISTS "adjustment_reason" text,
  ADD COLUMN IF NOT EXISTS "adjusted_by" integer REFERENCES "users"("id"),
  ADD COLUMN IF NOT EXISTS "adjusted_at" timestamp;

DROP INDEX IF EXISTS "settlement_expense_trip_expense_uniq_idx";
CREATE INDEX IF NOT EXISTS "settlement_expense_trip_expense_idx"
  ON "settlement_expenses" ("trip_expense_id");

UPDATE "settlement_expenses" se
SET "original_buy_amount" = te."buy_amount",
    "adjusted_buy_amount" = te."buy_amount",
    "submitted_sell_amount" = te."sell_amount",
    "original_snapshot" = jsonb_build_object(
      'expenseType', te."expense_type", 'buyAmount', te."buy_amount", 'sellAmount', te."sell_amount",
      'containerNumber', te."container_number", 'invoiceNumber', te."invoice_number",
      'invoiceDate', te."invoice_date", 'declarationNumber', te."declaration_number", 'note', te."note"
    ),
    "adjusted_snapshot" = jsonb_build_object(
      'expenseType', te."expense_type", 'buyAmount', te."buy_amount", 'sellAmount', te."sell_amount",
      'containerNumber', te."container_number", 'invoiceNumber', te."invoice_number",
      'invoiceDate', te."invoice_date", 'declarationNumber', te."declaration_number", 'note', te."note"
    )
FROM "trip_expenses" te
WHERE te."id" = se."trip_expense_id"
  AND (se."original_buy_amount" IS NULL OR se."adjusted_buy_amount" IS NULL
    OR se."original_snapshot" IS NULL OR se."adjusted_snapshot" IS NULL);

ALTER TABLE "settlement_expenses"
  ALTER COLUMN "original_buy_amount" SET NOT NULL,
  ALTER COLUMN "adjusted_buy_amount" SET NOT NULL,
  ALTER COLUMN "original_snapshot" SET NOT NULL,
  ALTER COLUMN "adjusted_snapshot" SET NOT NULL;

-- Historical finished work must not appear as newly incomplete.
INSERT INTO "trip_expense_completion_scopes"
  ("trip_id", "trip_container_id", "status", "completed_at")
SELECT tc."trip_id", tc."id", 'COMPLETED', now()
FROM "trip_containers" tc
JOIN "trips" t ON t."id" = tc."trip_id"
WHERE t."status" IN ('COMPLETED', 'LOCKED', 'CANCELED')
ON CONFLICT DO NOTHING;

-- Existing individually-approved forwarder expenses are treated as completed
-- so the new submission gate does not strand legacy work.
INSERT INTO "trip_expense_completion_scopes"
  ("trip_id", "trip_container_id", "status", "completed_at")
SELECT DISTINCT te."trip_id", te."trip_container_id", 'COMPLETED', now()
FROM "trip_expenses" te
WHERE te."forwarder_id" IS NOT NULL
  AND te."approval_status" = 'APPROVED'
  AND te."trip_container_id" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "trip_expense_completion_scopes"
  ("trip_id", "trip_container_id", "status", "completed_at")
SELECT DISTINCT te."trip_id", NULL::integer, 'COMPLETED', now()
FROM "trip_expenses" te
WHERE te."forwarder_id" IS NOT NULL
  AND te."approval_status" = 'APPROVED'
  AND te."trip_container_id" IS NULL
ON CONFLICT DO NOTHING;
