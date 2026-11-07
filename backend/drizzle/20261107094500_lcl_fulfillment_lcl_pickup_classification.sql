-- SIL-702 (id 822) — 'Lấy Lẻ' (LCL_PICKUP) on an LCL lot row.
--
-- The law (testplan/flows/02-dieuvan-dispatch.md §2.13, 2026-10-03, and its
-- permanent case TC-DV-DISPATCH-053): the LCL row's "Phân loại" select offers
-- the PAIR Lẻ (LCL) / Lấy Lẻ (LCL_PICKUP) and the dispatcher moves between
-- them. The select shipped that way on 2026-10-03 (c56cb4c9) — but this
-- check (added 2026-08-20, BEFORE the 'Lấy Lẻ' classification existed) still
-- pinned an LCL_SHIPMENT row to 'LCL'. Saving 'Lấy Lẻ' therefore died on the
-- constraint as a raw 23514 surfaced as HTTP 500 'Lỗi máy chủ', and the
-- workaround on 2026-10-06 (007352d6) removed the option from the select
-- instead of widening the constraint — QA then saw a select offering only 'Lẻ'
-- while its own hint still promised 'Lẻ hoặc Lấy Lẻ' (SIL-702, 06/11).
--
-- Deployment safety (drizzle-safe-migrations):
--   1. This is a pure WIDENING: every row that satisfies the old check ('LCL')
--      satisfies the new one, so no data is restated and no backfill runs.
--   2. DROP ... IF EXISTS then ADD → idempotent on re-run.
--   3. The new check is validated by the ADD itself (the table is small; the
--      whole fulfillment set is well under a second).
--   4. Order: the application write path (backend/src/services/dispatch-plan-
--      classification.ts) accepts the pair only AFTER this migration lands —
--      deploy the migration before the application, never the other way round.
-- Rollback: restore the rows first (UPDATE shipment_fulfillments SET
--   dispatch_classification = 'LCL' WHERE fulfillment_type = 'LCL_SHIPMENT'
--   AND dispatch_classification = 'LCL_PICKUP'), then
--   ALTER TABLE "shipment_fulfillments" DROP CONSTRAINT
--     "shipment_fulfillments_lcl_dispatch_classification_check";
--   ALTER TABLE "shipment_fulfillments" ADD CONSTRAINT
--     "shipment_fulfillments_lcl_dispatch_classification_check" CHECK (
--       "fulfillment_type" <> 'LCL_SHIPMENT' OR "dispatch_classification" = 'LCL');
ALTER TABLE "shipment_fulfillments" DROP CONSTRAINT IF EXISTS "shipment_fulfillments_lcl_dispatch_classification_check";
--> statement-breakpoint
ALTER TABLE "shipment_fulfillments"
  ADD CONSTRAINT "shipment_fulfillments_lcl_dispatch_classification_check"
  CHECK (
    "fulfillment_type" <> 'LCL_SHIPMENT'
    OR "dispatch_classification" IN ('LCL', 'LCL_PICKUP')
  );
