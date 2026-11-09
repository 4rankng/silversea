-- SIL-729 r6 staging diagnosis (READ-ONLY): mirror getPhoiPhieuReport TRA
-- pipeline on the real staging DB — trip-less OPS sources and why the r2+r4
-- resolver (resolveShipmentFallbackParties) does not name their lot.
-- Window: full month 2026-11-01..2026-11-30 (sub-window 01..08 filtered client-side).

WITH win AS (
  SELECT DATE '2026-11-01' AS d_from, DATE '2026-11-30' AS d_to
),
trip_ids AS (            -- reportTripIds
  SELECT t.id
  FROM trips t CROSS JOIN win
  WHERE t.deleted_at IS NULL AND t.status <> 'CANCELED'
    AND t.departure_date BETWEEN win.d_from AND win.d_to
),
src AS (                 -- reportSources, trip-less only
  SELECT eas.id AS src_id, eas.shipment_id, sh.shipment_code AS shipment_code,
         oee.fee_name, oee.amount, oee.paid_at, oee.expense_type_code
  FROM expense_accounting_sources eas
  JOIN ops_expense_entries oee ON oee.id = eas.source_id
  JOIN shipments sh ON sh.id = eas.shipment_id
  CROSS JOIN win
  WHERE eas.source_kind = 'OPS' AND eas.status = 'RECORDED'
    AND eas.trip_id IS NULL
    AND oee.paid_at BETWEEN win.d_from AND win.d_to
),
live_f AS (              -- r4 live fulfillments
  SELECT f.id, f.shipment_id, f.planned_carrier_type, f.planned_external_carrier_id,
         f.planned_vehicle_plate_number
  FROM shipment_fulfillments f
  JOIN (SELECT DISTINCT shipment_id FROM src) s ON s.shipment_id = f.shipment_id
  WHERE f.canceled_at IS NULL
),
live_t AS (              -- r4 union law live trips
  SELECT COALESCE(t.shipment_id, f.shipment_id) AS shipment_id, t.id AS trip_id,
         t.shipment_id AS t_ship, t.fulfillment_id AS t_fulf
  FROM trips t
  LEFT JOIN shipment_fulfillments f ON f.id = t.fulfillment_id
  WHERE (
          t.shipment_id IN (SELECT DISTINCT shipment_id FROM src)
          OR t.fulfillment_id IN (SELECT id FROM live_f)
        )
    AND t.deleted_at IS NULL AND t.status <> 'CANCELED'
),
trip_car AS (            -- resolveReportTripParties('TRA') identity per live trip
  SELECT lt.shipment_id, lt.trip_id,
         CASE
           WHEN tci.carrier_type = 'EXTERNAL' THEN
             CASE
               WHEN tci.external_entity_id IS NULL THEN NULL
               WHEN tci.external_entity_type = 'CUSTOMER' THEN
                 COALESCE(NULLIF(BTRIM(COALESCE(cc.short_name,'') || ' ' || cc.name),''), cc.name)
               WHEN tci.external_entity_type = 'SUPPLIER' THEN
                 COALESCE(NULLIF(BTRIM(COALESCE(scc.short_name,'') || ' ' || scc.name),''),
                          NULLIF(BTRIM(COALESCE(sup.short_name,'') || ' ' || sup.name),''))
               ELSE N'Chưa xác định đơn vị vận chuyển'
             END
           WHEN NULLIF(tr.license_plate,'') IS NOT NULL THEN N'XE NHÀ — SILVER SEA'
           ELSE NULL
         END AS carrier_name,
         CASE WHEN tci.carrier_type = 'EXTERNAL' AND tci.external_entity_type = 'CUSTOMER'
                   AND cc.id IS NOT NULL THEN 'carrier:' || tci.external_entity_id
              WHEN tci.carrier_type = 'EXTERNAL' AND tci.external_entity_type = 'SUPPLIER'
                   AND COALESCE(scc.id, sup.id) IS NOT NULL THEN 'vendor:' || COALESCE(scc.id, sup.id)
              WHEN NULLIF(tr.license_plate,'') IS NOT NULL THEN 'internal::'
              ELSE NULL
         END AS identity
  FROM live_t lt
  JOIN trips t ON t.id = lt.trip_id
  LEFT JOIN trip_carrier_info tci ON tci.trip_id = t.id
  LEFT JOIN customers cc ON cc.id = tci.external_entity_id
        AND tci.external_entity_type = 'CUSTOMER' AND cc.deleted_at IS NULL
  LEFT JOIN suppliers sup ON sup.id = tci.external_entity_id
        AND tci.external_entity_type = 'SUPPLIER' AND sup.deleted_at IS NULL
  LEFT JOIN customers scc ON scc.id = sup.linked_customer_id AND scc.is_carrier = true
        AND scc.status = 'ACTIVE' AND scc.deleted_at IS NULL
  LEFT JOIN trucks tr ON tr.id = t.truck_id
),
trip_verdict AS (        -- r2 all-agree per shipment
  SELECT shipment_id,
         COUNT(*) AS n_live_trips,
         BOOL_AND(identity IS NOT NULL) AS all_resolved,
         COUNT(DISTINCT identity) AS n_identities,
         MIN(identity) AS identity,
         (ARRAY_AGG(trip_id ORDER BY trip_id))[1] AS first_trip_id,
         BOOL_AND(carrier_name IS NOT NULL) AS all_named
  FROM trip_car GROUP BY shipment_id
),
ful_verdict AS (         -- r4 planned-carrier fact all-agree per shipment
  SELECT f.shipment_id,
         COUNT(*) AS n_live_ful,
         COUNT(*) FILTER (WHERE f.planned_external_carrier_id IS NOT NULL
                           AND cm.name IS NOT NULL) AS n_ext_ok,
         COUNT(*) FILTER (WHERE f.planned_external_carrier_id IS NULL
                           AND NULLIF(f.planned_vehicle_plate_number,'') IS NOT NULL) AS n_int_ok,
         COUNT(*) FILTER (WHERE f.planned_external_carrier_id IS NOT NULL
                           AND cm.name IS NULL) AS n_ext_dead,
         COUNT(*) FILTER (WHERE f.planned_external_carrier_id IS NULL
                           AND NULLIF(f.planned_vehicle_plate_number,'') IS NULL) AS n_unassigned,
         ARRAY_AGG(DISTINCT COALESCE(
           CASE WHEN f.planned_external_carrier_id IS NOT NULL AND cm.name IS NOT NULL
                THEN 'carrier:' || f.planned_external_carrier_id::text END,
           CASE WHEN f.planned_external_carrier_id IS NULL
                     AND NULLIF(f.planned_vehicle_plate_number,'') IS NOT NULL THEN 'internal::' END,
           'UNRESOLVED')) AS identities,
         MIN(cm.name) AS ext_name
  FROM live_f f
  LEFT JOIN customers cm ON cm.id = f.planned_external_carrier_id
        AND cm.is_carrier = true AND cm.deleted_at IS NULL
  GROUP BY f.shipment_id
)
SELECT src.shipment_code,
       src.fee_name, src.amount, src.paid_at,
       COALESCE(tv.n_live_trips, 0) AS n_live_trips,
       tv.all_resolved, tv.n_identities, tv.identity, tv.first_trip_id,
       COALESCE(fv.n_live_ful, 0) AS n_live_ful,
       fv.identities, fv.ext_name,
       fv.n_ext_ok, fv.n_int_ok, fv.n_ext_dead, fv.n_unassigned,
       (SELECT COUNT(*) FROM live_f f WHERE f.shipment_id = src.shipment_id) AS f_rows,
       -- trips raw linkage for the failing shipments
       (SELECT STRING_AGG(t.id::text || CASE WHEN t.shipment_id IS NOT NULL THEN ':ship' ELSE ':ful(' || t.fulfillment_id::text || ')' END
                 || '/st:' || t.status, ', ' ORDER BY t.id)
          FROM trips t
         WHERE COALESCE(t.shipment_id, (SELECT f2.shipment_id FROM shipment_fulfillments f2 WHERE f2.id = t.fulfillment_id)) = src.shipment_id) AS all_trips_linkage
FROM src
LEFT JOIN trip_verdict tv ON tv.shipment_id = src.shipment_id
LEFT JOIN ful_verdict  fv ON fv.shipment_id = src.shipment_id
WHERE -- resolver verdict: unresolved by BOTH laws (the 'Chưa xác định' bucket)
  NOT (COALESCE(tv.all_resolved, false) AND COALESCE(tv.n_identities, 0) = 1)
  AND NOT (COALESCE(fv.n_live_ful, 0) > 0
           AND fv.n_ext_dead = 0 AND fv.n_unassigned = 0
           AND (SELECT COUNT(*) FROM UNNEST(fv.identities) u WHERE u IS NOT NULL AND u <> 'UNRESOLVED') = 1)
ORDER BY src.shipment_code, src.paid_at;
