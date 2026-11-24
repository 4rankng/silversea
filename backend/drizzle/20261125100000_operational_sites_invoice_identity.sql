-- SIL-941 (CUS-07, §7.2.1 K7.7) — thông tin xuất hóa đơn CẤP NHÀ MÁY
-- (MST, tên xuất hóa đơn, địa chỉ xuất hóa đơn) cho hộp 'Xem chi tiết' nhà
-- máy và dữ liệu gốc /config/factories. Khác bộ hóa đơn phí nâng/hạ
-- (lift_fee_* / drop_fee_* / cleaning_*): đây là định danh hóa đơn VAT của
-- chính nhà máy. Cột nullable, không backfill — dữ liệu do người dùng nhập.
ALTER TABLE "operational_sites" ADD COLUMN "invoice_name" varchar(255);
ALTER TABLE "operational_sites" ADD COLUMN "invoice_address" text;
ALTER TABLE "operational_sites" ADD COLUMN "invoice_tax_code" varchar(40);
