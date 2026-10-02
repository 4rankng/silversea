-- Data-only migration (case QA-2026-09-24-01, director amendment 2026-09-24):
-- heals the strip migration's skip arm. Residual rows kept their id fragment
-- because their clean key collided with an existing (name, tax_code) pair;
-- the fragment is an id leak on a name that now renders verbatim (the
-- sanitiser stays deleted). Instead: strip the fragment, then append a
-- readable disambiguator "Base (2)", "Base (3)", ... — each attempt guarded
-- by the customers_active_name_tax_code_uniq_idx pair check; after 50
-- attempts the row is left untouched with a WARNING (skip + log).
-- Idempotent: disambiguated or stripped rows match nothing on re-run.
DO $strip2$
DECLARE
  r RECORD;
  v_clean text;
  v_suffix int;
  v_candidate text;
  v_done boolean;
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
    ELSE
      v_suffix := 2;
      v_done := false;
      LOOP
        EXIT WHEN v_suffix > 51;
        v_candidate := v_clean || ' (' || v_suffix || ')';
        IF NOT EXISTS (
          SELECT 1 FROM customers c2
           WHERE c2.id <> r.id
             AND c2.deleted_at IS NULL
             AND lower(btrim(c2.name)) = lower(btrim(v_candidate))
             AND COALESCE(NULLIF(lower(btrim(c2.tax_code)), ''), '')
                 = COALESCE(NULLIF(lower(btrim(r.tax_code)), ''), '')
        ) THEN
          UPDATE customers SET name = v_candidate WHERE id = r.id;
          v_done := true;
          EXIT;
        END IF;
        v_suffix := v_suffix + 1;
      END LOOP;
      IF NOT v_done THEN
        RAISE WARNING 'strip2: customer % keeps its fragment — 50 disambiguation attempts all collided', r.id;
      END IF;
    END IF;
  END LOOP;
END
$strip2$;
