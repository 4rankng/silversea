-- Backfill ledger rows for trips that were already COMPLETED before the
-- accounting trigger moved from LOCKED to COMPLETED.
--
-- Idempotency rule: each insert skips rows where the same entity/type/trip
-- (or fee id for ancillary fees) is already represented in the ledger.

WITH eligible AS (
  SELECT
    t.id,
    t.customer_id AS entity_id,
    t.trip_code,
    COALESCE(t.completed_at, t.updated_at, t.created_at, now()) AS ts,
    t.revenue::numeric AS amount
  FROM trips t
  WHERE t.status = 'COMPLETED'
    AND COALESCE(t.revenue::numeric, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM ledger l
      WHERE l.entity_type = 'CUSTOMER'
        AND l.txn_type = 'TRIP_REVENUE'
        AND l.txn_id = t.id
    )
),
base AS (
  SELECT DISTINCT ON (l.entity_id)
    l.entity_id,
    l.balance::numeric AS balance
  FROM ledger l
  WHERE l.entity_type = 'CUSTOMER'
  ORDER BY l.entity_id, l.id DESC
),
ordered AS (
  SELECT
    e.*,
    COALESCE(b.balance, 0) +
      SUM(e.amount) OVER (PARTITION BY e.entity_id ORDER BY e.ts, e.id ROWS UNBOUNDED PRECEDING) AS next_balance
  FROM eligible e
  LEFT JOIN base b ON b.entity_id = e.entity_id
)
INSERT INTO ledger (timestamp, txn_type, txn_id, entity_type, entity_id, debit, credit, balance, note)
SELECT
  ts,
  'TRIP_REVENUE',
  id,
  'CUSTOMER',
  entity_id,
  amount,
  0,
  next_balance,
  CASE WHEN trip_code IS NOT NULL THEN 'Doanh thu chuyến ' || trip_code ELSE 'Doanh thu chuyến' END
FROM ordered;

--> statement-breakpoint

WITH eligible AS (
  SELECT
    t.id,
    t.driver_id AS entity_id,
    t.trip_code,
    COALESCE(t.completed_at, t.updated_at, t.created_at, now()) AS ts,
    t.driver_salary::numeric AS amount
  FROM trips t
  WHERE t.status = 'COMPLETED'
    AND COALESCE(t.carrier_type, 'OWN') = 'OWN'
    AND t.driver_id IS NOT NULL
    AND COALESCE(t.driver_salary::numeric, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM ledger l
      WHERE l.entity_type = 'DRIVER'
        AND l.txn_type = 'DRIVER_SALARY'
        AND l.txn_id = t.id
    )
),
base AS (
  SELECT DISTINCT ON (l.entity_id)
    l.entity_id,
    l.balance::numeric AS balance
  FROM ledger l
  WHERE l.entity_type = 'DRIVER'
  ORDER BY l.entity_id, l.id DESC
),
ordered AS (
  SELECT
    e.*,
    COALESCE(b.balance, 0) +
      SUM(e.amount) OVER (PARTITION BY e.entity_id ORDER BY e.ts, e.id ROWS UNBOUNDED PRECEDING) AS next_balance
  FROM eligible e
  LEFT JOIN base b ON b.entity_id = e.entity_id
)
INSERT INTO ledger (timestamp, txn_type, txn_id, entity_type, entity_id, debit, credit, balance, note)
SELECT
  ts,
  'DRIVER_SALARY',
  id,
  'DRIVER',
  entity_id,
  0,
  amount,
  next_balance,
  CASE WHEN trip_code IS NOT NULL THEN 'Lương sản lượng chuyến ' || trip_code ELSE 'Lương sản lượng chuyến' END
FROM ordered;

--> statement-breakpoint

WITH eligible AS (
  SELECT
    t.id,
    t.fuel_supplier_id AS entity_id,
    t.trip_code,
    COALESCE(t.completed_at, t.updated_at, t.created_at, now()) AS ts,
    t.total_fuel_cost::numeric AS amount
  FROM trips t
  WHERE t.status = 'COMPLETED'
    AND t.fuel_supplier_id IS NOT NULL
    AND COALESCE(t.total_fuel_cost::numeric, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM ledger l
      WHERE l.entity_type = 'VENDOR'
        AND l.txn_type = 'FUEL_EXPENSE'
        AND l.txn_id = t.id
    )
),
base AS (
  SELECT DISTINCT ON (l.entity_id)
    l.entity_id,
    l.balance::numeric AS balance
  FROM ledger l
  WHERE l.entity_type = 'VENDOR'
  ORDER BY l.entity_id, l.id DESC
),
ordered AS (
  SELECT
    e.*,
    COALESCE(b.balance, 0) +
      SUM(e.amount) OVER (PARTITION BY e.entity_id ORDER BY e.ts, e.id ROWS UNBOUNDED PRECEDING) AS next_balance
  FROM eligible e
  LEFT JOIN base b ON b.entity_id = e.entity_id
)
INSERT INTO ledger (timestamp, txn_type, txn_id, entity_type, entity_id, debit, credit, balance, note)
SELECT
  ts,
  'FUEL_EXPENSE',
  id,
  'VENDOR',
  entity_id,
  0,
  amount,
  next_balance,
  CASE WHEN trip_code IS NOT NULL THEN 'Chi phí dầu chuyến ' || trip_code ELSE 'Chi phí dầu chuyến' END
FROM ordered;

--> statement-breakpoint

WITH eligible AS (
  SELECT
    t.id,
    t.external_carrier_id AS entity_id,
    t.trip_code,
    COALESCE(t.completed_at, t.updated_at, t.created_at, now()) AS ts,
    t.external_freight_cost::numeric AS amount
  FROM trips t
  WHERE t.status = 'COMPLETED'
    AND COALESCE(t.carrier_type, 'OWN') = 'EXTERNAL'
    AND t.external_carrier_id IS NOT NULL
    AND COALESCE(t.external_freight_cost::numeric, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM ledger l
      WHERE l.entity_type = 'CUSTOMER'
        AND l.txn_type = 'EXTERNAL_CARRIER_COST'
        AND l.txn_id = t.id
    )
),
base AS (
  SELECT DISTINCT ON (l.entity_id)
    l.entity_id,
    l.balance::numeric AS balance
  FROM ledger l
  WHERE l.entity_type = 'CUSTOMER'
  ORDER BY l.entity_id, l.id DESC
),
ordered AS (
  SELECT
    e.*,
    COALESCE(b.balance, 0) -
      SUM(e.amount) OVER (PARTITION BY e.entity_id ORDER BY e.ts, e.id ROWS UNBOUNDED PRECEDING) AS next_balance
  FROM eligible e
  LEFT JOIN base b ON b.entity_id = e.entity_id
)
INSERT INTO ledger (timestamp, txn_type, txn_id, entity_type, entity_id, debit, credit, balance, note)
SELECT
  ts,
  'EXTERNAL_CARRIER_COST',
  id,
  'CUSTOMER',
  entity_id,
  0,
  amount,
  next_balance,
  CASE WHEN trip_code IS NOT NULL THEN 'Cước thuê ngoài chuyến ' || trip_code ELSE 'Cước thuê ngoài' END
FROM ordered;

--> statement-breakpoint

WITH eligible AS (
  SELECT
    f.id,
    f.supplier_id AS entity_id,
    t.trip_code,
    COALESCE(t.completed_at, f.updated_at, f.created_at, now()) AS ts,
    f.buy_amount::numeric AS amount
  FROM trip_expenses f
  INNER JOIN trips t ON t.id = f.trip_id
  WHERE t.status = 'COMPLETED'
    AND f.approval_status = 'APPROVED'
    AND f.settlement_method = 'COMPANY_DIRECT'
    AND f.supplier_id IS NOT NULL
    AND COALESCE(f.buy_amount::numeric, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM ledger l
      WHERE l.entity_type = 'VENDOR'
        AND l.txn_type = 'VENDOR_EXPENSE'
        AND l.txn_id = f.id
    )
),
base AS (
  SELECT DISTINCT ON (l.entity_id)
    l.entity_id,
    l.balance::numeric AS balance
  FROM ledger l
  WHERE l.entity_type = 'VENDOR'
  ORDER BY l.entity_id, l.id DESC
),
ordered AS (
  SELECT
    e.*,
    COALESCE(b.balance, 0) +
      SUM(e.amount) OVER (PARTITION BY e.entity_id ORDER BY e.ts, e.id ROWS UNBOUNDED PRECEDING) AS next_balance
  FROM eligible e
  LEFT JOIN base b ON b.entity_id = e.entity_id
)
INSERT INTO ledger (timestamp, txn_type, txn_id, entity_type, entity_id, debit, credit, balance, note)
SELECT
  ts,
  'VENDOR_EXPENSE',
  id,
  'VENDOR',
  entity_id,
  0,
  amount,
  next_balance,
  CASE WHEN trip_code IS NOT NULL THEN 'Chi phí DV chuyến ' || trip_code ELSE 'Chi phí dịch vụ' END
FROM ordered;

--> statement-breakpoint

WITH eligible AS (
  SELECT
    f.id,
    f.forwarder_id AS entity_id,
    t.trip_code,
    COALESCE(t.completed_at, f.updated_at, f.created_at, now()) AS ts,
    f.buy_amount::numeric AS amount
  FROM trip_expenses f
  INNER JOIN trips t ON t.id = f.trip_id
  WHERE t.status = 'COMPLETED'
    AND f.approval_status = 'APPROVED'
    AND f.settlement_method = 'FORWARDER_ADVANCE'
    AND f.forwarder_id IS NOT NULL
    AND COALESCE(f.buy_amount::numeric, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM ledger l
      WHERE l.entity_type = 'FORWARDER'
        AND l.txn_type = 'FORWARDER_ADVANCE'
        AND l.txn_id = f.id
    )
),
base AS (
  SELECT DISTINCT ON (l.entity_id)
    l.entity_id,
    l.balance::numeric AS balance
  FROM ledger l
  WHERE l.entity_type = 'FORWARDER'
  ORDER BY l.entity_id, l.id DESC
),
ordered AS (
  SELECT
    e.*,
    COALESCE(b.balance, 0) -
      SUM(e.amount) OVER (PARTITION BY e.entity_id ORDER BY e.ts, e.id ROWS UNBOUNDED PRECEDING) AS next_balance
  FROM eligible e
  LEFT JOIN base b ON b.entity_id = e.entity_id
)
INSERT INTO ledger (timestamp, txn_type, txn_id, entity_type, entity_id, debit, credit, balance, note)
SELECT
  ts,
  'FORWARDER_ADVANCE',
  id,
  'FORWARDER',
  entity_id,
  amount,
  0,
  next_balance,
  CASE WHEN trip_code IS NOT NULL THEN 'Chi hộ DV chuyến ' || trip_code ELSE 'Chi hộ dịch vụ' END
FROM ordered;
