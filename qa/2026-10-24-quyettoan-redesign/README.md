# QA 2026-10-24 — Chi phí - Quyết toán redesign (CUS)

Owner screenshots 23/10 ("UI UX layout shitty") + audit 5 điểm + spec final v2.
Branch `fix-quyettoan-redesign` off main `322e8ebf`.

- Driver: `qa/scripts/2026-10-24-quyettoan-redesign.mjs` (Playwright, env-only
  ports: `QA_FRONT`/`QA_API`/`QA_PHASE`/`QA_USER`). Exit 0 = all checks pass.
- BEFORE: main checkout `ffdf9d92` (main — pre-redesign; the audited defects
  are live there) FE :7175, trunk BE :3002.
- AFTER: this worktree FE :7195 → worktree BE :3003 (shared local DB :5441).
- Account: local CUS (`cus`, testplan/testaccounts.txt) — quản trị màn hình.
- Read-only run: no DB writes anywhere (dialog/merge never submitted); DB
  identity (count + max(updated_at) of the 158 rendered lots) unchanged
  before/after — logged in both driver logs.

## Results

- AFTER 27/27 PASS (`quyettoan-redesign_after_ui-driver.log`, exit 0).
- BEFORE measures the audited defects on main — the two driver FAILs there ARE
  the defect evidence (rows 127–182px vs ≤56; headers/cells misaligned):
  rows >90px 158/158, 'Chưa xác định' ×557 desktop / ×92 phone, topbar month
  chip live on the route.

## Coverage (AGENTS §9)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Audit #1 rows 127–182 → 52px, 1 baseline, money right-align + header edge | UI DRIVEN | after_desktop-top.png, metrics_after_desktop.json (rowHeights all 52, alignments ['right'], edgeDelta 0), log | 768 band; print CSS |
| Audit #1 totals sticky bottom = Σ cột | UI DRIVEN | log `tfoot receivable = Σ` (5.000.000, known=95); pinned=839 pane=840; `—` when column has 0 known cells | payable/profit have no known data in this dataset — math law asserted on receivable + unit tests cover the rest |
| Audit #2 mã lô hiện 1 lần + tên KH Title Case 1 lần/group | UI DRIVEN | after_desktop-top.png (group header), group collapse 158→83 | — |
| Audit #3 'Chưa xác định' ×557 → 0; 3 trạng thái tiền | UI DRIVEN | log (found=0 desktop + phone; 691 'Chờ số liệu' pills), screenshots | — |
| Audit #4 1 cơ chế ngày (unified picker + popover dual-month) | UI DRIVEN | after_desktop-picker-popover.png, after_desktop-picker-applied.png: URL `?from=2026-10-01&to=2026-10-31`, refetch, trigger '01/10/2026 – 31/10/2026', chip 'Xóa bộ lọc (1)'; month chip off the route (driver INFO before=true) | Tuần này/Hôm nay/Quý presets e2e (unit-covered) |
| Audit #5 Gộp hàng action bar (no emoji), arm ≥2 valid ticks | UI DRIVEN | after_desktop-merge-armed.png (armed at 47th tick — first ungrouped LCL pair), aria-disabled true→null | merge dialog submit (would mutate DB — unit tests + dialog's own suite cover) |
| Chứng từ badge + popover + copy tờ khai | UI DRIVEN | after_desktop-docs-popover.png; copy toast asserted (clipboard granted) | multi-declaration lots in popover (unit-covered) |
| Kebak ⋯ → Mở chi tiết lô → L2 workspace | UI DRIVEN | after_desktop-kebab-menu.png, after_desktop-row-expanded.png ('Cước vận tải / Số Container / Cước thu / Phí hải quan…') | L2 editing flows (unchanged surface, own suites) |
| Mobile 390 cards + totals strip + 3-state tiền | UI DRIVEN | after_mobile-final.png, after_mobile-first-card.png, metrics_after_mobile.json (totals y=302, cards=20, banned string 0) | tablet 641–1023 band |
| DB/API identity | DB/API VERIFIED | DOM receivable 5.000.000 = API Σ known = 5.000.000; DB count/latest unchanged | — |

## Spec v2 → wire mapping (no fabricated data)

| Spec item | Landed | Reason |
|---|---|---|
| 'Chi hãng tàu' / 'Chi nội địa' | ✅ `carrierCostTotal` / `opsCostTotal` (shared zod + BE additive, unit-pinned) | the payable split, live values |
| 'Tuyến POL → POD' | ⚠️ cột 'NHÀ MÁY / TUYẾN' = factoryName (+địa chỉ trong tooltip) | L1 wire không có POL/POD |
| MST/Mã KH ở group header | ❌ bỏ | không có field mã KH/MST; customerId là internal id (AGENTS §2 cấm) |
| TMS viền vàng lệch đối soát | ❌ bỏ | không có nguồn TMS |
| '(PDF)', '· N file' trong popover chứng từ | ❌ bỏ | wire chỉ có Bill + số tờ khai |
| 'Khoản mục' select | ❌ giữ 'Khóa lô' (180px) | L1 không có chiều khoản mục thật — không bịa filter |
| Mono cho mã | ⚠️ `var(--font-data)` | font-family contract cấm mono app-wide |
| 'Chờ số liệu' amber | ✅ pill color-mix(--color-warning) | không có amber token riêng |

## design:drift (ratchet vs stale baseline)

`design-drift.baseline.json` is stale (188 files vs 207) and already RED on
main — same state the dispatch lane recorded. Gate applied per house practice:
delta vs BASE BRANCH (main `ffdf9d92`, script copied to a temp tree):

| counter | main | this branch |
|---|---|---|
| hexDirect | 182 | 182 |
| hexFallback | 68 | **67** |
| radiusOffLadder | 1 | 1 |
| rawShadow | 50 | 50 |
| rawZIndex | 81 | 81 |
| untokenizedTransition | 136 | 136 |
| mediaWidthValues | 49 | 49 |

Every counter ≤ main.

## Gates (AGENTS §5)

- `pnpm lint` (root): 0 errors
- `cd backend && npx tsc --noEmit`: 0 · `cd backend && pnpm test`: all pass
- `cd frontend && npx tsc -b`: 0 · `npx tsgo -b`: 0
- `cd frontend && pnpm test`: **5550/5550** (after `make build` dist)
- `make build`: exit 0

## Independent review pass (AGENTS §2)

Code-reviewer subagent, DONE_WITH_CONCERNS → all code findings fixed in this
changeset and re-verified:

- **H1** UnifiedDateRangePicker: a from-only draft survived a preset/clear
  commit and could silently compose a wrong range (day-click → preset →
  day-click). Fixed (`commitRange` drops the draft on preset/clear commits);
  regression case added to `UnifiedDateRangePicker.test.tsx`.
- **M1** CHỨNG TỪ badge click bubbled into the row's select-alias (an
  informational click flipped a merge pick). Fixed
  (`event.stopPropagation()` on the badge); the page test now asserts
  `data-selected` stays null after opening the checklist.
- **L1** tfoot raw upward shadow kept deliberately: the spec'd affordance
  (`0 -4px 6px -1px`) has no token (all `--shadow-*` point down); repo-wide
  rawShadow stays 50 = main (drift table above), and the color rides
  color-mix on `--ink`.
- **L2** docs/design-system/02-controls-and-forms.md "Never — merged
  date-range" bullet now scope-noted to the 2026-10-23 ruling.
- Recorded decisions (no question tools in this lane — written, not asked):
  locked lots keep LIVE split columns beside their frozen `payableTotal`
  (BE comment + unit source-pin); the totals foot is the GRAND TOTAL of the
  filtered list — collapse is a view fold, never a scope change (page test
  pins `Tổng cộng (3 lô)` with a group collapsed).

Reviewer gates re-run independently: lint 0, BE tsc 0 + 338/338, FE tsc 0,
scoped FE 146/146.
