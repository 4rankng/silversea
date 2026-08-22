-- Idempotent historical repair: only exact driver-reported DELIVERED events
-- with a current non-deleted trip, fulfillment, and shipment qualify. Never
-- create portal events/responses or parse legacy notes/acknowledgements.
INSERT INTO "delivery_attempts" ("shipment_id", "fulfillment_id", "trip_id", "shipment_container_id", "driver_progress_event_id", "customer_visible_event_id", "result", "occurred_at", "recorded_by")
SELECT fulfillment."shipment_id", fulfillment."id", trip."id", fulfillment."shipment_container_id", progress."id", NULL, 'DELIVERED', progress."occurred_at", COALESCE(progress."recorded_by", driver."user_id")
FROM "driver_progress_events" AS progress
INNER JOIN "trips" AS trip ON trip."id" = progress."trip_id" AND trip."deleted_at" IS NULL
INNER JOIN "shipment_fulfillments" AS fulfillment ON fulfillment."id" = trip."fulfillment_id" AND fulfillment."canceled_at" IS NULL
INNER JOIN "shipments" AS shipment ON shipment."id" = fulfillment."shipment_id" AND shipment."deleted_at" IS NULL
INNER JOIN "drivers" AS driver ON driver."id" = progress."driver_id" AND driver."deleted_at" IS NULL
WHERE progress."event_type" = 'DELIVERED'
  AND COALESCE(progress."recorded_by", driver."user_id") IS NOT NULL
ON CONFLICT ("driver_progress_event_id") DO NOTHING;
