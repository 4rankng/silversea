-- SIL-1133 (KB Ch.3 §3.2.4) — "Mô tả hàng hóa" của hàng lẻ (optional, free
-- text). Cột nullable thêm mới, không backfill: lô cũ không có mô tả là hợp
-- lệ. drizzle/meta đã hỏng từ trước; viết tay + re-run an toàn nhờ
-- IF NOT EXISTS (house convention, giống 20261126170000_sil1091).
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "cargo_description" text;
