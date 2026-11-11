# SIL-796 r2 — recon provenance (staging, 2026-11-11, read-only)

Drivers: `qa/scripts/2026-11-11-sil796-price-recon*.mjs` (staging API, dungnv) — raw
outputs in `qa/2026-11-11_sil796_recon*.json`.

## Decisive staging facts

- Lô 835 (SHP-2611-00341, MSKU1234565 **40'DC**, 15.000kg): deliveryPoint "khu công
  nghiệp Vân Trung, Phường Nếnh" → **route 10 (KCN Vân Trung)** là lane đúng của lô
  (shipment.routeName "KCN VÂN TRUNG, BẮC GIANG"); routeId null trên shipment — lane
  hiệu lực do plan-read suy ra = 10.
- Engine preview (customer 1 × route 10 × CONT40 × 2026-11-07) → **4.202.500** =
  pricing_tables **id 42** (giá ký 4.100.000, eff 2026-10-02) × freight_rate_terms
  sharePct 2.5 (rateTermsId 2) — EXACT hit, không fallback. CONT20 cùng lane (id 41,
  3.900.000 × 1.025) = **3.997.500** — số QA nêu là dòng CONT20 của lane.
- **3.937.500 (kỳ vọng trả của QA) KHÔNG tồn tại trong DB**: sweep toàn bộ
  pricing_tables (9 dòng >3tr, routes 6/9/10), carrier_route_pricing (1 dòng duy
  nhất: route 9 × class 1 giá-chung 1.800.000, eff 2026-09-01), weight tiers rỗng.
- Local dev mirror xác nhận cùng luật: carrier-pricing route 9 × CONT20.LIGHT →
  1.800.000 GENERIC (`qa/2026-11-11_sil796-r2_local-smoke.log`).

## Ý nghĩa

Số 4.202.500 hộp thoại tự điền ĐÚNG theo dòng giá ký case (route 10 × CONT40) của
chính lô. Nếu bảng giấy ký 4.000.000 cho Vân Trung × CONT40 → dữ liệu bảng giá
(id 42 = 4.100.000, hoặc terms 2.5%) nhập sai/chênh — quyết định dữ liệu thuộc về
owner, không phải code. Còn lại 2 lỗi code đã sửa (xem testplan case r2):
(1) trả = 0 do seed không chạy lại khi chọn nhà xe + seed nhầm tổng cước thu;
(2) keyed-miss rơi vào giá đầu bảng (số case LOẠI KHÁC — đúng hình diện QA cảnh báo).
