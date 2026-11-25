-- SIL-1038 (K5.11) — mức làm tròn phụ phí mặc định của khung báo giá mới là
-- 'hàng chục nghìn' (ROUND của Excel, -4: 823.250 → 820.000, 825.000 →
-- 830.000), không phải 'NONE'. Chỉ đổi DEFAULT cho insert tương lai — các
-- khung đã tạo giữ nguyên mode đã lưu (không hồi tố).
ALTER TABLE "quotations" ALTER COLUMN "surcharge_rounding_mode" SET DEFAULT 'TEN_THOUSAND';
