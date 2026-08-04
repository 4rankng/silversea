-- Classify the legacy catch-all NEW state before the application default and
-- transition contract move to PENDING_DATE / READY_FOR_DISPATCH. This is
-- intentionally idempotent: reruns only see rows still stored as NEW.
WITH classified AS (
  SELECT
    shipment.id,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM trips
        WHERE trips.shipment_id = shipment.id
          AND trips.status = 'IN_TRANSIT'
          AND trips.deleted_at IS NULL
      ) THEN 'IN_TRANSIT'
      WHEN EXISTS (
        SELECT 1
        FROM trips
        WHERE trips.shipment_id = shipment.id
          AND trips.status = 'COMPLETED'
          AND trips.deleted_at IS NULL
      ) AND NOT EXISTS (
        SELECT 1
        FROM trips
        WHERE trips.shipment_id = shipment.id
          AND trips.status NOT IN ('COMPLETED', 'CANCELED')
          AND trips.deleted_at IS NULL
      ) THEN 'PENDING_EXPENSE_APPROVAL'
      WHEN EXISTS (
        SELECT 1
        FROM trips
        WHERE trips.shipment_id = shipment.id
          AND trips.status <> 'CANCELED'
          AND trips.deleted_at IS NULL
      ) THEN 'DISPATCHED'
      WHEN shipment.closing_at IS NOT NULL
        OR shipment.planned_return_at IS NOT NULL
        THEN 'READY_FOR_DISPATCH'
      ELSE 'PENDING_DATE'
    END AS target_status
  FROM shipments AS shipment
  WHERE shipment.status = 'NEW'
    AND shipment.deleted_at IS NULL
), updated AS (
  UPDATE shipments AS shipment
  SET
    status = classified.target_status,
    version = shipment.version + 1,
    updated_at = NOW()
  FROM classified
  WHERE shipment.id = classified.id
    AND shipment.status = 'NEW'
  RETURNING shipment.id, classified.target_status
)
INSERT INTO shipment_status_history (
  shipment_id,
  from_status,
  to_status,
  reason,
  changed_at
)
SELECT
  updated.id,
  'NEW',
  updated.target_status,
  'Chuẩn hóa trạng thái tiếp nhận theo quy trình điều xe 2026',
  NOW()
FROM updated;
