-- 2026-09-10 ticket 18f4a2dd chunk 7 (phê duyệt removed): close the legacy
-- rows stranded by the auto-apply conversion. Nothing is deleted; audit
-- history is preserved. USER-VETOABLE: this migration closes old money
-- requests without applying them — the alternative (retroactively approving
-- old pending money) was ruled out (PM Amendment 5).
UPDATE governance_actions
SET status = 'SUPERSEDED',
    updated_at = now()
WHERE action_kind IN (
  -- direct-money family (payments/penalties/profit)
  'PAYMENT_RECEIPT', 'PAYMENT_REFUND', 'VENDOR_PAYMENT', 'CARRIER_PAYMENT',
  'DRIVER_PAYOUT', 'COMMISSION', 'PENALTY_CREATE', 'PENALTY_CANCEL',
  'PROFIT_DISTRIBUTION',
  -- own-table quartet decision kinds
  'ADVANCE_REQUEST_APPROVAL', 'ADVANCE_REQUEST_REJECTION',
  'DEBT_OFFSET_APPROVAL', 'DEBT_OFFSET_CANCEL'
)
  AND status IN ('PENDING_CHECK', 'PENDING_APPROVAL', 'RETURNED_FOR_EVIDENCE');
--> statement-breakpoint
-- Advance settlements whose decision endpoints were removed (TC-CHUNK4-009):
-- legacy PENDING / CHECKED_BY_ACCOUNTANT rows are conservatively closed as
-- REJECTED with a stamped reason — no retroactive approval of old money.
UPDATE advance_settlements
SET status = 'REJECTED',
    note = COALESCE(note, '') || ' [2026-09-10: approval flow removed — legacy request closed, no retroactive approval]',
    updated_at = now()
WHERE status IN ('PENDING', 'CHECKED_BY_ACCOUNTANT');
