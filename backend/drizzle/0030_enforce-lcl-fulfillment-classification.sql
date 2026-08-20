UPDATE "shipment_fulfillments"
SET "dispatch_classification" = 'LCL'
WHERE "fulfillment_type" = 'LCL_SHIPMENT'
  AND "dispatch_classification" <> 'LCL';--> statement-breakpoint
ALTER TABLE "shipment_fulfillments"
  ADD CONSTRAINT "shipment_fulfillments_lcl_dispatch_classification_check"
  CHECK (
    "fulfillment_type" <> 'LCL_SHIPMENT'
    OR "dispatch_classification" = 'LCL'
  );
