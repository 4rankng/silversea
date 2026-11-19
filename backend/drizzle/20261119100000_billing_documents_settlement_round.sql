-- Ticket 18/11 Task 2.4 (SIL-855) — [Lưu] ở bảng xem trước Xuất Debit Note
-- gắn tài liệu phát hành với đợt chốt (Lần · Tháng · Năm): lô của đợt nào,
-- kế toán chốt lần nào — truy vết được từ Debit Note trong Công nợ phải thu.
-- Nullable: các tài liệu phát hành trước luồng đợt chốt không có đợt gắn.
-- Schema-only, không backfill.
ALTER TABLE "billing_documents" ADD COLUMN "settlement_round_id" integer REFERENCES "debit_settlement_rounds"("id");
