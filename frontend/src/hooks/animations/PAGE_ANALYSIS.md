# Page Animation Integration Points

> Generated: 2026-06-13  
> Purpose: Identify animation targets for each page to plan anime.js integration.

## Legend

- **Has KPIs**: Page renders `<KPI>` components or custom KPI-like number displays (counter animation candidates)
- **Has List/Table**: Page renders data tables, card lists, or grid rows (staggered entrance candidates)
- **Has Modal/Drawer**: Page uses `<Modal>` or `<Drawer>` components (spring entrance/exit candidates)
- **Existing Anim**: Already uses animation hooks (skip for new integration)
- **Priority**: H = many visual elements, M = moderate, L = simple/static

---

## Summary Table

| Page | Root Selector | Has KPIs | Has List/Table | Has Modal/Drawer | Existing Anim | Priority |
|------|--------------|----------|----------------|------------------|--------------|----------|
| **DashboardPage** | `.dash-wf` | ✅ 4 KPIs + counter refs | ✅ bento grid, chart, lists | ❌ | ✅ `useDashboardAnimations` | — (reference) |
| **FinancePage** | `.fade-up-1` (wrapper) | ✅ 4 pnl-kpi strip | ✅ P&L table, chart, truck cards | ❌ | ❌ | **H** |
| **TripListPage** | `.trip-list-page.fade-up` | ✅ 6 metrics (custom) | ✅ full table + mobile cards | ❌ | ❌ | **H** |
| **DispatchPage** | `.dispatch-page.fade-up-1` | ✅ 5 metrics (custom) | ✅ fleet grid + orders table | ❌ | ❌ | **H** |
| **FleetPage** | `.fleet-page.fade-up` | ✅ 4 KPIs | ✅ 3 sub-tables (trucks/trailers/drivers) | ✅ 4 Modals (Truck/Driver/Trailer form + detail) | ❌ | **H** |
| **AuditLogPage** | `.audit-log-page.fade-up` | ✅ 4 KPIs | ✅ audit event list | ✅ 1 Drawer (detail) | ❌ | **H** |
| **DebtListPage** | `.debt-list-page.fade-up` | ✅ 4 aging buckets | ✅ table + mobile cards | ❌ | ❌ | **H** |
| **CustomersPage** | `.customers-page.fade-up` | ✅ 4 KPIs | ✅ table + mobile cards | ✅ 1 Modal (form) | ❌ | **M** |
| **ExpenseListPage** | `.expense-list-page.fade-up` | ✅ 3 custom KPI cards | ✅ table + mobile cards | ❌ | ❌ | **M** |
| **PayableListPage** | `.fade-up` (wrapper) | ✅ 5 summary-bar items | ✅ table + mobile cards | ❌ | ❌ | **M** |
| **ProfitPage** | `.fade-up` (wrapper) | ✅ hero value + history list | ✅ distribution history list | ❌ | ❌ | **M** |
| **DebtDetailPage** | `.debt-detail-page` | ❌ summary card | ✅ 2 tables (accounts + ledger) | ✅ 1 Modal (payment) | ❌ | **M** |
| **ForwarderSettlementsPage** | `.fset-page` | ✅ 3 KPIs | ✅ card list | ❌ | ❌ | **M** |
| **ForwarderAdvancesPage** | `.fadv-page` | ❌ | ✅ card list (advance requests) | ❌ | ❌ | **M** |
| **SalaryAttendancePage** | `.salary-page-layout__main` | ❌ summary dark card | ✅ calendar grid + mobile day list | ❌ | ❌ | **M** |
| **DriverEarningsPage** | `.kpi-grid.fade-up-2` | ✅ 3 KPIs | ✅ penalty table | ❌ | ❌ | **M** |
| **PenaltyPage** | `.penalty-page.fade-up` | ❌ | ✅ penalty card list + table | ❌ | ❌ | **M** |
| **DriverPenaltyPage** | `.fade-up` (wrapper) | ✅ 3 KPIs | ❌ | ❌ | ❌ | **L** |
| **TripDetailPage** | `.fade-up` (wrapper) | ❌ | ❌ info rows, legs panel | ✅ 1 Modal + 1 Drawer | ❌ | **M** |
| **TripCreatePage** | `.fade-up` (wrapper) | ❌ | ❌ form only | ❌ | ❌ | **L** |
| **TripEditPage** | `.fade-up` (wrapper) | ❌ | ❌ form only | ❌ | ❌ | **L** |
| **ForwarderTripsPage** | (no root page class) | ❌ | ✅ trip card list | ❌ | ❌ | **L** |
| **ForwarderTripDetailPage** | (no root page class) | ❌ | ❌ info rows + panels | ❌ | ❌ | **L** |
| **DriverTripsPage** | (no root page class) | ❌ | ✅ trip card list | ❌ | ❌ | **L** |
| **DriverTripDetailPage** | (no root page class) | ❌ | ❌ info rows + legs | ❌ | ❌ | **L** |
| **PayableDetailPage** | (no root page class) | ❌ summary card | ✅ ledger table | ✅ 1 Modal (payment) | ❌ | **M** |
| **ExpenseEntryPage** | `.expense-page-wrap.fade-up` | ❌ | ❌ form only | ❌ | ❌ | **L** |
| **AdminAdvancesPage** | `.adv-page.fade-up` | ✅ 3 custom adv-kpi | ✅ grid rows + mobile cards | ❌ | ❌ | **M** |
| **ForwarderSettlementCreatePage** | `.fset-page` | ❌ | ✅ check-list items | ❌ | ❌ | **L** |
| **SettlementPrintPage** | `.fade-up` (wrapper) | ❌ summary cards | ❌ print layout | ❌ | ❌ | **L** |
| **ConfigPage** | `.fade-up` (wrapper) | ❌ | ✅ config section cards | ❌ | ❌ | **L** |
| **UsersPage** | `.users-admin-page.fade-up` | ❌ | ✅ user cards | ❌ | ❌ | **L** |
| **SupplierListPage** | `.suppliers-page.fade-up` | ✅ 2 KPIs | ✅ table + mobile cards | ✅ 1 Modal (form) | ❌ | **M** |
| **LoginPage** | `.login-page` | ❌ | ❌ | ❌ | ❌ | **L** |

---

## Config Sub-Pages (under `pages/config/`)

| Config Page | Root Selector | Has KPIs | Has List/Table | Has Modal | Priority |
|-------------|--------------|----------|----------------|-----------|----------|
| **CustomersConfigPage** | `.cfg-page--customers.fade-up` | ✅ 4 KPIs | ✅ table | ✅ 2 Modals | M |
| **RoutesConfigPage** | `.cfg-page--routes.fade-up` | ✅ 4 KPIs | ✅ table + sub-row grid | ✅ 1 Modal | M |
| **PenaltyReasonsConfigPage** | `.penalty-reasons-page` | ✅ 4 KPIs | ✅ card grid | ✅ 2 Modals | M |
| **FuelConfigPage** | `.cfg-page--fuel.fade-up` | ❌ | ✅ history table | ❌ | L |
| **PortsConfigPage** | `.cfg-page--ports.fade-up` | ❌ | ✅ list panel | ✅ 1 Modal | L |
| **ContainerTypesConfigPage** | `.cfg-page--container-types.fade-up` | ❌ | ✅ list panel | ✅ 1 Modal | L |
| **TripExpenseConfigPage** | `.cfg-page--trip-expense.fade-up` | ❌ | ❌ form only | ❌ | L |
| **SalaryPeriodConfigPage** | `.sp-wrap.fade-up` | ❌ | ❌ form only | ❌ | L |
| **CapTableConfigPage** | (no page class) | ❌ | ✅ table | ❌ | L |
| **PricingTablesConfigPage** | (no page class) | ❌ | ✅ table | ❌ | L |
| **ManagementFeesConfigPage** | (no page class) | ❌ | ✅ table | ❌ | L |
| **RoadAllowancesConfigPage** | (no page class) | ❌ | ✅ table | ❌ | L |
| **TrucksConfigPage** | (no page class) | ❌ | ✅ table | ❌ | L |
| **TrailersConfigPage** | (no page class) | ❌ | ✅ table | ❌ | L |
| **CargoTypesConfigPage** | (no page class) | ❌ | ✅ table | ❌ | L |
| **ForwarderExpenseTypesConfigPage** | (no page class) | ❌ | ✅ table | ❌ | L |
| **ExpenseCategoriesConfigPage** | (no page class) | ❌ | ✅ table | ❌ | L |

---

## Key Findings

### Pages Already Using CSS `fade-up` Classes (no anime.js yet)
These pages use CSS-only entrance (`utilities.css` `.fade-up` / `.fade-up-N` classes). They are low-hanging fruit for upgrading to anime.js-driven entrance:

- FinancePage, TripListPage, DispatchPage, FleetPage, AuditLogPage
- DebtListPage, CustomersPage, ExpenseListPage, PayableListPage
- ProfitPage, PenaltyPage, DriverPenaltyPage, DriverEarningsPage
- TripDetailPage, TripCreatePage, TripEditPage, ConfigPage, UsersPage
- AdminAdvancesPage, SettlementPrintPage, ExpenseEntryPage

### Pages with Counter-Animatable KPIs (need `useCounterAnimation`)
These have number displays that would benefit from count-up:

1. **DashboardPage** — already has counter animation via `useDashboardAnimations`
2. **FinancePage** — 4 pnl-kpi values (revenue, gross profit, margin %, net profit)
3. **TripListPage** — 6 metric values (trips, KM, fuel, road allowance, value)
4. **DispatchPage** — 5 metric values (utilization %, fleet counts)
5. **FleetPage** — 4 KPI values
6. **AuditLogPage** — 4 KPI values
7. **DebtListPage** — 4 aging bucket amounts
8. **CustomersPage** — 4 KPI values
9. **ExpenseListPage** — 3 custom KPI values
10. **PayableListPage** — 5 summary-bar amounts
11. **ForwarderSettlementsPage** — 3 KPI values
12. **DriverEarningsPage** — 3 KPI values
13. **DriverPenaltyPage** — 3 KPI values
14. **AdminAdvancesPage** — 3 custom KPI values
15. **SupplierListPage** — 2 KPI values
16. Config: CustomersConfigPage (4), RoutesConfigPage (4), PenaltyReasonsConfigPage (4)

### Pages with Staggered-List Candidates (need `useStaggeredChildren` or `useListAnimations`)
These render repeated cards/rows/table rows:

- **FleetPage** — 3 sub-tables, each with 10-50 rows
- **TripListPage** — full paginated table + mobile cards
- **DispatchPage** — fleet grid + orders table
- **AuditLogPage** — audit event list (paginated)
- **DebtListPage** — customer table + mobile cards
- **CustomersPage** — table + mobile cards
- **ExpenseListPage** — table + mobile cards
- **PayableListPage** — table + mobile cards
- **ForwarderSettlementsPage** — card list
- **ForwarderAdvancesPage** — card list
- **AdminAdvancesPage** — grid rows + mobile cards
- **DriverTripsPage** — trip card list
- **ForwarderTripsPage** — trip card list
- **PenaltyPage** — penalty card list

### Pages with Modal/Drawer Spring Candidates (need `useModalAnimations`)
These use `<Modal>` or `<Drawer>` from UI.tsx:

- **FleetPage** — 4 Modals (truck form, driver form, trailer form, detail view)
- **AuditLogPage** — 1 Drawer (detail)
- **TripDetailPage** — 1 Modal (reassign) + 1 Drawer (adjustment)
- **DebtDetailPage** — 1 Modal (payment)
- **PayableDetailPage** — 1 Modal (payment)
- **CustomersPage** — 1 Modal (customer form)
- **SupplierListPage** — 1 Modal (supplier form)
- Config pages: CustomersConfigPage (2), RoutesConfigPage (1), PenaltyReasonsConfigPage (2), PortsConfigPage (1), ContainerTypesConfigPage (1)

### Pages Missing Root Selector
These pages lack a BEM-style root class for animation targeting. They need a wrapper div added before animation hooks can target them:

- ForwarderTripsPage, ForwarderTripDetailPage
- DriverTripsPage, DriverTripDetailPage
- PayableDetailPage
- Several config sub-pages (CapTable, PricingTables, ManagementFees, RoadAllowances, Trucks, Trailers, CargoTypes, ForwarderExpenseTypes, ExpenseCategories)

---

## Recommended Animation Integration Order

### Phase 1: High-Priority Pages (H) — Maximum Visual Impact
1. **FinancePage** — KPI counters + P&L table stagger + chart entrance
2. **TripListPage** — Metric counters + table row stagger + mobile card stagger
3. **DispatchPage** — Metric counters + fleet grid stagger + orders entrance
4. **FleetPage** — KPI counters + sub-table stagger + modal springs
5. **AuditLogPage** — KPI counters + event list stagger + drawer spring
6. **DebtListPage** — Bucket counters + table stagger + mobile card stagger

### Phase 2: Medium-Priority Pages (M)
7. **CustomersPage** — KPI counters + table stagger + modal spring
8. **ExpenseListPage** — Custom KPI counters + table stagger
9. **PayableListPage** — Summary counters + table stagger
10. **ProfitPage** — Hero counter + history list stagger
11. **DebtDetailPage** — Summary animation + table stagger + modal spring
12. **ForwarderSettlementsPage** — KPI counters + card list stagger
13. **ForwarderAdvancesPage** — Card list stagger
14. **SalaryAttendancePage** — Calendar grid entrance + summary animation
15. **DriverEarningsPage** — KPI counters + penalty table stagger
16. **PenaltyPage** — Card list stagger
17. **TripDetailPage** — Info rows stagger + modal/drawer springs
18. **AdminAdvancesPage** — Custom KPI counters + grid stagger
19. **SupplierListPage** — KPI counters + table stagger + modal spring
20. **PayableDetailPage** — Ledger table stagger + modal spring

### Phase 3: Config & Low-Priority Pages (L)
21. Config pages with KPIs (CustomersConfig, RoutesConfig, PenaltyReasonsConfig)
22. Simple list config pages (stagger only)
23. Form-only pages (minimal animation — just page entrance)
24. LoginPage (already has `login-card fade-up`, could get spring entrance)
