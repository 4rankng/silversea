# DIS-08 lan 2 — container identity weight law (card 211026180428) — 2026-10-21

Controller: agent, worktree `fix-dis08-lan2` (off main `9aab78d2`), branch
`fix-dis08-lan2`. Previous HANDOFF owners (FB-066 quickadd, R29F FB-093) đều
DONE — replaced per protocol.

**Status**: DONE — root-caused, fixed, verified UI DRIVEN 15/15 (390/768/1440),
gates green, review APPROVE. Commit trên branch; push theo brief.

## Root cause (verify-first, staging read-only + local)

QA wedge 18:04 là CỘT "Tổng quan hàng hóa" trên /dispatch: cùng dòng cont
"1 x 40HC" = **400** trong cột Hàng, nhưng 600 dưới Cảng nâng/Hạ (sibling
selector page-local card B 18/10). Không có law dùng chung — mỗi surface tự pin
(master port columns / detail cell 20261005_361 / cargo cell không pin gì).
Loại trừ: CSS token undefined (var chain + `--fw-semibold:600` trên :root OK),
font mapping (SemiBold 600 face thật, widths 400/500/600/700 khác nhau).

## Fix

Shared owner `frontend/src/styles/operational-table-typography.css`:
`.ops-container-line, .ops-table .ops-container-line { font-weight:
var(--ops-table-primary-weight) }`. Compound selector là bắt buộc — selector
đơn thua `.master-plan-grid__location-value{400}` cùng specificity theo source
order (regression bị local driver bắt sống: port summaries rơi 400 round đầu).
Áp: cargo count lines (flag `identity`, placeholder "Chưa có cont" giữ thường),
port summaries (xóa sibling selector), detail serial (xóa page-local weight,
giữ size/nowrap). Port name 400 mọi chỗ. Non-goals: drawer (đã ≥600), presence
chips, XLSX export (text-only).

## Evidence

`qa/2026-10-21-dis08-lan2/` (force-tracked): staging probes (wedge + font),
local driver before(FAIL 400)/after(15/15 PASS) ×3 widths, screenshots, gates
(tsgo/tsc/lint/scoped/FULL FE/make build). Review: APPROVE (Low finding về `''`
predicate ĐÃ áp dụng + test cover). Flake note: `RoleWorkInbox` UI43 fail 1 lần
dưới full-suite load, PASS isolated 22/22 và PASS run1 — không phải regression
của lane này.

## Next

- Merge trunk + staging recut khi wave đóng (src change có runtime FE).
- Regression case: `testplan/2026-10-21-dis08-lan2-cards.md` (DIS08-L2-01..05).
