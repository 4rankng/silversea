# 04 — Layout, navigation & overlays

Authority surface for the app shell, page canvases, headers/toolbars, navigation,
overlays, device bands and chrome budgets. Code owns WHAT; this file owns WHY and
WHERE. Every claim carries `path:line` or a counted grep.

Measured 2026-09-27 on the working tree. Counts are greps over
`frontend/src/**/*.css`, not estimates.

---
### App shell scrollport (`.app` / `.app-main` / `.app-body`)
- **Use** — the shell grid: `.app` (`grid-template-columns: var(--sidebar-w) minmax(0,1fr); grid-template-rows: 100dvh; overflow: clip`) at `frontend/src/components/layout/app-shell.css:22`; `.app-main` is the flex column (`:147`); `.app-body, .content` is the ONE scrollport (`overflow-y:auto`, `scrollbar-gutter:stable`, padding from `--app-body-pad-t/x`) at `frontend/src/components/layout/app-shell.css:162`. Tokens: `--sidebar-w:248px`, `--topbar-h:56px`, `--app-body-pad-t/x:24px`, `--sticky-thead-top` (`frontend/src/styles/tokens.css:246,283`).
- **Never** — a second page scrollport or page-level `height:100vh`; sticky headers must pin against `.app-body` (documented in `frontend/src/styles/record-table.css:49`, `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css:247`).
- **Divergence** — 0 duplicated scrollports; the token is consistent.
- **Enforced by** — `frontend/src/components/layout/app-shell.styles.test.ts` (2 tests: content-height scroll, single gutter/`minmax(0,)` track); `frontend/src/components/layout/mobile-gutter-contract.styles.test.ts` (2 tests: one outer gutter, no compounding).
- **Gap** — `--app-body-pad-x` is re-declared at a 3rd place (`frontend/src/components/layout/app-shell.css:188`, 1024–1280px → 20px) and once more in `frontend/src/styles/responsive.css:61,260`; there is no single owner of the gutter value.
### Page container & width cap (`--content-max-w`)
- **Use** — every direct child `div|section` of `.app-body` is capped to `min(100%, 1440px)` and centred by `.app-main:not(.driver-mode) .app-body > :where(div, section)` at `frontend/src/components/layout/app-shell.css:174`; a data page opts out with `.data-workspace { width:100% }` (`:183`).
- **Never** — a page re-declaring its own max-width lower than the shell's, or a page-local copy of the shell reselector.
- **Divergence** — 5 explicit opt-outs (grep `app-body > .`): `.data-workspace` (`app-shell.css:183`), `.dispatch-plan-page--wide` (`frontend/src/pages/DispatchPlanPage.css:23`), `.shipments-page` → 1800px (`frontend/src/pages/ShipmentsPage.css:965`), `.shipments-detail-page` → 1800px (`frontend/src/pages/ShipmentContainersPage.css:12`), `.csc-page` → no cap (`frontend/src/pages/clerk/ClerkShipmentCreatePage.css:8`). 6 pages self-cap **below** the shell: `.dispatch-plan-page` 1400 (`DispatchPlanPage.css:9`), `.sp-wrap` 960 (`frontend/src/pages/config/SalaryPeriodConfigPage.css:10`), `.salary-calendar-area` 840 (`frontend/src/pages/salary-attendance/calendar.css:153`), `.driver-earnings-page` 960 (`frontend/src/pages/DriverEarningsPage.css:2`), `.settlement-detail` 860 (`frontend/src/pages/SettlementPrintPage.css:7`), `.not-found-page` 480 (`frontend/src/pages/NotFoundPage.css:1`). 7 pages declare a **dead** 1600px cap (no-op under the 1440 shell cap): `DebtDetailPage.css:12`, `trip-detail/header.css:20,38`, `TripEditPage.css:14,126`, `ShipmentDetailPage.css:10`, `TripCreatePage.css:9`. 2 pages redeclare their own vertical rhythm on the root: `.trip-list-page { padding-bottom:40px }` (`frontend/src/pages/trip-list/table-extras.css:2`), `.customer-shell__main { padding:20px }` (`frontend/src/pages/portal/CustomerPortalLayout.css:194`).
- **Enforced by** — none. `app-shell.styles.test.ts` pins the shell rule, nothing forbids a page bypassing or shadowing it.
- **Gap** — no primitive "page frame" component/token bundle; each opt-out re-types the shell's `:where(div,section)` reselector, so a new page copy-pastes and drifts. 1800px is a second ad-hoc global measure that exists only in two hand-written selectors.
### Page header anatomy (eyebrow / title / actions)
- **Use** — `.page-header` flex row with `.page-header-main` → `.page-title` (`--text-title-size`) + `.page-subtitle` (max `72ch`) and `.page-actions`, at `frontend/src/components/PageHeader.css:6`; `--actions-only` variant `:44`; icon chip `.page-header-icon` (44px) `:70`.
- **Never** — a bespoke title/h1 block per page; the topbar also prints the current page name on phones, so the `.page-header__title-visible` H1 is `sr-only` ≤640px and becomes visible again only under `.is-driver` (`PageHeader.css:150,169`).
- **Divergence** — 05 (Overlays/Detail slice) owns detail-page header variants; here only the generic primitive is in scope.
- **Enforced by** — none specifically (`check-ui-contract.mjs` checks inline interactive minHeights, not header anatomy).
- **Gap** — the eyebrow/subtitle slot is typed as `.page-subtitle`; polished dialogs use a different `.modal__eyebrow` class for the same visual role — two names, one idea.
### Two-tier command header (title row + ribbon row)
- **Use** — the dense operational header pattern: row 1 a 36px title row, row 2 a 32px wrapping "ribbon" of filters. Reference impls: `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css:6` (80px two-tier, `.detailed-plan-header__row { display:contents }` at desk), `frontend/src/features/dispatch/catalogs/catalogs.css:372` (80px two-row strip), `frontend/src/pages/ShipmentDebitPage.css:3` (76px two-tier).
- **Never** — the pre-2026-09-26 stacked dropdown wall (title/segment/range/search/4 facet rows) that ran ~440px above the first record; the facets now live in the filter drawer.
- **Divergence** — 3 hand-built copies of the same 36px+32px geometry (dispatch-detail, catalogs, shipment-debit) with independent class names and no shared component.
- **Enforced by** — `frontend/design-lock/expectations/dispatch.mjs` (`chrome-budget` locks, `header-one-row`, `no-ribbon-facet-grid`, `facets-in-drawer`).
- **Gap** — no `TwoTierHeader` primitive; the geometry (36/32, gap 10/8, ribbon wraps) is re-typed per page.
### Toolbars & filter bars
- **Use** — `.toolbar` (flex, `align-items:end`, pad `10px 12px`) + `.toolbar__search` at `frontend/src/components/Toolbar.css:5,20`; filter density tokens `--filter-control-h` = 30px desktop / 44px ≤640 (`frontend/src/styles/tokens.css:275,435`).
- **Never** — a page rolling its own toolbar chrome; §5 filter law: desktop row-packing, dropdown ≤~320px, full-width only for primary search, mobile one column.
- **Divergence** — shared `ListFilterBar` (`frontend/src/components/ListFilterBar.css`) is the canonical filter host, yet ≥10 pages ship their own filter markup (`.detailed-plan-ribbon`, `.dispatch-catalogs__strip`, `.expense-filter-bar`, `.cus-worksheet` controls, `.cfg-*`).
- **Enforced by** — `frontend/src/styles/filter-density.test.ts` (desktop compact, touch restored <900px); `frontend/scripts/check-ui-contract.mjs:109` pins `.stab-pill` 30px etc.
- **Gap** — the mobile "stack to 1 column" half of §5 is asserted nowhere (grep: no test references filter stacking).
### Driver phone topbar
- **Use** — `.topbar--driver` with the identity block (`DriverIdentity`: name + plate column), the month navigator (`.topbar-date`, `MonthNavigator`) and the notification bell. At ≤640px all three share ONE row (`topbar.css` driver phone band: `order: 1` identity, `2` month, `3` bell; wrap is the ≤340px fallback), and the chip drops its period range there — the month is the state, the range stays in the trigger's `aria-label` and returns at ≥641px. Height is `auto` (the identity column + the 44px chip floor exceed `--topbar-h`); content is inset to `--driver-measure`.
- **Never** — a second row for the month navigator at phone width; a driver-phone date chip carrying the period range (the name then ellipsises to pay for it); a page-local month chip variant.
- **Divergence** — 0 (one implementation, `frontend/src/components/layout/topbar.css`; the ≤640 band is the only phone-specific rule).
- **Enforced by** — `testplan/qa/scripts/ui-driver-chrome-20260927.mjs` (TC-DRIVER-CHROME-01: one visual row, chip visible, period `display:none`, name not clipped, at 390/768 against a live dev or staging build). Ruling: `docs/design-guidelines.md` 2026-09-27.
- **Gap** — no `design-lock` entry (the driver topbar carries no lock; `topbar.css` has only the visibility contract in `Topbar.styles.test.ts`).
### Bottom navigation (driver)
- **Use** — `.bottom-nav` fixed bar, `height: calc(60px + env(safe-area-inset-bottom,12px))`, tabs `min-height:48px`, shown only `@media (max-width:1023px)` at `frontend/src/components/layout/bottom-nav.css:69,93,150`.
- **Never** — transparency on the bar (fully opaque `--surface`, `bottom-nav.styles.test.ts`); a second inset/background around full-bleed driver screens (`bottom-nav.css:8`).
- **Divergence** — driver mode is gated by `≤1023px` (sidebar hidden) but the shell chrome (`--driver-measure:720px` padding on `.topbar--driver`) applies at all widths (`frontend/src/components/layout/topbar.css:25`).
- **Enforced by** — `frontend/src/components/layout/bottom-nav.styles.test.ts`, `bottom-nav-sheet.styles.test.ts` (4 tests).
- **Gap** — the 70px scroll clearance (`bottom-nav.css:78`) is a hand-written `calc`, not a token; nothing pins it.
### Sidebar
- **Use** — `.sidebar` (`--sidebar-w:248px`), collapsed 48px icon rail gated `@media (min-width:1024px)` at `frontend/src/components/layout/app-shell.css:38`; overlay scrim `.sidebar-overlay` (`--z-overlay`) at `frontend/src/components/layout/sidebar-overlay.css:4`, slide-in ≤1023px (`frontend/src/styles/responsive.css:81`).
- **Never** — `sidebar.css` itself declares **no** `@media` (verified: 0 matches) — all its responsive behaviour must live in `responsive.css`/`app-shell.css`.
- **Divergence** — 0.
- **Enforced by** — `frontend/src/components/layout/Sidebar.styles.test.ts` (menu layering).
- **Gap** — sidebar close button is 36px on desktop, 44px only ≤1023px (`sidebar-overlay.css:18,31`) — under the touch floor if a coarse pointer hits a wide viewport.
### Navigation — how a role's nav is built
- **Use** — `getNavItems(role, dispatchCount, penaltiesCount, capabilities)` switch on role in `frontend/src/components/Layout.tsx:85`, sections from `getNavSections(role)`, active key resolved by longest `location.pathname` prefix (`Layout.tsx:639`); roles are `ADMIN|MANAGER|ACCOUNTANT|DISPATCHER|CUS|OPS|DRIVER|CUSTOMER`, default-open section per `PRIMARY_SECTION_BY_ROLE` (`Layout.tsx:72`). Sidebar renders `.sidebar-item` / `.sidebar-item-label`; collapsed rail hides labels via `sidebar-closed`.
- **Never** — page-local top-level navigation; RBAC stays in `App.tsx`+Casbin, the catalog is deliberately non-authoritative (`shared/src/navigation/pageCatalog.ts:12`).
- **Divergence** — the primitive `Tabs` (`frontend/src/design-system/Tabs.tsx`, `role="tablist"`) is imported by 16 tsx files, but **9 pages hand-roll tab markup**: `.shipment-finance__tabs` (own `<button>`, `frontend/src/features/shipment-finance/ShipmentFinancePanel.css:5`), `.dd-workspace-tabs` (`frontend/src/pages/DebtDetailPage.css:432`), `.status-tabs .stab-pill` (`frontend/src/pages/trip-list/filters.css:28`), plus `.accounting-tabs`, `.expense-accounting-tabs`, `.shipments-control__tabs`, `.driver-journey__tabs`, `.cfg-finance-tabs` — these re-skin `ds-tabs__btn` internally, so they are cosmetic variants, not new primitives, except the first three.
- **Enforced by** — `frontend/src/design-system/Tabs.styles.test.ts` (boxed = canonical button group); no test checks that a page uses `<Tabs>`.
- **Gap** — 3 genuinely independent tab implementations (`.shipment-finance__tabs`, `.dd-workspace-tabs`, `.status-tabs`) with their own active-state contract.

---
## Breakpoint inventory — the coherence problem, quantified

**49 distinct width values in `@media` (48 real — `44` is a `@media(pointer:coarse)` single-line block, not a band), across 528 `@media` lines / 152 files. 26 distinct widths in `@container`, across 54 `@container` lines / 29 files.** The canonical documented bands are only 4: `≤1500` operational canvas, `≤1023` tablet, `≤640` phone, `≤420` narrow phone (`frontend/src/styles/responsive.css:4-17`).
### `@media` widths (value | lines | files | where)
| px | ln | files | where (top files; `frontend/src/`) |
|----|----|------|------|
| 320 | 1 | 1 | `pages/DriverTripDetailPage.css` |
| 340 | 1 | 1 | `pages/clerk/ClerkShipmentCreatePage.css` |
| 359 | 1 | 1 | `pages/trip-list/responsive.css` |
| 360 | 7 | 7 | AccountingWorkspacePage, DriverEarningsPage, ExpenseEntryPage, DriverTripDetailPage, portal/PortalPages, DriverPenaltyPage, users/users |
| 380 | 2 | 2 | `components/layout/topbar.css`, `pages/ForwarderTripsPage.css` |
| 390 | 2 | 2 | `pages/LoginPage.css`, `pages/portal/PortalPages.css` |
| 420 | 18 | 16 | responsive.css, HeroKpiRow, PayableListPage, trip-detail/responsive, trip-list/*, salary hero-metrics, KpiCard, ActionBar, DriverContainerCard, AdminAdvancesPage … |
| 430 | 1 | 1 | `pages/DriverTripDetailPage.css` |
| 480 | 9 | 9 | DispatchAllocationPopover, DispatchPlanEditorCell, KpiCard, DriverTripPodPage, SupplierCarrierTrucks, PhoiPhieuControlPage, ForwarderAdvances, TreasuryPosition, DriverEarnings |
| 520 | 2 | 2 | `pages/ShipmentContainersPage.css`, `DispatchPlanEditorCell.css` |
| 560 | 5 | 5 | DispatchContainerDetailDrawer, TripInstructionsCard, ShipmentsPage, ForwarderTripDetailPage, config/config-page |
| 600 | 2 | 2 | `ShipmentFinancePanel.css`, `ShipmentCostEntryForm.css` |
| 620 | 2 | 2 | `pages/ShipmentsPage.css`, `config/debit-note-template-editor.css` |
| 639 | 8 | 4 | RecoverableCostsWorkspace, TreasuryPositionPage, WorkflowFinance, portal/PortalPages |
| **640** | **173** | **101** | Modal, tokens, PageHeader, config/*, DashboardPage, DebtDetailPage, CustomersPage, Pagination, Table, trip-list/*, payables-fuel-invoices, penalty/responsive, ShipmentDebit, CommandPalette … (+95) |
| 641 | 13 | 12 | DetailedPlanGrid, SearchableSelect, SummaryRail, ShipmentDetailPage, topbar, responsive, DriverTripDetailPage, ClerkShipmentCreatePage, SupplierListPage, FleetPage, config-page |
| 680 | 5 | 3 | ops/ops-modal, DispatchAllocationPopover, BillingDocumentBuilder |
| 700 | 5 | 4 | TripPodSubmission, portal/PortalPages, ShipmentsPage, AccountingWorkspacePage |
| 701 | 1 | 1 | `pages/AccountingWorkspacePage.css` |
| 720 | 4 | 2 | `pages/config/config-page.css`, `pages/SettlementPrintPage.css` |
| 760 | 5 | 4 | FleetPage, BillingDocumentsPanel, TruckTiresPage, ShipmentContainersPage |
| **767** | **20** | **17** | DateTimePickerPanels, SupplierListPage, ExpenseAccounting, customer-form, AdvanceWorkspace, RoleWorkInbox, ForwarderTripDateRangePicker, Tabs, TextField, ForwarderTripDetailPage, ListFilterBar, stale-build-banner, MasterPlanGrid, DetailedPlanGrid, ForwarderTripsPage, AdminAdvancesPage(+Settlements) |
| 768 | 7 | 6 | DriverEarningsPage, ListFilterBar, ExpenseAccounting, ForwarderTripsPage, DebtListPage, ShipmentsPage |
| 820 | 9 | 7 | config-page, utilities, DebtListPage, AuditLogPage, CustomersPage, SupplierListPage, AdminAdvanceSettlementsPage |
| 860 | 2 | 2 | `trip-detail/responsive.css`, `config/debit-note-template-editor.css` |
| 880 | 1 | 1 | `components/billing/BillingDocumentBuilder.css` |
| 899 | 1 | 1 | `pages/penalty/responsive.css` |
| 900 | 14 | 12 | ShipmentDetailPage, DebtDetailPage, FinancePage, LoginPage, catalogs, portal/PortalPages, DepositRefundTracker, SupplierListPage, ExpenseEntryPage, ClerkShipmentCreatePage, responsive, FleetPage |
| 960 | 5 | 5 | SupplierListPage, CreditOverrideQueuePage, ShipmentDetailPage, FleetPage, DetailedPlanGrid |
| 980 | 1 | 1 | `components/billing/BillingDocumentBuilder.css` |
| 999 | 1 | 1 | `pages/ShipmentsPage.css` |
| 1000 | 2 | 2 | `WorkflowFinance.css`, `AdminHealthWorkspace.css` |
| **1023** | **44** | **33** | debit-note-template-editor, config-page, salary calendar, ActionBar, FinancePage, ExpenseListPage, topbar, WorkflowFinance, TripEditPage, responsive, ForwarderTripsPage, ExpenseAccounting, trip-detail/responsive, SupplierListPage, DriverSecondaryPages, ProfitPage, trip-list/responsive, DriverTripPodPage, salary hero-metrics, bottom-nav, payables-fuel-invoices, financial-aging, DataTable, PayableListPage, NotificationsPage … (+8) |
| 1024 | 9 | 7 | PageHeader, bottom-nav, DriverEarningsPage, DriverTripDetailPage, app-shell, CarrierAllocationDialog, DriverTripsPage |
| 1025 | 1 | 1 | `pages/salary-attendance/calendar.css` |
| 1039 | 1 | 1 | `pages/ShipmentsPage.css` |
| 1100 | 20 | 19 | portal/PortalPages, FleetPage, ProfitPage, ExpenseAccounting, AccountingWorkspacePage, payables-fuel-invoices, customer-config-density, ConfigPage, FreightRateTermsConfigPage, AdminAdvanceSettlementsPage, SummaryRail, DebtDetailPage, PayableListPage, trip-list/responsive, DispatchPlanPage, DashboardPage, LoginPage, ClerkShipmentCreatePage, salary hero-metrics |
| 1101 | 2 | 2 | `ClerkShipmentCreatePage.css`, `AdminAdvanceSettlementsPage.css` |
| 1145 | 2 | 1 | `components/work-inbox/RoleWorkInbox.css` (two blocks) |
| 1180 | 4 | 4 | config-page, TruckTiresPage, trip-list/filters, debit-note-template-editor |
| 1200 | 6 | 6 | DebtDetailPage, trip-detail/responsive, TripCreatePage, TripEditPage, Table, debit-note-template-editor |
| 1279 | 3 | 3 | AdminAdvancesPage, QuotationConfigPage, ListFilterBar |
| 1280 | 1 | 1 | `components/layout/app-shell.css` |
| 1345 | 1 | 1 | `pages/FinancePage.css` |
| 1400 | 1 | 1 | `pages/config/config-page.css` |
| 1439 | 1 | 1 | `pages/trip-list/table.css` |
| 1500 | 8 | 6 | responsive.css, debit-note-template-editor, config-page, RecoverableCostsWorkspace, WorkflowFinance, DebtDetailPage |
| 1680 | 1 | 1 | `pages/trip-list/responsive.css` |
### `@container` widths (value | lines | files | where)
| px | ln | files | where |
|----|----|------|------|
| 192 | 1 | 1 | `components/untitled-ui/base/select/combobox.css` |
| 360 | 1 | 1 | `styles/record-table.css` |
| 420 | 1 | 1 | `components/trip/ContainerInstancesCard.css` |
| 430 | 1 | 1 | `components/trip/TripInfoCard.css` |
| 480 | 1 | 1 | `design-system/Pagination.css` |
| 520 | 1 | 1 | `pages/ForwarderTripDetailPage.css` |
| 560 | 2 | 2 | `pages/trip-list/filters.css`, `pages/ShipmentsPage.css` |
| 599 | 1 | 1 | `features/dispatch/master-plan/MasterPlanGrid.css` |
| 620 | 2 | 2 | `components/trip/TripInfoCard.css`, `pages/TripEditPage.css` |
| 640 | 4 | 3 | DetailedPlanGrid, ContainerInstancesCard, config/RoutesConfigPage |
| 641 | 1 | 1 | `pages/ShipmentContainersPage.css` |
| 680 | 1 | 1 | `pages/config/config-page.css` |
| 700 | 3 | 3 | OpsWalletPage, OpsFleetTrackingPage, ShipmentsPage |
| 760 | 2 | 2 | ShipmentsPage, DispatchContainerDetailDrawer |
| 780 | 1 | 1 | `pages/ShipmentContainersPage.css` |
| 820 | 2 | 2 | trip-list/hero-metrics, DashboardPage |
| 860 | 1 | 1 | `pages/ForwarderTripDetailPage.css` |
| 900 | 8 | 7 | OpsOrdersPage, DetailedPlanGrid, CreditOverrideQueuePage, DispatchPlanEditorCell, AccountingInvoiceTrackingPage, MasterPlanGrid, DashboardPage |
| 940 | 1 | 1 | `pages/trip-list/filters.css` |
| 960 | 1 | 1 | `components/trip/ContainerInstancesCard.css` |
| 980 | 2 | 1 | `pages/DashboardPage.css` |
| 1000 | 2 | 1 | `pages/ShipmentContainersPage.css` |
| 1037 | 2 | 1 | `pages/clerk/ClerkShipmentCreatePage.css` |
| 1060 | 1 | 1 | `pages/DashboardPage.css` |
| 1100 | 9 | 6 | record-table, config-page, AccountingWorkspacePage, customer-config-density, ExpenseListRecordTable, AccountingWorkInbox |
| 1180 | 2 | 2 | `pages/DashboardPage.css`, `pages/trip-list/hero-metrics.css` |

**Reading:** the canonical 4-band scale is not the scale in use. Only 1500/1023/640/420 have a documented meaning, but 640 and 1023 alone account for 217 of 528 `@media` lines, and values like 767/768/900/1100 (53 lines) are page-local inventions duplicating the tablet/desktop boundary. `141` `@container` line-files use 26 widths with no documented band set at all — `record-table.css:36` is the only container with a written contract.

---
## Overlays
### Drawer (right sheet)
- **Use** — `.drawer` / `.drawer-overlay` at `frontend/src/components/Drawer.css:10`; `max-width:580px`, `--surface`, full-height flex, head/body/foot, body `overscroll-behavior:contain`; ≤640px head/body/foot padding shrinks (`:95`).
- **Never** — a page-local side panel with its own scrim; the filter drawer (`.detailed-plan-filter-panel`) is the operator-approved home for facets.
- **Divergence** — 25 tsx files import `Drawer`; the biggest alternative is `.ops-modal*` (below).
- **Enforced by** — `frontend/src/styles/overlay-surface.styles.test.ts` (fill = `var(--surface`, flat, no raw white).
- **Gap** — no `maxTop`/density lock on drawer content; nothing pins the 580px width as law.
### Modal / Dialog
- **Use** — the ONE modal module: `frontend/src/design-system/Modal.tsx` (+ `Modal.css`, card 20260930_227) owns portal-to-body, scrim + backdrop dismissal, Escape (picker-deferent) and Enter-confirm, focus trap + focus return (close AND unmount paths), nest-safe scroll lock, overlay stacking, house chrome (`.modal__head/__body/__foot`, `--modal-max-w` size, polished variant, ≤640px bottom sheet) and `chrome="bare"` mode for dialog-owned surfaces (`.modal--bare` stays centered). `components/UI` re-exports it for the 33 legacy import sites; new code imports from `@/design-system`.
- **Never** — a second modal shell: private backdrop/Escape/scroll-lock/focus machinery, or page-local modal markup (below). Density: dialog body must not wrap a UUI select in the legacy input boundary (`operational-density.styles.test.ts`).
- **Chrome corners** — white header and footer inherit their corresponding shell corner radii, and every house shell, including the polished variant, clips child paint to its rounded boundary (`Modal.css`, QA-AUDIT-UI-19/51). Picker menus use portals so they can extend beyond the panel without breaking its corners.
- **Loading focus** — a dialog with no enabled controls focuses its temporary non-tabbable container. Tab/reverse Tab stay inside until controls enable, then enter the enabled children. The shared `useFocusTrap` owns this behavior; no page-specific loading trap (QA-AUDIT-UI-69).
- **Divergence** — the remaining ad-hoc modals below still re-implement surfaces; `features/ops/OpsModalBackdrop` is now a thin bare-mode adapter (skin only — its css owns `.ops-modal*`, no backdrop), and both dispatch hand-rolled portals were migrated (allocation popover rides bare Modal; tag manager rides the popover idiom).
- **Enforced by** — `frontend/src/design-system/Modal.test.tsx` (THE overlay suite: Escape, focus return, scroll lock incl. nesting, backdrop dismiss + opt-out, picker deference, adapter cases), `dialog-density-contract.styles.test.ts` (frozen-wrapper allowlist), `overlay-surface.styles.test.ts` (incl. TSX overlays and elevation-shadow ban), `features/ops/ops-modal.styles.test.ts` (no parallel backdrop).
- **Gap** — the mobile bottom-sheet shape lives only in `Modal.css`; `.confirm-box` and the remaining ad-hoc modals re-implement it.
### ConfirmDialog
- **Use** — `.confirm-overlay` / `.confirm-box` at `frontend/src/components/ConfirmDialog.css:6,19` (`--z-confirm`, max-width 400px, 44px icon tile); consumed via `useConfirm` (34 files) or direct import (7 files).
- **Never** — `window.confirm`; bespoke danger dialogs.
- **Divergence** — 0 duplicates found.
- **Enforced by** — `overlay-surface.styles.test.ts` (raw-white ban covers `--z-confirm` layers).
- **Gap** — none significant.
### Popover / Picker
- **Use** — `--z-popover:400`, `--z-nested-popover:410`, `--z-picker-modal:420` (`frontend/src/styles/tokens.css:390`); shared forms: `frontend/src/design-system/forms/DateRangePopover.css`, `SearchableSelect.css`, `TimePickerSurface.css`.
- **Never** — ad-hoc absolute-positioned panels with a hard-coded `z-index`; `frontend/src/design-system/forms/*` already own the picker surfaces.
- **Divergence** — ad-hoc popovers exist (below).
- **Enforced by** — `overlay-surface.styles.test.ts` z-layer scan.
- **Gap** — no shared `Popover` positioning primitive exposed from the design-system barrel beyond the form widgets.
### Ad-hoc overlays — census verdicts (card 20261001_251, 2026-10-01)
The 227 census listed ~10 ad-hoc surfaces. Per-surface review resolved every entry — most were already riding shared surfaces:
- `frontend/src/features/ops/ops-modal.css` — REDUCED to the ops SKIN (card 20260930_227); dialogs mount through the `OpsModalBackdrop` bare-mode adapter.
- `frontend/src/features/dispatch/master-plan/DispatchAllocationPopover.css` — MIGRATED (card 20260930_227): panel rides the bare design-system Modal; surface skin only.
- `.cus-appointment-popover` (ShipmentsPage.css / CusAppointmentPopover) — MIGRATED (card 20261001_251): the private transparent backdrop div is gone; the shared stack (usePopoverPosition + useClickOutside + useFocusTrap) owns dismissal, the tag-manager/DatePickerSurface idiom.
- `frontend/src/components/PhotoViewer.tsx` — MIGRATED (card 20261001_251): the lightbox rides the bare design-system Modal (portal/scrim/Escape/scroll-lock/focus/registration module-owned); the zoom/pan surface and keys stay local.
- DispatchContainerDetailDrawer's `returnFocusTarget` plumbing — RESOLVED (card 20261001_251): redundant second focus-return implementation deleted; the house Drawer's useAnimatedOverlay owns it.
- FALSE POSITIVES (never were ad-hoc systems): `.cus-quick-edit-modal*` and `.fuel-invoice-modal__footer` are content classes INSIDE house `Modal`s; `.debit-editor-preview__sheet` is a static paper preview (not an overlay); `.csc-customer-popover` is a skin class on the shared SearchableSelect popover; `.ops-settlement-sheet__*` rides `OpsModalBackdrop` since card 20260930_227; `ForwarderTripDateRangePicker` no longer exists.
- DELIBERATE EXCEPTIONS: `AuditLogPage`'s detail sheet uses the NATIVE `<dialog>` element (`d-modal-end`, `::backdrop`) — the browser owns Escape, focus containment and top-layer stacking, so there is no hand-rolled mechanics to migrate; a redesign into `.modal`/`.drawer` chrome would be a visual decision, not an architecture one. `CustomerPortalLayout`'s `__backdrop` is the sanctioned navigation scrim (the `.sidebar-overlay` pattern) and its account popover rides the global dismissal layer.
- Audit continuation (QA-AUDIT-UI-67/68/70): `BillingDocumentBuilder` and the five tire dialogs now use the existing bare Modal mechanics; their inner content skins remain local while the shared primitive owns focus, scroll and dismissal. The driver photo-action menu uses ordinary Modal chrome and a contextual zone title. The tire PositionPicker owns its nested Escape before the parent. The pinned Untitled UI v8 `modal` catalog reference was consulted; these adapters deliberately reuse the existing house primitive rather than install another one. Source migration alone is not native acceptance; current click-through evidence belongs in the audit coverage report.

---
## Chrome budgets & touch floors
### Chrome budget (vertical space the header+filter block steals)
- **Use** — the `maxTop` design-lock kind: the first record must start no lower than N px. Reference locks in `frontend/design-lock/expectations/dispatch.mjs`: dispatch-detail `275` at 390/500px, `230` at 768px, `215` at 1440px; master-plan `260` at 390/500/1440px, `215` at 768px. `frontend/design-lock/README.md` defines `maxTop` and the probe workflow.
- **Never** — the rejected ~440px stacked-dropdown header at 390–500px (`dispatch.mjs` chrome-budget note).
- **Divergence** — only the two dispatch pages carry `maxTop` locks; every other page's header height is unpinned.
- **Enforced by** — `frontend/design-lock/expectations/dispatch.mjs` (8 `maxTop` locks), run via `pnpm design:lock`; `frontend/role-ui-sweep.mjs:95` records `chromeH` but does not gate.
- **Gap** — no budget number documented in the guidelines for phone/tablet/desktop generally, and no lock on `/shipments`, `/config`, or any non-dispatch page.
### Control ceiling and touch sizing
- **Use** — `--control-max-h:40px`; `--control-touch-h`, `--control-mobile-h` and `--control-h` inherit that ceiling. The operator's accepted40px ceiling applies to ordinary single-line controls on every screen and pointer, superseding the old44px touch rule. Approved compact fields retain their30px token; quotation coefficients use the accepted72×30px field.
- **Never** — enlarge ordinary controls beyond40px to satisfy the retired44px rule, or give a page its own control-shape/height override. Multiline content and composite record containers have separate content budgets.
- **Enforced by** — `ordinary-control-ceiling.styles.test.ts`, the shared control geometry contract, `mobile-touch-floor.styles.test.ts` token consumers, design-lock `tapFloor` (default40) and the role sweep. Native computed geometry and original pixels remain required; source declarations alone cannot prove which rule won.
- **Gap** — design-lock touch-floor cases cover selected routes. The all-route390/768/1440 sweep and per-control evidence are required for the wider audit claim; physical Safari remains separate from Chrome touch emulation.
### Device bands
- **Use** — the documented set in `frontend/src/styles/responsive.css:4-17`: `≤1500` operational canvas, `≤1023` tablet, `≤640` phone, `≤420` narrow phone. Desktop reference width is `1440` (`--content-max-w`), design-lock widths are 390 / 500 / 768 / 1024 / 1440 (`design-lock/expectations/config.mjs` `WIDTHS`, `dispatch.mjs`).
- **Never** — a new page-local breakpoint; §5 density law assumes these four bands.
- **Divergence** — `@media` uses 48 real widths (above); the dominant page-invented ones are 767/768 (27 lines), 900 (14), 1100 (20), plus 820/960/1200. `@container` uses 26 widths with **no** documented band set.
- **Enforced by** — none. No test or script rejects a non-canonical width; `check-ui-contract.mjs` reads the 640/820 blocks by literal index.
- **Gap** — the band set exists as a comment, not a checkable contract.

---
## Empty / error page states
### Empty state
- **Use** — `.ds-empty-state` primitive (`frontend/src/design-system/EmptyState.css:1`, illustration 96×80, description max `min(100%,420px)`); art must route through the shared resolver (§6, card 20260922_40).
- **Never** — page-local `empty-*.svg` art; the retired shared `.empty-state` class must stay dead.
- **Divergence** — bespoke empty blocks remain: `.penalty-empty-state*` (`frontend/src/pages/DriverPenaltyPage.css:249`), `.mobile-empty-state` (`frontend/src/pages/trip-list/table-extras.css:22`), and 9 `DashboardPage.css` selector overrides of `.ds-empty-state__*` (lines 465–634).
- **Enforced by** — `frontend/src/design-system/empty-state.styles.test.ts` (retired chrome dead, reduced-motion guard, no import path to deleted shared EmptyState).
- **Gap** — no test forbids a new page-local empty block; §6's "three variants render the same everywhere" is unasserted.
### Error state
- **Use** — page-level inline error blocks (e.g. `.dispatch-plan-page__error` at `frontend/src/pages/DispatchPlanPage.css:56` with `role="alert"`), plus the global `ErrorBoundary` (`frontend/src/components/shared/ErrorBoundary.tsx`).
- **Never** — silent failure; errors surface as an inline `role="alert"` block with a retry action.
- **Divergence** — each page types its own `__error` class (grep: `.dispatch-plan-page__error`, `.driver-journey__error`, `.salary-attendance__error-text`, `.cus-appointment-popover__error`, `.fadv-form-panel__error`, `.cus-container-row__error`) with no shared primitive.
- **Enforced by** — none.
- **Gap** — no shared page-error primitive; the visual language (border `--danger`, `--danger-bg`) is re-typed per page.

---
## System gaps
- **No page-frame primitive.** The shell cap, gutter and sticky offset are re-typed by 5 opt-out selectors and 6 self-capping pages; the worst offender is `frontend/src/pages/ShipmentsPage.css:965` (a hand-written `.app-main:not(.driver-mode) .app-body > .shipments-page` copy of the shell selector).
- **No `TwoTierHeader` / `FilterBar` primitive.** 3 hand-built two-tier headers and ≥10 bespoke filter hosts; worst offender `frontend/src/features/dispatch/catalogs/catalogs.css:372`.
- **No container-query band contract.** 26 undocumented `@container` widths; worst offender `frontend/src/pages/DashboardPage.css` (980/1000/1060/1100/1180 with no written rule).
- **No page-empty / page-error primitive.** Every page re-types its empty/error block; worst offender `frontend/src/pages/DriverPenaltyPage.css:249` (`.penalty-empty-state`).
## Enforcement gaps
- **Page width caps are unenforced.** Nothing stops a page bypassing or shadowing `--content-max-w`; worst offender `frontend/src/pages/ShipmentsPage.css:965`.
- **Breakpoint coherence is unchecked.** 48 `@media` + 26 `@container` widths with only 4 documented bands; `check-ui-contract.mjs` hard-codes 640/820 by index (`frontend/scripts/check-ui-contract.mjs:90,122`); worst offender `frontend/src/pages/config/config-page.css` (15 media rules spanning 10 widths).
- **Chrome budget is lock-backed only for dispatch.** 8 `maxTop` locks cover 2 routes; `/shipments`, `/config`, `/trip-list` have none; worst offender `frontend/src/pages/trip-list/responsive.css` (5 widths, no budget).
- **Touch floor is lock-backed only for dispatch + shipments-detail.** No route-wide sweep gates merge; worst offender `frontend/src/components/layout/sidebar-overlay.css:18` (36px close control until ≤1023px).
- **Ad-hoc overlays are unenforced.** `.ops-modal*` runs as a parallel system across 12 files with no test forcing convergence; worst offender `frontend/src/features/ops/ops-modal.css:4`.
- **Tab markup convergence is unchecked.** 3 independent tab implementations vs the shared `Tabs` primitive; worst offender `frontend/src/features/shipment-finance/ShipmentFinancePanel.css:5`.

### Nested Escape ownership (2026-10-01, QA-AUDIT-UI-49)

`useClickOutside` owns document Escape for its open menu/filter consumers, using
`isTopOverlayToken` from the existing shared overlay stack. The token lifetime
is the layer's enabled/escape lifetime; ref/callback listener rebindings never
move a still-open parent above its child. This handles BODY focus after a clear
button disables without forcing focus or adding a second overlay mechanism.
The child's existing close callback restores focus to its trigger in the still
open parent; another Escape closes that parent. Pointer outside/path and
ignore-selector semantics are unchanged. Real shared FilterDropdown +
SearchableMultiSelect regression and DetailedPlanFilters cover sequential
Escape ownership, exact clear value and focus return.

The shared native Escape handler consumes the event before its close callback.
Later document listeners respect `defaultPrevented`: browser microtasks can
commit child cleanup between listeners, so topmost token checks alone cannot
prevent the same key from closing the next layer.
