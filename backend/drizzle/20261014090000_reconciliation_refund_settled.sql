-- Card 20261005 — ô chốt "đã hoàn ứng xong" của kế toán (luồng hoàn ứng).
-- NULL = chưa chốt; người chốt lưu kèm (FK mềm → users, không join cứng).
-- Drizzle schema đã khai báo sẵn hai cột này (backend/src/db/schema/expense-accounting.ts).
ALTER TABLE expense_reconciliations ADD COLUMN IF NOT EXISTS refund_settled_at timestamp with time zone;
ALTER TABLE expense_reconciliations ADD COLUMN IF NOT EXISTS refund_settled_by integer;
