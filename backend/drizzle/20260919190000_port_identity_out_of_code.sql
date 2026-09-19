-- Port identity leaves the schema: zone membership is DATA, the default
-- zone is a CONFIG flag, and the incidental-cost kind is structural.
--
-- (1) dispatch_zones.is_default — the config flag that replaces the FE's
--     hardcoded zone-code default. Positional seed keeps behavior identical:
--     exactly the zone with MIN(sort_order) carries the flag.
ALTER TABLE "dispatch_zones" ADD COLUMN "is_default" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE "dispatch_zones" SET "is_default" = true
WHERE "sort_order" = (SELECT MIN("sort_order") FROM "dispatch_zones");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS dispatch_zones_is_default_uniq_idx
  ON "dispatch_zones" ("is_default") WHERE "is_default";
--> statement-breakpoint
-- (2) ports.is_lach_huyen: the membership semantic is dispatch_zone (data).
--     Backfill the zone code where missing, then drop the place-named column.
--     The zone code VALUE is data (ruling) — the COLUMN name was the sin.
UPDATE "ports" SET "dispatch_zone" = 'LACH_HUYEN'
WHERE "is_lach_huyen" AND "dispatch_zone" IS NULL;
--> statement-breakpoint
ALTER TABLE "ports" DROP COLUMN "is_lach_huyen";
--> statement-breakpoint
-- (3) The incidental-cost kind was text-backed (applicationEnum): the value
--     rename is a DATA remap, swept across every text column that could
--     carry the string (per information_schema enumeration).
UPDATE "driver_incidental_costs" SET "cost_type" = 'LIFT_DROP_ZONE'
WHERE "cost_type" = 'LIFT_DROP_LACH_HUYEN';
--> statement-breakpoint
UPDATE "forwarder_expense_types" SET "category" = 'LIFT_DROP_ZONE'
WHERE "category" = 'LIFT_DROP_LACH_HUYEN';
--> statement-breakpoint
UPDATE "trip_expenses" SET "expense_type" = 'LIFT_DROP_ZONE'
WHERE "expense_type" = 'LIFT_DROP_LACH_HUYEN';
--> statement-breakpoint
UPDATE "ops_expense_entries" SET "expense_type_code" = 'LIFT_DROP_ZONE'
WHERE "expense_type_code" = 'LIFT_DROP_LACH_HUYEN';
--> statement-breakpoint
UPDATE "ancillary_revenue" SET "type" = 'LIFT_DROP_ZONE'
WHERE "type" = 'LIFT_DROP_LACH_HUYEN';
--> statement-breakpoint
-- (3b) Stored debit-note templates reference template columns by id in
--      jsonb — remap the place-named column id to the structural one so
--      persisted templates keep rendering after the code-side rename.
UPDATE debit_note_templates
SET columns = (
  SELECT jsonb_agg(
    CASE WHEN elem->>'id' = 'lach_huyen'
         THEN jsonb_set(elem, '{id}', '"zone_surcharge"')
         ELSE elem END
    ORDER BY ord
  )
  FROM jsonb_array_elements(columns) WITH ORDINALITY AS t(elem, ord)
)
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements(columns) e WHERE e->>'id' = 'lach_huyen'
);
--> statement-breakpoint

-- (4) Absence pin, DATA side: the migration FAILS if any swept column still
--     carries the old place-named string anywhere. Zero rows anywhere = the
--     purge is actually complete, not just code-side.
DO $$
DECLARE leftover integer;
BEGIN
  SELECT SUM(n) INTO leftover FROM (
    SELECT count(*) AS n FROM driver_incidental_costs WHERE cost_type = 'LIFT_DROP_LACH_HUYEN'
    UNION ALL
    SELECT count(*) AS n FROM forwarder_expense_types WHERE category = 'LIFT_DROP_LACH_HUYEN'
    UNION ALL
    SELECT count(*) AS n FROM trip_expenses WHERE expense_type = 'LIFT_DROP_LACH_HUYEN'
    UNION ALL
    SELECT count(*) AS n FROM ops_expense_entries WHERE expense_type_code = 'LIFT_DROP_LACH_HUYEN'
    UNION ALL
    SELECT count(*) AS n FROM ancillary_revenue WHERE type = 'LIFT_DROP_LACH_HUYEN'
  ) s;
  IF leftover > 0 THEN
    RAISE EXCEPTION 'Purge incomplete: % rows still carry the old place-named cost kind', leftover;
  END IF;
END $$;
