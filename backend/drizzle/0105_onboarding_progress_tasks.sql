CREATE TYPE "public"."onboarding_status" AS ENUM('in_progress', 'completed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."onboarding_task_status" AS ENUM('pending', 'completed', 'dismissed');--> statement-breakpoint
CREATE TABLE "user_onboarding_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tour_id" varchar(120) NOT NULL,
	"tour_version" integer NOT NULL,
	"current_step_id" varchar(120),
	"status" "onboarding_status" NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"skipped_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_onboarding_tasks" (
	"user_id" integer NOT NULL,
	"task_id" varchar(120) NOT NULL,
	"status" "onboarding_task_status" NOT NULL,
	"completed_at" timestamp with time zone,
	"metadata" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_onboarding_progress" ADD CONSTRAINT "user_onboarding_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_onboarding_tasks" ADD CONSTRAINT "user_onboarding_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_onboarding_progress_user_tour_version_idx" ON "user_onboarding_progress" USING btree ("user_id","tour_id","tour_version");--> statement-breakpoint
CREATE INDEX "user_onboarding_progress_user_idx" ON "user_onboarding_progress" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_onboarding_tasks_user_task_idx" ON "user_onboarding_tasks" USING btree ("user_id","task_id");