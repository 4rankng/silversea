-- SIL-1037 (K5.21/K5.23) — nhập kỳ giá dầu phải ghi rõ giá 'chưa VAT' hay
-- 'đã quy đổi'. Cột nullable: các kỳ ghi trước đây chưa có cơ sở giá → màn
-- hình hiện —, không suy đoán. Giá trị: 'PRE_VAT' (giá công bố đã chưa VAT)
-- hoặc 'CONVERTED' (đã quy đổi về chưa VAT). Schema-only, không backfill.
ALTER TABLE "fuel_price_periods" ADD COLUMN "price_basis" varchar(20);
