-- 2026-09-10 user directive: remove all phê duyệt (approval) flows.
-- The CUS container-edit approval flow is removed: edits now save directly.
-- Any container-edit request still sitting in an active status would be
-- stranded forever (its decision endpoint no longer exists), so retire the
-- pending rows to SUPERSEDED — audit history is preserved, nothing is
-- deleted.
UPDATE governance_actions
SET status = 'SUPERSEDED',
    updated_at = now()
WHERE action_kind IN (
  'CONTAINER_EDIT_REQUEST',
  'SHIPMENT_DELETE_REQUEST',
  'SHIPMENT_REOPEN_REQUEST',
  'SALARY_PERIOD_CLOSE',
  'SALARY_PERIOD_REOPEN',
  'SALARY_PERIOD_ADJUSTMENT',
  'SALARY_CONFIRMATION',
  'SALARY_REOPEN'
)
  AND status IN ('PENDING_CHECK', 'PENDING_APPROVAL', 'RETURNED_FOR_EVIDENCE');
