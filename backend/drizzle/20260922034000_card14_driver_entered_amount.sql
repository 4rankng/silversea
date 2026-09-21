-- Card 20260921_14: keep the DRIVER's original entry amount visible when the
-- accountant adjusts a tiền đường line. Backfill = amount for existing rows.
ALTER TABLE "driver_incidental_costs" ADD COLUMN "driver_entered_amount" numeric(15, 0);
UPDATE "driver_incidental_costs" SET "driver_entered_amount" = "amount" WHERE "driver_entered_amount" IS NULL;
