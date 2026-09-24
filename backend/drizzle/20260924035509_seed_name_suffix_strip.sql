-- Data-only migration (case QA-2026-09-24-01, director ruling round 2):
-- self-rigging test suites baked `<epoch-ms>-<rand>` fragments into the three
-- display-name columns the phoi-phieu board renders. Names are data: strip
-- the fragment from stored rows instead of laundering at render time.
-- Idempotent: a name already clean matches nothing on re-run. A name that is
-- ONLY an id fragment is left alone (the pattern requires a label before the
-- fragment) — stripping it would blank the row. No schema change.
UPDATE routes
   SET name = regexp_replace(name, '\s+[0-9]{13}-[A-Za-z0-9][A-Za-z0-9-]{1,23}$', '')
 WHERE name ~ '\s+[0-9]{13}-[A-Za-z0-9][A-Za-z0-9-]{1,23}$';
UPDATE drivers
   SET name = regexp_replace(name, '\s+[0-9]{13}-[A-Za-z0-9][A-Za-z0-9-]{1,23}$', '')
 WHERE name ~ '\s+[0-9]{13}-[A-Za-z0-9][A-Za-z0-9-]{1,23}$';
-- customers carry a partial unique index on (lower(btrim(name)), tax_code)
-- (customers_active_name_tax_code_uniq_idx), so a blind strip aborts the
-- migration wherever two rows collapse to one clean key. Strip per-row and
-- skip rows whose clean key already exists (they keep the fragment; the
-- operator-facing dupes are the accepted outcome of the ruling's
-- duplicate-collapse check, and row identity rests on Số Bill/Booking).
DO $strip$
DECLARE
  r RECORD;
  v_clean text;
BEGIN
  FOR r IN SELECT id, name, tax_code FROM customers
            WHERE name ~ '\s+[0-9]{13}-[A-Za-z0-9][A-Za-z0-9-]{1,23}$'
            FOR UPDATE LOOP
    v_clean := regexp_replace(r.name, '\s+[0-9]{13}-[A-Za-z0-9][A-Za-z0-9-]{1,23}$', '');
    IF NOT EXISTS (
      SELECT 1 FROM customers c2
       WHERE c2.id <> r.id
         AND c2.deleted_at IS NULL
         AND lower(btrim(c2.name)) = lower(btrim(v_clean))
         AND COALESCE(NULLIF(lower(btrim(c2.tax_code)), ''), '')
             = COALESCE(NULLIF(lower(btrim(r.tax_code)), ''), '')
    ) THEN
      UPDATE customers SET name = v_clean WHERE id = r.id;
    END IF;
  END LOOP;
END
$strip$;
