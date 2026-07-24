CREATE TYPE "public"."vehicle_component" AS ENUM('TRUCK', 'TRAILER');--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "vehicle_component" "vehicle_component" DEFAULT 'TRUCK';