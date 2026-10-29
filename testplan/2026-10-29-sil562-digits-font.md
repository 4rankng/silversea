# SIL-562 (id 640) — font chữ số có tnum thật: Inter Digits face

- **Case ID:** case-2026-10-29-sil562-digits-font
- **Ticket:** SIL-562 — "Add font-variant-numeric: tabular-nums to live counts and numeric/date data cells"
- **QA bounce (29/10, build 28c3a120):** khai báo `tabular-nums` computed có trên `.master-plan-grid__line`/td nhưng **không có tác dụng** — Be Vietnam Pro (bundled) không mang tnum/proportional-only, chữ số vẫn lệch cột (0=8.12, 1=4.62, 2=7.82, 8=7.6px).

## Fix

BUNDLE một **digits-only face** đứng trước Be Vietnam Pro trong mọi font stack nhà:

- `public/fonts/InterVariable-latin.woff2` — Inter variable (wght 100–900, latin subset, 48KB).
- `fonts.css`: `@font-face 'Inter Digits'` với **`unicode-range: U+0030-0039, U+002C, U+002E`** (chữ số + dấu phẩy/chấm) — prose vẫn render Be Vietnam Pro qua fallback.
- `tokens.css`: `'Inter Digits'` đứng đầu `--font-display/--font-body/--font-sans` (một lần, toàn app kế thừa).
- Mọi khai báo `tabular-nums` hiện có (Money, .num, record-table, Tabs count, operational data-table base — các shared primitives được allowlist từ trước) **sống dậy**: chữ số ăn một lưới advance duy nhất.

Không đổi: prose letterforms, size/weight nào của số, không thêm khai báo tabular-nums page-local (contract test vẫn cấm).

## Evidence (rung 3 — đo thật trong headless Chrome, driver `qa/2026-10-29_sil562-digits-font/driver-font-widths.mjs`)

Harness serve đúng `public/fonts/fonts.css` + stack nhà + khai báo `tabular-nums`, đo 10 spans (mỗi span = 1 chữ số × 10):

| Stack | widths (px/10 glyph) | spread |
|---|---|---|
| **Nhà (Inter Digits + tabular-nums)** | 10/10 = **103.75** | **0** |
| Control (BVP-only + cùng declaration — trạng thái QA đo) | 61.6 … 113.6 | **52** |

→ Cùng một khai báo: chết trên BVP, sống trên face mới. `font-widths.json` + `fontcheck-harness.html` (artifact).

## Test pin

- `styles/font-family-contract.test.ts` — case mới: face tồn tại trong fonts.css, `unicode-range U+0030-0039`, `font-weight: 100 900`, asset woff2 có mặt, 3 token nhà dẫn 'Inter Digits'.
- `styles/numeric-identity.styles.test.ts` — 6/6 trên production bundle (đã build lại).

## Not covered

- Đo reflow 2 lần refresh trên /shipments thật (cần backend + data staging) — QA kiểm chứng trên build mới: counts (220/24/156) không nhảy cột giữa 2 refresh; prose không đổi.
