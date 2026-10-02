CREATE TABLE "shipment_cost_locks" (
  "id" serial PRIMARY KEY,
  "shipment_id" integer NOT NULL,
  "shipment_version_at_lock" integer NOT NULL,
  "cost_snapshot" jsonb NOT NULL,
  "locked_by" integer NOT NULL,
  "locked_at" timestamptz DEFAULT now() NOT NULL,
  "lock_note" text,
  "unlocked_by" integer,
  "unlocked_at" timestamptz,
  "unlock_reason" text
);--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_cost_locks_active_uniq" ON "shipment_cost_locks" ("shipment_id") WHERE "unlocked_at" is null;--> statement-breakpoint
CREATE TABLE "shipment_cost_adjustments" (
  "id" serial PRIMARY KEY,
  "shipment_id" integer NOT NULL,
  "cost_lock_id" integer NOT NULL,
  "before_json" jsonb NOT NULL,
  "after_json" jsonb NOT NULL,
  "reason" text NOT NULL,
  "adjusted_by" integer NOT NULL,
  "adjusted_at" timestamptz DEFAULT now() NOT NULL,
  "idempotency_key" varchar(120) NOT NULL UNIQUE
);
