# SIL-641 residual report — wave 03/11 (lane fix/sil641-action-slot)

## Outcome

Residual defect của SIL-641 đã sửa và push: branch `fix/sil641-action-slot`,
commit `7cdb6aab1`, trên base `8ce2dda3` (origin/main). KHÔNG merge, KHÔNG deploy.

## Root cause (đã decode yardstick QA bằng probe, không đoán)

QA đo "ô nhập trong": native input combobox (516.5 @1307) vs trigger select
(558.5) vs native input text (556.5). Glyph SearchLg trang trí (16px) + gap +
wrapper `pl-2.5 pr-2` dành ~42px trong hàng flex combobox → Δ42/Δ40. Nút 36px
trong suốt → '+'/pencil nhìn như trôi sau viền field (QA: "lơ lửng ở gutter
x637", "pencil x1249 vs mép ô 1232" — đúng bằng slot.left = field.right + 8).

Lưu ý: reserve slot ĐÃ bằng nhau từ round 1 (cell/field/slot đo Δ0) — giả thuyết
"reserve lệch" trong brief không xảy ra ở code; residual nằm ở inner box + chip
vô hình. Cả hai đã xử lý.

## Fix

1. `uui-searchable-field.tsx`: `hideSearchIcon` → `icon={<></>}` (fragment qua
   `isValidElement` → không render node nào; `data-default-search-icon` absent
   nên container-query ≤192px của combobox.css không nhảy vào).
2. Identity section: 2 combobox (Khách hàng, Hãng tàu) opt-out glyph.
3. `ClerkShipmentCreatePage.css` scope `.csc-identity-grid`:
   `[data-combobox-value] { gap:0; padding-inline:0 }`, input
   `padding-left:10px` (padding-left CHỈ — giữ pr-8 điều kiện SIL-482, khuyến
   nghị reviewer), value span `padding-inline-start:10px`.
4. `.csc-append-button`: boundary 1px `var(--control-border)` (token
   "WCAG 1.4.11 non-text", đo 3.05:1) + `background: var(--surface)`. Hình học
   luật giữ nguyên (36×36 border-box, flex sibling, gap 8, margin-top 26,
   placeholder hidden mọi ô, không nối viền, không calc hardcode).

## Numbers (Chrome thật, account tiepvv, form /shipments/new FCL)

| Đo | Trước | Sau | AC |
|---|---|---|---|
| KH inner @1366 | 546 | 586 | — |
| XNK trigger @1366 | 588 | 588 | — |
| Bill inner @1366 | 586 | 586 | — |
| Hãng tàu inner @1366 | 546 | 586 | — |
| Δ row 1 (KH vs XNK) | **42** | **2** | ≤2 ✓ |
| Δ row 2 (Bill vs HT) | **40** | **0** | ≤2 ✓ |
| Δ cell (cột bounding-box) | 0 | 0 | ≤2 ✓ |
| gap field→slot | 8 | 8 | =8 ✓ |
| slot overrun mép ô | 0 | 0 | ≤0.5 ✓ |
| placeholder | 36 hidden mt26 | 36 hidden mt26 | ✓ |
| search glyph | 2 | 0 | ✓ |
| text start parity KH/Bill | — | Δ0 | ≤2 ✓ |
| 320px overflow | — | false, slot 36 đủ | ✓ |

Hành vi: dropdown mở/pick commit, '+' mở dialog KH, pencil mở dialog hãng tàu,
aria-label 2 nút giữ nguyên. DB read-only (671→671).

## Gates

- vitest scoped (features/shipments/create + ClerkShipmentCreatePage*): 455/455
- tsc -p frontend/tsconfig.json --noEmit: 0 lỗi
- eslint (3 file TS đổi): 0 lỗi
- uiux POLISH: Approve (finding MEDIUM 1.4.11 boundary 1.44:1 — đã fix trong
  review sang --control-border 3.05:1; verdict + đo đếm trong qa/)
- Review độc lập (code-reviewer): DONE_WITH_CONCERNS — 3 LOW non-blocking;
  đã nhận khuyến nghị padding-left. Reviewer xác nhận: consumer-safe (10 file
  dùng USearchableField không đổi), CSS layering thắng tailwind ở mọi width,
  không leak (grid chỉ chứa 2 combobox), pin mới là DOM-pin (không CSS-text).

## Board

- Verdict uiux đăng TRƯỚC commit; evidence comment đăng sau push; cột giữ
  In Progress (chờ merge + QA re-verify cùng yardstick trên).

## Evidence

`qa/2026-11-03_sil641/` (đã commit): before/after screenshots
(1440/1366/768/390/320 + 2 dialog + crops chẩn đoán), dom-metrics JSON,
driver logs GREEN failures=0, `probe/qa-yardstick-1307.json` (khớp số QA
517/559/557/517), contrast+focus log, behavior log, uiux verdict;
gate logs `qa/2026-11-03_sil641_{vitest-scoped,tsc,eslint-scoped}.log`;
drivers `qa/scripts/2026-11-03-sil641-*.mjs` (4 file, chạy được lại:
`PHASE=before|after node qa/scripts/2026-11-03-sil641-action-slot-ui-drive.mjs`).
Regression case: `testplan/2026-11-03-sil641-identity-action-slot-residual.md`.
