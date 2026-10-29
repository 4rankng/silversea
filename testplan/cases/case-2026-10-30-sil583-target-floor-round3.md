# Case: SIL-583 (board id 683) — sàn 24px cho cluster QA round 3 + phát hiện engine về hit-area

- **Routes:** `/shipments-debit` @768 (admin), `/shipments-detail` (ledger, lô có
  trường thiếu), `/shipments`, `/shipments/new`, `/dispatch`, `/dispatch-detail`
  @390/768/1440
- **Roles:** admin (debit + ledger), mọi role cho sweep chung
- **Related:** round 1 (9fcbbf7c, floors 24 + pseudo touch), round 2 (e3dd3d1d,
  bare-var residuals), QA fail 29/10 comment 2846 (build c2d740c5)

## Bug (QA round 3, build c2d740c5)

Sub-24 (WCAG 2.5.8 fail, mọi pointer):
- `.shipment-debit-mergetag__trigger` "Ghép (n/2)" 66×20 ×12 @/shipments-debit 768
- `.shipment-container-ledger__missing-fields-toggle` ×7 @/shipments-detail 768,
  cao 17px: "Thiếu N thông tin ▾", "Sửa cước thu khách", "BKS Báo khách (Ảo) —
  sửa", "Sửa BKS thực"

Cụm <44: Kế toán chốt debit 227×40 · Xuất Debit Note 122–171×40 · Tải XLSX
123×40/101×32 · Nhân bản container 24×40/24×24 · Copy số tờ khai 24×24 ·
Thêm ghi chú 120×24.

## Expected behavior

- Mọi control tương tác ≥24×24 (WCAG 2.5.8 AA — mệnh đề bắt buộc của AC).
- Touch: element giữ trần 40 house law (ruling 2026-09-27 — trần chạm = 40).
- Không phát sinh overlap vùng chạm.

## Fix (round 3)

- `ShipmentDebitPage.css`: `.shipment-debit-mergetag__trigger` min-height 24
  (+inline-flex) — 66×20 → 66×24.
- `ShipmentContainersPage.css`:
  `.shipment-container-ledger__missing-fields-toggle` min-height 24
  (+inline-block) — 17px → 24px.
- Các cặp link xếp chồng vài px (Ảo/thực, tag-trên-kebab) KHÔNG được nới
  44 vì bleed sẽ chồng hit region của control kề — no-overlap thắng aim 44
  (tiền lệ copy/badge round 1); chúng giữ sàn 24 và ăn trần 40 trên touch.

## ENGINE FINDING (round 3 — quan trọng cho mệnh đề "44 mở rộng bằng pseudo")

Đo thực trên Chromium (real `page.mouse.click`, không phải elementFromPoint):
control `position:relative` với `::after` inset −3px (computed) **không**
bắt được click tại 2px ngoài border box — với pseudo trong suốt, sơn
rgba(…,0.4), thêm border, hay box-shadow, đều 0 capture; elementFromPoint
trả về row cha. ⇒ Kỹ thuật "hit-area 44 qua pseudo-element" (accessibility.md
và layer round-1/2 trong coarse band) là **no-op trên engine này**. Hit area
thật = border box của element. 44 thật chỉ đạt bằng ngrav element — xung
đột trần 40 của ruling 2026-09-27 ⇒ cần owner ruling mới nếu muốn 44 thật.
Layer pseudo cũ giữ nguyên (vô hại) nhưng KHÔNG được tính là delivery.

## Verify

- Driver: `qa/scripts/ui-tap-targets-round3-verify-20261030.mjs` — ALL PASS:
  sweep 6 mặt × {390, 768, 1440} = 0 control <24; mergetag 10× 66.4×24;
  fieldLinks 100.4×24; real click trong box 24px flip aria-expanded
  (false→true @2px-inside-top); coarse 768: fieldLinks/mergetag/btn = 40
  (trần chạm). Log: `qa/2026-10-30_sil583_ui-driver-round3.log`.
- Pins: `mobile-touch-floor.styles.test.ts` (+2 floor pins, +1 engine-finding
  pin); Gates: scoped vitest 214/214, tsc -b 0.
