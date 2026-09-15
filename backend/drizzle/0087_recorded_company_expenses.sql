-- Preserve historical review facts before adopting direct accounting vocabulary.
INSERT INTO audit_logs (entity_type, entity_id, message, payload)
SELECT 'expense-status-migration', id, 'Giữ trạng thái lịch sử trước chuyển ghi nhận trực tiếp',
       jsonb_build_object('approvalStatus', approval_status, 'approvedBy', approved_by, 'approvedAt', approved_at)
FROM expenses WHERE approval_status IN ('PENDING', 'CHECKED', 'APPROVED', 'REJECTED');
--> statement-breakpoint
UPDATE expenses SET approval_status = CASE
  WHEN approval_status = 'APPROVED' THEN 'RECORDED'
  WHEN approval_status = 'REJECTED' THEN 'VOIDED'
  ELSE 'DRAFT' END
WHERE approval_status IN ('PENDING', 'CHECKED', 'APPROVED', 'REJECTED');
--> statement-breakpoint
ALTER TABLE expenses ALTER COLUMN approval_status SET DEFAULT 'RECORDED';
