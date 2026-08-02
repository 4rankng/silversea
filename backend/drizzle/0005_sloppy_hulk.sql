ALTER TYPE "public"."driver_progress_event_type" ADD VALUE IF NOT EXISTS 'ORDER_RECEIVED' BEFORE 'DEPARTED';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'DISPATCHER';--> statement-breakpoint
ALTER TABLE "shipment_status_history" ALTER COLUMN "from_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "shipment_status_history" ALTER COLUMN "to_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "status" SET DEFAULT 'NEW'::text;--> statement-breakpoint
UPDATE "shipments" SET "status" = CASE "status"
  WHEN 'DRAFT' THEN 'NEW'
  WHEN 'IN_PROGRESS' THEN 'DISPATCHED'
  WHEN 'DELIVERED' THEN 'PENDING_EXPENSE_APPROVAL'
  WHEN 'CLOSED' THEN 'COMPLETED'
  ELSE "status"
END;--> statement-breakpoint
UPDATE "shipment_status_history" SET
  "from_status" = CASE "from_status"
    WHEN 'DRAFT' THEN 'NEW'
    WHEN 'IN_PROGRESS' THEN 'DISPATCHED'
    WHEN 'DELIVERED' THEN 'PENDING_EXPENSE_APPROVAL'
    WHEN 'CLOSED' THEN 'COMPLETED'
    ELSE "from_status"
  END,
  "to_status" = CASE "to_status"
    WHEN 'DRAFT' THEN 'NEW'
    WHEN 'IN_PROGRESS' THEN 'DISPATCHED'
    WHEN 'DELIVERED' THEN 'PENDING_EXPENSE_APPROVAL'
    WHEN 'CLOSED' THEN 'COMPLETED'
    ELSE "to_status"
  END;--> statement-breakpoint
DROP TYPE "public"."shipment_status";--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('NEW', 'DISPATCHED', 'IN_TRANSIT', 'PENDING_EXPENSE_APPROVAL', 'COMPLETED', 'CANCELED');--> statement-breakpoint
ALTER TABLE "shipment_status_history" ALTER COLUMN "from_status" SET DATA TYPE "public"."shipment_status" USING "from_status"::"public"."shipment_status";--> statement-breakpoint
ALTER TABLE "shipment_status_history" ALTER COLUMN "to_status" SET DATA TYPE "public"."shipment_status" USING "to_status"::"public"."shipment_status";--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "status" SET DEFAULT 'NEW'::"public"."shipment_status";--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "status" SET DATA TYPE "public"."shipment_status" USING "status"::"public"."shipment_status";
