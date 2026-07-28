-- Preserve the legacy single-forwarder experience while making shipment
-- assignments the explicit authority for all future forwarder trip access.
INSERT INTO "user_shipment_links" ("user_id", "shipment_id")
SELECT forwarder."id", shipment."id"
FROM "users" forwarder
CROSS JOIN "shipments" shipment
WHERE forwarder."role" = 'FORWARDER'
  AND forwarder."status" = 'ACTIVE'
  AND forwarder."deleted_at" IS NULL
  AND shipment."deleted_at" IS NULL
ON CONFLICT ("user_id", "shipment_id") DO NOTHING;
