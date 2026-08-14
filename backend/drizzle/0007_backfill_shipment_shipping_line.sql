WITH unambiguous_shipping_lines AS (
  SELECT
    shipment_id,
    min(btrim(shipping_line_name)) AS shipping_line_name
  FROM shipment_containers
  WHERE nullif(btrim(shipping_line_name), '') IS NOT NULL
  GROUP BY shipment_id
  HAVING count(DISTINCT lower(btrim(shipping_line_name))) = 1
)
UPDATE shipments AS shipment
SET
  shipping_line_name = source.shipping_line_name,
  updated_at = now()
FROM unambiguous_shipping_lines AS source
WHERE shipment.id = source.shipment_id
  AND nullif(btrim(shipment.shipping_line_name), '') IS NULL;
