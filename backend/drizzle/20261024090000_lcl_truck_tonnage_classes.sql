-- FB-138 (card 231026162327, QA R39) — the canonical TRUCK-TONNAGE classes of
-- the LCL "Loại xe tính cước trả ĐV" catalog.
--
-- The 7 tonnage rungs are the customer's real taxonomy (their pricing matrix
-- "BÁO GIÁ MẪU 1" rows 1.25T…15T and the fuel-norms ladder), but until now
-- they only lived in the dev/staging DEMO seeder (seed-demo-freight-pricing.ts
-- — ensure-if-missing). A prod-mirror staging DB runs MIGRATIONS only, so it
-- carried just the 4 container price classes of 20260922231200_card58 — and
-- the "Gán xe nhóm" dropdown showed 4 Cont options with no Xe tải at all,
-- making the FB-090 sourcing rule (xe tải ⇒ 100% xe ngoài) untestable
-- (exactly what QA reported).
--
-- Master-data convergence, same idempotent shape as the card58 migration:
-- ON CONFLICT (code) DO NOTHING — existing rows (dev seed, config-UI edits)
-- are never modified, re-runs are a no-op. Codes are immutable catalog keys
-- (pricing_tables.rate_key and the FB-090 sourcing rule key on them; names +
-- is_container mirror the demo seeder's CANONICAL_CLASSES byte-for-byte).
INSERT INTO vehicle_size_classes (code, name, is_container, sort_order)
VALUES
  ('1.25T', 'Xe 1.25 tấn', false, 1),
  ('2.5T', 'Xe 2.5 tấn', false, 2),
  ('3.5T', 'Xe 3.5 tấn', false, 3),
  ('5T', 'Xe 5 tấn', false, 4),
  ('8T', 'Xe 8 tấn', false, 5),
  ('10T', 'Xe 10 tấn', false, 6),
  ('15T', 'Xe 15 tấn', false, 7)
ON CONFLICT (code) DO NOTHING;
