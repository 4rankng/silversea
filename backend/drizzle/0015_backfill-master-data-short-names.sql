UPDATE "customers"
SET "short_name" = btrim("name")
WHERE "short_name" IS NULL OR btrim("short_name") = '';

UPDATE "operational_sites"
SET "short_name" = btrim("name")
WHERE "short_name" IS NULL OR btrim("short_name") = '';

UPDATE "routes"
SET "short_name" = btrim("name")
WHERE "short_name" IS NULL OR btrim("short_name") = '';
