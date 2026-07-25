CREATE TYPE "public"."scheduler_run_status" AS ENUM('RUNNING', 'SUCCESS', 'FAILED');--> statement-breakpoint
CREATE TABLE "scheduler_run_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_name" varchar(64) NOT NULL,
	"cron" varchar(32) NOT NULL,
	"status" "scheduler_run_status" DEFAULT 'RUNNING' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "scheduler_run_logs_job_started_idx" ON "scheduler_run_logs" USING btree ("job_name","started_at");