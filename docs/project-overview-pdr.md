# Project Overview & Product Development Requirements (PDR)

> **Audience:** Stakeholders, new developers, and project leads. For detailed business rules, see [PRODUCT-SPECS.md](../PRODUCT-SPECS.md). For domain terminology, see [CONTEXT.md](../CONTEXT.md).

## Executive Summary

TingTing is a web-based fleet management platform for **Cong ty TNHH NEPO**, a Vietnamese container-trucking company operating 4+ trucks across 38+ routes serving 44+ customers. The system replaces 7+ Excel files and 300+ spreadsheets that previously required 2-3 hours/day of manual data consolidation by accountants and 1 hour/day by managers.

The platform covers the full operational lifecycle: trip dispatch through completion, financial recording (ledger-based double-entry), receivables/payables tracking, driver salary and attendance, tire lifecycle management, and P&L reporting -- all with Vietnamese-language UI and audit trails.

## Product Vision

Eliminate manual Excel-based operations for a small Vietnamese trucking company by providing a single, real-time web application that handles trip management, financial accounting, fleet maintenance, and driver administration. The system must comply with Vietnamese accounting standards (Decree 123/2020/ND-CP) and support mobile-first workflows for drivers and forwarders.

## User Personas

| Role | Vietnamese | Primary Tasks | Interface |
|------|-----------|---------------|-----------|
| Manager / Partner | Quan ly / Doi tac | Dispatch, financial oversight, debt collection, profit distribution, driver discipline | Desktop-first |
| Accountant | Ke toan | Trip data entry, fuel control, road-allowance calculation, receivables collection, expense recording, salary processing | Desktop-first |
| Forwarder | Giao nhan | Enter container/seal numbers, ancillary costs (lift, customs, weighing), use advance funds for payments | Mobile-first |
| Driver | Lai xe | View trip schedule, fuel allocation, earnings, and penalty history (read-only) | Mobile-first |

See [PRODUCT-SPECS.md §2](../PRODUCT-SPECS.md#2-dinh-nghia-nguoi-dung--giao-dien-user-personas--ui-strategy) for full persona descriptions.

## Business Scope

### Modules (11)

The platform covers these functional modules. Each links to its deep-dive flow document in `docs/flows/`:

| Module | Flow Doc | Brief Description |
|--------|----------|-------------------|
| Trip Management | [01-TRIP_LIFECYCLE](flows/01-TRIP_LIFECYCLE.md) | Create, dispatch, complete, lock trips; 5-state lifecycle |
| Dashboard & Reports | [03-DASHBOARD_VA_BAO_CAO](flows/03-DASHBOARD_VA_BAO_CAO.md) | Revenue, cost, P&L charts and tables |
| Receivables & Payments | [04-CONG_NO_VA_THANH_TOAN](flows/04-CONG_NO_VA_THANH_TOAN.md) | Customer debt tracking, payment matching (manual FIFO) |
| Profit Distribution | [05-PHAN_BO_LOI_NHUAN](flows/05-PHAN_BO_LOI_NHUAN.md) | Quarterly/yearly partner distribution with historical ownership % |
| Discipline & Penalties | [06-KY_LUAT_VA_PHAT](flows/06-KY_LUAT_VA_PHAT.md) | Driver penalty recording and salary deduction |
| Fleet Management | [07-DOI_XE_VA_FLEET](flows/07-DOI_XE_VA_FLEET.md) | Trucks, trailers, tires, vehicle alerts |
| Customer Management | [08-KHACH_HANG](flows/08-KHACH_HANG.md) | Customer catalog, pricing per route |
| System Configuration | [09-CAU_HINH_HE_THONG](flows/09-CAU_HINH_HE_THONG.md) | 24+ config tables (routes, fuel norms, expense items, etc.) |
| System Admin | [10-QUAN_TRI_HE_THONG](flows/10-QUAN_TRI_HE_THONG.md) | Users, RBAC, audit logs, chatbot admin |
| Vendor Expenses & Payables | [12-CHI_PHI_NCC_VA_CONG_NO_PHAI_TRA](flows/12-CHI_PHI_NCC_VA_CONG_NO_PHAI_TRA.md) | Operating expenses, vendor payables |
| Forwarder Portal | [13-GIAO_NHAN_VA_TAM_UNG](flows/13-GIAO_NHAN_VA_TAM_UNG.md) | Mobile portal for forwarders; advance fund management |
| Salary & Attendance | [14-LUONG_VA_CHAM_CONG](flows/14-LUONG_VA_CHAM_CONG.md) | Monthly salary periods, work days, trip-wage fill |
| Tire Management | [15-QUAN_LY_LOP_XE](flows/15-QUAN_LY_LOP_XE.md) | Install, transfer, spare lifecycle tracking |

For the complete module specification including data fields, validation rules, and business logic, see [PRODUCT-SPECS.md §3-§7](../PRODUCT-SPECS.md).

### Financial Architecture

The system uses a **centralized append-only ledger** (`sổ cái`) as the single source of truth for all financial balances:

- **Customer debt** -- running balance from TRIP_REVENUE + PAYMENT_RECEIVED rows
- **Vendor payables** -- running balance from EXPENSE + VENDOR_PAYMENT rows
- **Driver salary/penalties** -- tracked via salary periods with work-day and trip-wage calculations

Revenue is recorded **ex-VAT** (net); costs are recorded **incl-VAT** (gross). This asymmetry is intentional and documented in [PRODUCT-SPECS.md §4.1.1](../PRODUCT-SPECS.md).

### Out of Scope

- GPS tracking (partially shipped via Bach Khoa integration -- see [docs/plans/gps-actual-route-database.md](plans/gps-actual-route-database.md))
- Variable pricing (fixed Customer x Route pricing only)
- E-invoice generation (system records data; external invoicing is out of scope)
- Multi-company/multi-tenant support

## Key Business Rules

> These are summaries. Authoritative definitions live in [CONTEXT.md](../CONTEXT.md) and [PRODUCT-SPECS.md §4](../PRODUCT-SPECS.md).

1. **Trip lifecycle**: Created -> In Transit -> Completed -> Locked -> Canceled. State changes require explicit user action; the system never auto-transitions.
2. **Ledger immutability**: Once a trip is locked, its ledger entries are permanent. Corrections use ADJUSTMENT entries (per Vietnamese Decree 123/2020/ND-CP). Unlocking posts UNLOCK_REVERSAL rows.
3. **Fuel pricing**: Two columns -- `fuelPriceApplied` (config snapshot at trip creation, never mutated) and `fuelActualUnitPrice` (per-trip actual pump price). Effective price = actual ?? snapshot.
4. **Road allowance**: Fixed lookup table by Route x Trailer Type, with manual adjustments per trip. Formula: `total = standard - (stations x 55,000) + returnCargoBonus`.
5. **Payment matching**: Manual FIFO by default; accountant can override order. Partial payments allowed. Single bank transfer generates multiple ledger rows grouped by `receiptId`.

## Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Language** | Vietnamese-language UI, audit logs, and error messages. English for code and docs. |
| **Currency** | VND (Vietnamese Dong). No decimal places in display. Internal calculations use `round2dp()`. |
| **Precision** | All financial calculations through `round2dp()` and `computeTripTotals()` from `shared/src/calculations/`. |
| **Mobile** | DRIVER and FORWARDER roles use mobile-first responsive layouts. |
| **Auth** | JWT tokens + Casbin RBAC. Dual-layer: `casbinAuthz(resource)` (coarse) + `requireRoles()` (tight). |
| **Audit** | Every mutation request auto-logged with Vietnamese message, user, timestamp, and entity details. |

## Related Documents

| Document | Relevance |
|----------|-----------|
| [PRODUCT-SPECS.md](../PRODUCT-SPECS.md) | Full business specification -- the authoritative source for all rules |
| [CONTEXT.md](../CONTEXT.md) | Domain glossary and Vietnamese/English term mappings |
| [AGENTS.md](../AGENTS.md) | Architecture overview, commands, and key code patterns |
| [System Architecture](system-architecture.md) | Technical architecture, request lifecycle, component diagram |
| [Codebase Summary](codebase-summary.md) | Repository map and "where to find X" index |
| [Project Roadmap](project-roadmap.md) | Completed features, planned work, deferred items |
