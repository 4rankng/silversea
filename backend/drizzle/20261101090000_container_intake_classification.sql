-- SIL-638 (id 742) TC5 (QA verdict 01/11) — CUS per-container intake
-- classification (Đơn/Kẹp/Kết hợp) becomes DURABLE container data.
--
-- Before: the quick-create schema accepted containers[].classification but
-- the persistence path dropped it — the field never reached the lot's
-- fulfillment rows, so the dispatch grid ("Phân loại", already live on the
-- FE) showed ĐƠN for every quick-created leg and the TC5 dispatch lane
-- failed end-to-end. The declaration is the CUS intake decision that the
-- fulfillment's dispatch_classification must carry (brief contract:
-- containers[].classification → fulfillment dispatch_classification;
-- omitted = SINGLE).
--
-- Nullable text (applicationEnum values SINGLE/DOUBLE/COMBINED — subset of
-- the fulfillment's dispatch classification): null = never declared, every
-- reader falls back to the legacy lot law (isCombined ? COMBINED : SINGLE).
-- Existing rows keep null, so no data is restated and re-runs are a no-op.
ALTER TABLE shipment_containers
  ADD COLUMN IF NOT EXISTS classification text;
