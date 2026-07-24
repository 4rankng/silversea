-- Add cargo_weight_kg (Pete's "trọng lượng hàng") and updated_at to trip_containers,
-- and relax the created_by FK to NULL so accountants/managers can manage container
-- instances from the trip edit form (not just forwarders during receipt).

ALTER TABLE "trip_containers"
  ADD COLUMN IF NOT EXISTS "cargo_weight_kg" numeric(10, 2),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now();

ALTER TABLE "trip_containers"
  ALTER COLUMN "created_by" DROP NOT NULL;
