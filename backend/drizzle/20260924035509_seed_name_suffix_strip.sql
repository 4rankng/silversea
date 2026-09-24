-- Data-only migration (case QA-2026-09-24-01, director ruling round 2):
-- self-rigging test suites baked `<epoch-ms>-<rand>` fragments into the three
-- display-name columns the phoi-phieu board renders. Names are data: strip
-- the fragment from stored rows instead of laundering at render time.
-- Idempotent: a name already clean matches nothing on re-run. A name that is
-- ONLY an id fragment is left alone (the pattern requires a label before the
-- fragment) — stripping it would blank the row. No schema change.
UPDATE customers
   SET name = regexp_replace(name, '\s+[0-9]{13}-[A-Za-z0-9][A-Za-z0-9-]{1,23}$', '')
 WHERE name ~ '\s+[0-9]{13}-[A-Za-z0-9][A-Za-z0-9-]{1,23}$';
UPDATE routes
   SET name = regexp_replace(name, '\s+[0-9]{13}-[A-Za-z0-9][A-Za-z0-9-]{1,23}$', '')
 WHERE name ~ '\s+[0-9]{13}-[A-Za-z0-9][A-Za-z0-9-]{1,23}$';
UPDATE drivers
   SET name = regexp_replace(name, '\s+[0-9]{13}-[A-Za-z0-9][A-Za-z0-9-]{1,23}$', '')
 WHERE name ~ '\s+[0-9]{13}-[A-Za-z0-9][A-Za-z0-9-]{1,23}$';
