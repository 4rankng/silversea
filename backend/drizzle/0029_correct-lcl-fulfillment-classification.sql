-- Custom SQL migration file, put your code below! --
UPDATE "shipment_fulfillments"
SET "dispatch_classification" = 'LCL'
WHERE "fulfillment_type" = 'LCL_SHIPMENT'
  AND "dispatch_classification" = 'SINGLE';
