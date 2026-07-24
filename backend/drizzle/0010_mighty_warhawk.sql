CREATE TYPE "public"."trailer_status" AS ENUM('ACTIVE', 'MAINTENANCE', 'INACTIVE');--> statement-breakpoint
CREATE TABLE "trailers" (
	"id" serial PRIMARY KEY NOT NULL,
	"license_plate" varchar(20) NOT NULL,
	"type" "trailer_type" NOT NULL,
	"status" "trailer_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "trailers_license_plate_unique" UNIQUE("license_plate")
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "trailer_id" integer;--> statement-breakpoint
ALTER TABLE "trucks" ADD COLUMN "current_trailer_id" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_trailer_id_trailers_id_fk" FOREIGN KEY ("trailer_id") REFERENCES "public"."trailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_current_trailer_id_trailers_id_fk" FOREIGN KEY ("current_trailer_id") REFERENCES "public"."trailers"("id") ON DELETE no action ON UPDATE no action;