-- SIL-1241 — 'Moóc cho chuyến (ghi đè)': the per-trip trailer override picked
-- in the plan editor's 'Phát lệnh cho tài xế' section must survive 'Lưu thay
-- đổi'. Staged pre-issuance on the fulfillment (same law as planned_end_at);
-- issuance resolves issue-trailer ?? this column ?? tractor coupling. null =
-- ride the coupling. Additive, no backfill.
ALTER TABLE "shipment_fulfillments" ADD COLUMN IF NOT EXISTS "planned_trailer_id" integer;
