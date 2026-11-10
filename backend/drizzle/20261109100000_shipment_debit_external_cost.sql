-- SIL-771 — Bảng Kiểm soát lô hàng (chốt debit): cột 'Chi phí ngoài' do kế
-- toán nhập trực tiếp trên bảng — các chi phí NGOÀI cước phải thu / phải trả
-- (kẹt, hợp và phát sinh nâng/hạ cảng). Công thức lợi nhuận khách chốt
-- 09/11/2026: Lợi nhuận = Tổng thu − Tổng trả − Chi phí ngoài.
--
-- Schema-only: null = chưa nhập (đóng góp 0 vào công thức, không phải "chưa
-- xác định"); không có backfill dữ liệu nào cần chạy. Tiền VND nguyên — cùng
-- precision/scale với cost_group_freight_manual (20261023120000).
ALTER TABLE "shipments" ADD COLUMN "debit_external_cost" numeric(15, 0);
