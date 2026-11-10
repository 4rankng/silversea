-- SIL-773 — bảng Kiểm soát lô hàng: nút 'Lưu - Phê duyệt từng dòng và ẩn'.
-- debit_hidden_at/by đánh dấu dòng kế toán đã lưu/đối soát từng dòng và ẩn
-- khỏi danh sách tác nghiệp (GET /debit-board mặc định loại ra); bật
-- includeHidden vẫn tra lại được lịch sử — dữ liệu không bị xoá.
-- Schema-only, không backfill.
ALTER TABLE "shipments" ADD COLUMN "debit_hidden_at" timestamptz;
ALTER TABLE "shipments" ADD COLUMN "debit_hidden_by" integer;
