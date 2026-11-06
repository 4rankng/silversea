-- SIL-683 boundary proof on real Postgres (dev DB :5441/silversea).
-- The completion instant is stored as a naive timestamp holding UTC wall clock.
-- old = single `at time zone 'Asia/Ho_Chi_Minh'`  (the defect: interprets UTC wall as +07)
-- new = `at time zone 'UTC' at time zone 'Asia/Ho_Chi_Minh'` (the shared reporting law)
-- Boundaries required by the ticket brief:
--   * 23:xx biên đêm  : completed 23:30 VN on 11-05 → stored 16:30 UTC → must stay 2026-11-05
--   * 00:xx biên sáng : completed 00:30 VN on 11-06 → stored 17:30 UTC → must be   2026-11-06
--   * ticket trip 347 : completed 09:59 VN on 11-06 → stored 02:59 UTC → must be   2026-11-06
\echo '=== session timezone = UTC ==='
SET timezone = 'UTC';
WITH samples(stamp, label) AS (VALUES
  ('2026-11-05 16:30:00'::timestamp, '23:30 VN 11-05 (biên đêm)'),
  ('2026-11-05 17:30:00'::timestamp, '00:30 VN 11-06 (biên sáng)'),
  ('2026-11-06 02:59:44'::timestamp, '09:59 VN 11-06 (ticket 347)')
)
SELECT label,
  to_char(stamp at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS old_single_chain,
  to_char(stamp at time zone 'UTC' at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS new_utc_chain
FROM samples ORDER BY stamp;

\echo '=== session timezone = Asia/Ho_Chi_Minh (same rows must render identically under the new chain) ==='
SET timezone = 'Asia/Ho_Chi_Minh';
WITH samples(stamp, label) AS (VALUES
  ('2026-11-05 16:30:00'::timestamp, '23:30 VN 11-05 (biên đêm)'),
  ('2026-11-05 17:30:00'::timestamp, '00:30 VN 11-06 (biên sáng)'),
  ('2026-11-06 02:59:44'::timestamp, '09:59 VN 11-06 (ticket 347)')
)
SELECT label,
  to_char(stamp at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS old_single_chain,
  to_char(stamp at time zone 'UTC' at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS new_utc_chain
FROM samples ORDER BY stamp;

\echo '=== ::date filter form (debit-note draft law) ==='
SELECT
  ('2026-11-05 17:30:00'::timestamp at time zone 'Asia/Ho_Chi_Minh')::date AS old_filter,
  ('2026-11-05 17:30:00'::timestamp at time zone 'UTC' at time zone 'Asia/Ho_Chi_Minh')::date AS new_filter;
