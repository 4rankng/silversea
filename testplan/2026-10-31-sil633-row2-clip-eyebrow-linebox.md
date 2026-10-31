# SIL-633 (id 737) — regression: dòng thứ 2 thẻ lô /shipments bị cắt nửa + chồng hàng kế

- **Nguồn:** QA wave 31/10/2026 trên staging (`vantai.tingting.vip/shipments`, thẻ lô band ≤999px),
  ticket SIL-633 (board id 737, cột In Progress).
- **Triệu chứng:** dòng thứ 2 mỗi thẻ ('Chưa có nhà máy', 'Chưa phân xe'…) bị cắt nửa glyph và
  dính vào hàng/cell kế dưới; font đồng nhất 11/12px → ROW-HEIGHT CLIP. Nghi từ `5886f5c8`
  (house-scale eyebrow fact).
- **Ca kiểm thử:** mở `/shipments` filter Tháng 10/2026, băng thẻ ≤999px (390/495), quan sát
  dòng thứ 2 của mỗi cell (eyebrow fact + fact thứ 2).

## Root cause (kỹ thuật)

Cùng lớp lỗi SIL-540 (board 606, pin trong `ShipmentsTableRowHeight.test.tsx`): ink glyph
tiếng Việt ≈1.21em, nên mọi line box của cell phải ≥1.35 để còn half-leading bảo vệ glyph
trước device-pixel rounding / font fallback. `5886f5c8` đưa eyebrow fact của băng thẻ
/shipments (`ShipmentsPage.css` `.cus-inline-trigger::before`) lên 11px bold UPPERCASE
(ink cao nhất trong cell — hoa + dấu trên DƯỚI) nhưng giữ `line-height: 1.3` → box
14.3px, slack ~0.5px/side = đúng 1 device pixel DPR2 — glyph bị cạo nửa khi rendering
rounding bất lợi. Đó là dòng thứ 2 bị "CẮT NỬA".

## Hành vi mong đợi

Line box của eyebrow chứa trọn ink (token chung `--ops-table-header-line-height`, 1.35 —
cùng luật ≥1.35 mà pin SIL-540 giữ cho các dòng khác của cell). Không quay về page-owned
geometry; dùng shared token.

## Pin

`control-density.styles.test.ts` — test SIL-633 mở rộng: eyebrow `::before` phải mang
`line-height: var(--ops-table-header-line-height, 1.35)` và cấm literal `1.3`.

## Bằng chứng_drive

- TRƯỚC (staging 31/10 ~23:15, bản đã có 5886f5c8): sweep 10 bề rộng (390→1440) ×
  staging + local, detector escape/overlap: **0 ca tái hiện trực quan** — xem
  `qa/2026-10-31_sil633-regression_before-staging.log`,
  `qa/2026-10-31_sil633-regression_sweep-staging.log`,
  `testplan/assets/sil633-regression-before-staging-*.png`.
- Fix chọn hướng cấu trúc (chứa line box) theo luật SIL-540 — không đợi tái hiện môi
  trường cụ thể (owner chỉ định fix này trong brief).
