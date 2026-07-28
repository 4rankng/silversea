-- Legacy deployments had one shared forwarder account. Preserve that account's
-- access only when the assumption is true; fail closed instead of granting all
-- shipments to multiple existing forwarders.
DO $$
DECLARE
  active_forwarder_count integer;
  legacy_forwarder_id integer;
BEGIN
  SELECT count(*)::integer, min("id")
  INTO active_forwarder_count, legacy_forwarder_id
  FROM "users"
  WHERE "role" = 'FORWARDER'
    AND "status" = 'ACTIVE'
    AND "deleted_at" IS NULL;

  IF active_forwarder_count > 1 THEN
    RAISE EXCEPTION
      'Cannot backfill forwarder shipment scope: % active forwarders require explicit assignments',
      active_forwarder_count;
  END IF;

  IF active_forwarder_count = 1 THEN
    INSERT INTO "user_shipment_links" ("user_id", "shipment_id")
    SELECT legacy_forwarder_id, shipment."id"
    FROM "shipments" shipment
    WHERE shipment."deleted_at" IS NULL
      AND shipment."status" IN ('DRAFT', 'IN_PROGRESS')
    ON CONFLICT ("user_id", "shipment_id") DO NOTHING;
  END IF;
END $$;
