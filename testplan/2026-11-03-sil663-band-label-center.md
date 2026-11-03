# SIL-663 (id 770) — Form tạo lô, dải band trên: nhãn lệch dưới ~6px so với ô nhập/nút chọn — căn giữa dọc (cả 2 tab)

## Problem & Root Cause

### Measured defect (staging 8ce2dda3, /shipments/new, @1366px, bounding-box tâm dọc)
- Tab Hàng FCL: nhãn 'Loại hàng' tâm y144.6 vs nút chọn Hàng FCL tâm y138.6 → nhãn thấp hơn **6px**.
- Tab Hàng lẻ: nhãn 'Loại hàng' + 'Ngày giờ đóng trả' tâm y144.6 vs ô ngày/giờ tâm y138.6 → thấp hơn **6px**.
- Nhãn cao 18px (y136–154), control cao 28–30px (y125–153): đáy gần thẳng (154≈153) → bottom-aligned.

### Root causes (bottom-align idiom, 3 rules)
1. `.csc-mode-band__row { align-items: flex-end }` — hàng band bottom-align 2 con (SIL-604 chọn flex-end cho "one baseline row").
2. `.csc-lcl-delivery { align-items: flex-end }` (desktop base; ≤640/≤768 đã là center) — nhãn 'Ngày giờ đóng trả' đáy-chồng-đáy với control.
3. `@media (min-width:1024px) .csc-mode legend { float: left; margin: 12px 10px 0 0 }` (+ bản onescreen ≥1280) — margin-top 12px đáy-align legend 18px với shell 30px (12+18=30).

## What Changed, Per File

### 1. `frontend/src/pages/clerk/ClerkShipmentCreatePage.css`
- `.csc-mode-band__row`: `align-items: flex-end` → **`center`**. Các control shell đều đúng `--uui-control-h` (SIL-616) → center giữ nguyên luật one-baseline-row của SIL-604 (độ cao bằng nhau) trong khi nhãn căn giữa.
- `.csc-lcl-delivery` base: `align-items: flex-end` → **`center`** (các band touch ≤640/≤768 đã center, giữ nguyên làm guard).
- Block ≥1024: bỏ float+margin 12px. **`display: contents`** trên legend (Chrome render mọi in-flow legend thành slot block xếp trên — `display: inline` bị ép về block, đã thử thật) → nội dung legend vào inline flow của fieldset; legend + shell căn giữa lẫn nhau bằng **`vertical-align: middle`** (midpoint trùng theo cấu trúc — cùng luật items-center của row, biểu diễn trong line box). `white-space: nowrap` trên `.csc-mode`; shell nhận `margin-left: 10px` (gap label→control, thay margin-right cũ của float).

### 2. `frontend/src/pages/clerk/ClerkShipmentCreatePage.onescreen.css`
- Block ≥1280: cùng luật như block ≥1024 của sheet gốc (bản mirror).

### 3. Pins cập nhật
- `ShipmentCreateWorkspace.sil616-617-625-band.test.tsx`: pin SIL-639 đổi flex-end→center; pin SIL-662 block ≥1024 khớp luật display:contents + vertical-align:middle mới.
- `ClerkShipmentCreatePage.styles.test.ts`: pin SIL-604 đổi flex-end→center kèm comment supersede.

## Mechanism notes (vì sao không phải margin/pixel hack)
- `top: 50%` trên legend `position: relative` **không hoạt động**: %-top của relative đặt trong containing block content-height → computes to `auto` (đã thử thật, legend đứng yên, translateY(-50%) đẩy lệch −15px). Đoạn này ghi lại để lane sau không thử lại.
- Float legend không có align-items — cơ chế căn của float chỉ là margin ⇒ thay cơ chế (display:contents + line-box center) thay vì bù số.
- A11y giữ nguyên: legend vẫn là first child của fieldset; tên group đo bằng CDP Accessibility tree trước/sau giống hệt ('Loại hàng *' semantics, dấu * aria-hidden).

## How It Is Proven (bounding-box, không nhìn bằng mắt)
- Driver: `qa/scripts/2026-11-03-sil663-driver.mjs` (PHASE=before/after, Puppeteer headless, frontend :7203/backend :3103 local).
- PHASE=before @1366: legend-vs-shell **5.5px**, dateLabel-vs-dateGroup **6.0px** (tái hiện staging), legend-vs-dateGroup 5.5px; @1024 5.5px.
- PHASE=after @1366: legend-vs-shell **−1.3px**, dateLabel-vs-dateGroup **0.0px**, legend-vs-dateGroup **−1.3px** → tất cả ≤2px. @1024 one-row + label-trái giữ nguyên (−1.3px). @390: nowrap, docOverflowX=0, groupAria 'Ngày giờ đóng trả', legendText 'Loại hàng *'.
- Ghi chú −1.3px: Range box đo ink/em của glyph (ascent>descent); inline box 18px chứa glyph căn giữa chính xác theo cấu trúc.
- Screenshots: `qa/2026-11-03_sil663_ui-{before,after}-{1366,1024,390}-{fcl,lcl}.png` · log: `qa/2026-11-03_sil663_ui-driver.log`.
- Gates: vitest scoped 4 file / 65 test pass · `tsc -p frontend/tsconfig.json --noEmit` 0 lỗi.
- uiux POLISH verdict: **Approve** (comment board SIL-663 pre-commit).
