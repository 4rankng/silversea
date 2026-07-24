CREATE TYPE "public"."penalty_status" AS ENUM('ACTIVE', 'CANCELED');--> statement-breakpoint
ALTER TABLE "penalties" ADD COLUMN "status" "penalty_status" DEFAULT 'ACTIVE' NOT NULL;