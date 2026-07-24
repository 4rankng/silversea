-- Backfill trip_legs.km for legs left at 0 (distance never entered) from the
-- real Bách Khoa GPS-measured distances seeded into route_polylines (0064).
--
-- Matching mirrors route-capture.ts cleanPlaceName = trim().toLowerCase()
-- (the single source of truth for leg <-> polyline keys), and is bidirectional:
-- A->B also covers B->A reversed. When both a forward and a reverse pair exist
-- they differ slightly (different actual drives); the exact-direction match is
-- preferred, ties broken by lowest route_polyline id for determinism.
--
-- Idempotency rule: only legs with km = 0 are touched, so re-runs are safe and
-- no hand-corrected distance is ever overwritten. Legs whose (origin,destination)
-- pair is not yet in route_polylines stay at 0 until a truck drives the route and
-- the completion hook / backfill derives it.

WITH matches AS (
  SELECT
    l.id AS leg_id,
    ROUND(p.distance_km)::integer AS km,
    ROW_NUMBER() OVER (
      PARTITION BY l.id
      ORDER BY
        CASE WHEN lower(trim(l.origin)) = p.origin_cleaned THEN 0 ELSE 1 END,
        p.id
    ) AS rn
  FROM trip_legs l
  JOIN route_polylines p ON
        (lower(trim(l.origin)) = p.origin_cleaned
     AND lower(trim(l.destination)) = p.destination_cleaned)
     OR
        (lower(trim(l.origin)) = p.destination_cleaned
     AND lower(trim(l.destination)) = p.origin_cleaned)
  WHERE l.km = 0
)
UPDATE trip_legs l
SET km = GREATEST(1, m.km),
    updated_at = now()
FROM matches m
WHERE l.id = m.leg_id
  AND m.rn = 1;
