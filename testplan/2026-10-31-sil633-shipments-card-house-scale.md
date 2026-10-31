# SIL-633 (id 737) — /shipments Tổng quan lô hàng: cỡ chữ/kích thước component trên thẻ lô hàng lệch chuẩn

## Case ID
SIL-633-CARD-HOUSE-SCALE

## Bug (staging 31/10, screenshot shipments-font-size-broken.png — viewport ~495×828 CSS @2x)
Thẻ lô hàng trong danh sách /shipments (card band ≤999px + bảng ≥1000px cùng
row component) mang geometry/typography do PAGE CSS tự pin, không theo shared
control layer — khác chuẩn các fix SIL-616/SIL-624 đã chốt:

1. Nút `Chi tiết` (UUI Button size=sm, color=link-color):
   - Page pin `min-height: 34px` (block chết, bị block sau che) + `min-height:
     32px` (active) + riêng ≥1000px pin `min-height: 24px; line-height: 1.2`.
   - Page pin `font-size: var(--text-caption-size)` (11px) trong khi shared
     `compactActionText` của chính UUI sm button là 12px
     (`--text-control-compact-size`).
   - Tại ≤767px kit tự có `max-md:min-h-11` (44px touch floor, SIL-583 r2)
     nhưng page pin 32px load sau nên THẮNG cascade → nút đo 32px, vi phạm
     floor 44px đã được QA round-4 chốt ("UUI buttons must really measure
     ≥44px at 390/768").
2. Nhãn fact trên card (`::before`, vd "Khách hàng") render 11px/500
   sentence-case — trong khi shared record-table card band (một answer cho
   labelled fact) render eyebrow 11px/700 UPPERCASE letter-spacing .04em.

Giá trị fact (strong 12px / span 11px) đã đúng token ops-table — không đụng.

## Expected (house law)
- Xóa mọi page-owned height/font pin trên `.cus-dashboard-detail`; nút rides
  shared UUI sm geometry: ~28px content fine-pointer, 44px tại max-md/coarse,
  font 12px shared. Page chỉ giữ paint (color/hover/focus/nowrap).
- Card label align record-table eyebrow: 11px token, 700, uppercase,
  letter-spacing .04em.
- Pin trong `control-density.styles.test.ts`: ShipmentsPage.css không được
  owns height/typography trên `.cus-dashboard-detail`.

## Repro / verify
- Mở /shipments (local FE port riêng, CUS) tại 390 / 495 / 768 / 1440:
  đo `button.cus-dashboard-detail` computed `min-height`/`font-size`.
  - ≤767px: min-height 44px (từ kit max-md:min-h-11, KHÔNG phải page pin).
  - ≥1000px: không còn 24px pin; font-size 12px.
- Ảnh before/after: `testplan/assets/sil633-*.png`, đo đạc qua
  `qa/2026-10-31_sil633-card-scale_ui-driver.log`.

## Scope guard
CHỈ thẻ lô hàng /shipments (CusShipmentRow + ShipmentsPage.css cus-* band).
Không đụng bảng/trang khác, không đụng filter band (16px/44px là law SIL-558).
