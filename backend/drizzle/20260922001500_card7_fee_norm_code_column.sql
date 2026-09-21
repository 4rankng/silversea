-- Card 20260921_7 — record which fee norm the driver picked (traceability,
-- mirroring expense_type_code from card 20260921_6). NULL = not norm-driven.
ALTER TABLE "driver_incidental_costs" ADD COLUMN "fee_norm_code" varchar(50);--> statement-breakpoint
