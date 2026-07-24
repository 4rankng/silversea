CREATE TABLE "onboarding_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"event_name" varchar(60) NOT NULL,
	"tour_id" varchar(120),
	"tour_version" integer,
	"step_id" varchar(120),
	"role" varchar(20) NOT NULL,
	"route_key" varchar(60),
	"duration_ms" integer,
	"trigger_source" varchar(20),
	"target_found" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_events" ADD CONSTRAINT "onboarding_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "onboarding_events_user_created_idx" ON "onboarding_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "onboarding_events_name_created_idx" ON "onboarding_events" USING btree ("event_name","created_at");