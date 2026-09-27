# 03 — Data display and feedback

Slice 3 of the design-system map (see [`README.md`](./README.md)). Code owns WHAT;
this file owns only **which primitive does which job**, what is banned, and what
enforces it. Counts are greps over `frontend/src` at 2026-09-27 (`.tsx` excluding
`*.test.*`). Law sources in [`../design-guidelines.md`](../design-guidelines.md).

The table/record surface is where per-page invention is worst: one shared
`record-table` class coexists with 48 raw `<table>`s carrying no shared base.

## Data tables

### Table base: `record-table` / `ops-table`
- **Use** — `frontend/src/styles/record-table.css` (`.record-table-wrap`, `.record-table`, `.record-table__action`) + `frontend/src/styles/operational-table-typography.css` (`.ops-table`); recipe at `record-table.css:10-30`. **28 of the 76 `.tsx` files that render `<table>`** carry a shared class; `data-label` 423× across 70 files; `record-table__action` 19×.
- **Never** — **48 of 76 `<table>` files use no shared base**, each inventing a private skin (23 CSS files declare own `border-collapse`, 44 style `td`, 40 `th`; 63 bespoke `*table*` names). Worst: `.routes-table` (90, `pages/config/config-page.css:591`), `.invoice-tracking-table` (58, `pages/AccountingInvoiceTrackingPage.css:114`), `.tt-table` (47, `config-page.css:130`), `.cus-dashboard-table` (44, `pages/ShipmentsPage.css:363`), `.ops-bill-table`/`.factories-table` (32 each, `pages/ForwarderTripsPage.css:133`, `config-page.css:558`), `.cfg-customer-table` (26, `pages/config/customer-config-density.css:107`), `.expense-register-table` (23, `features/expense-accounting/ExpenseAccounting.css:28`), `.shipment-debit-table` (12, `pages/ShipmentDebitPage.css:153`).
- **Divergence** — 28 files on the shared base vs 48 raw tables, 63 class names.
- **Enforced by** — `src/styles/workboard-standard.styles.test.ts` (thead skin, single global `thead th` case/tracking authority + allowlist of 9 fork surfaces); `src/styles/operational-table-typography.test.ts`; `src/styles/table-sort.styles.test.ts`.
- **Gap** — nothing requires `record-table`/`ops-table`; the 48 raw tables are unchecked (e.g. `features/shipments/cus/CusContainerLedger.tsx`, `features/ops/OpsFundBookSection.tsx`).

### `DataTable` React primitive — dead
- **Use** — `frontend/src/design-system/DataTable.tsx` (`design-system/index.ts:20`): column defs, controlled sort, `mobileRender`, built-in skeleton + `EmptyState` + `Pagination`.
- **Never** — **0 production call sites**; every reference is its own test (`design-system/DataTable.test.tsx:3`) or a comment. Only the shared CSS is read (`operational-density.styles.test.ts:9`, `mobile-card-interaction.styles.test.ts:9`).
- **Divergence** — 1 primitive, 0 adopters, 76 hand-built tables.
- **Enforced by** — `src/design-system/DataTable.test.tsx` (sort headers only).
- **Gap** — a whole React table system exists unused; adopt or delete it.

### Table vs card — the band, not a page decision
- **Use** — `record-table.css`: `@container (max-width: 1100px)` (`:122`) turns each `<tr>` into a labelled record card (`display: grid`, 2-up facts, eyebrow from `content: attr(data-label)`, `:203`); `@container (max-width: 360px)` (`:222`) collapses to 1 column.
- **Never** — a second band vocabulary + private collapses: `DataTable.css:176` uses `@media (max-width: 1023px)` for the same job; `.invoice-tracking-table tbody` (`AccountingInvoiceTrackingPage.css:383`), `.cfg-customer-table tbody tr` (`customer-config-density.css:107`), `.cfg-page .routes-table tbody tr` (`config-page.css:663`) re-implement the collapse.
- **Divergence** — 1 shared container band vs 1 media band + 3 bespoke collapses.
- **Enforced by** — `src/styles/workboard-standard.styles.test.ts` (pins 1100px band + `attr(data-label)`); `src/styles/responsive-polish.styles.test.ts` (≤1500px hand-off).
- **Gap** — two band vocabularies (`@container 1100` / `@media 1023`); the 3 bespoke collapses are unpinned.

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
- **Use** — `ListFilterBar` (`frontend/src/components/ListFilterBar.tsx`, card `20260922_38`) + `components/FilterBar.css`. Real grid (card `20260925_8`): desktop auto-fit, tablet 768–1279 = 2 cols, mobile <768 = 1 col. **10 call sites.** §5: row-packing, dropdown ≤~320px, full-width only for the primary search.
- **Never** — 28 CSS files own filter styling; `.filter-chip` recoloured from 6 sheets (`.fwd-filter-chip`, `.dd-filter-chip`, `.users .filter-chip`); old hand-rolled bars persist (`.expense-filters`, `.fset-search-bar`, `.penalty-filter-bar`).
- **Divergence** — 10 shared hosts vs 28 filter stylesheets / 6 `.filter-chip` forks.
- **Enforced by** — `src/styles/filter-density.test.ts` (pins `--filter-control-h` in `FilterBar.css` + accounting/expense/debt/trip-list); `src/components/FilterBar.styles.test.ts`; `src/styles/responsive-polish.styles.test.ts` (≤640px stack).
- **Gap** — the contract is pinned per named file; a new bespoke filter bar is unchecked.

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
- **Never** — 1 native `window.confirm` survives: `pages/config/MasterDataImportPage.tsx:80`.
- **Divergence** — 37 shared-dialog calls vs 1 native `confirm`.
- **Enforced by** — `src/components/confirm-dialog.test.tsx`.
- **Gap** — the native `window.confirm` is unchecked; icon-only destructive buttons are not audited for `aria-label`.

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
- **Destructive** — `pages/config/MasterDataImportPage.tsx:80` still native `confirm`.
