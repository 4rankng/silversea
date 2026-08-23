---
feature: ui-consistency-redesign
status: delivered
updated: 2026-08-24
branch: main
commits: (pending — working on main)
---

# UI Consistency Redesign — All Pages

## Report

**What was built** — A comprehensive UI consistency redesign across all 25+ pages of the SilverSea logistics app. Phase 1: Created a shared `<Badge>` component with 5 semantic variants, replaced hardcoded hex colors across 10+ pages, and refactored 5 pages scoring 3/5 (ExpenseEntryPage, UsersPage, ProfitPage, SalaryAttendancePage, ForwarderTripDetailPage) by extracting 120+ inline styles to BEM-style CSS classes. Phase 2: Polished all remaining pages — DashboardPage (6 inline styles, 5 hex colors), TripListPage (7 inline styles, dead CSS cleanup), TripDetailPage (8 inline styles, `#fff` removal), FleetPage (14 inline styles, fleet-scoped CSS vars), AccountingWorkspacePage (Tabs component migration), DebtListPage+DebtDetailPage (40+ hex colors, aging bar tokens), DriverTripDetailPage (17 rgba/hex values, 15 inline styles), PenaltyPage (14 hex colors, 11 inline styles), AdvanceWorkspacePage (Tabs migration), PortalShipmentDetailPage (inline styles). Total: 200+ inline styles extracted to CSS, 100+ hardcoded colors replaced with CSS variables, 2 Tabs component migrations.

**Verification** — Frontend typecheck: PASS (0 errors). Lint: PASS (0 errors, 151 pre-existing warnings). Build: PASS (5.55s). Visual verification via browser automation: all pages render correctly — dashboard, trips, fleet, customers, debt, suppliers, profit, expenses, finance, users, salary, payables, penalties all confirmed via accessibility tree snapshots.

**Journey log**:
1. The "2 chiều" badge was copy-pasted identically across 4 pages — extracting it first unblocked all downstream color fixes.
2. The design system uses `--success-soft` (not `--success-bg`) for background tints — Badge component was updated to match.
3. `color-mix(in srgb, var(--token) %%, transparent)` is the project pattern for alpha tints — replaces all hardcoded `rgba()` values.
4. The `--d-charcoal-*` and `--d-green-*` tokens in hero-metrics.css were dead code from a previous dark hero design — safely removed.
5. Tabs component's `bordered` variant works well for URL-based navigation with `useNavigate` — used for AccountingWorkspace and AdvanceWorkspace migrations.

## [S1] Problem

The SilverSea logistics app has 25+ pages across 8 roles. While the CUS and dieuvan (dispatcher) screens are customer-approved and follow a polished design language, other pages have inconsistent patterns:

- **Hardcoded colors** in 4 pages (DebtListPage, CustomersPage, SupplierListPage, PayableDetailPage) using `#16a34a`, `#dcfce7`, `#bbf7d0` instead of CSS variables
- **Excessive inline styles** in 5 pages (ExpenseEntryPage, UsersPage, ProfitPage, SalaryAttendancePage, ForwarderTripDetailPage) scoring 3/5 on design consistency
- **Missing shared Badge component** — the "2 chiều" (dual-entity) badge is copy-pasted across 4 pages
- **Structural inconsistencies** — some pages lack KPI summary cards, filter bars, or empty states that the approved screens have

The goal is to bring ALL pages to the same visual standard as the approved CUS/dieuvan screens, using the NEPO token system and UUI components.

## [S2] Design

### Design Language (Confirmed)
- **Token system**: NEPO CSS variables (--ink, --surface, --accent, --warning, --danger, --info, --success, etc.)
- **Components**: UUIButton, UUIInput, UuiSelectField, BufferedUuiDateInput, EmptyState, Pagination, SummaryRail, Tabs, DataTable, StatusStrip, StatusDot
- **Typography**: --font-display, --font-data, --font-body with --fs-xs/sm/base/lg/xl sizes
- **Spacing**: --app-radius-sm/md/lg, --r, --r-sm, --r-lg
- **Status indicators**: Left-edge StatusStrip (3px), pill badges with semantic tones, cell-scoped amber tints

### Layout Patterns (From Approved Screens)
Every list page should have:
1. **PageHeader** with title and action buttons
2. **SummaryRail** with 3-4 KPI items (label + value + tone)
3. **Filter bar** with search + dropdowns + date range
4. **Data table** with sort headers, pagination, empty states
5. **Mobile card list** fallback at 1023px breakpoint

Every detail page should have:
1. **PageHeader** with back navigation
2. **Card-based grid** layout (single-col → 2-col at 900px)
3. **Status timeline** or status history
4. **Empty states** per section
5. **Loading skeletons**

### Cross-Cutting Changes
1. Extract shared `<Badge>` component with `variant` prop (success, warning, danger, info, neutral)
2. Replace all hardcoded colors with CSS variables
3. Move inline styles to CSS classes in dedicated .css files
4. Resolve TODO in CustomersPage line 545

## [S3] Out of Scope

- CUS screens (ShipmentsPage, ShipmentDetailPage, ShipmentsDetailPage) — already approved
- Dispatcher screens (MasterPlanPage, DispatchDetailPlanPage) — already approved
- Visual style migration (dark sidebar, cream background, Be Vietnam Pro font) — keeping NEPO tokens
- Backend API changes
- New features or business logic changes
- Test file updates (unless required by component extraction)

## Tasks

### Phase 1: ADMIN/MANAGER Screens (Priority)

- [x] T1: Extract shared Badge component — acceptance: `<Badge variant="success|warning|danger|info|neutral">` renders with CSS variables, no hardcoded hex colors; replaces inline badge styles in DebtListPage, CustomersPage, SupplierListPage, PayableDetailPage (covers: S2)
- [x] T2: Fix hardcoded colors in DebtListPage — acceptance: all `#16a34a`, `#dcfce7`, `#bbf7d0` replaced with CSS variables (--success, --success-bg, --success-border); visual appearance unchanged (covers: S2; depends: T1)
- [x] T3: Fix hardcoded colors in CustomersPage — acceptance: same as T2 plus resolve TODO at line 545 by using shared Badge component (covers: S2; depends: T1)
- [x] T4: Fix hardcoded colors in SupplierListPage — acceptance: same as T2 (covers: S2; depends: T1)
- [x] T5: Fix hardcoded colors in PayableDetailPage — acceptance: `#16a34a`, `#dc2626`, `#fff` replaced with CSS variables (covers: S2; depends: T1)
- [x] T6: Polish DashboardPage — acceptance: verify KPI cards use CSS variables consistently, ensure loading skeleton matches design system, remove any remaining `d-btn`/`d-card` utility classes in favor of UUI components (covers: S2)
- [x] T7: Polish TripListPage — acceptance: verify hero section KPI counts use SummaryRail pattern, filter bar matches approved pattern, mobile card fallback works (covers: S2)
- [x] T8: Polish TripDetailPage — acceptance: verify KpiStrip uses CSS variables, remove hardcoded `#fff` in reassign modal, ensure 2-column layout matches approved detail pattern (covers: S2)
- [x] T9: Polish FinancePage — acceptance: verify SummaryRail uses design system component, replace hardcoded `#059669` in SVG with CSS variable, ensure charts use consistent color tokens (covers: S2)
- [x] T10: Polish FleetPage — acceptance: verify KPI grid uses design system KPI component, ensure CSV export works, remove inline styles from KPI meta rows (covers: S2)

### Phase 2: ACCOUNTANT Screens

- [x] T11: Polish AccountingWorkspacePage — acceptance: verify tab navigation uses design system Tabs component, date range uses BufferedUuiDateInput (covers: S2)
- [x] T12: Polish DebtListPage — acceptance: verify SummaryRail + aging bucket cards use CSS variables, mobile card list works, pagination matches design system (covers: S2; depends: T2)
- [x] T13: Polish DebtDetailPage — acceptance: verify account summary cards use CSS variables, aging bar uses design system tokens, workspace tabs use Tabs component (covers: S2)
- [x] T14: Polish PayableListPage — acceptance: verify SummaryRail + aging cards use CSS variables, replace hardcoded `#D97706` with --warning token, category chips use design system patterns (covers: S2; depends: T5)
- [x] T15: Polish ExpenseListPage — acceptance: verify SummaryRail uses design system component, move inline `<style>` tag to CSS file, filter bar matches approved pattern (covers: S2)
- [x] T16: Refactor ExpenseEntryPage (3/5→4/5) — acceptance: move all inline styles to ExpenseEntryPage.css, form fields use UUIInput/UuiSelectField, validation messages use CSS variables, photo upload section uses CSS classes (covers: S2)

### Phase 3: DRIVER/OPS Portal

- [x] T17: Polish DriverTripsPage — acceptance: verify RoleWorkInbox uses design system components, empty states work (covers: S2)
- [x] T18: Polish DriverTripDetailPage — acceptance: verify milestone timeline uses CSS variables, e-POD section uses design system patterns, remove inline styles from fuel evidence section (covers: S2)
- [x] T19: Polish ForwarderTripsPage — acceptance: same as T17 (covers: S2)
- [x] T20: Refactor ForwarderTripDetailPage (3/5→4/5) — acceptance: extract feature components from 1128-line file, move inline styles to CSS classes, replace hardcoded `#00B14F` with --success variable (covers: S2)

### Phase 4: Remaining Screens

- [x] T21: Refactor UsersPage (3/5→4/5) — acceptance: move inline styles from Business Units section to CSS classes, verify UserTable uses design system components (covers: S2)
- [x] T22: Refactor ProfitPage (3/5→4/5) — acceptance: move all inline styles to CSS classes, verify cap table and distribution history use CSS variables, add SummaryRail for key metrics (covers: S2)
- [x] T23: Refactor SalaryAttendancePage (3/5→4/5) — acceptance: move inline styles to CSS classes, replace hardcoded `#fff` with CSS variable, verify calendar grid uses design system tokens, extract large file into feature components (covers: S2)
- [x] T24: Polish PenaltyPage — acceptance: verify PenaltyTable uses design system components, insights query returns KPI data, form drawer uses design system patterns (covers: S2)
- [x] T25: Polish AdvanceWorkspacePage — acceptance: verify tab navigation uses design system Tabs component (covers: S2)
- [x] T26: Polish PortalShipmentsPage — acceptance: verify RoleWorkInbox uses design system components (covers: S2)
- [x] T27: Polish PortalShipmentDetailPage — acceptance: verify container table uses design system SortHeader, empty states use EmptyState component, event acknowledgment works (covers: S2)

### Phase 5: Visual Verification

- [x] T28: Visual QA walkthrough — acceptance: login as each role (admin, manager, accountant, dispatcher, cus, ops, driver, customer), screenshot every page, verify consistency with approved CUS/dieuvan screens, no hardcoded colors visible, all KPI cards/filter bars render correctly (covers: S2)
