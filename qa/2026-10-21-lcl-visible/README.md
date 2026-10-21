# qa/2026-10-21-lcl-visible — 4 card LCL form visible-by-default (verify-fail fix)

Cards: **211026130115 (LCL-02)** · **211026130215 (LCL-03)** · **211026130315 (LCL-04)** ·
**211026130415 (LCL-05)** — cùng form tạo lô `/shipments/new`. Regression case:
`testplan/2026-10-21-lcl-visible-default-4cards.md`.

## Môi trường

- LOCAL: FE Vite worktree `:7176` (port 7175 bị lane khác giữ — script nhận
  `QA_BASE`; literal trong script là 7175 theo `dev-port-contract`) → BE `:3002`
  (main checkout @ 9aab78d2, BE không đổi) → Postgres `:5441`.
- Trình duyệt: Chrome thật (puppeteer-core), 1440×900, token inject trước SPA
  navigation. Account `cus` (vai CUS) — `testplan/testaccounts.txt`.
- Driver: `testplan/qa/scripts/2026-10-21-lcl-visible-probe.mjs <before|after>`
  (desired-behavior checks — FAIL trước fix, PASS sau fix). Log:
  `before-probe.log` / `after-probe.log` trong thư mục này.

## Verdict trước/sau (form mặc định Nhập khẩu/FCL)

| # | Card | Check (trên form QA mở) | Before | After | Evidence |
|---|------|--------------------------|--------|-------|----------|
| 1 | LCL-02 211026130115 | "Thêm kho" hiện TRƯỚC khi chọn KH + dialog mở ra (title "Thêm kho lấy hàng", body 3 trường + KH picker); Xuất → "Thêm kho trả hàng" | **FAIL** (button biến mất trước khi chọn KH: `[]` — không có gì để chụp) | **PASS** | `before-probe.log` (FAIL line) / `after-04-them-kho-before-customer.png` (dialog mở với KH picker) + `after-05-them-kho-export.png` (title trả hàng) |
| 2 | LCL-03 211026130215 | Segmented control "Hàng lẻ" ở ĐẦU form (band đầu `.csc-form`); Lịch & ghi chú rụng ngay khi chọn | **FAIL** (control vùi trong "Thông tin hàng", topOffset=495px) | **PASS** (`bandIsFirstBlock:true`) | `before-01-default-form.png` (control ở giữa form) / `after-01-default-form.png` (band đầu form) + `after-02-lcl-form.png` |
| 3 | LCL-04 211026130315 | "Ngày giao hàng" MỞ SẴN ngay sau 1 click chọn Hàng lẻ — không nút "+", không reveal step, không "Ngày giao bổ sung" | trước: field nằm dưới fold sau "Thông tin hàng" + implementation cũ từng có reveal button "Thêm ngày giao hàng" | **PASS** (`field:true, visible:true, revealButtons:[]`, trong top band) | `after-02-lcl-form.png` (field cạnh segmented control) |
| 4 | LCL-05 211026130415 | placeholder `"Gợi ý quy cách (chọn hoặc gõ)"` + dropdown mở CÓ gợi ý sẵn (9 options) không cần gõ | **FAIL** (placeholder "Chọn hoặc nhập quy cách (Pallet, Roll, Carton…)") | **PASS** (placeholder đúng + bare-click list đủ Thùng gỗ…Can) | `before-03-packaging-dropdown.png` / `after-03-packaging-dropdown.png` |

After-probe: **21/21 PASS, failures=0** (`after-probe.log`). Before-probe:
3 FAIL đúng các defect (`before-probe.log`).

### Ghi chú kỹ thuật (lcl-05 click)

Dropdown suggestions mở bằng click thật khi field đã ổn định trong viewport.
Click ngay sau scroll-into-view tức thì (puppeteer auto-scroll) bị overlay
scroll-dismissal đóng lại trong ~66ms — cùng luật với MỌI picker trong app
(customer/route picker cùng hành vi), không phải defect của field. Driver
pre-scroll + settle 600ms trước click (tương tác user thật); investigation log
không giữ (throwaway).

## Gates (máy idle, cây cuối)

| Gate | Command | Kết quả | Artifact |
|------|---------|---------|----------|
| FE typecheck (tsgo) | `cd frontend && pnpm exec tsgo -b` | exit 0 | cổng `tsgo exit: 0` |
| FE typecheck (tsc) | `cd frontend && npx tsc -b` | exit 0 | — |
| Scoped vitest | `cd frontend && npx vitest run src/features/shipments/create src/pages/clerk/ClerkShipmentCreatePage.test.tsx` | **261/261** (29 files) — gồm file regression mới 4/4 | — |
| Root lint | `pnpm lint` | exit 0 | — |
| FE build | `cd frontend && pnpm build` | exit 0 (build 1m17s) | — |
| FULL FE | `cd frontend && pnpm test` | xem dưới | `2026-10-21_lcl-visible_fe-full-vitest.txt` |

FULL FE (`2026-10-21_lcl-visible_fe-full-vitest.txt`, lần cuối trên máy quiet):
**5419/5419 pass, EXIT=0** — full suite xanh toàn bộ trên cây cuối.

Các lần full-FE trước đó chạy dưới **load average 68–77** (các lane khác đang
chiếm máy — đúng class flake FB-066 đã ghi trong HANDOFF): 5417/5419 với các
fail 5s-timeout ở file NGOÀI diff (ShipmentsPage "edits schedule…",
`dialog-density-contract.styles.test.ts`, RoleWorkInbox UI43). Bằng chứng flake
thuần, không phải regression:

- `2026-10-21_lcl-visible_fe-flake-atbase.txt` — CÙNG 3 file trên cây BASE
  (git stash toàn diff): **163/163 pass trong 21.5s** khi máy quiet → không
  red-at-base theo code; chúng fail có điều kiện khi tải máy cao (cùng class
  fail xuất hiện với lẫn không có diff — bg_38 vs bg_40).
- `dialog-density-contract` pass standalone; các test fail khác nhau qua từng
  lần chạy (subset ngẫu nhiên theo tải) — dấu hiệu timeout/load, không phải
  deterministic.
- Scope của diff (create + clerk): **261/261 xanh 3 lần** (cả khi tải lẫn
  idle) — bao gồm file regression mới 4/4.

Lần full-FE trước nữa (cùng cây, chưa build dist) có thêm 4 fail đã phân loại
và đóng: 2× `numeric-identity.styles.test.ts` (contract đọc `dist/assets` —
xanh sau `pnpm build`), 1× `dev-port-contract.test.ts` (port literal 7176
trong probe — sửa về 7175 theo contract), 1× LCL-05 unit test (jsdom focus
semantics — pin bằng `.focus()` + `aria-expanded`, 4/4).

## Review

Independent code-reviewer (subagent LclVisibleReview): **APPROVE** — 4 card
IMPLEMENTED end-to-end, contracts giữ nguyên (181026200700, FB-079, factory
gate, `.csc-mode` CSS pins, 181026143000 §1a), test pin revert-proof. Nits đã
sửa: stale `openOnType` comment (ClerkShipmentCreatePage.test.tsx) + pin
"exactly ONE" delivery field. Ghi nhận thêm: `pnpm design:drift` đỏ sẵn tại
base 9aab78d2 (456 commits trôi baseline — nợ riêng, diff này đóng góp 0 vào
mọi metric).

## Phủ (Coverage) — §9

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| LCL-02 kho quick-add mở trước KH + title theo hướng | UI DRIVEN | `after-04-them-kho-before-customer.png`, `after-05-them-kho-export.png`, `after-dom-them-kho.json`, `after-probe.log` | Lưu kho mới từ dialog (submit→DB) — không chạy; vai khác ngoài CUS |
| LCL-03 segmented control đầu form + Lịch & ghi chú rụng | UI DRIVEN | `before-01-default-form.png` vs `after-01-default-form.png`, `after-02-lcl-form.png`, `after-probe.log` | Widths 390/768 (chỉ 1440); layout FCL giữ nguyên chỉ assert bằng unit |
| LCL-04 Ngày giao hàng mở sẵn, không nút "+" | UI DRIVEN | `after-02-lcl-form.png` (field trong top band), `after-probe.log` (`revealButtons:[]`) | Submit tạo lô LCL end-to-end (DB row) — không chạy trong scope UX-fix |
| LCL-05 placeholder + dropdown gợi ý sẵn | UI DRIVEN | `after-03-packaging-dropdown.png` (list đủ 9 options), `after-probe.log` | Nhập giá trị tuỳ ý ngoài gợi ý (đã pin bằng unit ClerkShipmentCreatePage) |

- Mọi claim trên: driver command + exit status trong `after-probe.log`
  (`PROBE after DONE — failures=0`), account `cus`, width 1440, catalog
  provenance: giữ nguyên house primitive `.csc-mode` segmented (pin
  `ClerkShipmentCreatePage.styles.test.ts`) + `ShipmentCreateSection` dùng lại
  — không invent layout mới, không cần catalog tham chiếu (không thêm pattern).
- DB side-effect: read-only UX verification (không có write path nào được
  exercise) — các đường lưu/không lưu nằm ngoài các claim trên.
