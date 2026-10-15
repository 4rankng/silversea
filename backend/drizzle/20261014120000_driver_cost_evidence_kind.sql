-- Card 20261005 — ô chọn chứng từ Hóa đơn / Phiếu thu cho chi phí lái xe.
--
-- `evidence_kind` phân loại chứng từ của một khoản chi lái xe: 'INVOICE' (có
-- số hoá đơn) hoặc 'RECEIPT' (phiếu thu, bắt buộc có biên lai ảnh). NULL =
-- các dòng cũ ghi trước card này — hiển thị "Chưa phân loại chứng từ", mở lại
-- lô hàng để sửa thì mới ghi được giá trị (không backfill).
ALTER TABLE "driver_incidental_costs" ADD COLUMN "evidence_kind" text;
