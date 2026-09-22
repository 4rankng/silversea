-- Card 20260921_21 CORE — staging seed for QA rungs on /accounting/chot-debit.
-- Statement-for-statement tested on the local dev DB. Transaction-wrapped;
-- run with your pre-backup per house rules. Re-runnable: every insert is
-- guarded with WHERE NOT EXISTS on the natural keys below.
--
--   psql -v admin_id=<staging admin user id> -f this-file.sql
--
-- The :admin_id drives every NOT NULL user FK (paid_by_id / requested_by /
-- confirmed_by) — never hardcode an id across environments.
BEGIN;

INSERT INTO customers (name)
SELECT 'Khách C21 A' WHERE NOT EXISTS (SELECT 1 FROM customers WHERE name = 'Khách C21 A');
INSERT INTO customers (name)
SELECT 'Khách C21 B' WHERE NOT EXISTS (SELECT 1 FROM customers WHERE name = 'Khách C21 B');
INSERT INTO customers (name)
SELECT 'Nhà xe C21 Alpha' WHERE NOT EXISTS (SELECT 1 FROM customers WHERE name = 'Nhà xe C21 Alpha');
INSERT INTO routes (name)
SELECT 'C21 route Hải Phòng' WHERE NOT EXISTS (SELECT 1 FROM routes WHERE name = 'C21 route Hải Phòng');


-- Lots: ALL EXPORT + booking_ref, bl_number NULL — the shipments check
-- constraint pairs direction with the document reference.
INSERT INTO shipments (customer_id, route_id, shipment_code, booking_ref, trade_direction, expected_delivery_date, cargo_mode, status)
SELECT c.id, r.id, 'SHP-C21-A', 'BOOK-C21-A', 'EXPORT', '2026-09-25', 'FCL', 'PENDING_DATE'
FROM customers c, routes r WHERE c.name='Khách C21 A' AND r.name='C21 route Hải Phòng'
  AND NOT EXISTS (SELECT 1 FROM shipments WHERE shipment_code='SHP-C21-A');
INSERT INTO shipments (customer_id, shipment_code, booking_ref, trade_direction, expected_delivery_date, cargo_mode, status)
SELECT c.id, x.code, x.booking, 'EXPORT', x.edd, 'FCL', 'PENDING_DATE'
FROM (VALUES
  ('Khách C21 B', 'SHP-C21-B', 'BOOK-C21-B', DATE '2026-09-26'),
  ('Khách C21 A', 'SHP-C21-C', 'BOOK-C21-C', DATE '2026-09-27'),
  ('Khách C21 B', 'SHP-C21-E', 'BOOK-C21-E', DATE '2026-09-28'),
  ('Khách C21 B', 'SHP-C21-D', 'BOOK-C21-D', DATE '2026-10-05')
) AS x(cust, code, booking, edd)
JOIN customers c ON c.name = x.cust
WHERE NOT EXISTS (SELECT 1 FROM shipments s WHERE s.shipment_code = x.code);

-- Lot A worked-numbers family (the full column ladder).
INSERT INTO trips (shipment_id, customer_id, route_id, status, departure_date)
SELECT s.id, s.customer_id, s.route_id, 'CREATED', DATE '2026-09-20'
FROM shipments s WHERE s.shipment_code='SHP-C21-A'
  AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.shipment_id = s.id);
INSERT INTO freight_rate_snapshots (shipment_id, trip_id, freight_amount, surcharge_amount, total_amount, rate_terms_id, pricing_table_id, fuel_norm_id, fuel_price_period_id, billed_km, liters, fuel_delta, share_pct)
SELECT s.id, t.id, '1000000', '200000', '1200000', 1, 1, 1, 1, '10', '0', '0', '0'
FROM shipments s, trips t WHERE s.shipment_code='SHP-C21-A' AND t.shipment_id=s.id
  AND NOT EXISTS (SELECT 1 FROM freight_rate_snapshots f WHERE f.shipment_id = s.id);
INSERT INTO ops_expense_entries (shipment_id, expense_type_code, amount, customer_charge_amount, paid_by_id, paid_at)
SELECT s.id, 'ZONE_SURCHARGE', '50000', '90000', :admin_id, DATE '2026-09-19'
FROM shipments s WHERE s.shipment_code='SHP-C21-A'
  AND NOT EXISTS (SELECT 1 FROM ops_expense_entries o WHERE o.shipment_id = s.id AND o.expense_type_code='ZONE_SURCHARGE');
INSERT INTO ops_expense_entries (shipment_id, expense_type_code, amount, paid_by_id, paid_at)
SELECT s.id, 'QAC1-LIFT', '30000', :admin_id, DATE '2026-09-19'
FROM shipments s WHERE s.shipment_code='SHP-C21-A'
  AND NOT EXISTS (SELECT 1 FROM ops_expense_entries o WHERE o.shipment_id = s.id AND o.expense_type_code='QAC1-LIFT');
INSERT INTO trip_expenses (trip_id, expense_type, buy_amount, sell_amount)
SELECT t.id, 'OTHER', '100000', '500000'
FROM trips t JOIN shipments s ON s.id=t.shipment_id WHERE s.shipment_code='SHP-C21-A'
  AND NOT EXISTS (SELECT 1 FROM trip_expenses e WHERE e.trip_id = t.id);
INSERT INTO trip_carrier_info (trip_id, carrier_type, external_entity_id, external_entity_type, external_freight_cost, external_plate_number)
SELECT t.id, 'EXTERNAL', (SELECT id FROM customers WHERE name='Nhà xe C21 Alpha'), 'CUSTOMER', '400000', '29C-211.52'
FROM trips t JOIN shipments s ON s.id=t.shipment_id WHERE s.shipment_code='SHP-C21-A'
  AND NOT EXISTS (SELECT 1 FROM trip_carrier_info ci WHERE ci.trip_id = t.id);
INSERT INTO pricing_tables (customer_id, route_id, price, rate_key, effective_date)
SELECT c.id, r.id, '150000', 'RU', DATE '2026-09-01'
FROM customers c, routes r WHERE c.name='Khách C21 A' AND r.name='C21 route Hải Phòng'
  AND NOT EXISTS (SELECT 1 FROM pricing_tables p WHERE p.customer_id=c.id AND p.route_id=r.id AND p.rate_key='RU');

-- Adjustment states: B = live PENDING (blocks export; 409 toast rung needs
-- NO cost lock — the guard fires before the lock check), E = CONFIRMED.
-- Lot A stays NONE: it is the tick -> Gui -> cho doi soat rung.
INSERT INTO shipment_rate_adjustment_requests (shipment_id, status, requested_by)
SELECT s.id, 'PENDING', :admin_id FROM shipments s WHERE s.shipment_code='SHP-C21-B'
  AND NOT EXISTS (SELECT 1 FROM shipment_rate_adjustment_requests r WHERE r.shipment_id = s.id AND r.status='PENDING');
INSERT INTO shipment_rate_adjustment_requests (shipment_id, status, requested_by, confirmed_by, confirmed_at)
SELECT s.id, 'CONFIRMED', :admin_id, :admin_id, now() FROM shipments s WHERE s.shipment_code='SHP-C21-E'
  AND NOT EXISTS (SELECT 1 FROM shipment_rate_adjustment_requests r WHERE r.shipment_id = s.id AND r.status='CONFIRMED');
COMMIT;

-- Expected board read afterwards:
--   A = tickable (NONE) | B = pending clock + Xac nhan/Rut | C = all "Chua xac dinh"
--   E = checked "Da doi soat" | D absent when the window is September
-- Verify: SELECT shipment_code, expected_delivery_date FROM shipments
--         WHERE shipment_code LIKE 'SHP-C21-%' ORDER BY id;  -- 5 rows
