# Product-wide route, role, navigation, and function inventory

Date: 2026-07-26  
Scope: current local checkout at `/Users/dev/Documents/projects/silversea`  
Purpose: deterministic functional and visual browser QA coverage map (read-only inventory)

> Baseline note: this inventory captured the pre-fix router state. The UltraQA
> fix loop subsequently corrected CUSTOMER/CLERK landing and office-route
> admission, added dedicated customer navigation, and removed CLERK-only
> notification/API mismatches. Final observed behavior and remaining defects
> are authoritative in `reports/visual-functional-results.md`.

## Authority and important interpretation

- Runtime frontend routing and redirects are owned by `AppRoutes` in `frontend/src/App.tsx:101-260`.
- Paths/titles are projected from `shared/src/navigation/pageCatalog.ts` through `frontend/src/lib/routes.ts`; those files explicitly say they are **not RBAC authorities** (`shared/src/navigation/pageCatalog.ts:14-20`, `frontend/src/lib/routes.ts:17-20`).
- Visible navigation is independently hand-authored by `getNavItems()` in `frontend/src/components/Layout.tsx:50-109`.
- Backend API authority is Casbin (`backend/src/casbin/policy.csv`) plus route-specific role checks. A page being admitted by React Router does not prove its API calls will succeed.
- The shared enum has **seven** roles: ADMIN, MANAGER, ACCOUNTANT, DRIVER, FORWARDER, CUSTOMER, CLERK (`shared/src/constants/index.ts:111-125`), with Vietnamese labels at `shared/src/constants/index.ts:240-248`.

### Critical current-state mismatches to test, not silently normalize

1. `adminOnly` is a misleading name. Its predicate only rejects DRIVER, FORWARDER, and CUSTOMER; therefore it currently admits **ADMIN, MANAGER, ACCOUNTANT, and CLERK** (`frontend/src/App.tsx:118-128`). CLERK consequently reaches almost every office/config page at the SPA layer, while Casbin grants CLERK only `shipments read|write` and `customer_portal read` (`backend/src/casbin/policy.csv:78-91`). Expect many CLERK pages to render API 403/error/empty states. This is a frontend/backend RBAC defect or unfinished role integration, not a valid pass.
2. `/` sends only DRIVER/FORWARDER to their portal and sends CUSTOMER/CLERK to `/dashboard`; `/dashboard` itself redirects only DRIVER/FORWARDER. Thus direct `/` and `/dashboard` currently expose DashboardPage to CUSTOMER and CLERK (`frontend/src/App.tsx:151-155`). CUSTOMER's intended `customerHome` is otherwise `/portal/shipments` (`frontend/src/App.tsx:115-125`).
3. `homeForRole()` only knows DRIVER and FORWARDER; all other roles resolve to `/dashboard` (`frontend/src/lib/routes.ts:112-117`).
4. `getNavItems()` has no CUSTOMER or CLERK branch, so both receive an empty sidebar catalog (`frontend/src/components/Layout.tsx:50-109`). Their role-specific pages are URL-only.
5. CLERK is the only role without a seeded login. The main seed calls `seedShipments(passwordHash)` (`backend/src/seed.ts:442`), which idempotently creates `customer` / `admin123` as CUSTOMER (`backend/src/seed.ts:447-487`); the CLI entry point invokes `seed()` when run directly (`backend/src/seed.ts:641-650`). That user is intentionally inserted without `users.customerId`, however. Login places `customerId` in the JWT when present (`backend/src/routes/auth.ts:38-60`), and current user-create/update routes do not accept or persist it (`backend/src/routes/auth.ts:98-155`). The seeded CUSTOMER can authenticate and exercise landing/empty-state behavior, while meaningful own-row shipment/debit-note QA still needs an approved Drizzle mapping fixture.

## Roles and deterministic identities

All seeded passwords are `admin123` (`backend/src/seed.ts:14-35`; documented in root `AGENTS.md`).

| Role | Vietnamese label | Seeded/demo identity | Expected route home in current main flow | Notes |
|---|---|---|---|---|
| ADMIN | Quản trị viên | `admin` / Trần Văn Admin | `/dashboard` | Wildcard backend authority; only role admitted to chatbot monitoring, FAQ, app settings. |
| MANAGER | Quản lý | `giamdoc` / Lê Văn Tỉnh | `/dashboard` | Full office navigation except ADMIN-only app/FAQ/chatbot items. |
| ACCOUNTANT | Kế toán | `ketoan` / Nguyễn Thị Mai | `/dashboard` | Office navigation; `/users` is visible but mutation UI/API is driver-scoped. No audit-log nav item even though Casbin grants read. Router explicitly denies `/audit-logs`. |
| DRIVER | Lái xe | `laixe`, `thu`, `pho`, `quyet` | `/my-trips` | Each has a linked driver profile; linking is an explicit portal prerequisite (`backend/src/seed.ts:37-53`). |
| FORWARDER | Giao nhận | `giaonhan` / Nguyễn Văn Giao | `/my-forwarder-trips` | Separate trip/advance/settlement workspace. |
| CUSTOMER | Khách hàng | `customer` / Khách hàng Demo | Intended `/portal/shipments`; current `/` and `/dashboard` behavior lands on dashboard | Seeded by `seedShipments`; currently unlinked to `users.customerId`, so row-scoped portal queries use deny-all and can only prove authentication/empty-state behavior until mapped. |
| CLERK | Nhân viên chứng từ | **None** | Comment says `/clerk/shipments/new`; current `/`/404 is `/dashboard` | Empty navigation; router/API mismatch described above. |

The full seed creates nine login identities: ADMIN, MANAGER, ACCOUNTANT, FORWARDER, four DRIVER users, and CUSTOMER (`backend/src/seed.ts:14-35,442,467-487`). E2E's canonical account table still contains only the first five role families (`e2e/helpers.py:18-24`), so neither CUSTOMER nor CLERK is covered by the existing E2E role harness.

## Route-guard truth table

Abbreviations used below: A=ADMIN, M=MANAGER, K=ACCOUNTANT, D=DRIVER, F=FORWARDER, C=CUSTOMER, L=CLERK.

| Guard/current behavior | Allowed roles | Redirect targets for denied roles | Source |
|---|---|---|---|
| unauthenticated app | none; LoginPage replaces all route content | URL does not change; after login the same URL is routed | `frontend/src/App.tsx:101-110`; `frontend/src/pages/LoginPage.tsx:15-27` |
| dashboard/root behavior | `/dashboard`: A,M,K,C,L; `/`: redirects D/F to portal and all others to `/dashboard` | D→`/my-trips`; F→`/my-forwarder-trips` | `frontend/src/App.tsx:151-155` |
| `adminOnly` (actual) | A,M,K,L | D→`/my-trips`; F→`/my-forwarder-trips`; C→`/portal/shipments` | `frontend/src/App.tsx:122` |
| `officeStaffOnly` | A,M,K | D/F→own portal; C/L→`/dashboard` | `frontend/src/App.tsx:128` |
| `managerOrAdminOnly` | A,M | D/F→own portal; C→`/portal/shipments`; K/L→`/dashboard` | `frontend/src/App.tsx:126` |
| `strictAdminOnly` | A | D/F→own portal; M/K/C/L→`/dashboard` | `frontend/src/App.tsx:133-136` |
| `driverOnly` | D | F→forwarder home; C→customer home; A/M/K/L→dashboard | `frontend/src/App.tsx:123` |
| `forwarderOnly` | F | D→driver home; C→customer home; A/M/K/L→dashboard | `frontend/src/App.tsx:124` |
| `customerOnly` | C | D/F→own portal; A/M/K/L→dashboard | `frontend/src/App.tsx:125` |
| `clerkOrAdminOnly` | A,L | D/F→own portal; C→customer home; M/K→dashboard | `frontend/src/App.tsx:129-132` |
| catch-all `*` | n/a | D→driver; F→forwarder; C→customer; A/M/K/L→dashboard | `frontend/src/App.tsx:245-248` |

## Complete current route/page inventory

### Entry, home, and aliases

| Route | Component/result | Allowed/current behavior | Visible entry | Functional check |
|---|---|---|---|---|
| any URL while signed out | `LoginPage` | public login surface | direct | Required identifier/password, password visibility toggle, invalid credentials, busy state, session-expired notice, responsive artwork. |
| `/` | redirect | D/F portal; everybody else dashboard | browser/home | Verify all seven roles because C/L currently route incorrectly versus comments. |
| `/dashboard` | `DashboardPage` | A,M,K,C,L | sidebar A/M/K | Month navigation, KPI/approval queue, attention links, revenue day/month toggle, finance/dispatch/fleet/debt drill-downs; C/L API-error behavior. |
| unknown `*` | redirect | role-specific catch-all | direct | Check A/M/K/L→dashboard, D/F/C→own portal. |
| `/routes` | redirect `/config/routes` | redirect is unguarded, destination guard applies | legacy URL | Confirm final role-specific destination. |
| `/trucks`, `/drivers` | redirect `/fleet` | destination `adminOnly` | legacy URL | Confirm final role-specific destination. |
| `/trailers` | redirect `/config/trailers` | destination `adminOnly` | legacy URL | Confirm final role-specific destination. |
| `/audit-log`, `/admin/audit-logs`, `/admin/audit-log` | redirect `/audit-logs` | destination A/M only | legacy URL | Confirm K does not retain audit page despite backend audit read. |
| `/config/llm-settings`, `/config/onboarding-settings` | redirect `/config/app-settings` | A only | old config links | Confirm M/K/L/C redirect to dashboard. |
| `/config/management-fees`, `/config/container-types`, `/config/seal-types`, `/config/ports` | redirect `/config` | unguarded redirect, destination `adminOnly` | config/legacy | Confirm C/D/F redirect from destination; note L reaches config. |

### Office operations, finance, HR, and master data

All `adminOnly` rows below currently allow **A/M/K/L**, not just administrators. D/F/C are denied as specified in the truth table.

| Route | Page | Guard | Visible entry / prerequisite | Key functional actions to exercise |
|---|---|---|---|---|
| `/dispatch` | `DispatchPage` | adminOnly | office sidebar | Live vehicle map, fleet status, pending orders, create trip, dispatch, reassign own/external carrier. |
| `/fleet` | `FleetPage` | adminOnly | office sidebar | Truck/driver/trailer tabs/cards, add/edit/status flows, open tire detail; export if shown. |
| `/fleet/:id/tires` | `TruckTiresPage` | officeStaffOnly A/M/K | truck card; valid truck id | Position manager; add/install/transfer/unmount/edit/delete/liquidate tire; filters and mobile table overflow. |
| `/fleet/trailers/:id/tires` | same, `vehicle="trailer"` | officeStaffOnly A/M/K | trailer card; valid trailer id | Same tire lifecycle with trailer-specific positions. |
| `/trips` | `TripListPage` | adminOnly | office sidebar | Search/filter/paging, export, create, detail, copy plan, bulk quick-edit/save, responsive rows/cards. |
| `/trips/new` | `TripCreatePage` | adminOnly | Create buttons; needs customers/routes/trucks/drivers | Own vs external carrier; route/date/customer; container/seal; pricing/fuel/cost calculations; photos; dirty-leave guard; submit. |
| `/trips/:id` | `TripDetailPage` | adminOnly | trip row; valid id | Edit, dispatch, complete, lock/unlock, cancel, reassign, adjustment invoice, documents/photos and role-specific action visibility. |
| `/trips/:id/edit` | `TripEditPage` | adminOnly | trip detail; valid editable id | Preserve/customize route legs, carrier switch, financial inputs, containers/services/contact/photos, submit and cancel/dirty guard. |
| `/finance` | `FinancePage` | adminOnly | sidebar/dashboard | Month/year, export, day/month trend, expandable vehicles, cost composition and reconciliation indicators. |
| `/profit` | `ProfitPage` | adminOnly | sidebar/dashboard | Period selection, preview distribution, finalize/close quarter, history; verify validation and immutable finalized state. |
| `/debt` | `DebtListPage` | adminOnly | sidebar | Aging buckets, search/filter, export, customer drill-down. |
| `/debt/:id` | `DebtDetailPage` | adminOnly | debt/customer row; valid customer id | Period/workspace tabs, ledger filters, record payment/overpayment behavior, XLSX export, billing document paths. |
| `/debt/:id/billing/new` | same page | adminOnly | customer debt page; valid customer id | Verify billing-document creation mode actually opens and completes from this URL. |
| `/penalties` | `PenaltyPage` | adminOnly | sidebar | Filter/search, create penalty from valid driver/trip/reason, cancel penalty with reason, totals. |
| `/advances` | `AdminAdvancesPage` | adminOnly | sidebar | Status filters, approve/reject forwarder requests, empty/error/loading states. |
| `/admin/advance-settlements` | `AdminAdvanceSettlementsPage` | officeStaffOnly A/M/K | sidebar | Status filters, open/inspect settlement, approve/reject (action visibility must follow backend capabilities). |
| `/customers` | `CustomersPage` | adminOnly | sidebar | Search/status/risk filters, add/edit/delete, export, pagination, detail navigation. |
| `/customers/:id` | `DebtDetailPage` | adminOnly | customer list; valid customer id | Customer summary/debt ledger and supplier-linked projection where applicable. |
| `/customers/:id/billing/new` | `DebtDetailPage` | adminOnly | valid customer id | Billing document creation path. |
| `/shipments` | `ShipmentsPage` | officeStaffOnly A/M/K | office sidebar; seeded shipments | Read-only status/search/pagination/retry, detail navigation. |
| `/shipments/:id` | `ShipmentDetailPage` | officeStaffOnly A/M/K | shipment row; valid id | General data, containers, documents, status history, linked trips, back behavior. |
| `/suppliers` | `SupplierListPage` | adminOnly | sidebar | Search/status filters, add/edit/delete, export, paging, payable detail navigation. |
| `/suppliers/:id` | `PayableDetailPage` | adminOnly | supplier row; valid id | Ledger filters, record payment/overpay confirmation, XLSX/PDF export. |
| `/expenses` | `ExpenseListPage` | adminOnly | sidebar | Filters/reset/paging, add, open/edit, approval/payment status display, empty/error states. |
| `/expenses/new` | `ExpenseEntryPage` | adminOnly | Add expense | Supplier/category inline creation, invoice/photo upload, recurrence, financial validation, submit/cancel. |
| `/expenses/:id/edit` | `ExpenseEntryPage` | adminOnly | editable expense id | Load/preserve values, allowed edits, paid/locked protections, delete if surfaced. |
| `/payables` | `PayableListPage` | adminOnly | sidebar | Category/filter/search, export, record supplier commission, drill-down. |
| `/payables/:id` | `PayableDetailPage` | adminOnly | payable row; valid supplier/carrier id | Ledger filters, payment, export, linked entity navigation. |
| `/salary` | `SalaryAttendancePage` | adminOnly | sidebar | Month switch, driver detail, cycle attendance cells, commission/payout, lock/unlock/finalize period, role action visibility. |
| `/users` | `UsersPage` | officeStaffOnly A/M/K | sidebar/config card | Role/status filters/search/sort/paging, create/edit/disable/delete; K must remain driver-only in edit behavior. |
| `/audit-logs` | `AuditLogPage` | managerOrAdminOnly A/M | sidebar only A/M | Date/category/user/search filters, refresh, details drawer, copy payload, paging/export if present. |
| `/chatbot-monitoring` | `ChatbotMonitoringPage` | strictAdminOnly A | ADMIN sidebar | Date/role filters, KPI/latency/lane/tool/token panels, recent-turn detail, empty/error data. |
| `/settlements/:id` | `SettlementPrintPage` | officeStaffOnly A/M/K | settlement review; valid id | Review/edit eligible expense, select requests, approve/finalize, preview/print. |

### Configuration routes

`/config` and most config pages use the actual `adminOnly` predicate (A/M/K/L). `ConfigPage` filters only two cards as ADMIN-only (`faq-entries`, `app-settings`) and exposes all other `CONFIG_ITEMS` to M/K/L (`frontend/src/pages/ConfigPage.tsx:33-39,128-139`; `frontend/src/data/searchRegistry.ts:55-77`). For L, most destination APIs should fail under Casbin and must be recorded as an RBAC mismatch.

| Route | Page | Guard | Functional actions |
|---|---|---|---|
| `/config` | `ConfigPage` | adminOnly | Search card catalog; verify counts/statuses; open every visible card; role-specific card visibility. |
| `/config/trailers` | `TrailersConfigPage` | adminOnly | List/filter/add/edit/delete/status/registration data. |
| `/config/trucks` | `TrucksConfigPage` | adminOnly | List/add/edit/delete/status, defaults/maintenance, open ownership. |
| `/config/trucks/:truckId/owners` | `TruckOwnersConfigPage` | adminOnly | Valid truck prerequisite; add/edit/delete owner share/effective periods. |
| `/config/routes` | `RoutesConfigPage` | adminOnly | Search/filter/select; add/edit/delete route; multi-leg add/remove. |
| `/config/cargo-types` | `CargoTypesConfigPage` | adminOnly | CRUD and active/inactive behavior. |
| `/config/pricing-tables` | `PricingTablesConfigPage` | adminOnly | Customer × route pricing CRUD, effective dates, validation. |
| `/config/road-allowances` | `RoadAllowancesConfigPage` | adminOnly | Route × trailer allowance CRUD and calculation fields. |
| `/config/penalty-reasons` | `PenaltyReasonsConfigPage` | adminOnly | Search/severity/sort; add/edit/delete reason. |
| `/config/fuel` | `FuelConfigPage` | adminOnly | Load/save norms and unit price; validation; price history. |
| `/config/fuel-norms` | `FuelNormsConfigPage` | adminOnly | Route/vehicle norm CRUD. Not present in `CONFIG_ITEMS`, so direct-URL QA required. |
| `/config/weight-pricing-tiers` | `WeightPricingTiersConfigPage` | adminOnly | Weight-tier CRUD/overlap boundaries. Direct URL only. |
| `/config/lift-pricing` | `LiftPricingConfigPage` | adminOnly | Port × container lift/drop pricing CRUD. Direct URL only. |
| `/config/ancillary-revenue` | `AncillaryRevenueConfigPage` | adminOnly | Ancillary revenue rule/price CRUD. Direct URL only. |
| `/config/company-info` | `CompanyInfoConfigPage` | adminOnly | Company legal/contact/bank fields; save/reload persistence. |
| `/config/trip-expense` | `TripExpenseConfigPage` | adminOnly | Default trip-expense values; validation/save/reload. |
| `/config/cap-table` | `CapTableConfigPage` | adminOnly | Capital partners/shares CRUD and 100% validation. |
| `/config/customers` | `CustomersConfigPage` | adminOnly | Search/filter; add/edit/delete customer master data. |
| `/config/salary-periods` | `SalaryPeriodConfigPage` | adminOnly | Default/current period rules, save and cross-month boundaries. |
| `/config/expense-categories` | `ExpenseCategoriesConfigPage` | adminOnly | CRUD; recurring/renewal attributes. |
| `/config/forwarder-expense-types` | `ForwarderExpenseTypesConfigPage` | adminOnly | CRUD; immutable system code; active state. |
| `/config/tire-positions` | `TirePositionsConfigPage` | officeStaffOnly A/M/K | CRUD/order/vehicle applicability; L must be redirected. |
| `/config/debit-note-templates` | `DebitNoteTemplatesConfigPage` | officeStaffOnly A/M/K | Create/open/duplicate/delete/select templates. |
| `/config/debit-note-templates/new` | `DebitNoteTemplateEditorPage` | officeStaffOnly A/M/K | Name, sections, columns, visibility/order/alignment, preview, create. |
| `/config/debit-note-templates/:id` | same | officeStaffOnly A/M/K | Valid template id; edit/save/delete and reload fidelity. |
| `/config/faq-entries` | `FaqEntriesConfigPage` | strictAdminOnly A | Search; add/edit/delete FAQ, tags, embedding warnings. |
| `/config/app-settings` | `AppSettingsConfigPage` | strictAdminOnly A | Feature/tutorial/bot/provider/GPS settings, validation/save/reload and secret masking. |

### Driver routes

| Route | Page | Allowed | Visible entry / prerequisite | Key actions |
|---|---|---|---|---|
| `/my-trips` | `DriverTripsPage` | D | desktop sidebar + mobile bottom nav; linked driver profile | Status filters, card/list/detail navigation, offline/loading/empty states. |
| `/my-trips/:id` | `DriverTripDetailPage` | D | assigned trip id | View route/container/contact, status progression and confirmation/photo/location actions surfaced by trip state. |
| `/my-trips/two-orders` | `DriverTwoOrdersPage` | D | direct/internal link; trips for today | Current/next order presentation and detail navigation. Not in role nav. |
| `/my-earnings` | `DriverEarningsPage` | D | desktop sidebar + mobile bottom nav | Month selection, salary/allowance/penalty equation, details/empty state. |
| `/my-payslips` | `DriverPayslipsPage` | D | direct/internal link; finalized periods | List finalized payslips, open/download if offered. Not in role nav. |
| `/my-penalties` | `DriverPenaltyPage` | D | desktop sidebar + mobile bottom nav | Month/status detail, totals and deduction visibility. |

Driver mobile alone receives the persistent bottom navigation plus account sheet; `Layout` renders it only when `user.role === 'DRIVER'` (`frontend/src/components/Layout.tsx:333,407-440`). Test 390px and 320px explicitly.

### Forwarder routes

| Route | Page | Allowed | Visible entry / prerequisite | Key actions |
|---|---|---|---|---|
| `/my-forwarder-trips` | `ForwarderTripsPage` | F | sidebar | Status filters, trip cards/list, detail navigation. |
| `/my-forwarder-trips/:id` | `ForwarderTripDetailPage` | F | assigned forwarder trip | Add container; add/edit/delete expenses; upload/view photos; link expense to container; mark completion. |
| `/my-advances` | `ForwarderAdvancesPage` | F | sidebar | New request, amount/reason validation, cancel form, status filters. |
| `/my-settlements` | `ForwarderSettlementsPage` | F | sidebar | Status filters, open/print, create settlement, empty state. |
| `/my-settlements/new` | `ForwarderSettlementCreatePage` | F | create button; eligible advances/expenses | Select unresolved advances and expense groups, totals, submit, success navigation. |
| `/my-settlements/:id` | `SettlementPrintPage` | F | existing own settlement id | View/preview/print; role/state-specific edit/finalize controls must remain hidden when unauthorized. |

Forwarder has no driver-style mobile bottom bar. Its mobile navigation is the general sidebar drawer; check reachability at 390/320px.

### Customer portal routes

| Route | Page | Allowed | Visible entry / prerequisite | Key actions |
|---|---|---|---|---|
| `/portal/shipments` | `PortalShipmentsPage` | C | URL only; mapped CUSTOMER fixture | Row-scoped list, status/date data, previous/next pagination, detail navigation, empty state. |
| `/portal/shipments/:id` | `PortalShipmentDetailPage` | C | own shipment id | General info, containers, status history; attempt another customer's id and require denial/not-found. |
| `/portal/debit-notes` | `PortalDebitNotesPage` | C | URL only; mapped CUSTOMER fixture | Row-scoped debit-note list/status/date/amount and document open/download if offered; empty state. |

CUSTOMER currently has no nav entries, and `/`/`/dashboard` are inconsistent with `customerHome`; direct URL, login landing, root, dashboard, catch-all, own-id, and foreign-id checks are all required.

### Clerk routes

| Route | Page | Allowed | Visible entry / prerequisite | Key actions |
|---|---|---|---|---|
| `/clerk/shipments/new` | `ClerkShipmentCreatePage` | A,L | URL only; customers configured | Customer selection, optional refs/dates, validation, create; verify resulting shipment id. |
| `/clerk/shipments/:id/docs` | `ClerkShipmentDocsPage` | A,L | valid shipment | Save B/L, add/remove/save containers, readiness validation, dispatch/transition action. |

CLERK has no nav and current root/home behavior is dashboard. Also probe representative `adminOnly` pages (`/trips`, `/config`, `/finance`) and require the product to either redirect cleanly or provide a fully authorized surface; the current expected observation is route admission followed by backend 403/error.

## Navigation visibility inventory

Source: `getNavItems()` at `frontend/src/components/Layout.tsx:50-109`; config cards at `frontend/src/data/searchRegistry.ts:55-77`.

| Role | Visible primary navigation |
|---|---|
| ADMIN | Tổng quan; Phân xe; Sổ chuyến đi; Lô hàng; Lương & Chấm công; Kỷ luật; Báo cáo lãi lỗ; Phân chia lợi nhuận; Công nợ phải thu; Công nợ phải trả; Chi phí phát sinh; Tạm ứng; Duyệt hoàn ứng; Đội xe; Khách hàng; Nhà cung cấp; Tuyến đường; Người dùng; Cài đặt ứng dụng; Giám sát Chatbot; Nhật ký người dùng; Cấu hình. |
| MANAGER | Same office set except Cài đặt ứng dụng and Giám sát Chatbot; includes Nhật ký người dùng. Config grid hides FAQ/App settings. |
| ACCOUNTANT | Same common office set, including Người dùng and Cấu hình; no Audit/Chatbot/App-settings nav. `/users` is intentionally scoped to driver data/actions. |
| DRIVER | Hành trình; Thu nhập; Kỷ luật. Same three in mobile bottom nav plus Tài khoản. Payslips/two-orders are hidden subpages. |
| FORWARDER | Chuyến đi; Tạm ứng; Phiếu thanh toán. |
| CUSTOMER | Empty primary nav (current gap). |
| CLERK | Empty primary nav (current gap). |

Common authenticated shell actions for all roles are profile update, password change, and logout (`frontend/src/components/Layout.tsx:162-223`); verify them at desktop and mobile. The sidebar has a 1024px breakpoint (`frontend/src/components/Layout.tsx:126-160`).

Hidden/detail routes that must be reached through rows/cards/actions or direct URLs: every `/:id` route; trip create/edit; expense create/edit; billing-new paths; tire pages; config truck owners/template editor; driver two-orders/payslips; settlement create/detail; all customer/clerk pages; direct-only fuel-norm/weight/lift/ancillary config pages.

## Seed and state prerequisites

Use IDs returned by the running API/UI; do not hard-code database IDs.

| Surface | Deterministic prerequisite |
|---|---|
| Login/office | `make setup` or equivalent migrated/seeded local stack; five canonical role families. |
| Driver | User must be linked to `drivers.user_id`; standard seed links `laixe`, `thu`, `pho`, `quyet` (`backend/src/seed.ts:37-53`). Use a driver with at least one assigned trip for detail/actions. |
| Forwarder | `giaonhan`; at least one forwarder-visible trip. Create eligible expense and advance before settlement creation. |
| Trip create | At least one customer, route, active truck, active driver; external carrier path needs carrier/supplier master data. |
| Tire pages | Valid truck/trailer plus tire-position catalog; create a disposable tire for full lifecycle. |
| Debt/payables | Customer/supplier with ledger entries; create a controlled unpaid transaction before testing payment/overpay. |
| Expense edit | Disposable unpaid expense; separately verify paid/approved immutability. |
| Salary | Driver attendance data and open period; finalized period for payslip. |
| Shipment office/detail | Standard seed creates shipment data through `backend/src/seed.ts` shipment service calls; discover IDs from `/api/shipments`. |
| Customer portal | `customer` / `admin123` is created by the standard seed and can prove login/landing/empty states. For meaningful own-row data, link that user through `users.customerId` to a customer with shipments/debit notes; current create-user contract cannot establish the link. |
| Clerk | **Missing from standard seed.** ADMIN/MANAGER can create a CLERK account through user management, but no navigation/home is supplied. |
| Template editor | Create a disposable template first, then use returned id for edit/delete/reload. |

For destructive/mutating browser checks, create uniquely named disposable records and clean them up through product APIs/UI where supported. Do not alter canonical seeded records used by later roles.

## Existing automated coverage and gaps

### What exists

- `e2e/test_00_auth.py`: login and top-level redirect checks for MANAGER, DRIVER, FORWARDER, ADMIN; invalid credentials; some forbidden page/API checks and catch-all behavior.
- `test_01`–`test_10`: trip lifecycle/list, dashboard/finance, debt, profit, penalties, fleet/dispatch, customers, selected config pages, users/audit.
- `test_11_driver_portal.py`: substantial driver list/detail/earnings/penalty behavior and RBAC.
- `test_12_vendor_expenses.py`: supplier/expense/payables API lifecycle plus selected browser pages/RBAC.
- `test_13_forwarder_portal.py`: substantial forwarder trip/container/expense behavior and RBAC.
- `test_14_smoke_closed_loop.py`: API-level shipment→trip→expense→debit-note→payment→P&L→dashboard chain.
- Focused frontend units exist for `ShipmentsPage`, clerk create/docs, driver payslips/two-orders, route metadata, and selected calculations/components.

### Material gaps for this request

1. The seeded CUSTOMER login is absent from `e2e/helpers.py`, CLERK has no seeded login at all, and no E2E tests mention either role.
2. No E2E browser coverage for customer portal pages, clerk pages, office shipment detail, debit-note portal, or cross-customer row scoping.
3. No router matrix test covering all seven roles against every route. Helper-name drift (`adminOnly`) is therefore not caught.
4. Existing auth E2E checks only representative denied pages, not all hidden/direct routes and aliases.
5. Many config pages have no browser E2E: trailers/trucks/owners/cargo/pricing/allowance/fuel norms/weight/lift/ancillary/company/trip expense/cap table/salary periods/expense categories/tire positions/forwarder types/debit templates/FAQ/app settings.
6. No product-wide screenshot/overflow/a11y sweep. Existing E2E screenshots are selective and not a desktop/tablet/mobile matrix.
7. `frontend/src/App.tsx`/`getNavItems()` has no focused route/nav unit test; `frontend/src/lib/routes.test.ts` validates metadata helpers, not runtime authorization.
8. Accountants are router-admitted to broad mutation pages while backend/UI capability differences are page-specific; actions need explicit visibility and 403 checks, not only page-load checks.
9. CUSTOMER/CLERK shell navigation and home behavior are untested and currently inconsistent.

## Recommended deterministic browser sequence

Run each page at 1440×900 desktop and 390×844 mobile; add 768×1024 tablet for shell/config/table layouts and 320×568 for pages with dense tables/forms. At every viewport check: no horizontal page overflow, no clipped fixed actions, readable wrapping, focus visibility, usable dialogs/drawers, and touch targets.

1. **Baseline and fixture discovery**
   - Confirm backend health and seeded identities.
   - As ADMIN, obtain/create disposable IDs for customer, supplier, truck, trailer, trip, shipment, expense, settlement, and debit-note template.
   - Use the seeded `customer` identity for CUSTOMER authentication/landing checks. Establish its `customerId` mapping plus a CLERK fixture through an approved Drizzle fixture path for meaningful role data/actions. If mapping or CLERK setup is unavailable, bound those checks explicitly; do not substitute ADMIN screenshots.
2. **Signed-out shell**
   - Visit `/login`, a protected deep link, and unknown URL; check login error, password toggle, keyboard submit, session expiry, artwork at all widths.
3. **ADMIN exhaustive route sweep**
   - Traverse every sidebar item in order, then every config card, then all hidden/direct/detail routes in the inventory.
   - Perform one complete lifecycle for trip, dispatch, tire, customer, supplier, expense, payable/payment, penalty, advance/settlement, salary, user, template, FAQ/settings.
   - Screenshot every distinct page state after stable data load, plus every dialog/drawer and representative empty/error state.
4. **MANAGER sweep**
   - Verify menu omissions (app settings/chatbot); direct denied URLs; audit access; office CRUD/actions according to Casbin; every visible config card.
5. **ACCOUNTANT sweep**
   - Verify no audit/chatbot/app settings; `/users` view with driver-only edit behavior; office pages and action visibility; denied manager/admin-only paths. Attempt mutation where the UI exposes it and reconcile with API permission.
6. **DRIVER sweep**
   - Use an assigned-trip driver. Verify login home, desktop sidebar, mobile bottom nav/account sheet, list/detail/two-orders/earnings/payslips/penalties, status/photo/location actions, offline/empty cases, and denial of every office/forwarder/customer/clerk family.
7. **FORWARDER sweep**
   - Verify responsive drawer navigation; trip/container/expense/photo lifecycle; advance request; settlement create/detail/print; denial of all other role families.
8. **CUSTOMER sweep**
   - Verify post-login landing, `/`, `/dashboard`, catch-all, empty navigation defect, three portal pages, pagination/download, own shipment/debit note, and foreign-customer ID denial.
9. **CLERK sweep**
   - Verify post-login landing/root/catch-all and empty navigation; create shipment then docs/B-L/containers/readiness/dispatch.
   - Probe `/trips`, `/finance`, `/config`, `/users`, `/shipments`; record the current router/API mismatch precisely.
10. **Cross-role direct-URL denial matrix**
    - Keep one browser context per role and visit one representative from each guard family plus all strict/portal/clerk routes and legacy redirects. Assert final URL and absence of protected content.
11. **Final responsive regression pass**
    - Revisit the densest pages at 320px: trip list/create/detail, finance, debt detail, salary, users, tire management, template editor, forwarder trip detail/settlement, clerk docs, customer shipment detail.
    - Recheck common profile/password/logout for each shell style.

## Inventory verdict

The route catalog contains all implemented page patterns above, but current code does **not** provide a coherent seven-role browser contract: CUSTOMER is seeded but unlinked and has no navigation, CLERK lacks a demo identity and navigation, their home behavior is inconsistent, and CLERK is unintentionally admitted by `adminOnly` to pages its backend role cannot use. These are priority findings for the functional run, not reasons to omit those roles.

Status: DONE_WITH_CONCERNS  
Summary: Complete current route/page/role/navigation/action inventory produced for all seven roles and all nine seeded demo accounts, including dynamic prerequisites, automated coverage gaps, and an ordered browser QA sequence.  
Concerns/Blockers: CLERK lacks a deterministic seeded identity. CUSTOMER is seeded and can log in, but remains unlinked to `users.customerId`, which blocks meaningful row-scoped portal data through the standard fixture. Router behavior also over-admits CLERK and exposes dashboard to CUSTOMER/CLERK.
