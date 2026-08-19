-- Deterministic backfill for Lạch Huyện dispatch zones and fulfillment
-- classification. Idempotent: reruns are no-ops.
--
-- Forward-fix rollback (no down-migration; roll forward only):
--   UPDATE ports SET dispatch_zone = NULL
--     WHERE dispatch_zone = 'LACH_HUYEN' AND name IN (...list above);
--   UPDATE shipment_fulfillments SET dispatch_classification = NULL
--     WHERE dispatch_classification = 'LCL';
-- Never `drizzle-kit push`; corrections are new forward migrations.
--
-- Zone authority: only the four verified Lạch Huyện-area terminals. Names are
-- the stable cross-environment key (codes are auto-generated and unstable).
-- All other ports keep NULL dispatch_zone; ADMIN classifies them in the port
-- catalog UI. Never infer zone from names at request time.
UPDATE "ports"
SET "dispatch_zone" = 'LACH_HUYEN'
WHERE "dispatch_zone" IS DISTINCT FROM 'LACH_HUYEN'
  AND "name" IN (
    'Cảng Lạch Huyện (HICT)',
    'Cảng Lạch Huyện - HICT',
    'Cảng TIL - HTIT',
    'Cảng Hateco'
  );
--> statement-breakpoint
-- Classification: only provable legacy rows are classified. An LCL fulfillment
-- is deterministically 'LCL'. Every FCL row stays NULL until an operator
-- classifies it in a detailed-plan save — 'Kẹp' cannot be derived from
-- container counts, and shipment-level 'Đóng kết hợp' must not leak in.
UPDATE "shipment_fulfillments"
SET "dispatch_classification" = 'LCL'
WHERE "fulfillment_type" = 'LCL_SHIPMENT'
  AND "dispatch_classification" IS NULL;
