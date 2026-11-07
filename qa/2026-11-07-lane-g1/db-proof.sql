-- Lane G1 DB side-effect proofs (2026-11-07, dev DB silversea @ :5441)

-- SIL-723: the UI drive's saved Ops expense row (drawer save → ops_expense_entries)
SELECT id, shipment_id, expense_type_code, amount, paid_at, left(note,40), approval_status, created_at
FROM ops_expense_entries WHERE note LIKE 'QA lane G1%' ORDER BY id DESC LIMIT 3;
-- → 758 | 845 (lô 1786 · SILW7114252A) | TIRE_WEIGH | 80000 | 2026-11-07 |
--   'QA lane G1 — chi tiền mặt 2 công nhân dỡ…' | RECORDED | 2026-11-07 05:16:08

-- SIL-721: lot 1786 (SILW7114252A) lock/unlock events — actor 147 = ketoan
-- (Nguyễn Thị Mai, ACCOUNTANT) performed the unlocks through the UI drive.
SELECT id AS lock_id, action, actor FROM (
  SELECT id AS lock_id, 'LOCK' AS action, locked_by AS actor, locked_at AS at
    FROM shipment_cost_locks WHERE shipment_id = 1786
  UNION ALL
  SELECT id, 'UNLOCK', unlocked_by, unlocked_at
    FROM shipment_cost_locks WHERE shipment_id = 1786) t ORDER BY at;
-- → pairs LOCK/UNLOCK all by actor 147; lot ended UNLOCKED (its original state).

-- SIL-722: trip 773 (lô 1138) carries the confirmed ROAD_ALLOWANCE claim.
SELECT id, trip_id, cost_type, amount, fee_name FROM driver_incidental_costs
WHERE fee_name LIKE 'QA-722%';
-- → 19 | 773 | ROAD_ALLOWANCE | 80000 | QA-722 tien duong da duyet (CONFIRMED)
-- trips.totalCost 0 → 80000 (delta đúng +80.000₫) — sil722_trip773_run1_api.log.
