-- Advances & settlements moved to direct-effect saves: the approval
-- lifecycle statuses no longer exist in the enum, so any rows still
-- carrying them are migrated to the recorded state. The approving actor
-- falls back to the requester/creator — the record itself is the audit
-- evidence (migration logged in _journal.json + backup history).
UPDATE advance_requests
SET status = 'APPROVED',
    approved_by = COALESCE(approved_by, requester_id),
    approved_at = COALESCE(approved_at, NOW())
WHERE status = 'PENDING';

UPDATE advance_settlements
SET status = 'APPROVED',
    approved_by = COALESCE(approved_by, forwarder_id),
    approved_at = COALESCE(approved_at, NOW())
WHERE status IN ('PENDING', 'CHECKED_BY_ACCOUNTANT');
