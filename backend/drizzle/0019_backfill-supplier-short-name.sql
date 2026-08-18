UPDATE "suppliers"
SET "short_name" = btrim("name")
WHERE "short_name" IS NULL OR btrim("short_name") = '';