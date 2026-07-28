CREATE TABLE "trip_gps_capture_jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "governance_action_id" integer NOT NULL,
  "trip_id" integer NOT NULL,
  "status" varchar(16) DEFAULT 'PENDING' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "lease_token" varchar(100),
  "lease_expires_at" timestamp with time zone,
  "last_error" text,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "trip_gps_capture_jobs_status_check"
    CHECK ("trip_gps_capture_jobs"."status" in ('PENDING', 'RUNNING', 'RETRY', 'SUCCEEDED')),
  CONSTRAINT "trip_gps_capture_jobs_attempt_count_check"
    CHECK ("trip_gps_capture_jobs"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "trip_gps_capture_jobs"
  ADD CONSTRAINT "trip_gps_capture_jobs_governance_action_id_governance_actions_id_fk"
  FOREIGN KEY ("governance_action_id") REFERENCES "public"."governance_actions"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trip_gps_capture_jobs"
  ADD CONSTRAINT "trip_gps_capture_jobs_trip_id_trips_id_fk"
  FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trip_gps_capture_jobs_action_uniq_idx"
  ON "trip_gps_capture_jobs" USING btree ("governance_action_id");
--> statement-breakpoint
CREATE INDEX "trip_gps_capture_jobs_retry_idx"
  ON "trip_gps_capture_jobs" USING btree ("status", "next_attempt_at");
