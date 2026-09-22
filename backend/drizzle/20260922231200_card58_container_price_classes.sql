-- Card 20260922_58 (catalog half) — four container PRICE classes split by
-- cargo weight (operator ruling 2026-09-22): exactly 20.0t is HEAVY
-- (< 20t light, >= 20t heavy); weight = booking cargo weight (cus/điều vận),
-- never gross; missing weight BLOCKS container pricing ("Thiếu trọng tải"),
-- never a default class — a wrong class misroutes the vehicle (fleet sheet:
-- light rigs cap 22t, heavy 33t). Labels are the customer sheet verbatim
-- (BÁO GIÁ MẪU 1 — LONG MINH). Weight does NOT split fuel norms (the sheet's
-- lít/chuyến is identical across each light/heavy pair: 64/64 and 70/70),
-- so fuel_consumption_norms keeps CONT20/CONT40 only; the price-selection
-- half (card _66) resolves the class via
-- shared resolveContainerPriceClass and looks up norms by base type.
-- Idempotent: ON CONFLICT (code) DO NOTHING makes re-runs a no-op. Existing
-- CONT20/CONT40 rows are untouched — current container prices compute
-- identically (card regression criterion 6). Journal + .sql land together
-- (no `when` edits).
INSERT INTO vehicle_size_classes (code, name, is_container, sort_order)
VALUES
  ('CONT20.LIGHT', 'Cont 20 - Trọng tải < 20 tấn', true, 10),
  ('CONT20.HEAVY', 'Cont 20 - Trọng tải > 20 tấn', true, 11),
  ('CONT40.LIGHT', 'Cont 40 nhẹ - Trọng tải < 20 tấn', true, 12),
  ('CONT40.HEAVY', 'Cont 40 nặng - Trọng tải > 20 tấn', true, 13)
ON CONFLICT (code) DO NOTHING;
