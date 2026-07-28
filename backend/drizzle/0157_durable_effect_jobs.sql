CREATE TABLE "durable_effect_jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "kind" varchar(40) NOT NULL,
  "payload_version" smallint DEFAULT 1 NOT NULL,
  "dedupe_key" varchar(255) NOT NULL,
  "payload" jsonb NOT NULL,
  "status" varchar(16) DEFAULT 'PENDING' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 20 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "lease_token" varchar(100),
  "lease_expires_at" timestamp with time zone,
  "last_error" text,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "durable_effect_jobs_status_check"
    CHECK ("durable_effect_jobs"."status" in ('PENDING', 'RUNNING', 'RETRY', 'SUCCEEDED', 'CANCELLED', 'DEAD')),
  CONSTRAINT "durable_effect_jobs_attempt_count_check"
    CHECK ("durable_effect_jobs"."attempt_count" >= 0),
  CONSTRAINT "durable_effect_jobs_max_attempts_check"
    CHECK ("durable_effect_jobs"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "durable_effect_jobs_kind_dedupe_uniq_idx"
  ON "durable_effect_jobs" USING btree ("kind", "dedupe_key");
--> statement-breakpoint
CREATE INDEX "durable_effect_jobs_due_idx"
  ON "durable_effect_jobs" USING btree ("status", "next_attempt_at", "id");
--> statement-breakpoint
CREATE INDEX "durable_effect_jobs_lease_idx"
  ON "durable_effect_jobs" USING btree ("status", "lease_expires_at");
--> statement-breakpoint
WITH legacy_cleanup_pending AS (
  SELECT
    al."id" AS audit_log_id,
    al."entity_type",
    al."entity_id",
    NULLIF(BTRIM(COALESCE(al."payload" ->> 'storageKey', '')), '') AS storage_key
  FROM "audit_logs" al
  WHERE al."payload" ->> 'event' = 'STORAGE_CLEANUP_PENDING'
    AND COALESCE(al."payload" ->> 'cleanupPending', 'false') = 'true'
    AND NULLIF(BTRIM(COALESCE(al."payload" ->> 'storageKey', '')), '') IS NOT NULL
)
INSERT INTO "durable_effect_jobs" (
  "kind",
  "payload_version",
  "dedupe_key",
  "payload",
  "status",
  "attempt_count",
  "max_attempts",
  "next_attempt_at",
  "created_at",
  "updated_at"
)
SELECT
  'STORAGE_DELETE',
  1,
  'legacy-cleanup-audit:' || legacy_cleanup_pending."audit_log_id",
  jsonb_strip_nulls(jsonb_build_object(
    'storageKey', legacy_cleanup_pending."storage_key",
    'mode', 'ORPHAN_GUARD',
    'entityType', legacy_cleanup_pending."entity_type",
    'entityId', legacy_cleanup_pending."entity_id"
  )),
  'PENDING',
  0,
  50,
  now(),
  now(),
  now()
FROM legacy_cleanup_pending
ON CONFLICT ("kind", "dedupe_key") DO NOTHING;
