-- Card 20260922_63 (operator ruling): TWO different SITC facilities —
-- Bãi SITC (Đình Vũ, Đông Hải 2, Hải An) stays zoned HAI_PHONG (untouched);
-- the SITC depot at the Lạch Huyện deep-water area (opened 07/2025 by
-- Cảng Hải Phòng + SITC Group) joins the Lạch Huyện cluster. Ports are CRUD
-- DATA: zone membership + per-port fee-config rows drive the lift fee, so
-- this ships data, never logic. Insert-missing guards keep a re-run and
-- operator edits safe.
INSERT INTO "ports" ("name", "short_name", "code", "city", "address", "dispatch_zone")
SELECT 'SITC - Lạch Huyện', 'SITC LH', 'SITCLH', 'Hải Phòng', 'Lạch Huyện, Cát Hải, Hải Phòng', 'LACH_HUYEN'
WHERE NOT EXISTS (
  SELECT 1 FROM "ports" WHERE "code" = 'SITCLH' AND "deleted_at" IS NULL
);--> statement-breakpoint
-- Fee-config rows: one per Lạch Huyện-zone port so the per-lift fee counts
-- every nâng/hạ in the cluster (customer example: Hateco lift + SITC-Lạch
-- Huyện drop = 2 × 500.000). Amount is the customer's negotiated default —
-- operator-editable data, never a code constant.
INSERT INTO "port_zone_surcharges" ("port_id", "kind_slug", "label", "amount")
SELECT p."id", 'zone_lift_drop_surcharge', 'Phí nâng/hạ Lạch Huyện', '500000'
FROM "ports" p
WHERE p."dispatch_zone" = 'LACH_HUYEN'
  AND p."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "port_zone_surcharges" z
    WHERE z."port_id" = p."id"
      AND z."kind_slug" = 'zone_lift_drop_surcharge'
      AND z."deleted_at" IS NULL
  );--> statement-breakpoint
