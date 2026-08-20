-- Custom SQL migration file, put your code below! --
UPDATE "shipment_fulfillments"
SET "dispatch_classification" = 'SINGLE'
WHERE "dispatch_classification" IS NULL;
