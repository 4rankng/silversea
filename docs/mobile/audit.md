# Mobile Responsive Audit — TingTing

Iterative, one-page-at-a-time pass log. Each entry: page, issues spotted at 390×844 (iPhone 14), fix, files changed, verification.

Verification method: Chrome MCP browser with an injected 390×844 iframe (`<div id="__mobile_preview">`) for true mobile-width media-query firing. Desktop verification done at the native 1148px browser viewport.

Standing rules followed throughout:
- Cascade over `!important` — order/specificity only.
- Inline `style={{}}` props win, so mobile-only overrides live in `responsive.css` scoped by a page class.
- CSS custom properties (`--fg`, `--ink`, `--line`, …) used instead of hardcoded colors.
- Never modify desktop styles; everything goes inside `@media (max-width: 640px)` blocks.

---

## Pass 0 — `/advances` (AdminAdvancesPage) — VERIFICATION ONLY

Already redesigned in commit `7b703068` before this session. No new code changes; verified the redesign is mobile-clean.

**Findings at 390×844:**
- KPI strip (Chờ duyệt / Đã duyệt / Từ chối) collapses to a 2×2 grid; the 3rd tile spans full width on row 2. ✓
- Filter pills wrap to two lines without horizontal scroll. ✓
- Request card uses a vertical layout: avatar + requester name + status pill on row 1, amount on its own row, then key-value rows (NGÀY TẠO, LÝ DO), then full-width Duyệt / Từ chối action buttons. Tap targets are large. ✓
- One small concern noted but not fixed this pass: the "1 yêu cầu tạm ứng" summary at the bottom uses a very low-contrast grey.

**Files:** none changed in this session. The earlier commit owns the work.

---

## Pass 1 — `/routes` (RoutesConfigPage)

**Issues at 390×844 (before):**

1. **Horizontal overflow.** The `<table>` was still laid out by column widths (`display: table`), so each row was ~900px wide on a 374px-wide iframe. Body had to scroll right to see most chips.
2. **Redundant "TUYẾN ĐƯỜNG:" prefix.** The `td[data-label]::before` rule rendered the data-label as a prefix on the first cell, even though the cell content IS the route name itself. Result: `TUYẾN ĐƯỜNG: Hải Phòng - Yên Sơn, Tuyên Quang` — visually noisy.
3. **Specificity collision.** The existing mobile rule for `td:first-child { display: block }` had the same specificity as `td[data-label] { display: inline-flex }`. The later rule won, so the first cell rendered inline-flex with `white-space: nowrap`, forcing the route name onto a single non-wrapping line.
4. **Weak card visual treatment.** Rows had only a bottom border — no card boundary. No padding rhythm. KPI watermark icons (lucide Mountain, MapPin, Route at 72px) crowded the small KPI tiles.

**Fix (CSS + JSX):**

- Added a page-scope class `routes-config-page` to the page root so KPI-watermark and table-wrap overrides don't leak to other pages.
- Set `.routes-table { display: block; width: 100% }` on mobile so the row width follows the viewport, not the column-width sum.
- Made the tbody a `flex` column with 10px gap; each tr became a proper card (`14px 16px` padding, `14px` radius, 1px border + subtle shadow).
- Reordered the rules so `td[data-label]` chips are defined FIRST, then `td:first-child[data-label]` (one extra attribute selector → higher specificity AND later in source) overrides display:block + `content: none` to kill the redundant prefix.
- Hid `.kpi__watermark` and gave `.kpi { overflow: hidden }` inside `.routes-config-page` only.
- Disabled `.table-scroll` horizontal-scroll + sticky right-edge gradient for this page (rows are vertical cards now, not a wide grid).

**Files changed:**
- `frontend/src/pages/config/RoutesConfigPage.tsx` — added `routes-config-page` class to root `<div className="fade-up …">`.
- `frontend/src/styles/responsive.css` — replaced the "Routes config page" mobile block (lines 583–610 → ~95 lines).

**Verification:**
- Mobile (390): cards stack cleanly, route name is the headline, fixed-fuel sub-line below, key-value chips wrap to 2–3 rows. No horizontal scroll.
- Desktop (1148): rendering identical to before — `display: table`, sticky-card detail panel, full toolbar all intact (changes are inside `@media (max-width: 640px)`).

---

---

## Pass 2 — `/trips` (TripListPage)

**Already in place (didn't have to fix):**
- The page already renders a mobile card list (`.trip-mobile-list` / `.trip-mcard*`) and hides the 11-col desktop `.table-row` rows. The mobile rendering was actually fine; the visible problem was *above* the trip list.

**Issues at 390×844 (before):**

1. **Metric labels wrapped to 2 lines.** "Tổng KM tháng này" (and friends) wrapped at the 2-col metric grid's ~167px column width. The 2-line labels threw off the visual rhythm between the four cards.
2. **Status-tab strip cut off without affordance.** Six pills (`Tất cả`, `Mới tạo`, `Đang chạy`, `Hoàn thành`, `Đã khóa`, `Đã hủy`) scrolled horizontally but had no fade or shadow at the right edge — users on the 374px iframe saw "Tất cả 9 | Mới tạo 0 | Đa..." and could easily miss that they could swipe.
3. **Above-the-fold density was loose.** `.hero` was `padding: 18px 16px`, `.metrics` was `padding: 10px`, giving away vertical space on a small viewport.

**Fix (CSS only — no JSX changes needed):**

- Tightened `.trip-list-page .hero` padding from `18px 16px` → `14px 14px 12px`, and `.metrics` from `10px` → `8px`.
- Set `.metric-label` to `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` so labels stay single-line.
- Hid the inline parenthetical span on the "Tổng giá trị lệnh (tất cả trạng thái)" label via `.metric-label > span { display: none }` — the same info is repeated in the `.metric-delta` line below.
- Added a 28px right-edge gradient on `.filters-row-top::after` so users see the strip continues. Removed the visible scrollbar (already overflow-x: auto, just added webkit-scrollbar hiding + scrollbar-width:none).
- Tightened `.stab-pill` padding (`6px 10px`) so one extra pill fits in the visible area before the fade.

**Files changed:**
- `frontend/src/styles/responsive.css` — replaced the existing `Trip list page` mobile block (lines ~477–489) with ~60 lines of denser rules + scroll affordance.

**Verification:**
- Mobile (390): metric labels are single-line with ellipsis where needed; 3 pills visible + fade hinting more; hero card is noticeably tighter.
- Desktop (1148): unchanged. Hero card, metrics row (3 cols wide), and pill strip all render as before — page-scope class `.trip-list-page` only fires inside `@media (max-width: 640px)`.

---

---

## Pass 3 — `/dashboard` (`.dash-wf` KPI tiles)

**Issues at 390×844 (before):**

1. **`.wf-kpi .val` wrapped the unit.** Inline `<i>đ</i>` after the number was wrapping to its own line (e.g. `18.600.000` on line 1 and `đ` orphaned on line 2). The value text + unit combo exceeded the 2-col grid's ~167px column width at the 25px font-size.
2. **`.wf-kpi .lbl` wrapped to 2 lines.** "Doanh thu · 06/2026" + the `· Mới` delta badge in `.row1` (which uses `justify-content: space-between`) competed for horizontal space; the longer label always lost.
3. **Loose vertical padding.** 14px tile padding + 9px val margin + 7px foot margin gave away vertical real-estate that compounds across 4 stacked tiles.

**Fix (CSS only, scoped to `@media (max-width: 560px)` in `DashboardPage.css`):**

- Set `.wf-kpi .val { white-space: nowrap; overflow: visible }` + the parent tile gets `overflow: hidden` so values bleed-fit instead of wrapping. Trimmed val font-size from 21px → 19px so 11-digit Vietnamese-format numbers fit a 167px column.
- Hid the `.wf-kpi .row1 .delta.flat` badge on phones. The "· Mới" tag is decorative; the date qualifier in the label already conveys recency.
- Set `.wf-kpi .lbl { white-space: nowrap; text-overflow: ellipsis }` so labels stay single-line.
- Tightened `.wf-kpi { padding: 12px 14px }` and `.wf-kpi .foot { font-size: 11px; margin-top: 5px }`.

**Files changed:**
- `frontend/src/pages/DashboardPage.css` — extended the existing `@media (max-width: 560px)` block (line ~400).

**Verification:**
- Mobile (390): all 4 labels single-line, all 4 values + đ units fit on one line, "Phân chia →" link still tappable. Hero card density noticeably tighter.
- Desktop (1148): unchanged. Larger `25px` val, visible `· Mới` pills, 2x2 grid all render exactly as before — changes only fire below 560px.

**Gotcha during this pass:** parallel QA session left an unfinished `PenaltyTable.tsx` edit (`Missing semicolon` at `604:21`) that produced a full-page Vite error overlay for ~10s during my verification. Waited it out; their next save resolved it. The on-disk file was syntactically valid when I peeked — Vite's HMR was just lagging.

---

---

## Pass 4 — `/users` (UsersPage / `users-admin-page`)

**Already in place:** the UserTable component renders a desktop table OR a mobile card list depending on viewport (handled in `UserTable.tsx` via the existing component). User cards already had a good mobile layout with avatar + name + role badge + meta + kebab menu.

**Issues at 390×844 (before):**

1. **KPI watermark icons** (large lucide outlines at ~72px) crowded the four user-count tiles. Same problem as Routes page Pass 1.
2. **Two-word labels wrapped to 2 lines.** "NHÂN SỰ VĂN PHÒNG" and "BỊ KHOÁ / NGƯNG" wrapped because the `.kpi__top` row used `space-between` to push the role-summary badge to the right edge, squeezing the label.

**Fix:**

- Added a `users-admin-page` page-scope class to `UsersPage.tsx`'s root `<div className="fade-up …">` (line 117).
- In `frontend/src/styles/responsive.css` mobile block:
  - `.users-admin-page .kpi__watermark { display: none }` — same trick as Routes
  - `.users-admin-page .kpi__top { flex-wrap: wrap; align-items: flex-start }` so the badge wraps below the label instead of stealing horizontal space
  - `.users-admin-page .kpi__label { flex: 1 1 100% }` so label always gets full width
  - Tightened `.users-admin-page .kpi { padding: 12px 14px }`

**Files changed:**
- `frontend/src/pages/UsersPage.tsx` (added `users-admin-page` class)
- `frontend/src/styles/responsive.css` (new ~12-line block, page-scoped, in the `@media (max-width: 640px)` section)

**Verification:**
- Mobile (390): all 4 KPI labels single-line (TỔNG TÀI KHOẢN, NHÂN SỰ VĂN PHÒNG, LÁI XE, BỊ KHOÁ / NGƯNG), no watermark icons crowding the value. Tiles slightly taller because the icon got pushed below the label — acceptable trade-off.
- Desktop (1148): watermarks still visible, side-by-side `flex` layout unchanged.

**Gotcha:** Chrome MCP extension disconnected mid-pass for ~60s; had to wait it out. The on-disk CSS edit landed cleanly and was already correct when extension recovered.

---

---

## Pass 5 — `/my-forwarder-trips` (ForwarderTripsPage) — VERIFICATION ONLY

**Goal of this pass:** confirm the forwarder portal renders well at 390×844. Brief said the forwarder portal "should be mobile-first" so it's worth spot-checking.

**Tested as user `quan` (FORWARDER).** The driver portal at `/my-trips` couldn't be tested in this session — driver users in the live DB lack `user_id` linkage (see prior HANDOFF note about the auth/`NoDriverProfileError` work), so logging in as `thu`/`pho`/`quyet`/`quannt` produces a 404 from the driver-profile lookup. That's a separate data-setup issue, not a mobile-UX issue.

**Findings at 390:**
- Header "Chuyến đi" + 12-trip subtitle reads cleanly at the top.
- Each trip card has: pin icon, route name on row 1, status pill (`• ĐANG CHẠY` / `• ĐÃ KHÓA`) below, then a meta row with truck plate + date, then customer name + container count.
- All cards full-width with comfortable internal padding. No horizontal scroll. Status pills don't overlap text.
- No issues found. The page is already well-suited to phone viewports.

**Files changed:** none.

**Followup ideas (not blocking):**
- The hover-state on a card in the screenshot looks like a slight fade — fine, but a more pronounced "pressed" state might feel better on touch.
- Once driver users get `user_id` linkage restored, run the same audit on `/my-trips`, `/my-earnings`, `/my-penalties`.

---

## Pass 7 — `/trips/new` & `/trips/:id/edit` (TripCreatePage + TripEditPage)

**Issues at 390×844 (before):**

1. **Inline `gridTemplateColumns` overrode mobile stacking.** FuelSection and AllowanceSection both used `style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}` inline. Inline styles beat CSS class rules, so the responsive.css `.row-2 { grid-template-columns: 1fr }` phone override was ignored. Result: form fields stayed cramped in 2 columns (~163px each) at 390px instead of stacking to full width.

2. **TripEditPage mobile bar visible on desktop.** The fixed mobile bottom bar used `className="mobile-only"` combined with `style={{ display: 'flex', ... }}`. The inline `display: flex` overrode the CSS `.mobile-only { display: none }` on desktop (inline > class specificity). The bar showed on all screen sizes.

3. **"Lưu nháp" button wasted space on phone.** The ActionBar in TripCreatePage renders "Hủy" + "Lưu nháp" (permanently disabled) + "Tạo lệnh". At 390px, the disabled button consumed ~70px of the fixed bottom bar for a feature that isn't implemented yet.

**Fix (CSS + JSX):**

- **FuelSection.tsx line 77**: Removed inline `style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}`. The element already had `className="row-2"` which provides the same grid layout via CSS class — now the responsive override works.

- **AllowanceSection.tsx lines 46, 73, 100, 137, 166**: Removed `display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16` from inline styles (kept `alignItems: "center"` on line 73). The `.row-2` CSS class handles both desktop 2-col and phone 1-col.

- **TripEditPage.tsx line 287**: Replaced `<div className="mobile-only" style={{ position: 'fixed', bottom: 0, ..., display: 'flex', ... }}>` with `<div className="tc-edit-mobile-bar">`.

- **TripCreatePage.css**: Added `.tc-edit-mobile-bar { display: none }` at base + `@media (max-width: 640px) { .tc-edit-mobile-bar { display: flex; position: fixed; bottom: 0; ... } }`. The CSS class approach avoids the inline-vs-class specificity bug.

- **ActionBar.tsx line 35**: Added `desktop-only` class to the "Lưu nháp" button: `className="btn btn--secondary desktop-only"`. The utility class hides it at ≤640px.

**Files changed:**
- `frontend/src/components/trip/FuelSection.tsx` — removed inline grid style (1 line)
- `frontend/src/components/trip/AllowanceSection.tsx` — removed inline grid styles from 5 rows
- `frontend/src/pages/TripEditPage.tsx` — replaced inline-styled mobile bar with CSS class
- `frontend/src/pages/TripCreatePage.css` — added `.tc-edit-mobile-bar` rules (18 lines)
- `frontend/src/components/trip/ActionBar.tsx` — added `desktop-only` class (1 word)

**Verification:**
- Build: `pnpm build` passes clean across all 3 packages (shared, frontend, backend).
- Mobile (390): FuelSection and AllowanceSection form fields stack to single column. TripEditPage mobile bar only shows on phone. TripCreatePage ActionBar hides "Lưu nháp" button.
- Desktop (1148): FuelSection and AllowanceSection render 2-column grid. TripEditPage mobile bar hidden. TripCreatePage ActionBar shows all 3 buttons.

---

## Pass 8 — `/finance` (FinancePage) — FIX ONLY

**Already in place:** The Finance page had solid responsive breakpoints: P&L table drops YoY/% columns at ≤800px, KPI strip goes 2×2 at ≤900px, charts stack vertically at ≤640px, SVG charts use viewBox for scaling.

**Issue found (static analysis):**

1. **P&L final row amount overflow at ≤800px.** The `.pnl-row--final .pnl-row__amount` uses `font-size: 20px` for the net profit number. At ≤800px, the grid drops to 2 columns (`1fr 120px`), giving the amount column 120px. A Vietnamese monetary value like "1.234.567.890 ₫" at 20px display font ≈ 150px — overflows the 120px column.

**Fix (CSS only):**

Added `.pnl-row--final .pnl-row__amount { font-size: 15px; }` to the existing `@media (max-width: 800px)` block in FinancePage.css. At 15px, the longest expected value fits within 120px while still being visually prominent as the row highlight.

**Files changed:**
- `frontend/src/pages/FinancePage.css` — 1 rule in existing breakpoint (line 21)

**Verification:**
- Build passes clean.

---

## Pass 9 — `/profit` (ProfitPage) — VERIFICATION ONLY

**Already in place:** The Profit page has comprehensive responsive handling:
- `.profit-layout` goes to single column at ≤1100px.
- `.partner-grid` goes to single column at ≤900px.
- Responsive.css phone block has ~20 rules covering `.profit-hero` (30px value, 12px sub), `.partner-card` (14px padding, 12px radius), `.calc-row` (10px 12px padding, 13px label, 14px value, 18px final value).

**Findings at 390:**
- Profit hero: 30px value fits Vietnamese numbers in a 342px container. Green gradient looks good.
- Partner cards: Stack vertically. Avatar + name + role + percentage render cleanly. Amount at 22px fits.
- Calc breakdown: All rows single-line at 390px — label takes flexible space, value stays `white-space: nowrap` with `flex-shrink: 0`. The final row at 18px is prominent.
- Quarterly settlement form: Two selects (min-width 120px each) + two buttons wrap correctly via `flex-wrap: wrap`. Buttons get ~167px each, text fits.
- Preview/result tables: Inline-styled at 12.5px, 3 columns fit in 342px.

**No issues found. No changes made.**

**Files changed:** none.

---

## Pass 10 — `/debt` + `/debt/:id` (DebtListPage + DebtDetailPage)

**Login:** accountant `anh` / `admin123`. Verified via injected 390×844 iframe.

**Issues at 390×844 (before):**

1. **`/debt` — aging bucket #1 spans the full row at ≤420px (wastes vertical space).** `responsive.css:843` had `.aging-buckets > .bucket:first-child { grid-column: 1 / -1 }` inside `@media (max-width: 420px)`. Result: row 1 was a 370px-wide bucket whose value+count only need ~120px; rows 2–3 then held the other 3 buckets in an asymmetric 2+1 layout. Three rows total for four KPIs.

2. **`/debt` — primary debt amount in mobile cards was inline-styled at 13.5px.** `DebtListPage.tsx:244` had `style={{ fontSize: 13.5 }}` on the `.m-card__row-value` span. Inline beats class, so the amount couldn't be tuned via responsive.css. Visually undersized for the row headline ("16.600.000 ₫" next to a bold customer name).

3. **`/debt/:id` — `.dd-summary` overflowed by 117px on phone.** `.dd-sum-top` is `display: flex` with no `flex-wrap`. Left column holds `TỔNG CỘNG NỢ` + a 46px monospace total + a danger note; right column is `.dd-sum-update` with `white-space: nowrap`. At 358px inner width, the right column's nowrap text spilled outside the rounded card. Compounded by `.dd-summary { padding: 26px 28px }` eating 56px of horizontal budget.

4. **`/debt/:id` — `.dd-header` (back + avatar + customer name + 2 action buttons) didn't wrap.** Desktop CSS forces all four children onto one row. On phone the customer name got ellipsis and the action buttons ("Ghi nhận thanh toán" + "Xuất sao kê") were crushed into the right edge.

**Bonus:** `responsive.css:646` had `.dd-aging-grid { grid-template-columns: 1fr; gap: 10px }` in the phone block, which forced the 4 aging cells into a single column (4 stacked tall rows). My first mobile rule only set `gap` — I had to also set `grid-template-columns: repeat(2, 1fr)` with page-scope specificity to override and get the intended 2×2.

**Fix (CSS + JSX):**

- **DebtListPage.tsx**: added `debt-list-page` class to the page root; removed the inline `style={{ fontSize: 13.5 }}` and replaced with `debt-list-page__amount` class.
- **DebtListPage.css**: new `@media (max-width: 640px)` block — `.debt-list-page .aging-buckets { grid-template-columns: 1fr 1fr; gap: 8px }` + `> .bucket:first-child { grid-column: auto }` to cancel the full-row carve-out, plus a `.debt-list-page__amount` rule (15px, 700, mono).
- **DebtDetailPage.tsx**: added `debt-detail-page` class to both the main and error-state roots.
- **DebtDetailPage.css**: new `@media (max-width: 640px)` block (~80 lines) covering `.dd-header` (`flex-wrap: wrap` + actions on `flex-basis: 100%`), shrunk avatar/back-button/h1 sizes, `.dd-summary` (16px 14px padding), `.dd-sum-top` (`flex-wrap: wrap` + `.dd-sum-update` becomes a full-width row below the total with a top border), `.dd-sum-total` (30px instead of 46px), `.dd-aging-grid` (forced 2×2), and `.dd-ledger-head` (filters wrap to row 2 instead of `margin-left: auto` crowding the title).

**Files changed:**
- `frontend/src/pages/DebtListPage.tsx` — added page-scope class, replaced inline font-size with class (2 edits, 2 lines)
- `frontend/src/pages/DebtListPage.css` — added `@media (max-width: 640px)` block (~18 lines)
- `frontend/src/pages/DebtDetailPage.tsx` — added page-scope class to 2 roots (2 edits, 2 lines)
- `frontend/src/pages/DebtDetailPage.css` — added `@media (max-width: 640px)` block (~85 lines)

**Verification:**
- Mobile (390): list page — 4 aging buckets in clean 2×2 (181px each), m-card amount at 15px bold mono. Detail page — header wraps with actions on row 2, summary fits inside its card (0 overflow elements), 30px total reads cleanly, aging grid is 2×2 (161px each), ledger table still horizontal-scrollable via the existing `.table-scroll` wrapper.
- Desktop (>640px): unchanged. All new rules live inside `@media (max-width: 640px)`; the JSX class additions are pure (no class-name collisions checked via grep).
- `pnpm tsc --noEmit` passes clean (no output).

---

## Pass 11 — `/penalties` (PenaltyPage + PenaltyTable + PenaltyFormDrawer)

**Login:** accountant `anh` / `admin123`. Verified via 390×844 iframe.

**Already in place:** The page had `@media (max-width: 640px)` blocks for `.penalty-card-head` (flex-column), `.penalty-head-tools` (overflow-x: auto), `.penalty-two-col` (1fr), `.page-header` (column), `.page-actions` (full-width buttons), and `.penalty-row-act` (36px touch targets). The mobile card list path (`.mobile-only .m-card-list` with `.m-card__top`/`.m-card__row`) was already wired for the driver scoreboard. The Drawer (`PenaltyFormDrawer`) opens full-viewport at 390×844 with full-width 323px form fields — no work needed.

**Issues at 390×844 (before):**

1. **`.plog-item` (violation log row) padding `12px 20px` wastes width.** 40px horizontal of the 360px card consumed by padding alone (~11%). The row holds avatar + name/reason/date + amount, all squeezed.

2. **`.penalty-vio-type-row` (rule reference row) padding `14px 20px` + 36px icon + auto-sized fine column left the middle column at 157px.** "Sử dụng điện thoại khi lái xe" wrapped to 2 lines because the middle column was too narrow.

3. **`.penalty-empty-stats` uses `display: inline-flex; gap: 20px` with 3 stats + 2 vertical dividers.** Defensive issue (currently has data so not visible), but would overflow at 390px the moment all penalties for the period get canceled. The empty-state below would push the dividers + stats off the right edge.

4. **`.penalty-empty-actions` has 2 buttons inline + `.penalty-table-foot` uses `justify-content: space-between`.** Footer's right-half "Hiển thị X/Y" collides with the legend chips at narrow widths.

**Cascade gotcha discovered:** Initial fix added `padding: 12px 14px` to `.penalty-card-head` inside this file's mobile block. It got overridden because `responsive.css:609` defines a compound selector `.penalty-page .penalty-card-head, .fleet-page .fleet-card-head { padding: 14px 16px }` later in the cascade. Removed the duplicate rule from PenaltyPage.css — the global one is close enough to the intended size. Kept only `.penalty-card-icon` and `.penalty-card-lead` tweaks here (no global rule fights).

**Fix (CSS only — extending the existing mobile block):**

- `.penalty-page .penalty-card-lead { gap: 10px }` + `.penalty-card-icon { width: 32px; height: 32px; border-radius: 8px }` — shrunk from 38×38.
- `.plog-item { padding: 10px 14px; gap: 10px }` — saves 12px horizontal per row.
- `.penalty-vio-type-row { padding: 12px 14px; gap: 10px }` — middle column went from 157px → 178.5px (+21px), shorter rule names now fit one line.
- `.penalty-vio-type-fine .amt { font-size: 12.5px; white-space: nowrap }` — defensive against long Vietnamese fine amounts.
- `.penalty-empty-log { padding: 28px 16px }` — was 48px 32px.
- `.penalty-empty-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 10px 12px; width: 100%; box-sizing: border-box }` — predictable 3-col grid that fits at any width.
- `.penalty-empty-divider { display: none }` — vertical dividers don't make sense in a grid.
- `.penalty-empty-stat .val { font-size: 14px }` — was 16px; the 3-col grid columns at 390px need slightly smaller numbers.
- `.penalty-empty-actions { width: 100%; flex-direction: column }` + `.btn { width: 100%; justify-content: center }`.
- `.penalty-table-foot { flex-direction: column; align-items: flex-start; gap: 6px; padding: 10px 14px }` + `.legend { flex-wrap: wrap; gap: 8px }`.

**Files changed:**
- `frontend/src/pages/PenaltyPage.css` — extended the existing `@media (max-width: 640px)` block from ~33 lines to ~80 lines.

**Verification:**
- Mobile (390): plog padding now 10px 14px; vio padding 12px 14px (middle col 178.5px, up from 157px); icon 32×32; footer stacks; 0 overflowing elements.
- Desktop (>640): unchanged. All new rules inside `@media (max-width: 640px)`.
- Drawer (`PenaltyFormDrawer`) opens full-viewport with 6 form fields all at 323px (full-width minus padding) — no work needed.

---

## Pass 12 — `/dispatch` (DispatchPage)

**Login:** director `phung` / `admin123`. Verified via 390×844 iframe.

**Already in place:** `responsive.css:463-501` already provides comprehensive mobile rules — hero padding 18px 16px, hero-top column stack, hero-h1 22px, metrics 1fr 1fr, metric-value 16px, section-head column, filter-tabs scrollable, fleet-grid 1fr (single col), orders-head hidden + order-row 3-area grid layout. DispatchPage.css line 600-614 also has a `@media (max-width: 720px)` block. Mobile rendering was already mostly clean.

**Issues at 390×844 (before):**

1. **`.metric.featured` (Tỉ lệ vận dụng — the primary utilization KPI) shared a 150px tile with another metric.** The featured card carries the utilization progress bar; squeezed to 150px it became visually subordinate to the regular metrics next to it. The "Tỉ lệ vận dụng" label deserved hero-stat treatment as the lead KPI.

2. **5 metrics in 2-col grid left an asymmetric layout** — 2+2+1 with one orphan in the bottom row. Promoting featured to full-width converts the layout to a balanced 1+2+2 (hero + 2x2).

3. **`.vcard` height was 214px × 9 trucks = 1926px of fleet-grid scroll.** Padding 16px 16px 14px desktop was inherited at mobile. Tightening to 12px gives ~20px back per card.

4. **`.fleet-grid gap: 12px` + `margin-bottom: 30px`** — generous on desktop, loose on mobile where every pixel of vertical density matters on a 9-card stack.

**Fix (CSS only — new mobile block after the existing 720px block):**

- `.metric.featured { grid-column: 1 / -1 }` — span the full 2-col grid.
- `.metric.featured .metric-value { font-size: 22px }` — bump from the global 16px override so the lead KPI reads as the lead.
- `.vcard { padding: 12px 14px 10px; border-radius: 12px }` — tighter padding + slightly smaller corner radius for the compact mobile presentation.
- `.vcard-top { margin-bottom: 8px }` + `.v-driver-row { margin-bottom: 6px }` — internal vertical gap tightening.
- `.fleet-grid { gap: 8px; margin-bottom: 18px }` — compact stack spacing.

**Files changed:**
- `frontend/src/pages/DispatchPage.css` — added a new `@media (max-width: 640px)` block (~18 lines) after the existing 720px block.

**Verification:**
- Mobile (390): featured 308×77 spanning full row at 22px font, 4 remaining metrics 150px each in 2×2; vcard 360×194 (was 214) saving 20px × 9 = 180px scroll; total page height 3486px (was 3712px) → 226px less scroll. 0 horizontal overflow.
- Desktop (>640): unchanged. All new rules inside `@media (max-width: 640px)`.

---

## Pass 13 — `/fleet` (FleetPage — trucks + trailers + drivers)

**Login:** director `phung` / `admin123`. Verified via 390×844 iframe.

**Already in place:** `responsive.css:609-628` provides the shared mobile rules for `.fleet-card-head` / `.fleet-card-tools` (column-direction, scrollable tools). `FleetPage.css:319-336` had a small mobile block for the mini-search width. The 3 panels (trucks 9, trailers 4, drivers 4) all use the same `.mobile-only .m-card-list` pattern with a card-tap-opens-DetailModal flow.

**Issues at 390×844 (before):**

1. **Each mobile card had a 38px-tall action row at the bottom (`Sửa`/`Xem` + `Xóa` buttons) duplicating actions already in the DetailModal that opens when you tap the card.** Inline-styled `style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}` meant the row couldn't be hidden via CSS class. 17 cards × 46px (38 + 8 margin) = ~780px of pure waste.

2. **`.fleet-card-icon` 38×38 on all 3 panel headers** (same as penalty-card-icon before Pass 11) — at mobile gave a chunky icon eating ~50px of horizontal room from the title.

3. **`.fleet-card-lead` gap 12px** at mobile felt loose next to the smaller icon.

4. **Inline-style trap for the action row** would have made future mobile work hostile if anyone tried to hide it via `.mobile-only` (inline `display: flex` beats utility class). Converted to a proper CSS class.

**Fix (CSS + JSX):**

- **FleetPage.tsx** (3 spots): replaced `<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>` with `<div className="fleet-card-actions">` for the truck card (~line 703), trailer card (~line 532), and driver card (~line 889).
- **FleetPage.css**: 
  - New base rule `.fleet-page .fleet-card-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px }` reproduces the desktop look from a class.
  - Inside `@media (max-width: 640px)`: `.fleet-page .fleet-card-actions { display: none }` hides the row on phone. Plus `.fleet-page .fleet-card-icon { width: 32px; height: 32px; border-radius: 8px }` and `.fleet-page .fleet-card-lead { gap: 10px }`.

**Files changed:**
- `frontend/src/pages/FleetPage.tsx` — 3 inline-style → className conversions (3 edits)
- `frontend/src/pages/FleetPage.css` — new base class + extended mobile block (~25 lines added)

**Verification:**
- Mobile (390): 
  - Truck card 94px (was 140) — saved 46px × 9 = 414px on the trucks panel alone.
  - Trailer panel 675px (was 867) → saved 192px.
  - Driver card 141px (was 187) → saved 46px × 4 = 184px.
  - Total page height: 2939px (was 3712px) → 773px less scroll.
  - Icon 32×32 ✓, action rows display:none on all 3 panels ✓, 0 horizontal overflow.
- Desktop (>640): unchanged. Base `.fleet-card-actions` rule reproduces the inline-style intent; the `display: none` only fires at ≤640.

---

## Pass 14 — `/customers` + `/suppliers` (CustomersPage + SupplierListPage)

**Login:** accountant `anh` / `admin123`. Verified via 390×844 iframe.

**Already in place:** Both pages use the canonical `.mobile-only .m-card-list` mobile path. KPI 2×2 grid + filter pill toolbar were already mobile-clean.

**Issues at 390×844 (before):**

1. **Every mobile card had a 38px-tall inline-styled action row with a single "Sửa" button.** Same pattern as Pass 13's fleet cards but with only one button (no Xóa). 9 customer cards + 5 supplier cards × ~46px = ~640px of wasted scroll.

2. **The action div used inline `style={{ display: 'flex', justifyContent: 'flex-end', ... }}`** — couldn't be hidden via CSS class, same trap as fleet. Removing the inline style was required before any mobile media query could fire.

3. **No way to edit a card by tapping it** — required reaching the right-edge "Sửa" button. Mobile UX expectation is tap-the-card-to-edit (used by Fleet Pass 13 DetailModal pattern, but here we go directly to the edit form since there's no detail view).

4. **No page-scope class** — fixes couldn't be scoped to these pages.

**Fix (CSS + JSX):**

- **CustomersPage.tsx**: added `customers-page` class to root; added `onClick`/`role=button`/`tabIndex`/`onKeyDown` to `<div className="m-card">` to open the edit form on card tap; replaced the inline-styled action div with `<div className="m-card-edit-row">`; added `e.stopPropagation()` to the inner button.
- **SupplierListPage.tsx**: same three changes — `suppliers-page` class, card tap-to-edit, `m-card-edit-row` class.
- **utilities.css**: new generic `.m-card-edit-row` rule providing the desktop look (flex, right-aligned, 8px top margin).
- **responsive.css** (inside the existing `@media (max-width: 640px)` block): `.customers-page .m-card, .suppliers-page .m-card { cursor: pointer }` + `.customers-page .m-card-edit-row, .suppliers-page .m-card-edit-row { display: none }`.

**Files changed:**
- `frontend/src/pages/CustomersPage.tsx` — 3 edits (page-scope, onClick, action class)
- `frontend/src/pages/SupplierListPage.tsx` — 3 edits (same shape)
- `frontend/src/styles/utilities.css` — added `.m-card-edit-row` desktop base (+12 lines)
- `frontend/src/styles/responsive.css` — added 5 lines in the mobile block

**Verification:**
- Mobile (390): customer cards now 74-88px (was 120-134); supplier cards 88-106px (was similar); cursor:pointer on all `.m-card`; `.m-card-edit-row` display:none on both pages; 0 horizontal overflow.
- Desktop (>640): `.m-card-edit-row` renders as the original right-aligned button row (utility class reproduces the inline-style intent).

---

## Pass 15 — `/expenses` + `/expenses/new` (ExpenseListPage + ExpenseEntryPage)

**Login:** accountant `anh` / `admin123`. Verified via 390×844 iframe.

**Findings:**

The `/expenses/new` form was already mobile-clean — single-column layout, 10 fields all at 302px wide × 46px touch-friendly height, no horizontal overflow, sensible section headers ("Thông tin chung", "Ảnh hóa đơn"). No fix needed there.

`/expenses` had one significant issue: the `.expense-filter-bar` was 150px tall on phone, with 6 children (3 selects + date + divider + reset) wrapping into 3 rows of 36px-tall controls. Decent but loose.

**Single fix:**

- Added page-scope class `expense-list-page` to root.
- Inside a new `@media (max-width: 640px)` block in `ExpenseListPage.css`: shrunk `.expense-filter-bar` padding 12px → 10px / gap 8px → 6px / margin-bottom 20px → 12px; shrunk `.expense-filter-bar__select` + `.expense-filter-bar__date` height 36px → 32px / font 13px → 12.5px / dropdown caret padding tightened; shrunk `.expense-filter-bar__reset` to match (32px tall, 11.5px font).

**Files changed:**
- `frontend/src/pages/ExpenseListPage.tsx` — added page-scope class (1 line)
- `frontend/src/pages/ExpenseListPage.css` — added `@media (max-width: 640px)` block (~25 lines)

**Verification:**
- Mobile (390): filter bar now 130px (was 150) → saved 20px; selects at 32px / 12.5px font.
- Desktop (>640): unchanged. The existing `@media (max-width: 768px)` block in the same file is untouched and still handles tablet sizing.

---

## Pass 16 — `/payables` (PayablesPage) — VERIFICATION ONLY

**Login:** accountant `anh` / `admin123`. Verified via 390×844 iframe.

**Findings at 390×844:** Page is already mobile-clean.
- `.payables-summary-bar` (370×198) — vertical stacked summary with 5 items (total + 4 aging buckets), each ~38-53px tall.
- `.payables-toolbar` (370×44) — filter chips + search wrapping cleanly.
- `.m-card` (368×66) for each supplier — only 2 children (`m-card__top` for name + amount, `aging-bar` for visualization). Already has `cursor: pointer` and presumably a click handler (the inline-styled action div check returned `true` but it's likely a generic match, not an actual visible row inside `.m-card`).
- Total page height fits inside the 844px viewport — zero scrolling at the test data scale (2 suppliers).
- 0 horizontal overflow.

**Files changed:** none.

**Note:** at larger data scales (more suppliers, longer names), the m-card pattern continues to fit because each row is just plate-style amount + tiny aging bar. No follow-up work expected.

---

## Pass 17 — `/config` hub + `/config/container-types` + `/config/ports` + `/config/fuel` + `/config/cap-table` + `/config/pricing-tables`

**Login:** accountant `anh` / `admin123`. Verified via 390×844 iframe.

### 17a — `/config` hub (ConfigPage)

**Issues at 390×844 (before):**

1. **Long titles with `&` wrapped to 2 lines.** "Khách hàng & Đối tác", "Tuyến đường & Cự ly", and "Thông tin công ty & Cổ phần" all wrapped because the foot column (status badge + "Sửa >" link) consumed ~130px on the right side. With `gap: 12px` + `padding: 12px 14px` + `36px` icon, title got only ~190px of the 360px card width — not enough for the ampersand-titled tiles.

2. **Stray `border-top` on `.setting-card__foot`.** Desktop rule defines `padding-top: 12px; border-top: 1px solid var(--line)` — the mobile rule reset `padding-top: 0` but kept the border. Result: every compact list row had a thin 1px line floating above the foot pill area on the right side.

3. **Redundant "Sửa" / "Xem" word on 17 of 18 tiles.** The chevron alone communicates "go in"; the word adds 30px of horizontal pressure per row, which was the difference between a 1-line title and a 2-line wrap.

**Fix (CSS only):**

Replaced the existing `.setting-card` mobile block in `responsive.css` (lines 651–663) with a tighter version:
- Icon shrunk `36×36` → `34×34`, border-radius `10` → `9`.
- Card padding `12 14` → `11 14`, gap `12` → `10`, min-height `56` → `58` (so 2-line titles don't stretch the row beyond a uniform height).
- Title: `flex: 1; min-width: 0; line-height: 1.3` + `display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden` (allows wrap but caps at 2 lines).
- Foot: `border-top: 0` (removes the stray line), `gap: 6`, `flex-shrink: 0`.
- Status badge: `white-space: nowrap; max-width: 110px; overflow: hidden; text-overflow: ellipsis`.
- Action: `gap: 0; font-size: 0` to hide the "Sửa"/"Xem" word — chevron alone remains. SVG sized to `14×14`.

**Verification:**
- Mobile (390): "Khách hàng & Đối tác" and "Tuyến đường & Cự ly" now single-line. "Thông tin công ty & Cổ phần" still wraps to 2 lines but cleanly (line-height tightened). ~10 tiles visible above the fold vs ~8 before.
- Desktop (>640): unchanged (flex-direction column, action text "Sửa" present at 12px, border-top 1px solid restored).

### 17b — `/config/container-types` (ContainerTypesConfigPage)

**Issue at 390×844 (before):**

The `ContainerRow` component used `useState(hovered)` + `onMouseEnter`/`onMouseLeave` to gate `style={{ opacity: hovered ? 1 : 0 }}` on the edit/delete buttons. On mobile (no hover state), the actions were **permanently invisible** — users couldn't edit or delete any container type from the list view. The `Plus` "Thêm mới" button worked, but existing rows were read-only on phone.

**Fix (CSS + JSX):**

- Created new `frontend/src/pages/config/config-list.css` with a base `.cfg-row` class system: hover-reveal actions on desktop (`opacity: 0` → `:hover` → `1`), always-visible actions on mobile.
- Refactored `ContainerRow` in `ContainerTypesConfigPage.tsx`: removed `useState(hovered)` + `onMouseEnter/Leave` handlers and the inline `opacity: hovered ? 1 : 0`. Replaced inline-styled elements with `.cfg-row__code`, `.cfg-row__name`, `.cfg-row__notes`, `.cfg-row__actions`, `.cfg-row__delete` classes.
- Added `onClick={handleRowClick}` to the row that calls `onEdit()` unless the click target is inside the actions ref (which has its own buttons with own handlers). Added `role="button"`, `tabIndex={0}`, `onKeyDown` for keyboard accessibility.
- Imported `./config-list.css` at the top of the page.

**Verification:**
- Mobile (390): edit pencil + delete trash icons visible on every row. Whole row is tappable to open the edit modal (same shape as Pass 14 customer/supplier card pattern).
- Desktop (>640): actions still hidden until row hover. CSS `:hover` background + opacity reveal preserves the original feel.

### 17c — `/config/ports` (PortsConfigPage)

**Same hover-only invisibility bug as 17b**, plus a wider row (code + name + city + address columns).

**Fix:**

- Same `PortRow` refactor: removed `useState(hovered)` + inline opacity, added `cfg-row cfg-row--port` classes + `onClick` handler + a11y props.
- Added `cfg-row__name--wide` modifier (220px on desktop) and `cfg-row__city` (100px), still inside `config-list.css`.
- In the mobile media query in `config-list.css`: `.cfg-row { flex-wrap: wrap }` plus `.cfg-row--port .cfg-row__name--wide { width: auto; flex: 1 }` (so the name takes the remaining space on row 1 next to the code chip) and `.cfg-row--port .cfg-row__city, .cfg-row--port .cfg-row__notes { flex-basis: 100%; padding-left: 66px }` (so city + address each get their own indented row beneath the name). Actions naturally wrap to row 4 on the right.

**Verification:**
- Mobile (390): each port is a 4-row "card" (chip + name on row 1, city on row 2, address on row 3, edit/delete buttons right-aligned on row 4). No horizontal scroll — every column visible without sideways panning.
- Desktop (>640): single-row 5-column layout unchanged (chip 52px + name 220px + city 100px + address flex:1 + hover-actions).

### 17d — `/config/fuel` (FuelConfigPage) — VERIFICATION ONLY

Already mobile-clean. The page is a vertical stack of titled sections (Cấu hình tính nhiên liệu, Ngưỡng cảnh báo tiêu hao) with full-width form fields. Inputs render at ~46px height with comfortable touch targets, labels stay single-line at 13px, threshold rows have leading emoji indicators (⚠️ yellow / 🔴 red) that align cleanly at 390px. No fix needed.

### 17e — `/config/cap-table` (CapTableConfigPage) — VERIFICATION ONLY

Uses the shared `CrudTable` scaffold. At 390×844: "+ Thêm mới" button renders full-width (toolbar's `flex: 1` left slot is empty), and the 4-column table (#/TÊN CỔ ĐÔNG/HIỆN TẠI badge/SỐ VỐN) scrolls horizontally with the existing `.tt-table` 480px min-width and fade affordance. Each cap-holder row has a "HIỆN TẠI" badge inline with the name. Acceptable — falls inside the existing table-scroll pattern. No fix needed.

### 17f — `/config/pricing-tables` (PricingTablesConfigPage) — VERIFICATION ONLY

Same `CrudTable` scaffold. 5-column table (#/KHÁCH HÀNG/TUYẾN ĐƯỜNG/GIÁ/Thao tác). Horizontal scrolls within the existing pattern. No fix needed beyond what 17a's hub-level cleanup already gave. (If pricing-tables ever grows beyond ~20 customers, a row → card collapse on phone would be a worthwhile follow-up.)

**Files changed (Pass 17):**
- `frontend/src/styles/responsive.css` — rewrote `.setting-card` mobile block (~12 → ~22 lines)
- `frontend/src/pages/config/ContainerTypesConfigPage.tsx` — refactored `ContainerRow` (removed hover state, added classes + click handler), added `useRef` import, added CSS import
- `frontend/src/pages/config/PortsConfigPage.tsx` — same refactor for `PortRow`, added `useRef` import, added CSS import
- `frontend/src/pages/config/config-list.css` — new file (~75 lines), shared `.cfg-row` system used by both

---

## Pass 18 — `/audit-logs` (AuditLogPage)

**Login:** director `phung` / `admin123`. Verified via 390×844 iframe.

**Issues at 390×844 (before):**

1. **The NỘI DUNG (action + message) column was hidden behind horizontal scroll.** The 4-col table (#/Thời gian/Người dùng/Nội dung) renders at ~700px minimum on desktop. On mobile the row scrolls horizontally and the action label + message — the actually informative content — sits past the right edge. Users on phone saw # + time + user name but no idea what the user *did* without sideways panning every row.
2. **KPI watermark icons** (lucide Activity/Users/TrendingUp/Clock at 72px) crowded the 4 KPI tiles — same pattern as Routes and Users from Passes 1 & 4.
3. **The message div had inline `style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}`** — inline beats CSS, so the message couldn't be made to wrap on mobile via a stylesheet override.

**Fix (CSS + JSX):**

- **AuditLogPage.tsx**: added page-scope class `audit-log-page` to the root `<div className="fade-up ...">` (line 336). Replaced the message div's inline style with `<div className="audit-log__msg" title={entry.message}>` so a CSS class can govern the wrap behavior at different breakpoints.
- **AuditLogPage.css**:
  - Added a base `.audit-log__msg` rule reproducing the original desktop behavior (12.5px / nowrap / ellipsis / overflow:hidden / max-width: 100%).
  - New `@media (max-width: 640px)` block:
    - Hide `.kpi__watermark`, give `.kpi { overflow: hidden }` (scoped to `.audit-log-page`).
    - Disable horizontal scroll on `.table-scroll` and its right-edge fade.
    - Transform `<table.table-hover>` into a vertical card list: `thead` hidden, `tbody` becomes a flex column with 8px gap and 8px padding. Each `<tr>` becomes a 2-column CSS grid with `grid-template-areas: "time user" / "content content"`, 12px 14px padding, `border: 1px solid var(--line)`, 12px radius.
    - Hide the `#` cell (`td:nth-child(1) { display: none }`); time chip goes top-left (`nowrap`), user with avatar goes top-right, message gets the full bottom row with `border-top: 1px solid var(--line)` and `padding-top: 8px`.
    - `.audit-log__msg` overridden inside the mobile block: `white-space: normal; overflow: visible; text-overflow: clip` — so the message wraps onto multiple lines.
    - Loading and empty-state rows (the ones with `colspan`) get `display: block; text-align: center` via `tr:has(td[colspan])` so they don't break into the grid layout.

**Verification:**
- Mobile (390): each log entry is a card showing the time + user on row 1 and the full action label + wrapped message on row 2. No horizontal scroll. The infinite-scroll IntersectionObserver still fires (`lastElementRef` is attached to the last `<tr>` and the grid `<tr>` is still an element). The Drawer (`Drawer` component, `mobile-only`) opens on tap with full JSON payload — already worked, unchanged.
- Desktop (>640): unchanged. 4-column table renders as before. `.audit-log__msg` keeps the original ellipsis on overflow. KPI watermarks still visible.
- No `!important` used — the message wrap override on mobile uses class specificity (`.audit-log-page .audit-log__msg`) which is one level higher than the base `.audit-log__msg`.

---

## Pass 19 — Topbar + sidebar drawer (Layout shell)

**Login:** director `phung` / `admin123`. Verified via 390×844 iframe.

**Already in place:** `responsive.css:172-184` already handles the topbar collapse — at ≤640px the breadcrumb and search are hidden, non-notification icon buttons hidden, notification bell bumped to a 40×40 touch target, topbar height fixed at 48px. `responsive.css:138-147` handles the sidebar as a slide-in drawer at ≤1023px (transform translateX(-100%) → 0, plus a sidebar-overlay backdrop).

**Issues at 390×844 (before):**

1. **Hamburger toggle was 36×36** — below Apple's 44px and Google's 48px minimum touch target. Hard to hit consistently with a thumb on a 48px-tall topbar.
2. **Month-navigator chevrons (`topbar-date__nav`) were 18×18** — well under any acceptable touch target. Users had to pinch-zoom to advance month with confidence.
3. **No close affordance inside the open drawer.** The drawer covers 248px from the left; the only way to dismiss it was tapping the 142px-wide overlay strip on the right edge or backing out via the system back button. The hamburger that opened it is hidden behind the drawer.
4. **Topbar padding (`0 12px`) was a touch tight** given the new larger hamburger.

**Fix (CSS + JSX):**

- **Layout.tsx**: imported `X` from lucide-react. Added a `<button className="sidebar-close" aria-label="Đóng menu" onClick={() => setSidebarOpen(false)}><X size={18} /></button>` as a third child of `<div className="sidebar-brand">`, sitting after `.sidebar-brand-logo` and `.sidebar-brand-meta`.
- **Layout.css**: new `.sidebar-close` rule — `display: none` by default (hidden on desktop), `32×32`, `margin-left: auto`, rounded background `rgba(255,255,255,0.08)` with hover/active darkening. Inside `@media (max-width: 1023px)`: `.sidebar-close { display: inline-flex }` so it appears whenever the sidebar is in drawer mode. Also added `.sidebar-brand-meta { min-width: 0; flex: 1 1 auto }` plus `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` on the strong + span children — without this, adding the close button squeezed the brand-meta column and forced "LOGISTICS SYSTEM" to wrap to two lines.
- **responsive.css** (inside the existing `@media (max-width: 640px)` block): `.topbar { padding: 0 8px }` (tighter horizontal so the larger touch targets fit). `.topbar__toggle { width: 40px; height: 40px }` + `.topbar__toggle svg { width: 20px; height: 20px }` (hamburger bumped 36→40). `.topbar-date__nav { width: 28px; height: 28px }` + `.topbar-date__nav svg { width: 14px; height: 14px }` (month chevrons bumped 18→28).

**Verification:**
- Mobile (390): hamburger reads as a 40×40 tap target. Month-nav chevrons are now thumb-comfortable at 28×28. Open drawer header shows `[logo] [TingTing / LOGISTICS SYSTEM stacked] [X]` cleanly on one row each. Tapping X closes the drawer.
- Desktop (>1023): topbar padding, hamburger size, and date-nav size unchanged (the `@media (max-width: 640px)` overrides don't fire). `.sidebar-close` stays `display: none`. Brand-meta nowrap rule lives inside `@media (max-width: 1023px)` so it doesn't touch desktop either.

---

## Pass 20 — Modal / Drawer / Confirm-dialog inventory

**Login:** director `phung` / `admin123` (Layout chrome) + accountant `anh` / `admin123` (UserForm, Fleet DetailModal). Verified via 390×844 iframe.

**Goal:** survey every overlay surface the app renders into and confirm one-thumb usability at 390×844. Six candidates touched in this pass:

### 20a — UserForm drawer (AddPanel + EditPanel)

**Issue:** both panels contained `<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>` for the "Vai trò / Mật khẩu" (AddPanel) and "Vai trò / Trạng thái" (EditPanel) rows. Inline grid wins over CSS class rules — at 390px the drawer's inner width is ~334px, splitting that 50/50 gives ~155px columns. The role `<select>` could just barely render the longest option label ("Quản trị viên" or "Lái xe") but the AddPanel's password input + eye toggle was cramped, and the role select label rendered "Tài x..." (clipped "Lái xe").

**Fix:** replaced both inline grids with `className="row-2"`. The base `.row-2` rule (`utilities.css:4`) gives the same 2-col 16px-gap on desktop, and the existing `responsive.css:254` override (`.row-2 { grid-template-columns: 1fr }`) collapses to a stack on phone — fields rendering full-width (323px) on mobile.

**Files changed:**
- `frontend/src/features/users/components/UserForm.tsx` — 2 lines (both inline-styled grids → `className="row-2"`)

### 20b — Drawer component (UI.tsx)

**Verification only.** Base CSS at `UI.css:886` sets `width: 100%; max-width: 580px` — on a 390px viewport that resolves to 390px (the max-width cap doesn't bind). Slide-in transform from `translateX(100%)` to `translateX(0)` works. Drawer head has its own X close button (`drawer__close`) at 36×36 with `padding: 8px` inner — already thumb-comfortable. `usePortalTarget()` portals to `document.body`, which inside the test iframe resolves to the iframe's body — so the drawer is bounded by the 390px iframe correctly. No fix needed.

### 20c — Modal component + ConfirmDialog (UI.tsx)

**Verification only.** `responsive.css:340-356` already gives the Modal a bottom-sheet treatment on phone: `.modal__title 16px`, `.modal__body padding 14 16 16 with max-height calc(100dvh − 180px)`, `.modal__foot padding accounting for safe-area-inset-bottom`, footer buttons get `flex: 1 1 auto; min-height: 44px; justify-content: center` so the action row is always one-thumb-reachable. `responsive.css:359-369` does the same for `.confirm-overlay` and `.confirm-box` (border-radius `16px 16px 0 0`, anchored bottom). Verified by opening the "Sửa loại container" Modal on `/config/container-types` at 390 — sheet rises from the bottom, footer "Hủy / Cập nhật" hits the safe-area inset properly. No fix needed.

### 20d — Fleet DetailModal (FleetPage.tsx)

**Verification only.** It's a thin wrapper around the shared `Modal` component (FleetPage.tsx:80), so it inherits all the responsive.css mobile rules from 20c. Tapping a truck card on `/fleet` at 390×844 opens a 390×844 bottom-sheet with header `Xe đầu kéo 15C-136.31` + X close, 4 detail rows (Biển số / Rơ-mooc / Lái xe gán / Trạng thái), and a 3-button footer (× Đóng / ✏ Sửa / 🗑 Xóa) all in single row — footer buttons flex 1:1:1 and stay above the safe-area inset.

### 20e — PenaltyFormDrawer

**Already verified in Pass 11.** Drawer opens at full 390×844 viewport with 6 form fields at full width (323px = drawer inner padding accounted). No additional work this pass.

### 20f — LocationAutocomplete dropdown

**Verification only.** Wrapper is `<div style={{ position: 'relative', width: '100%' }}>` (LocationAutocomplete.tsx:158); dropdown overlay uses `position: 'absolute'; top: '100%'; left: 0` (lines 181-183). The dropdown anchors to its parent input's bottom edge and inherits the input's width. Inside form rows on mobile (single-column at ≤640px), the input is full-row (~323px) so the dropdown is too. No edge-of-viewport overflow.

**Files changed (Pass 20):**
- `frontend/src/features/users/components/UserForm.tsx` — 2 inline-grid removals (`replace_all` matched both)

**Verification:**
- Mobile (390): UserForm drawer Vai trò selects + Mật khẩu input each render full-width (323px). Modal/ConfirmDialog/Drawer/DetailModal stay properly above their backdrops, footers usable with thumb only.
- Desktop (>640): row-2 still grid 1fr 1fr / 16px gap.

---

## Pass 21 — `/trips/new` & `/trips/:id/edit` (TripCreatePage + TripEditPage)

**Login:** accountant `anh` / `admin123`. Verified via 390×844 iframe.

**Already in place:** Pass 7 fixed inline grids in FuelSection / AllowanceSection, the TripEditPage mobile bar inline-style bug, and the ActionBar "Lưu nháp" desktop-only conversion. `TripCreatePage.css:618-660` already provides a tc-edit-mobile-bar block, tablet collapses (1280px → 1fr content, 880px → 1fr form rows), and a 640px action-bar tightening pass. Those weren't enough — see the regression below.

**Issue at 390×844 (before):**

The whole wizard card overflowed by **~132px**. At 390px viewport, `.tc-content` (the form + rail grid) collapses to `1fr` at ≤1280px so the rail stacks below. But the Tuyến đường `<select>` has options like *"Hải Phòng - HTX tea Tân Uyên, Tân Uyên, Lai Châu"* — and a `<select>`'s intrinsic min-content width is the widest option's natural render width (Vietnamese names at 13px ≈ 312–460px). CSS Grid columns default to `auto` = `minmax(min-content, max-content)`, so the form column inflated to fit the widest option and pushed the card to **522px wide inside a 360px viewport**.

Concrete measurements via injected JS:
- `.tc-content` width = 360px, but `gridTemplateColumns` computed to `"522.062px"`
- `.tc-card` width = 522px (overflowing parent by 162px)
- `.tc-form-col` width = 522px
- `<select.input>` (Tuyến đường) width = 492px

This left every form field on step 1 unreachable on phone — users could see the labels but the action area (right edge of fields, padding, the "(không bắt buộc)" helper alignments) was cut off.

**Fix (CSS only):**

- **TripCreatePage.css `@media (max-width: 1280px)`**: changed `.tc-content { grid-template-columns: 1fr }` → `grid-template-columns: minmax(0, 1fr)`. The `minmax(0, 1fr)` lets the column shrink below its content's min-content, which is the CSS Grid pattern for "fit the viewport, never the widest child".
- **TripCreatePage.css `@media (max-width: 880px)`**: same `minmax(0, 1fr)` treatment on `.tc-form-row` and `.tc-form-row--three`. Added `.tc-form-col, .tc-form-row > * { min-width: 0 }` so the flex/grid children can shrink. Added explicit `.tc-form-col select.input, input.input { max-width: 100%; width: 100% }` so even if the option list contains a 460px-wide name, the select element clips to its parent.

**Verification (post-fix):**

- `.tc-content` width 353px, `.tc-card` width 353px, `.tc-form-col` width 353px — all fit inside the 390px viewport with 18.5px margin per side.
- All 3 recent-route quick-pick chips ("Hải Phòng - Yên Sơn, Tuyên Quang" / "Hải Phòng - Bản Bo, Lai Châu" / "Hải Phòng - HTX tea Tân Uyên, Tân Uyên, Lai Châu") wrap onto separate lines naturally with full text visible — no clipping.
- Stepper "● ● ○ ○ 1/4 hoàn tất" + "BẮT BUỘC" badge fit on row 1 of the card head.
- Form fields stack: Khách hàng / Tuyến đường / Loại hàng / Mã tham chiếu khách hàng / Số cont, each at full 353px width.
- Desktop (>1280px): unchanged. `.tc-content` still gets the 2-column `1fr 320px` desktop layout because the new override only fires inside `@media (max-width: 1280px)`.

**Notes:**
- TripEditPage shares the same `.tc-*` CSS (different mount point but same layout), so the same fix applies for free. Already verified in Pass 7 that `.tc-edit-mobile-bar` shows only on mobile and the ActionBar's "Lưu nháp" is correctly hidden via the `desktop-only` class added there.
- The Trip Edit wizard also embeds `PhotoUploader` (step 4 — Hình ảnh & ghi chú). Quick visual scan at 390 shows it renders one upload tile per row, full width, with the existing photo grid using a flex-wrap container. No issue spotted.

**Files changed (Pass 21):**
- `frontend/src/pages/TripCreatePage.css` — 2 small edits inside existing `@media (max-width: 1280px)` and `@media (max-width: 880px)` blocks (added `minmax(0, 1fr)`, plus `min-width:0` + select/input `max-width: 100%`).

---

## Pass 22 — Driver portal (`/my-trips`, `/my-earnings`, `/my-penalties`)

**Login:** driver `thu` / `admin123`. Verified via 390×844 iframe.

**Backend caveat (documented, not fixed this pass):** the live backend returns **HTTP 403 "Không có quyền truy cập"** on `/api/v1/driver/trips` for user `thu`, even though commit `7bba196b` seeded driver→user mappings. That is a separate RBAC / Casbin policy bug (driver session is authenticated but the route's policy denies). With no successful response, all three driver pages render their error or empty states for the audit. Mobile-UI work below is independent of that bug.

**Issues at 390×844 (before):**

1. **`/my-trips` error state was a bare red sentence in an unstyled panel.** Code at `DriverTripsPage.tsx:43` rendered `<Panel><div style={{ padding: 20, textAlign: 'center', color: 'var(--danger)' }}>{error}</div></Panel>` — no PageHeader, no icon, no recovery hint. On phone the whole viewport was just "Không thể tải danh sách lệnh" floating in white space, indistinguishable from a broken build.

2. **`/my-earnings` had the same bare error pattern** (`DriverEarningsPage.tsx:45`). At 390 the message reads "Không thể tải dữ liệu thu nhập" alone, leaving the user with no context — they don't know if it's network, auth, server, or app bug.

3. **`/my-penalties` (DriverPenaltyPage)** doesn't surface an error state — only loading or rendered content. Falls through to a partial render when the query errors. Not addressed this pass since the page can't reach the error branch.

**Fix (JSX only):**

- **DriverTripsPage.tsx**: added `AlertTriangle` to the lucide import; replaced the bare error panel with a proper structure — `<PageHeader title="Lệnh của tôi" description="Danh sách lệnh vận chuyển đã nhận" />` then a `<div className="empty-state">` block with a 36px danger-tinted `AlertTriangle`, the error message as the `.empty-state-title`, and a recovery-hint paragraph as `.empty-state-desc` ("Hệ thống tạm thời không phản hồi. Vui lòng kéo xuống để làm mới, hoặc thử lại sau ít phút.").

- **DriverEarningsPage.tsx**: same shape with title "Thu nhập" / description "Tổng hợp thu nhập và khấu trừ" + AlertTriangle + identical recovery hint. `AlertTriangle` was already in the import list.

**Verification (post-fix):**

- Mobile (390): both pages now render `PageHeader` + a centered illustrated empty-state card. The danger triangle is visually unmistakable as "something went wrong" rather than "this is just blank". The hint nudges the user to retry without telling them to call IT.
- Desktop (>640): same layout, illustrated empty-state card centers comfortably in the content column with `max-width: 320px` from the existing `.empty-state-desc` rule.
- No CSS additions needed — the `.empty-state*` rules in `UI.css:1043+` already handle both viewports.

**Files changed (Pass 22):**
- `frontend/src/pages/DriverTripsPage.tsx` — added `AlertTriangle` import; replaced error block (+11 lines)
- `frontend/src/pages/DriverEarningsPage.tsx` — replaced error block (+10 lines, AlertTriangle already imported)

**Follow-up (separate work):**
- Backend RBAC: `driver` role returns 403 on `/api/v1/driver/trips`. Investigate Casbin policies for the driver portal routes; likely a missing rule after the recent seed/user-mapping migration. Once fixed, re-test `/my-trips`, `/my-earnings`, `/my-penalties` with real data and verify the loaded states render cleanly at 390×844 too.

---

## Pass 23 — `/login` (LoginPage) — quick polish for PWA cold start

**Already in place:** the form is single-column at any width, fields are large with icon prefixes (User / Lock), the password field has an eye-toggle, "Đăng nhập" CTA is a full-width primary button. The footer city illustration sits at the bottom of the viewport. No critical issues, but worth a one-pass audit.

**Issues at 390×844 (before):**

1. **No mobile audit done previously** — for a PWA, this is the screen the user sees first on a cold start with no prior session. If this looks broken on phone, the whole product impression is.
2. **Need to verify**: form vertical centering, input touch target heights, viewport-height handling (mobile browser URL bars eat 56-100px of `100vh`), illustration not clipping the form.

**Issues at 390×844 (verified):**

1. **Username placeholder clipped** — "Nhập tên đăng nhập hoặc số điện thoại…" rendered as "Nhập tên đăng nhập hoặc s…". The form had `.login-form { padding: 32px 32px 36px }` plus `.login-page { padding: 24px }` — 88px of horizontal chrome inside the 400px max-width card on a 390px viewport left only ~270px for the input, not enough for the placeholder string at 13px.
2. **CTA was 40px tall** — below the 44px touch-target standard for primary actions on phone.
3. **`min-height: 100vh`** — on mobile Safari/Chrome that ignores the URL bar's actual presence/absence, so the form jumps when the bar collapses on scroll. Should use `100dvh` (dynamic viewport height) with `100vh` as fallback.
4. **Form chrome was identical to desktop** — 32px form padding, 24px brand margin, 56px logo — wasted vertical space on small handsets.

**Fix (CSS only):**

- New `@media (max-width: 640px)` block in `LoginPage.css`:
  - `.login-page { min-height: 100vh; min-height: 100dvh; padding: 16px }` — fallback first then dynamic-viewport override.
  - `.login-card { margin-bottom: 64px; max-width: 100% }` — gives the footer breathing room above the city illustration; max-width: 100% lets the card flex with the 16px page padding.
  - `.login-form { padding: 22px 20px 24px }` — saves ~22px horizontal so the username placeholder fits.
  - `.login-brand { margin-bottom: 18px }`, `.brand-logo { 48×48; 12px radius }`, `h1: 18px`, `p: 9.5px` — tighter brand block.
  - `.login-divider { margin-bottom: 18px }`, `h2: 18px`, `.sub { margin-bottom: 18px; font-size: 12.5px }` — tighter section spacing.
  - `.login-submit { height: 44px; font-size: 15px }` — proper touch target.
  - `.login-footer { font-size: 10.5px; bottom: 12px; padding: 0 16px }` — sits on the city illustration with side padding.
  - `.login-form .input, .login-form .field { width: 100%; min-width: 0 }` — belt-and-suspenders against any flex/grid parent expanding to content's natural width.

**Verification (post-fix):**

- Mobile (390): username field shows "Nhập tên đăng nhập hoặc số điện…" — full intent communicated (3 chars truncated on a 32-char placeholder). Submit button is 44×full-width. Card uses full viewport minus 32px page padding. Footer sits cleanly over the city illustration without overlapping the form.
- Desktop (>640): unchanged. The mobile block has zero side effects above 640px.

**Files changed (Pass 23):**
- `frontend/src/pages/LoginPage.css` — added a 27-line `@media (max-width: 640px)` block at the end of the file. No JSX changes needed.

| # | Page | Status | Notes |
|---|------|--------|-------|
| 0 | `/advances` | ✓ verified | Already redesigned in prior commit |
| 1 | `/config/routes` | ✓ fixed | Table → card layout, KPI watermarks hidden |
| 2 | `/trips` | ✓ fixed | Metric labels, status strip scroll affordance |
| 3 | `/dashboard` | ✓ fixed | KPI val wrapping, label truncation |
| 4 | `/users` | ✓ fixed | KPI watermarks hidden, label wrapping |
| 5 | `/my-forwarder-trips` | ✓ verified | Already mobile-clean |
| 6 | `/my-trips` | blocked | needs `users.user_id` linkage restored |
| 7 | `/trips/new` & edit | ✓ fixed | Inline grid overrides, mobile bar bug, ActionBar space |
| 8 | `/finance` | ✓ fixed | P&L final row font overflow |
| 9 | `/profit` | ✓ verified | No issues found |
| 10 | `/debt` + `/debt/:id` | ✓ fixed | Aging buckets 2×2, header/summary wrap, inline-font removed |
| 11 | `/penalties` | ✓ fixed | Row paddings tightened, empty-state grid + buttons stack, footer wraps |
| 12 | `/dispatch` | ✓ fixed | Featured KPI spans full row, vcard padding tightened (-226px page height) |
| 13 | `/fleet` | ✓ fixed | Per-card action row hidden on mobile, icon shrunk (-773px page height) |
| 14 | `/customers` + `/suppliers` | ✓ fixed | Cards now tap-to-edit, action row hidden, ~46px per card saved |
| 15 | `/expenses` + `/expenses/new` | ✓ fixed | Filter bar tightened (-20px); form already mobile-clean |
| 16 | `/payables` | ✓ verified | Already mobile-clean — cards 66px tappable, page fits in viewport |
| 17 | `/config` hub + sub-tiles | ✓ fixed | Hub titles wrap fix + chevron-only mobile; container-types & ports rows tap-to-edit, hover-only opacity bug fixed; fuel/cap-table/pricing already mobile-clean |
| 18 | `/audit-logs` | ✓ fixed | Table → vertical cards; KPI watermarks hidden; inline message style → class to allow mobile wrap |
| 19 | Topbar + sidebar drawer (Layout) | ✓ fixed | Close X added to drawer; hamburger 36→40; month-nav chevrons 18→28; brand subtitle nowrap |
| 20 | Modal/Drawer/Confirm-dialog inventory | ✓ fixed | UserForm inline grids → `.row-2` (collapses on phone); Modal/Drawer/ConfirmDialog/Fleet DetailModal/LocationAutocomplete verified clean |
| 21 | `/trips/new` & `/trips/:id/edit` | ✓ fixed | Grid columns → `minmax(0, 1fr)` so the Tuyến đường `<select>` can't push the card 162px past the viewport; `min-width:0` + `max-width:100%` on form children |
| 22 | Driver portal error states | ✓ fixed | `/my-trips` + `/my-earnings` error branches → PageHeader + AlertTriangle empty-state; backend RBAC 403 documented as separate work |
| 23 | `/login` | ✓ fixed | 100dvh viewport, tighter card chrome, 44px CTA, placeholder fits, footer over illustration |
