-- Round calculated_liters in trip_legs
UPDATE trip_legs
SET calculated_liters = ROUND(calculated_liters)
WHERE calculated_liters IS NOT NULL
  AND calculated_liters != ROUND(calculated_liters);

--> statement-breakpoint

-- Round fuel_supplement_liters in trips
UPDATE trips
SET fuel_supplement_liters = ROUND(fuel_supplement_liters)
WHERE fuel_supplement_liters IS NOT NULL
  AND fuel_supplement_liters != ROUND(fuel_supplement_liters);

--> statement-breakpoint

-- Round fuel_liters, recalculate total_fuel_cost, total_cost, and gross_profit in trips.
-- Unit price resolution (in priority order):
--   1. fuel_actual_unit_price (when non-zero)
--   2. fuel_price_applied     (when non-zero)
--   3. effective fuel price for the trip's departure day (from fuel_price_history)
--   4. derived from existing cost / liters (last resort)
-- NULLIF(...,0) is essential: legacy trips have fuel_price_applied = 0, and a plain
-- COALESCE would treat 0 as a real price and zero out the fuel cost.
WITH rounded_trips AS (
  SELECT
    id,
    ROUND(fuel_liters) AS rounded_liters,
    ROUND(COALESCE(
      NULLIF(fuel_actual_unit_price, 0),
      NULLIF(fuel_price_applied, 0),
      (SELECT unit_price FROM fuel_price_history
         WHERE effective_date <= (departure_date::timestamp + interval '23 hours 59 minutes')
         ORDER BY effective_date DESC LIMIT 1),
      total_fuel_cost / NULLIF(fuel_liters, 0)
    )) AS unit_price,
    total_fuel_cost AS orig_fuel_cost,
    total_cost AS orig_total_cost,
    gross_profit AS orig_gross_profit
  FROM trips
  WHERE fuel_liters IS NOT NULL
    AND fuel_liters != ROUND(fuel_liters)
),
calcs AS (
  SELECT
    id,
    rounded_liters,
    (rounded_liters * unit_price) AS new_fuel_cost,
    (rounded_liters * unit_price) - orig_fuel_cost AS cost_delta,
    orig_total_cost,
    orig_gross_profit
  FROM rounded_trips
)
UPDATE trips t
SET
  fuel_liters = c.rounded_liters,
  total_fuel_cost = c.new_fuel_cost,
  total_cost = c.orig_total_cost + c.cost_delta,
  gross_profit = c.orig_gross_profit - c.cost_delta
FROM calcs c
WHERE t.id = c.id;
