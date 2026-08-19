-- Merge the duplicated HICT terminal row. Two rows describe the same physical
-- terminal ("Cảng Lạch Huyện (HICT)" from the original seed vs "Cảng Lạch
-- Huyện - HICT" created by ops); both carry dispatch_zone LACH_HUYEN while
-- shipment containers reference either one depending on environment.
--
-- Canonical row = the live (not soft-deleted) row carrying the most shipment
-- container references; ties resolve to the earlier-created row. Resolved by
-- name — never by id — so this is safe across environments. Idempotent: once
-- one variant is soft-deleted, reruns find nothing to merge and no-op.
--
-- Forward-fix rollback (no down-migration; roll forward only): re-activate
-- the soft-deleted row and repoint its references back, if ever needed.
-- Never `drizzle-kit push`; corrections are new forward migrations.

-- 1. Repoint container references from every non-canonical HICT variant onto
--    the canonical row (self-referencing UPDATEs are filtered out by the
--    subquery's own winner selection).
UPDATE "shipment_containers" AS sc
SET "pickup_port_id" = canon."id"
FROM (
  SELECT p."id"
  FROM "ports" p
  WHERE p."name" IN ('Cảng Lạch Huyện (HICT)', 'Cảng Lạch Huyện - HICT')
    AND p."deleted_at" IS NULL
  ORDER BY (
    SELECT count(*) FROM "shipment_containers" sc
    WHERE sc."pickup_port_id" = p."id" OR sc."dropoff_port_id" = p."id"
  ) DESC, p."created_at" ASC
  LIMIT 1
) AS canon
WHERE sc."pickup_port_id" IN (
  SELECT "id" FROM "ports"
  WHERE "name" IN ('Cảng Lạch Huyện (HICT)', 'Cảng Lạch Huyện - HICT')
)
  AND sc."pickup_port_id" IS DISTINCT FROM canon."id";
--> statement-breakpoint
UPDATE "shipment_containers" AS sc
SET "dropoff_port_id" = canon."id"
FROM (
  SELECT p."id"
  FROM "ports" p
  WHERE p."name" IN ('Cảng Lạch Huyện (HICT)', 'Cảng Lạch Huyện - HICT')
    AND p."deleted_at" IS NULL
  ORDER BY (
    SELECT count(*) FROM "shipment_containers" sc
    WHERE sc."pickup_port_id" = p."id" OR sc."dropoff_port_id" = p."id"
  ) DESC, p."created_at" ASC
  LIMIT 1
) AS canon
WHERE sc."dropoff_port_id" IN (
  SELECT "id" FROM "ports"
  WHERE "name" IN ('Cảng Lạch Huyện (HICT)', 'Cảng Lạch Huyện - HICT')
)
  AND sc."dropoff_port_id" IS DISTINCT FROM canon."id";
--> statement-breakpoint
-- 2. Soft-delete the losing variants (conflicts on ports.code uniqueness are
--    impossible: the loser keeps its own code; codes are unique per row).
UPDATE "ports"
SET "deleted_at" = now(), "updated_at" = now()
WHERE "name" IN ('Cảng Lạch Huyện (HICT)', 'Cảng Lạch Huyện - HICT')
  AND "id" NOT IN (
    SELECT p."id"
    FROM "ports" p
    WHERE p."name" IN ('Cảng Lạch Huyện (HICT)', 'Cảng Lạch Huyện - HICT')
      AND p."deleted_at" IS NULL
    ORDER BY (
      SELECT count(*) FROM "shipment_containers" sc
      WHERE sc."pickup_port_id" = p."id" OR sc."dropoff_port_id" = p."id"
    ) DESC, p."created_at" ASC
    LIMIT 1
  );
