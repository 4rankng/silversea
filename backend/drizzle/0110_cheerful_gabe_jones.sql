CREATE TABLE "photo_geotags" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" varchar(32) NOT NULL,
	"entity_id" integer NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy" double precision,
	"altitude" double precision,
	"gps_at" timestamp with time zone,
	"source" varchar(16) DEFAULT 'phone' NOT NULL,
	"sample_count" integer,
	"best_accuracy" double precision,
	"elapsed_ms" integer,
	"recorded_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "photo_geotags" ADD CONSTRAINT "photo_geotags_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "photo_geotags_entity_uniq" ON "photo_geotags" USING btree ("entity_type","entity_id");