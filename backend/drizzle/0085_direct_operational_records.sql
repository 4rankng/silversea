-- Direct operational records. Preserve every legacy row and its actual actors;
-- do not fabricate approval, receipt, payment, or ledger events.
-- Application data states are text columns (applicationEnum).
INSERT INTO audit_logs (message, entity_type, entity_id, payload)
SELECT 'Retired internal approval lifecycle; retained prior state and actors', 'ops-expense-entries', id,
       jsonb_build_object('migration', '0085_direct_operational_records', 'priorStatus', approval_status,
                          'approvedById', approved_by_id, 'approvedAt', approved_at, 'rejectionReason', rejection_reason)
FROM ops_expense_entries WHERE approval_status IN ('PENDING', 'APPROVED', 'REJECTED');
--> statement-breakpoint
UPDATE ops_expense_entries SET approval_status = CASE
  WHEN approval_status = 'REJECTED' THEN 'VOIDED'
  WHEN amount > 0 AND paid_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM shipments s WHERE s.id = ops_expense_entries.shipment_id
  ) AND EXISTS (
    SELECT 1 FROM forwarder_expense_types t WHERE t.code = ops_expense_entries.expense_type_code
  ) THEN 'RECORDED'
  ELSE 'DRAFT' END
WHERE approval_status IN ('PENDING', 'APPROVED', 'REJECTED');
--> statement-breakpoint
ALTER TABLE ops_expense_entries ALTER COLUMN approval_status SET DEFAULT 'RECORDED';
--> statement-breakpoint
INSERT INTO audit_logs (message, entity_type, entity_id, payload)
SELECT 'Retired internal approval lifecycle; pending reconciliation remains a draft', 'ops-settlements', id,
       jsonb_build_object('migration', '0085_direct_operational_records', 'priorStatus', status,
                          'approvedById', approved_by_id, 'approvedAt', approved_at, 'rejectionReason', rejection_reason)
FROM ops_settlements WHERE status IN ('PENDING', 'APPROVED', 'REJECTED');
--> statement-breakpoint
UPDATE ops_settlements SET status = CASE status WHEN 'APPROVED' THEN 'RECORDED' WHEN 'REJECTED' THEN 'VOIDED' ELSE 'DRAFT' END
WHERE status IN ('PENDING', 'APPROVED', 'REJECTED');
--> statement-breakpoint
ALTER TABLE ops_settlements ALTER COLUMN status SET DEFAULT 'RECORDED';
--> statement-breakpoint
INSERT INTO audit_logs (message, entity_type, entity_id, payload)
SELECT 'Retired internal approval lifecycle; incomplete invoice remains a draft', 'fuel-invoices', id,
       jsonb_build_object('migration', '0085_direct_operational_records', 'priorStatus', approval_status,
                          'approvedBy', approved_by, 'approvedAt', approved_at)
FROM fuel_invoices WHERE approval_status IN ('PENDING', 'APPROVED', 'REJECTED');
--> statement-breakpoint
UPDATE fuel_invoices SET approval_status = CASE approval_status WHEN 'APPROVED' THEN 'RECORDED' WHEN 'REJECTED' THEN 'VOIDED' ELSE 'DRAFT' END
WHERE approval_status IN ('PENDING', 'APPROVED', 'REJECTED');
--> statement-breakpoint
ALTER TABLE fuel_invoices ALTER COLUMN approval_status SET DEFAULT 'RECORDED';
