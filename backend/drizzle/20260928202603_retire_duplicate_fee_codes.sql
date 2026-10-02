-- Data-only migration (thẻ 20260928_164, case QA-2026-09-25-01):
-- migration card6 (20260921231000_card6_driver_fee_catalog) seed thêm hai mã
-- SANITATION / STORAGE_FEE cho nhóm chi phí lái xe có hóa đơn, nhưng chúng TRÙNG
-- TÊN HIỂN THỊ với hai mã chuẩn của danh mục chi hộ đã có sẵn — FEE_CLEANING
-- ("Phí vệ sinh") và FEE_WAREHOUSE ("Phí lưu kho") — nên dropdown "Loại phí" của
-- OPS hiện hai lựa chọn giống hệt nhau nhưng khác mã (case QA-2026-09-25-01 mục 3).
-- Bản purge trên staging đã tắt đúng hai mã đó bằng tay; migration này đưa mọi môi
-- trường — kể cả DB dựng mới từ migration — về cùng một trạng thái, và form chi phí
-- lái xe giờ trỏ về mã chuẩn (shared/src/constants: DRIVER_LOT_COST_EXPENSE_TYPES).
-- Không đổi schema. Idempotent: chỉ chạm row còn ACTIVE, nên row đã tắt khớp 0 dòng.
UPDATE forwarder_expense_types
   SET status = 'INACTIVE', deleted_at = now(), updated_at = now()
 WHERE code IN ('SANITATION', 'STORAGE_FEE')
   AND status = 'ACTIVE'
   AND deleted_at IS NULL;
