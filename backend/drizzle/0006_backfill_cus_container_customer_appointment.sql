UPDATE "shipment_containers" AS container
SET "customer_appointment_at" = CASE
  WHEN shipment."trade_direction" = 'IMPORT'
    THEN COALESCE(shipment."planned_return_at", shipment."closing_at")
  ELSE COALESCE(shipment."closing_at", shipment."planned_return_at")
END
FROM "shipments" AS shipment
WHERE container."shipment_id" = shipment."id"
  AND container."customer_appointment_at" IS NULL
  AND (shipment."closing_at" IS NOT NULL OR shipment."planned_return_at" IS NOT NULL);
