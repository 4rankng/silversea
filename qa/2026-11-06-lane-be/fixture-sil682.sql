-- SIL-682 fixture (LOCAL DEV DB ONLY — ss-prod-db :5441/silversea, dev stack).
-- Mirrors the staging defect shape: the "Chi tiết tiền đường" dialog keys its
-- rows on expense_accounting_sources.id (PK 5000) while the confirm endpoint
-- resolves (sourceKind, sourceId) against the NATIVE driver_incidental_costs.id.
-- pk 5000 ≠ native id ⇒ the old code 404s ("Không tìm thấy chi phí thuộc lô."),
-- the fixed code resolves the alias and confirms native id.
-- Cleanup: qa/2026-11-06-lane-be/cleanup-sil682.sql
\set trip_id 1337
\set shipment_id 1809
\set driver_id 23
\set actor_id 9

INSERT INTO driver_incidental_costs
  (trip_id, driver_id, cost_type, amount, occurred_at, payer_kind, cost_group,
   fee_name, customer_charge_amount, driver_entered_amount, evidence_kind, recorded_by)
VALUES
  (:trip_id, :driver_id, 'LIFT_FEE', 150000, '2026-11-05', 'USER', 'DRIVER_ROAD',
   'Phí nâng container (QA fixture SIL-682)', 150000, 150000, 'RECEIPT', :actor_id)
RETURNING id AS native_id;

-- Explicit alias PK 5000 (≠ native id) — the dialog's id space.
INSERT INTO expense_accounting_sources
  (id, source_kind, source_id, version, shipment_id, trip_id, recorded_by_id, status)
VALUES
  (5000, 'DRIVER', (SELECT max(id) FROM driver_incidental_costs), 1,
   :shipment_id, :trip_id, :actor_id, 'RECORDED');

-- Keep future serials above the reserved alias id.
SELECT setval('expense_accounting_sources_id_seq', 5001, false);
