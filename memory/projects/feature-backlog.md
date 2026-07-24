# Feature Backlog (Track 2)

**Status:** In progress
**Tracking:** `TASKS.md` (Track 2)
**Priority Order:** P0 (Epic E bug fixes) → P1 (Epic B Receivables) → P2 (Epics A, C) → P3 (Epic D)

## Epic A: Fuel Norm Thresholds & Warnings
**Priority:** P2 · **Status:** Not started

Configurable fuel consumption thresholds (warning + critical) replacing hardcoded 37/40 L/100km.
- Threshold config in fuel_config table + UI
- TripListPage/TripDetailPage use configured thresholds
- TTBQ vs norm comparison in detail view
- Dashboard warning indicators

## Epic B: Accounts Receivable (Công nợ phải thu)
**Priority:** P1 · **Status:** Partially done

### US-B.1: Record payments with FIFO suggestion
- DebtDetailPage supports payment recording and trip-specific allocation
- Missing: FIFO suggestion button, running total display

### US-B.2: Overdue customer alerts
- Backend aging endpoint exists
- Missing: Dashboard alerts widget, color-coded debt list, navigation from alerts
- **T-B.2.1 done**: `GET /reports/receivables-summary` endpoint

### US-B.3: Export customer statement
- Not implemented. Needs PDF/Excel generation backend + UI button.

## Epic C: Dashboard & Reporting Enhancements
**Priority:** P2 · **Status:** Partially done

DashboardPage exists with KPIs and charts. Needs:
- Monthly revenue trend line
- Cost breakdown pie chart
- Top 5 profitable routes
- Fleet status overview
- P&L drill-down to trip level
- Year-over-year comparison
- Excel export for P&L

## Epic D: Profit Distribution
**Priority:** P3 · **Status:** Partially done

ProfitPage and backend endpoint exist. Cap table management in ConfigPage.
- Verify cap table history calculation
- Distribution preview before execution
- Immutable distribution records
- Historical distribution view

## Epic E: Tech Debt & Bug Fixes
**Priority:** P0 · **Status:** Mostly done

- T-E.1.1–T-E.1.3: ✅ TypeScript compilation fixes (snake_case alignment, shared type alignment)
- T-E.2.1–T-E.2.3: Not started (API endpoint audit, shared path constants, response shape verification)

## Other Completed Work

### Clickable Elements Audit (May 2026)
All pages audited for broken/non-functional clickable elements. 9 files fixed:
- PenaltyPage (5 fixes), DispatchPage (1), DashboardPage (3), FleetPage (1)
- CustomersPage (1), AuditLogPage (1), DebtListPage (1), ProfitPage (2), TripEditPage (1)
- Pattern: `alert()` → inline toast, `window.confirm()` → `useConfirm()`, dead links → `navigate()`

### Architecture Deepening (Ousterhout-style)
6 refactoring tasks completed:
- C3: Unified camelCase↔snake_case seam (`snakeCaseSerializer` middleware)
- C4: Trip service edge leaks (IN_TRANSIT→COMPLETED auto-complete)
- C5: Centralized authorization guards (`requireRoles()` middleware)
- C6: Extracted DriverService (`driver.service.ts`)
- C1: Deepened Ledger module (`LedgerService`)
- C2: Extracted Reporting module (`reporting.service.ts`)
