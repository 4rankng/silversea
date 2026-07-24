-- US-005: Backfill SERVICE_FEE ledger rows for "chi hộ" (forwarder-advanced) fees
-- on COMPLETED-or-LOCKED, non-deleted trips that were approved before the SERVICE_FEE
-- posting was wired into postTripLock. This is a one-time data backfill to bring the
-- running-balance AR ledger into agreement with the historical fee receivables.
--
-- Billable statuses are COMPLETED + LOCKED (revenue/AP posts at COMPLETED via
-- postTripLock; LOCKED is a frozen-figures superset). CREATED / IN_TRANSIT / CANCELED
-- have no posted AR. ORDER MATTERS: this WHERE must be widened BEFORE first apply —
-- running LOCKED-only first would let the NOT EXISTS guard freeze those rows out and
-- a later re-run would not revisit them. After widening, a re-run inserts only the
-- newly-eligible COMPLETED candidates; a second re-run inserts 0.
--
-- Semantics:
--   For every (COMPLETED-or-LOCKED trip, APPROVED fee, sell_amount > 0) with NO existing
--   SERVICE_FEE ledger row for that (txn_id=fee.id, entity=CUSTOMER,
--   entity_id=trip.customer_id), insert exactly one SERVICE_FEE debit row.
--   Idempotent by composite key (txn_type + txn_id + entity_type + entity_id).
--   The buy side posts these fees as VENDOR_EXPENSE / FORWARDER_ADVANCE, never
--   SERVICE_FEE, so txn_id alone would not actually collide — but matching the
--   full composite key mirrors the runtime postEntry identity and stays safe.
--
-- Running balance:
--   CUSTOMER balance convention: balance = prev + debit - credit.
--   Each customer's new rows are ordered by customer_id, fee_id so assigned
--   serial ids rise with the cumulative balance (getBalance reads latest-by-id).
--   base = customer's current latest-by-id ledger balance (0 if none).
--   cum  = SUM(debit) OVER (PARTITION BY customer_id ORDER BY fee_id).
--   row.balance = base + cum.
--
-- Append-only: INSERT only. No UPDATE/DELETE of ledger rows.
WITH candidates AS (
  SELECT
    te.id         AS fee_id,
    t.customer_id AS customer_id,
    ROUND(te.sell_amount::numeric) AS debit
  FROM trip_expenses te
  JOIN trips t ON t.id = te.trip_id
  WHERE t.status IN ('COMPLETED', 'LOCKED')
    AND t.deleted_at IS NULL
    AND te.approval_status = 'APPROVED'
    AND te.sell_amount::numeric > 0
),
not_yet AS (
  SELECT c.*
  FROM candidates c
  WHERE NOT EXISTS (
    SELECT 1
    FROM ledger l
    WHERE l.txn_type = 'SERVICE_FEE'
      AND l.txn_id = c.fee_id
      AND l.entity_type = 'CUSTOMER'
      AND l.entity_id = c.customer_id
  )
),
ranked AS (
  SELECT
    n.fee_id,
    n.customer_id,
    n.debit,
    COALESCE((
      SELECT l.balance::numeric
      FROM ledger l
      WHERE l.entity_type = 'CUSTOMER'
        AND l.entity_id = n.customer_id
      ORDER BY l.id DESC
      LIMIT 1
    ), 0) AS base,
    SUM(n.debit) OVER (
      PARTITION BY n.customer_id
      ORDER BY n.fee_id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS cum
  FROM not_yet n
)
INSERT INTO ledger (
  txn_type, txn_id, entity_type, entity_id,
  debit, credit, balance, note, timestamp, created_at
)
SELECT
  'SERVICE_FEE',
  fee_id,
  'CUSTOMER',
  customer_id,
  debit,
  0,
  base + cum,
  'Phí chi hộ (nhập số dư)',
  NOW(),
  NOW()
FROM ranked
ORDER BY customer_id, fee_id;
