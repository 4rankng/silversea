# 03 — Data display and feedback

Slice 3 of the design-system map (see [`README.md`](./README.md)). Code owns WHAT;
this file owns only **which primitive does which job**, what is banned, and what
enforces it. Counts are greps over `frontend/src` at 2026-09-27 (`.tsx` excluding
`*.test.*`). Law sources in [`../design-guidelines.md`](../design-guidelines.md).

The table/record surface is where per-page invention is worst: one shared
`record-table` class coexists with 48 raw `<table>`s carrying no shared base.

## Data tables

### Table base: `record-table` / `ops-table`

Bounded table `.row-action` buttons use the shared two-pixel inset keyboard
outline from `components/Table.css`; the complete ring stays inside the existing
target when phone action rails reach a clipped table edge. Preserve target size,
content and callbacks rather than adding page-local padding or hiding the ring
(QA-AUDIT-UI-79).
- **Use** — `frontend/src/styles/record-table.css` (`.record-table-wrap`, `.record-table`, `.record-table__action`) + `frontend/src/styles/operational-table-typography.css` (`.ops-table`); recipe at `record-table.css:10-30`. **28 of the 76 `.tsx` files that render `<table>`** carry a shared class; `data-label` 423× across 70 files; `record-table__action` 19×.
- **Never** — **48 of 76 `<table>` files use no shared base**, each inventing a private skin (23 CSS files declare own `border-collapse`, 44 style `td`, 40 `th`; 63 bespoke `*table*` names). Worst: `.routes-table` (90, `pages/config/config-page.css:591`), `.tt-table` (47, `config-page.css:130`), `.cus-dashboard-table` (44, `pages/ShipmentsPage.css:363`), `.ops-bill-table`/`.factories-table` (32 each, `pages/ForwarderTripsPage.css:133`, `config-page.css:558`), `.cfg-customer-table` (26, `pages/config/customer-config-density.css:107`), `.expense-register-table` (23, `features/expense-accounting/ExpenseAccounting.css:28`), `.shipment-debit-table` (12, `pages/ShipmentDebitPage.css:153…`. (Three Kế toán skins left this list on 2026-09-29: `.invoice-tracking-table` (58) — the invoice board also carried a `min-width: 1350px` floor and a private `@container (max-width: 900px)` collapse, and its 1953px table was CLIPPED by the shell's `overflow-x: hidden` so a third of its columns were unreachable; `.deposit-tracker-table` (1220px floor + a page override of `.table-wrap`'s overflow); and `.tt-table` on `/accounting/chot-debit` — all three now ride `record-table ops-table` + `record-table-wrap`.)
- **Wide human text (QA-AUDIT-UI-88)** — opt in to `.record-table__text` for customer/notes that need an18ch intrinsic minimum, and `.record-table__reference` for a complete12–20ch business reference span that wraps long tokens. The existing1100px record band removes those minima and bounds the reference to its fact. Add `.record-table-wrap--scroll` only when those semantic columns genuinely exceed a desktop canvas: it is the same natural-height wrapper, not a second scroll box or a fixed table floor. Its horizontal boundary owns the table header rather than promising app-body sticky behavior; test the actual header/scroll/focus on adoption. DepositTracker is the proven first adopter, with dates/money/ordinals left atomic.
- **Divergence** — 28 files on the shared base vs 48 raw tables, 63 class names.
- **Enforced by** — `src/styles/workboard-standard.styles.test.ts` (thead skin, single global `thead th` case/tracking authority + allowlist of 9 fork surfaces); `src/styles/operational-table-typography.test.ts`; `src/styles/table-sort.styles.test.ts`.
- **Gap** — nothing requires `record-table`/`ops-table`; the 48 raw tables are unchecked (e.g. `features/shipments/cus/CusContainerLedger.tsx`, `features/ops/OpsFundBookSection.tsx`).

### A table's caption and heading (2026-09-29)
- **Use** — an `<h2>` above the board for the DOCUMENT it renders (sentence case, section scale) and a `<caption className="sr-only">` for the accessible name: `/accounting/chot-debit` prints "Kế hoạch điều động tổng hợp" once, above the board, with the period beside it. A caption that carries something the table ADDS (a count, a period, a measure) may stay visible — `.ppc-report`'s "Báo cáo Phải thu (theo khách hàng)" does.
- **Never** — a visible caption that only restates the page name (the retired `"BẢNG KIỂM SOÁT PHƠI PHIẾU - TIỀN ĐƯỜNG"`), or an ALL-CAPS heading/caption anywhere. A page's H1 is the SCREEN's name, one name, sentence case; the document a board renders is the BOARD's identity and never rides the H1 behind a separator (the retired `"Kế toán chốt debit — KẾ HOẠCH ĐIỀU ĐỘNG TỔNG HỢP"`).
- **Enforced by** — `src/components/page-heading-law.test.ts` (app-wide source scan over `PageHeader title=` literals and every literal `<h1|h2|h3>`/visible `<caption>`).

### `DataTable` React primitive — dead
- **Use** — `frontend/src/design-system/DataTable.tsx` (`design-system/index.ts:20`): column defs, controlled sort, `mobileRender`, built-in skeleton + `EmptyState` + `Pagination`.
- **Never** — **0 production call sites**; every reference is its own test (`design-system/DataTable.test.tsx:3`) or a comment. Only the shared CSS is read (`operational-density.styles.test.ts:9`, `mobile-card-interaction.styles.test.ts:9`).
- **Divergence** — 1 primitive, 0 adopters, 76 hand-built tables.
- **Enforced by** — `src/design-system/DataTable.test.tsx` (sort headers only).
- **Gap** — a whole React table system exists unused; adopt or delete it.

### Table vs card — the band, not a page decision

In the shared record band, each fact permits normal whitespace even when its
desktop cell has a token-nowrap hook. The inline `data-label` must wrap with its
value inside the allocated cell; `Money` still owns atomic digits/unit behavior.
QA-AUDIT-UI-17 covers long Bill values and the full refund-date label.
- **Use** — `record-table.css`: `@container (max-width: 1100px)` (`:122`) turns each `<tr>` into a labelled record card (`display: grid`, 2-up facts, eyebrow from `content: attr(data-label)`, `:203`); `@container (max-width: 360px)` (`:222`) collapses to 1 column.
- **Never** — a second band vocabulary + private collapses: `DataTable.css:176` uses `@media (max-width: 1023px)` for the same job; `.cfg-customer-table tbody tr` (`customer-config-density.css:107`), `.cfg-page .routes-table tbody tr` (`config-page.css:663`) re-implement the collapse. (`.invoice-tracking-table tbody`'s private collapse was retired 2026-09-29 — the page now rides this band.)
- **Divergence** — 1 shared container band vs 1 media band + 2 bespoke collapses.
- **Enforced by** — `src/styles/workboard-standard.styles.test.ts` (pins 1100px band + `attr(data-label)`); `src/styles/responsive-polish.styles.test.ts` (≤1500px hand-off).
- **Gap** — two band vocabularies (`@container 1100` / `@media 1023`); the 2 bespoke collapses are unpinned.

Editable expense detail dialogs also use this record band: `data-label` exposes
every fee, identifier, person, amount and action on phones; one DOM owns both
record and desktop grid. Totals use the ruled summary anatomy plus `Money`,
outside the responsive row collection. Phone horizontal panning is not an
accepted substitute for keeping editable context visible (operator ruling
2026-10-01, QA-AUDIT-UI-12 reopened). A draft uses quiet text; the shared global
table hover is neutral and fine-pointer-only, including sticky cells.

### A board wider than the canvas — `debit-board` (2026-09-29)
- **Use** — `frontend/src/pages/accounting/AccountingDebitClosePage.css`: at tablet/desktop widths a money matrix (17 columns: 10 money + identity + notes) that cannot fit the operational canvas takes an explicit scroll box, per-column minimum widths and sticky identity columns. At <=640px, `components/shared/LedgerRecordList` renders readable house Panel records using the same column values and actions: identity and primary facts are visible, remaining facts expand under Chi tiết, and a 20-record pager keeps every record reachable. Selection uses an explicit checkbox and never follows a disclosure or nested action. The owner rejected off-screen phone accounting data on 2026-10-01; a horizontal cue alone does not satisfy that requirement. See QA-AUDIT-UI-30/31. Matrix precedent remains `.shipment-debit-table-wrap` above the phone breakpoint.
- **Never** — a `table-layout: fixed` wall with explicit colgroup shares (the retired 2640px `AccountingDebitClosePage` board: the shares were the only thing holding the grouped header together and half the board lived off screen); a `nowrap` money HEADER (it sizes the track from its own label and starves the data columns — the amount never wraps, the header always does); page-private horizontal-scroll overrides or a second nested wrapper around `.record-table-wrap`. The default shared wrapper keeps `overflow: visible` for app-body sticky headers; the explicit shared wide-text opt-in above owns its own horizontal boundary.
- **Enforced by** — `src/pages/accounting/AccountingDebitClosePage.test.tsx` (the board's rendered contract); the design-drift ratchet (`pnpm design:drift`: the new sheet adds no raw hex/shadow/z-index/radius/breakpoint).
- **Gap** — the debit money-matrix anatomy remains that board's distinct grouped/sticky-column pattern. Shared ordinary record tables now have the bounded semantic wide-text adoption above; do not copy the debit board's financial-column shares into them.

### Column visibility — the default counts VALUES, not cells (2026-09-29)
- **Use** — `frontend/src/lib/column-visibility.ts` + `hooks/useHiddenColumns.ts`: a column declaring `autoHideWhenEmpty` hides itself while no rendered row carries a value — "Thiếu cước thu" is a missing-data warning, not data (law §1), so a breakdown that is still missing on every row does not hold a track on the board. It returns by itself the moment one row carries a number, and an explicit picker choice always wins.
- **Never** — hand-rolling a hide/show rule, or hiding an identity/action column (mark them `pinned`; `hideableColumns` enforces it).
- **Enforced by** — `src/pages/accounting/AccountingDebitClosePage.test.tsx` ("a breakdown column with no value anywhere stays out of the board, and returns with data"); `components/ColumnPicker.test.tsx`.

### Row selection — a row is the control (2026-09-29, card `20260929_207`)
- **Use** — `frontend/src/hooks/useTableRowSelection.ts`: `data-selected` on the `<tr>`, click toggles, Space/Enter toggles the focused row, a click that lands on an interactive child belongs to that child, and the select-all affordance lives in the toolbar where its scope can be stated. The selection edge is NEUTRAL INK (`box-shadow: inset 3px 0 0 var(--ink)`), never a brand tint (`src/styles/selection-state-contract.styles.test.ts`).
- **Never** — a checkbox column for row selection; a second `Set` dance per page; an accent-filled selected row.
- **Enforced by** — `src/styles/selection-state-contract.styles.test.ts`; the page tests of each migrated board.
- **Gap** — the migration is in flight (9 tables carried a selection checkbox at 2026-09-29); `AccountingTransportRegister` still carries its own copy.

## Cell patterns

### Status / value cells
- **Use** — `StatusText` (`frontend/src/components/shared/StatusText.tsx`, card `20260924_21`): plain text + one 7px dot — no pill/fill/border. 28 usages; legacy `Badge` (`shared/Badge.tsx`) delegates to it (purge at the shared layer).
- **Never** — 145 bespoke `*badge*/*chip*/*pill*/*tag*` classes re-declaring radius/fill/colour: `.tc-status-pill` (17, `features/trips/*`), `.penalty-sev-pill` (5), `.penalty-grade-badge` (5), `.cus-direction-badge` (3, `ShipmentsPage.css:369`), `.dtp-pill` (4), `.container-tag` (3). 20 CSS files still hardcode status hex (`#177448`, `#A0444E`).
- **Divergence** — 1 primitive / 28 uses vs 145 bespoke chip classes.
- **Enforced by** — `src/components/shared/StatusText.test.tsx`; `src/styles/semantic-token-contrast.styles.test.ts` (status token ≥4.5:1); `src/styles/operational-color-contract.styles.test.ts`.
- **Gap** — nothing forbids a new page-local status pill; the 145 chips are unchecked.

### Status strips / dots
- **Use** — `StatusStrip`/`StatusDot`/`StatusSwatch`/`getStatusColor` (`frontend/src/components/shared/StatusStrip.tsx`) — the 3×20px left-edge marker (§10). 22 `StatusStrip` usages.
- **Never** — full-height colour fills; `StatusStrip` hardcodes `#177448`/`#A0444E` in `STATUS_COLORS` (`:5`) and consumers pass raw `color=`, bypassing the triads.
- **Divergence** — 1 marker primitive (3 faces) but a hardcoded, non-token colour source every consumer bypasses with `color=`.
- **Enforced by** — `src/styles/pill-ban-nav-badges.styles.test.ts` (guards the two sanctioned `0 999px 999px 0` rails in `sidebar.css`).
- **Gap** — the marker's colour source is hardcoded, not token-bound.

### Money cells and numeric alignment

Financial comparisons use the magnitude of a nonzero previous amount, while
their arrow follows the actual numerical change. Success/danger tone expresses
favorability separately: lower costs are favorable; higher revenue or profit is
favorable. Flat or unknown comparisons and zero profit totals are neutral.
Dashboard and Finance comparison owners retain missing previous reports as
unknown, and trip profit total owners apply positive/negative/zero state without
changing calculations or amounts (QA-AUDIT-UI-75).

Tax codes, phone numbers and catalog codes use the global `.data-token` inner
value boundary from `styles/utilities.css` (QA-AUDIT-UI-22). It preserves whole
digits without clipping while surrounding record labels and prose still wrap.
Use the existing `Plate` primitive for vehicle plate values. The source/CSS
contract is pinned by `styles/numeric-identity.styles.test.ts` and actual customer
directory/disclosure captures at390/768/1440.

- **Use** — `Money` (`frontend/src/components/shared/Money.tsx`, §10): digits in `--font-data`, unit sub-caption (`Money.css:27`, `opacity: 1` for §2). 90 `<Money>` uses; `.num` alignment 129× in `.tsx` / 28 CSS files (`.record-table .num { text-align: right; font-family: var(--font-data) }`, `record-table.css:96`).
- **Never** — bare `formatCurrency(...)` renders the unit at digit size: **241 occurrences** in `.tsx` — the dominant non-conforming path (`<Money>` covers ~27%).
- **Divergence** — 90 `<Money>` vs 241 `formatCurrency`; no rule chooses.
- **Enforced by** — `src/styles/table-no-truncation.styles.test.ts` (money cells wrap, never clip).
- **Gap** — no check bans bare `formatCurrency`; number/unit treatment is unpinned unless a page uses `<Money>`.

### Numbers, units and count numerals
- **Use** — visible number/unit gap ("71 người", never "71người", §4). The KPI primitive pins it via `src/components/KpiCard.styles.test.ts` (measures `.kpi__value-unit` at every breakpoint) — **but `KpiCard.tsx` does not exist**; `KpiCard.css` + its test are orphaned.
- **Never** — count badges as pills. The 2026-09-27 ruling is plain tone-coloured numerals (`countTone`), shared form `.ds-tabs__count` (`design-system/Tabs.css:136`). Bespoke count chips persist: `.filter-chip__count` (`components/FilterBar.css:130`, `padding: 2px 6px; background: rgba(0,0,0,.06); border-radius: 4px`) plus ~24 `*__count` and 6 `-count` classes (`.penalty-violation-count` 7, `.stab-count`, `.dispatch-catalogs__count`, …).
- **Divergence** — 1 shared count treatment vs ~30 bespoke count badges.
- **Enforced by** — `src/design-system/Tabs.styles.test.ts` (plain count numerals, no pills); `src/styles/badge-radius.styles.test.ts` (`.d-badge`/dashboard delta chip 6px, not daisyUI 20px).
- **Gap** — "no count pills" is pinned only on `Tabs`; `.filter-chip__count` and the ~30 count chips are unchecked.

### Note / document / schedule cells
- **Use** — `.ops-schedule` is the one shared schedule-cell class (`frontend/src/styles/operational-table-typography.css:29`; flex stack, datetime wraps at the time/date space) — 4 files / 10 uses. Notes and documents have **no shared cell class**; a document cell renders as an `<a>`/`<button>` inside page markup.
- **Never** — bespoke note/document cells: `.cus-note-preview` / `.cus-note-clamp` (`pages/ShipmentsPage.css:772` & `:2428` — the §4-sanctioned 2-line note clamp, `-webkit-line-clamp: 2`), `.driver-trip-pod-note` (6), `.expense-work-notes` (4), `.dispatch-driver-note__text` (`features/dispatch/detailed-plan/DispatchDriverNote.css:9`); documents `.ops-doc-state` (3, `pages/OpsWalletPage.css:145`), `.dd-documents-section` (3), `.cus-dashboard-col--documents`; schedule variants `.cus-schedule-missing` (`ShipmentsPage.css:685`, `!important` warn colour), `.cus-schedule-lot-fallback` (`:418`).
- **Divergence** — 1 shared schedule class vs 12+ bespoke note/document/schedule classes; notes and documents have no shared cell primitive at all.
- **Enforced by** — `src/styles/table-no-truncation.styles.test.ts` (the note preview is the deliberate clamp exception, everything else in a data cell must wrap).
- **Gap** — no shared note/document cell; the permitted `.cus-note-preview` clamp is unpinned against accidental removal elsewhere.

### Sort headers
- **Use** — `SortHeader` (`frontend/src/components/shared/SortHeader.tsx`) for bespoke `record-table` markup; `DataTable`'s internal header for `ds-table` — both render the one `.table-sort-button` from `styles/table-sort.css`. **214 `<SortHeader>` call sites**.
- **Never** — 4 files re-implement sorting: `features/trips/tripColumns.tsx:151` (copies the button), `pages/AdminAdvancesPage.tsx:65` (own `GridSortHeader`, icon-only aria), `features/dispatch/detailed-plan/DetailedPlanGrid.tsx:205` and `features/users/components/UserTable.tsx:296` (raw `<th aria-sort>`).
- **Divergence** — 214 shared `SortHeader` call sites vs 4 hand-rolled headers (11 direct `.table-sort-button` uses across 4 files).
- **Enforced by** — `src/styles/table-sort.styles.test.ts` (`font/color: inherit`, no own `font-size`; neutral-ink hover; idle icon `.65`; 24px hit area at unchanged density).
- **Gap** — nothing requires `SortHeader`; the 4 bespoke headers compile free.

## Pagination, filters, counts

### Pagination + page-size
- **Use** — `Pagination` (`frontend/src/design-system/Pagination.tsx`): page window, `pageSizeOptions`/`onPageSizeChange` ("Số dòng mỗi trang"), `aria-label="Phân trang"`. 33 files import it.
- **Never** — bespoke families: `.users-pagination` (`features/users/users.css:219`), `.portal-pagination` (`pages/portal/PortalPages.css:461`, re-skins `.ds-pagination__btn`), `.workflow-pagination` (`pages/WorkflowFinance.css:11`), `.expense-accounting-pagination` (`ExpenseAccounting.css:10`), `features/recoverable-costs/RecoverableCostsPagination.css`. 22 files build their own prev/next; `pageSize`/`perPage` in 45 files.
- **Divergence** — 33 files on the primitive vs ~5 bespoke families + 22 hand-rolled page controls.
- **Enforced by** — `design-system/Pagination.test.tsx` (primitive only); no bespoke family is checked.
- **Gap** — no check forces `Pagination`; per-page size controls are unpinned.

### List filter bars
- **Use** — `FilterBar` (`frontend/src/design-system/FilterBar.tsx`, card 20260930_229) is THE band: it owns the strip layout (`.filter-bar`, one **wrapping flex line** — `display:flex; flex-wrap:wrap; align-items:flex-end; gap:12px 16px` — never a grid, never a declared column count), the measured row budget, and the fold. Consumers hand it slots; its DOM order is search cell → always-inline criteria (`children`) → `fold` criteria → `presets` → `quickFilters` → column picker → spacer → actions. `ListFilterBar` (`frontend/src/components/ListFilterBar.tsx`) is the same component under its former name — a compat alias for the surfaces the staged cutover has not reached; new surfaces import `FilterBar` from the design-system barrel and use the `fold` slot.
- **Feedback alignment (QA-AUDIT-UI-56)** — normal filter rows retain `flex-end`. Hosted `UuiSelectField` adapters use their existing inner inline label/control anatomy; direct non-prefixed `BufferedUuiDateInput` fields use one visible label/intrinsic control row. Both keep helpers below that row. Direct prefixed date, standalone date or search-error feedback selects the shared `flex-start` state so its normal-flow helper does not lower adjacent controls. Ordinary stacked forms and folded portalled filters retain their label anatomy; this rule does not promise alignment for arbitrary external label stacks. The measured fold and wrapping row budget remain unchanged.
- **Where a criterion goes** — the criteria every list shares (search, `DateRangeFields` from/to pair, quick ranges, reset) stay visible in the bar. Every other criterion is handed to the band's `fold` slot (`criteria`, `count`, `onReset`, optional `neverInline`): the band mounts the `Bộ lọc` affordance itself (`FilterDropdown`, a flat repo-native trigger reading `Bộ lọc` / `Bộ lọc, N đang áp dụng`, a dialog body that is the *same* wrapping line as the bar, `Đặt lại`/`Áp dụng` riding its last line, panel `min(520px, calc(100vw - 24px))`) — so a bar whose content exceeds two rows always has something to fold into, by construction. Surfaces still on the alias compose `FilterDropdown` as a `children` item; the measured placement behaves identically.
- **Quick ranges, one implementation per container** — `DateRangePresets` (`design-system/forms/DateRangeFields.tsx`) renders the chips where the bar can hold them; `DateRangePresetSelect` renders the same preset array as a dropdown inside the dialog, where the chips group would wrap onto lines of its own.
- **Width follows the value** — a filter control is as wide as the value it holds, bounded by its family:

| family | floor | cap |
|---|---|---|
| search cell (`flex: 1 1 220px`) | 220px | 300px |
| date field (`[data-input-wrapper]`) | 149px | 168px |
| `DateRangeFields` (two fields + 12px seam) | 310px | 348px |
| `UuiSelectField` (`.ds-uui-select`) | 180px | 280px |
| `SearchableSelect` / `SearchableMultiSelect` | 200px | 320px |
| `FilterDropdown` trigger | content | 180px |
| reset action | content | 120px |

- **Row budget** — at most **two** visual rows at every width ≥460px; the only grower is the search cell. The budget is the band's own measurement, **not a breakpoint and not a per-page promise**: `frontend/src/design-system/filter-bar-mode.ts` counts the rendered rows and picks `inline` → `dialog` (criteria fold into `Bộ lọc`) → `dialog-presets` (the ranges follow them). Below the physical floor (≤430px) the strip wraps to three lines; nothing stretches. `neverInline` is the one documented escape (a facet set that cannot fit two rows at any width — the dispatch plans).
- **Never** — a page-local bar layout: no page may declare `display:flex/grid`, `flex-wrap`, `grid-template-columns`, `align-items` or `gap` on its filter container (a page may size only). Never `width:100%` on a filter control (the search cell is the one exception, capped at 300px). Never a `box-shadow` on a filter surface or its popover. Never a popover painted before it has coordinates — the `top: position?.top ?? 12` fallback is the "dropdown jumps over the page header" bug; the panel stays `visibility:hidden` until `usePopoverPosition` returns.
- **Divergence** — 46 files render the shared strip. The first cutover (2026-09-27) converted the 13 remaining shared-bar list surfaces; the second sweep the same day took the page-local control planes the operator named — trips, the dispatch detailed-plan ribbon/header and the catalogs that `CatalogTableShell` carries, admin + forwarder advances, the payables family (fuel invoices, /payables, /payables/:id), the invoice/search planes on users, the audit log, ops orders, salary, the transport register, the fuel-evidence review, recoverable costs, the expense report, the profitability panel, `/config`, `/customers`, `/config/routes` and the `CrudTable` shell **that 17 catalogue pages inherit** — plus the shared `PeriodFilter` and shipment-finance panel. It also retired the last shared hosts of the old shapes: `Toolbar` pills, `.fwd-filter-chip*` (its sheet deleted), the dead `WorkboardFilters` and its `.list-filter-bar__pair` wrapper.
- **Enforced by** — `src/design-system/FilterBar.test.tsx` (the bar-level contracts, written once: fold opens, two-row cap flips the mode, anchor gating, the alias-is-the-band pin); `src/components/filter-grid-rebuild.styles.test.ts` (one flex line, no grid, exactly one grower, the search cap, no `?? 12`); `src/components/FilterDropdown.test.tsx`; `src/tests/filter-audit-contract.test.tsx` (the band owns the law structurally; the audit keeps only styling drift); `src/styles/filter-density.test.ts`; `frontend/design-lock/expectations/filters.mjs` (`rows ≤2` on `/shipments` at 1440/1187/1024/768/594/500/460, the `maxWidth` caps above, `matchHeight` against the tab row, `minFont ≥11`); `testplan/qa/scripts/ui-filter-audit-20260927.mjs` (styling drift walked across surfaces × widths: family caps, overflow, anchor geometry — the two-row verdict itself is structural since 2026-09-30).
- **Gap** — the ~46 surfaces still on the `ListFilterBar` alias compose their own `FilterDropdown` as a child (identical measured behaviour; they gain nothing and lose nothing), and the page-local containers listed under Divergence keep their own layout until the follow-up cutover.

### Quick-filter chips / badges / pills
- **Use** — `.filter-chip` (`components/FilterBar.css:102`, 8px radius); shared badge chrome pinned at 4–6px (never a pill).
- **Never** — `.filter-chip` has 48 recolouring rule hits across sheets (`.fwd-filter-chip--active` 8, `.fwd-filter-chip` 7, `.penalty-chip` 6, `.dd-filter-chip`, `.tc-route-chip`, `.as-expense-chip`, `.ti-chip`); status pills restate §1-violating shapes.
- **Divergence** — 1 `.filter-chip` primitive vs 145 bespoke badge/chip/pill/tag classes total.
- **Enforced by** — `src/styles/badge-radius.styles.test.ts` (nav `d-badge` 6px); `src/styles/pill-ban-nav-badges.styles.test.ts` (sidebar/`Pill.css`/topbar badges 4px, never `999px`).
- **Gap** — the pill ban covers nav/badge chrome only; quick-filter/status chips are unchecked.

## KPI rails, empty, loading, feedback

### KPI / summary rails and sparklines
- **Use** — `SummaryRail` (`frontend/src/design-system/SummaryRail.tsx`) — the workboard ruled strip (labels left, value right, no cards, tones colour the number only). 12 files. `HeroKpiRow` (`components/shared/HeroKpiRow.tsx`) is the separate hero contract (2 usages). `Sparkline` (`design-system/Sparkline.tsx`, T2): 32px tokens-only SVG, `ariaLabel` required, 6 usages.
- **Never** — bespoke KPI families: `.wf-kpi` (45, `pages/DashboardPage.css:209`), `.penalty-kpi-grid` (22, `pages/penalty/violation-log.css`), `.adv-kpi` (16, `pages/AdminAdvancesPage.css:30`), `.as-kpi` (15, `pages/AdminAdvanceSettlementsPage.css:30`), `.invoice-tracking-kpi`, `.fleet-kpi-meta`, `.hero-kpi-mini` — **57 distinct kpi/hero/stat/metric classes**; `.adv-kpi`/`.as-kpi` are near-duplicates.
- **Divergence** — 12 files on `SummaryRail` vs 57 bespoke KPI classes; Sparkline near-unused.
- **Enforced by** — `src/styles/workboard-standard.styles.test.ts` (rail is a ruled strip — hairlines, no radius/background/box-shadow on items, tones colour the number only).
- **Gap** — no rule steers a page to `SummaryRail`; the 57 KPI classes and inline chart SVG are unchecked.

### Empty states + illustration resolver
- **Use** — `EmptyState` (`frontend/src/design-system/EmptyState.tsx`, card `_41`) + the single typed resolver `frontend/src/lib/emptyIllustrations.ts` (`resolveEmptyIllustration`, `EmptyContext`). 63 files import `EmptyState`; **50 `context=`** vs 5 legacy `illustration=`; 1 legacy `empty-*.svg` ref (a test).
- **Never** — 107 bespoke `*empty*` classes; 80 `.tsx` files render a literal `className="…empty…"`; 169 files hardcode a "Không có dữ liệu"/"Chưa có…" literal. Worst: `.ops-bill-state--empty` (7, `pages/ForwarderTripsPage.css:98`), `.wf-chart-empty` (7, `pages/DashboardPage.css:459`), `.fset-empty-state` (6, `pages/ForwarderSettlementsPage.css:17`), `.ci-empty` (6, `components/trip/ContainerInstancesCard.css:377`), `.penalty-empty-stat` (6, `pages/penalty/responsive.css:362`).
- **Divergence** — 63 files on `EmptyState` (50 via the resolver) vs 80 files with bespoke empty markup / 107 empty classes.
- **Enforced by** — `src/design-system/empty-state.styles.test.ts` (retired `.empty-state` chrome + `ttFloat` stay dead; reduced-motion guard; no infinite animation); **`src/design-system/empty-state-art-coverage.test.ts`** (2026-09-27) — mechanically parses every `<EmptyState>` call site and fails, naming file:line, when one lacks `context`/`illustration`; it also asserts every resolver path exists in `public/` and is non-empty. Measured when it landed: 72 call sites, **21 without art**; the 18 real ones are wired (the design-system preview page is the one allowlisted host). **Unloadable art is measured too**: `EmptyState` marks a failed image `data-art-missing` instead of vanishing silently, `role-ui-sweep.mjs` reports `art=N`, and `frontend/design-lock/expectations/shipments.mjs` holds `my-trips/phone/no-broken-art`.
- **Why the missing-art check exists** (2026-09-27 incident): the driver fuel/cost empty states rendered **text-only in the deployed environment** while the code was correct — `empty-fuel.webp` / `empty-costs.webp` returned **403** on the host (the files landed unreadable to the web user: a control path returned 404, a healthy sibling `.webp` 200) and the primitive's `onError` hid the image without a trace. The local tree is now `chmod 644`; the deployed artifact needs a redeploy (or a host-side `chmod`) — operator action.
- **Art set (2026-09-27, operator-provided)** — beyond the four original PNGs (`empty-1..4`), the shared set is now `empty-tasks` / `empty-documents` / `empty-fuel` / `empty-costs` (driver) plus `empty-shipments` (container doors), `empty-no-results` (magnifier over a box), `empty-notifications` (ringing bell), `empty-wallet` (wallet with a sprout). Contexts added the same day: `shipments`, `documents`, `wallet`, `cleared` (the pre-existing `empty-approvals-cleared.webp` was unreferenced art — it now carries the *positive* empties: "Không có biên bản vi phạm", "Chưa có khoản khấu trừ nào"); and `search`, `notifications`, `expenses`, `earnings`, `advances`, `salary` were **re-pointed** off the generic faces onto the purpose-made ones (`expenses` → the costs art, money surfaces → the wallet art, filtered-empty → the no-results art). The mapping is one table (`ART_BY_CONTEXT`) — if a surface reads wrong, change the row, never the call site.
- **Measured locks** — `design-lock/expectations/empty-art.mjs`: `artShown` + `noBrokenArt` on `/my-payslips`, `/my-earnings`, `/my-trips/two-orders` and the filtered-empty `/shipments?searchSuffix=…` at 390/768. Verified 2026-09-27: `empty-wallet.webp` decoded on `/my-payslips` and `/my-earnings`, `empty-tasks.webp` on two-orders, `empty-no-results.webp` on the filtered shipment list, `empty-approvals-cleared.webp` on `/my-earnings`.
- **A positive empty is not an error** — "no violations", "nothing deducted" are good news; they take `cleared`, not the `error` or money face. Error faces take `error` (`role="alert"`). Mixing the two is the inconsistency this law exists to kill.
- **Gap** — bespoke empty *markup* is still widespread: 107 `*empty*` classes, 80 `.tsx` files rendering a literal `…empty…` class, worst `components/trip/ContainerInstancesCard.tsx:377`, `pages/ForwarderTripsPage.css:98` (`.ops-bill-state--empty`), `pages/DashboardPage.css:459` (`.wf-chart-empty`). Those are the next conversion batch; the guard only sees `<EmptyState>` call sites today.

### Loading skeletons
- **Use** — `Skeleton`/`SkeletonLine`/`SkeletonCircle`/`SkeletonCard`/`SkeletonTable`/`SkeletonKPIs` (`frontend/src/components/shared/Skeleton.tsx`). 8 files / 14 usages; `LoadingOverlay` 1 file, `Spinner` 3; `DataTable` carries its own `.ds-table__skeleton-bar`.
- **Never** — 27 bespoke `*loading*`/`*skeleton*` classes: `.expense-loading` (`pages/ExpenseListPage.css:347`), `.portal-loading` (`PortalPages.css:432`), `.penalty-loading` (`penalty/violation-log.css:539`), `.profit-loading` (`ProfitPage.css:401`), `.debt-loading`, `.cus-loading`, `.shipments-detail-skeleton`, `.fset-loading`, `.adv-loading`, `.tdp-loading`, `.infinite-loading`.
- **Divergence** — 8 files on the shared `Skeleton` vs 27 bespoke loading skins.
- **Enforced by** — none (only `DataTable.css`'s reduced-motion handling).
- **Gap** — no rule steers loading UI to `Skeleton`; worst offender `pages/ExpenseListPage.css:347`.

### Alerts / toasts / banners
- **Use** — `useToast`/`ToastProvider` (`shared/Toast.tsx`, 68 files — strongest adoption here), `Alert` (`shared/Alert.tsx`, 47 files; daisyUI `d-alert`, info/success/warning/error), `Banner` (`shared/Banner.tsx`, T3; 4 files; `.nepo-banner`).
- **Never** — bespoke notice strips outside the primitives: `.cus-notice` (`pages/ShipmentsPage.css`), `.treasury-notice` (`TreasuryPositionPage.css`), `.workflow-notice` (`WorkflowFinance.css`), `.vehicle-alerts-strip`.
- **Divergence** — Toast/Alert well-adopted; Banner only 4 hosts with several page-local notice strips still live.
- **Enforced by** — none specific.
- **Gap** — no check chooses Toast vs Alert vs Banner; bespoke strips unpinned.

### Destructive-action affordances
- **Use** — shared `confirm` hook (`frontend/src/components/confirm-dialog.tsx:84`; `ConfirmDialog` `:35`) — **37 call sites** (`variant: 'danger'`, `confirmLabel: 'Xóa'`); §4: icon-only destructive actions carry `aria-label`.
- **Never** — native `window.confirm`; the unsaved-navigation guard in `hooks/usePageLeaveGuard.ts` remains a separate legacy path.
- **Convergence (2026-10-01, QA-AUDIT-UI-10)** — `pages/config/MasterDataImportPage.tsx` now uses the shared confirmation for rejection, including Cancel and persisted REJECTED proof.
- **Enforced by** — `src/components/confirm-dialog.test.tsx`.
- **Gap** — the legacy navigation guard's native confirmation is unchecked; icon-only destructive buttons are not audited for `aria-label`.

## System gaps

- **No live React table primitive** — `DataTable` has 0 adopters; 76 pages hand-build tables (`features/ops/OpsFundBookSection.tsx`, `features/shipments/cus/CusContainerLedger.tsx`).
- **No shared cell-render API** for identity/status/money/document/schedule cells; the one permitted 2-line note clamp, `.cus-note-preview` (`pages/ShipmentsPage.css:772`), is unpinned.
- **No shared KPI primitive** consistent with the orphaned `KpiCard.css`; 57 bespoke KPI classes.
- **No loading/notice primitive in practice** — 27 loading skins, several notice strips.

## Enforcement gaps

- **Tables** — nothing makes a page adopt `record-table`/`ops-table`; worst offender `pages/config/config-page.css` (`.tt-table` + `.routes-table`).
- **Status/chip/count** — the pill ban covers nav/badge chrome only; 145 chip classes and ~30 count chips unchecked, including `.filter-chip__count` (`components/FilterBar.css:130`); worst offender `features/trips/*` `.tc-status-pill`.
- **Money** — no check bans bare `formatCurrency` (241 uses) or enforces `<Money>`.
- **Empty** — no check requires `EmptyState`/resolver; worst offender `components/trip/ContainerInstancesCard.tsx:377` (`.ci-empty`).
- **Loading** — no check requires `Skeleton`; worst offender `pages/ExpenseListPage.css:347`.
- **Sort/pagination/filters** — 4 bespoke sort headers, ~5 pagination families, 28 filter stylesheets compile free.
- **Destructive** — `pages/config/MasterDataImportPage.tsx` uses the house confirmation; rejection still requires a reason and preserves the blocked-row apply gate.

`LedgerRecordList` is the phone record fallback for wide ledgers and pricing matrices. Its shared compact label/value rows retain existing renderers and explicit selection/details/page20. Short numeric editors use `TextField controlWidth="short-number"` rather than full-track fields. Metric-by-class tables may opt into `table-matrix` for an opaque sticky row axis inside the existing `table-scroll`; the generic table/rowspan behavior stays unchanged.

`LedgerMatrix` owns one explicit columns/row.cells mapping for desktop matrices and phone `LedgerRecordList`. A `rowHeader` column becomes a semantic desktop row header and uses the row title/subtitle on phone without repeating an identity fact. Optional `align:"end"` aligns only numeric values/editors; ordinary refs/notes retain start alignment. Optional `framed` uses existing desktop Panel/table-scroll while phone records keep their own shared Panel shells. Pricing matrices prefer one class per row and five metric columns rather than ten class tracks; explicit `table-matrix` row-axis semantics pin the marked first header and row headers without altering generic rowspan tables.

Facts and matrix columns may opt into `layout:"full-width"` for a composite editor, source list or expanded nested workspace. The shared record owner stacks its label above the full-width content lane; scalar facts retain the compact paired label/value recipe. Callers declare this anatomy explicitly, without child-type inference or page-local width overrides (QA-AUDIT-UI-65).
