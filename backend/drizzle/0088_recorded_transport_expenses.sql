-- Preserve the complete old records before retiring review states. No historical
-- ledger entries, proof attachments, reviewer identities or timestamps are erased.
INSERT INTO audit_logs (entity_type, entity_id, message, payload)
SELECT 'trip-expense-status-migration', id, 'Giữ lịch sử trước chuyển chi phí sang ghi nhận trực tiếp', to_jsonb(trip_expenses)
FROM trip_expenses WHERE approval_status IN ('PENDING', 'APPROVED', 'REJECTED', 'RETURN_FOR_EVIDENCE');
--> statement-breakpoint
INSERT INTO audit_logs (entity_type, entity_id, message, payload)
SELECT 'advance-settlement-status-migration', id, 'Giữ lịch sử trước chuyển hoàn ứng sang ghi nhận trực tiếp', to_jsonb(advance_settlements)
FROM advance_settlements WHERE status IN ('PENDING', 'CHECKED_BY_ACCOUNTANT', 'APPROVED', 'REJECTED');
--> statement-breakpoint
INSERT INTO audit_logs (entity_type, entity_id, message, payload)
SELECT 'advance-request-status-migration', id, 'Giữ lịch sử trước chuyển tạm ứng sang ghi nhận trực tiếp', to_jsonb(advance_requests)
FROM advance_requests WHERE status IN ('PENDING', 'CHECKED_BY_ACCOUNTANT', 'APPROVED', 'REJECTED');
--> statement-breakpoint
-- Existing snapshots retain their original evidence. A changed source identity
-- needs reconciliation before the next financial confirmation.
UPDATE trip_financial_state SET ar_snapshot_dirty = true, ap_snapshot_dirty = true, ar_snapshot_changed_at = now(), ap_snapshot_changed_at = now(), updated_at = now()
WHERE trip_id IN (SELECT trip_id FROM trip_expenses WHERE approval_status = 'APPROVED');
--> statement-breakpoint
UPDATE trip_expenses SET approval_status = CASE
  WHEN approval_status = 'APPROVED' THEN 'RECORDED'
  WHEN approval_status = 'REJECTED' THEN 'VOIDED'
  ELSE 'DRAFT' END, version = version + 1, updated_at = now()
WHERE approval_status IN ('PENDING', 'APPROVED', 'REJECTED', 'RETURN_FOR_EVIDENCE');
--> statement-breakpoint
UPDATE advance_settlements SET status = CASE
  WHEN status = 'APPROVED' THEN 'RECORDED'
  WHEN status = 'REJECTED' THEN 'VOIDED'
  ELSE 'DRAFT' END, version = version + 1, updated_at = now()
WHERE status IN ('PENDING', 'CHECKED_BY_ACCOUNTANT', 'APPROVED', 'REJECTED');
--> statement-breakpoint
UPDATE advance_requests SET status = CASE
  WHEN status = 'APPROVED' THEN 'RECORDED'
  WHEN status = 'REJECTED' THEN 'VOIDED'
  ELSE 'DRAFT' END, version = version + 1, updated_at = now()
WHERE status IN ('PENDING', 'CHECKED_BY_ACCOUNTANT', 'APPROVED', 'REJECTED');
--> statement-breakpoint
ALTER TABLE trip_expenses ALTER COLUMN approval_status SET DEFAULT 'RECORDED';
--> statement-breakpoint
ALTER TABLE advance_settlements ALTER COLUMN status SET DEFAULT 'RECORDED';
--> statement-breakpoint
ALTER TABLE advance_requests ALTER COLUMN status SET DEFAULT 'RECORDED';
