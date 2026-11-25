-- SIL-1029 (K4.58) — bảng giá cấu hình phải có CẢ cước thu lẫn cước trả theo
-- từng trọng tải. Bảng /config/pricing-tables trước đây chỉ có một cột giá
-- (price = cước thu khách); thêm cột cước trả nullable. Nullable: thiếu cước
-- trả là "chưa biết" (màn hình hiện —), không bao giờ tự điền 0. Schema-only,
-- không backfill — dữ liệu do người dùng nhập.
ALTER TABLE "pricing_tables" ADD COLUMN "carrier_price" numeric(15, 0);
