-- Add partial unique indexes to prevent duplicate B/L and declaration numbers
-- across active shipments. Soft-deleted rows (deleted_at IS NULL) are excluded
-- so clerks can resurrect historical shipment_ids for audit without collision.
-- Uses LOWER() for case-insensitive uniqueness at the DB level.

-- Active shipments: one B/L number per active shipment
CREATE UNIQUE INDEX "shipments_bl_number_active_uniq_idx"
  ON "shipments" (LOWER("bl_number"))
  WHERE "deleted_at" IS NULL AND "bl_number" IS NOT NULL;

-- Active shipments: one booking ref per active shipment
CREATE UNIQUE INDEX "shipments_booking_ref_active_uniq_idx"
  ON "shipments" (LOWER("booking_ref"))
  WHERE "deleted_at" IS NULL AND "booking_ref" IS NOT NULL;

-- Declarations: one declaration number globally (declarations don't soft-delete)
CREATE UNIQUE INDEX "shipment_declarations_number_uniq_idx"
  ON "shipment_declarations" (LOWER("declaration_number"))
  WHERE "declaration_number" IS NOT NULL;
