-- Penalty approval workflow: new records enter PENDING and never deduct
-- until an authorized approver (never the submitter) promotes them to
-- ACTIVE. Pre-existing rows stay ACTIVE (grandfathered) with NULL
-- created_by / approved_by / approved_at — history is not rewritten.
-- status is a plain text column, so PENDING needs no type change.
ALTER TABLE "penalties" ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id");
ALTER TABLE "penalties" ADD COLUMN IF NOT EXISTS "approved_by" integer REFERENCES "users"("id");
ALTER TABLE "penalties" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;

ALTER TABLE "penalties" ALTER COLUMN "status" SET DEFAULT 'PENDING';
