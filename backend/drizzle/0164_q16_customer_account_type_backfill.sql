UPDATE "users" AS "u"
SET
  "customer_account_type" = 'CORPORATE_GROUP',
  "updated_at" = now()
WHERE "u"."role"::text = 'CUSTOMER'
  AND "u"."customer_account_type" = 'SINGLE_ENTITY'
  AND (
    SELECT COUNT(DISTINCT "ucl"."customer_id")
    FROM "user_customer_links" AS "ucl"
    INNER JOIN "customers" AS "c"
      ON "c"."id" = "ucl"."customer_id"
    WHERE "ucl"."user_id" = "u"."id"
      AND "c"."deleted_at" IS NULL
  ) > 1;
