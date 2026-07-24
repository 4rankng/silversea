# Blueprint — Remaining `feedback202606.docx` tasks

**Generated:** 2026-06-17 (Blueprint skill, verify-before-build; adversarial-reviewed & revised)
**Source:** `docs/feedback202606.docx` + codebase verification
**Mode:** git + gh present (ssh, account `4rankng`). `main` is 7 commits ahead of `origin/main`. → **branch/PR per step.**

---

## 0. Headline — the backlog was mostly stale

A codebase verification pass (wired-vs-stub, file:line evidence — not commit messages) overturned the prior memory roadmap. **Of ~13 items previously marked blocked / not-started, only 6 core steps + minor polish remain.** Everything else is DONE end-to-end:

| Item | Was | Verified | Evidence |
|---|---|---|---|
| V2/A9 payables (chips, COMMISSION posting, vendor payment, reports) | blocked | ✅ DONE | `PayableListPage.tsx:28-34`, `commission.service.ts:17`, `financial.service.ts:252` |
| F3 profit per-vehicle | blocked (cap-table) | ✅ DONE ⚠️ *(raw-ID leak → Step 7)* | `profit-distribution.service.ts:176`, `truckCapTable`, `ProfitPage.tsx:398` |
| F2 driver earnings | blocked (txn question) | ✅ DONE *(see wording note)* | `DriverEarningsPage.tsx:164-189`, `driver.service.ts:118-161` |
| N3 expense back-dating | not started | ✅ DONE | `schema.ts:491` + reporting `pnl.service.ts:82-84`; editable picker `ExpenseEntryPage.tsx:381` |
| N1 tire module + warranty alerts | epic | ✅ DONE | `schema.ts:126`, migration `0051_tires.sql`, `config.ts:123-148`, `computeTireAlerts` wired at `TruckTiresPage.tsx:199` |
| F1 advance **balance** surfacing | not built | ✅ DONE | `AdminAdvancesPage.tsx:253` via `useAdminAdvanceBalances` |
| F1 advance **settlement** approval (hoàn ứng) | not built | ❌ **→ Step 6** | hooks + endpoints exist but **orphaned — no UI consumer** |

**Two corrections to earlier wording (from adversarial review):**
- **F2:** "payable balance" = **unpaid driver salary** (DRIVER ledger: salary credits − penalties − payouts). Drivers take **no cash advances** in this model — advances are forwarder-scoped. So the balance genuinely represents what the company still owes the driver.
- **Open question — F2 "MTD":** customer asked for values *"tính từ đầu tháng tới hiện tại"* (month-to-today). The code computes over the **full salary period**, which may differ from calendar-month-to-today. **Flag to customer** before closing B2.

**Do NOT rebuild any ✅ item above** — they are wired and tested.

---

## 1. Steps (6 core + 1 polish — fully parallel)

All seven are **independent** (no shared files — Step 6 touches `Layout.tsx`/`App.tsx` which no other step touches) → may execute concurrently.

### Step 1 — V1: AR KPI card on Dashboard
**ID:** V1 / A8 · **Size:** S · **Model:** default · **Depends on:** nothing

**Context brief.** The Dashboard already fetches receivables summary (`useDashboardData.ts:78` → `/reports/receivables-summary`, shape `{ totalOutstanding, overdueCustomers }`) but only renders it as a one-line attention text (`DashboardPage.tsx:259`). Customer wants AR as a first-class KPI.

**Tasks.**
1. In `DashboardPage.tsx`, add a KPI card to the 4-card strip (`DashboardPage.tsx:378-414`) — title "Công nợ phải thu", value `totalOutstanding`, subtitle `overdueCustomers` "khách quá hạn".
2. Render via existing `<Money>`/`moneyParts` (subtitle-sized ₫ unit, no truncation).
3. Reuse existing dashboard data; **no new endpoint, no new hook**.

**Files:** `frontend/src/pages/DashboardPage.tsx`
**Verification.** tsc (3 CI cmds) + `pnpm build` green; manual: card value ties to Finance receivables summary.
**Exit criteria.** AR card visible desktop + mobile.
**Rollback.** `git revert`.

---

### Step 2 — B5: Forwarder container click-to-fill
**ID:** B5 / C1.3 · **Size:** S · **Model:** default · **Depends on:** nothing

**Context brief.** FK (`tripExpenses.tripContainerId`, `schema.ts:640`) + manual dropdown (`ForwarderTripDetailPage.tsx:505`) exist, but container rows (`:361-386`) are plain `<div>`s with no `onClick`. Customer: click a container row → pre-fill it into the expense form (no double entry).

**Tasks.**
1. Make each container row clickable → `setExpenseForm({ ...expenseForm, tripContainerId: row.id, containerNumber: row.containerNumber })`.
2. Highlight active row; keep dropdown as editable fallback.

**Files:** `frontend/src/pages/ForwarderTripDetailPage.tsx`
**Verification.** tsc + build green; manual: click → form pre-filled; expense persists correct `tripContainerId`.
**Exit criteria.** Single-click container → form pre-filled.
**Rollback.** `git revert`.

---

### Step 3 — N6-customer: AR balance + drill-down on CustomersPage
**ID:** N6 / A13 · **Size:** S-M · **Model:** default · **Depends on:** nothing

**Context brief.** `CustomersPage.tsx` builds `debtMap` (a `Map` keyed by customer id, lines 198-211) from `useCustomerLedgerEntries()` but uses it only for a risk dot. Drill-down target **exists**: `/debt/:id` (`DebtDetailPage` = customer AR statement, `App.tsx:133`).

**Tasks.**
1. Add a "Công nợ" column (desktop table `:443-500`) + mobile card field (`:385-438`) reading `debtMap.get(customer.id)` via `<Money>` (overdue > 0 highlighted).
2. Make rows clickable → `navigate('/debt/:id')`.

**Files:** `frontend/src/pages/CustomersPage.tsx`
**Verification.** tsc + build green; manual: balance shown; row → AR statement ties.
**Exit criteria.** AR balance per customer + click-through.
**Rollback.** `git revert`.

---

### Step 4 — N6-supplier: AP balance + drill-down on SupplierListPage
**ID:** N6 / A14 · **Size:** S-M · **Model:** default · **Depends on:** nothing

**Context brief.** `SupplierListPage.tsx` is pure CRUD with zero financial data. Drill-down target **exists**: `/payables/:id` (`PayableDetailPage`, `App.tsx:167`). AP data via existing `usePayablesSummary()` (`financialClient.ts:63`) → items with nested `supplier.id` + `totalOutstanding`.

**Tasks.**
1. Call `usePayablesSummary()` once, build `Map<supplier.id, totalOutstanding>`.
2. Add "Công nợ" column + mobile field via `<Money>`.
3. Make supplier rows clickable → `/payables/:id`.

**Files:** `frontend/src/pages/SupplierListPage.tsx`
**Verification.** tsc + build green; manual: balance shown; row → PayableDetailPage ties.
**Exit criteria.** AP balance per supplier + click-through.
**Rollback.** `git revert`.

---

### Step 5 — F1-2b: Settlement export joins `tripContainerId` FK
**ID:** F1-2b · **Size:** S-M · **Model:** default · **Depends on:** nothing

**Context brief.** DB FK is correct (`tripExpenses.tripContainerId` → `tripContainers.id`), but `settlement-export.service.ts` (line 56) still groups by the loose denormalized `containerNumber` string. Customer: voucher must show costs **per container** accurately.

**Tasks.**
1. Resolve each expense's container via `tripContainerId` → join `tripContainers` for canonical `containerNumber`; **fall back to stored `containerNumber` only when `tripContainerId` is null** (legacy rows).
2. Group by resolved key; keep `LinkedExpense` shape backward-compatible.
3. Confirm `SettlementPrintPage.tsx` (re-groups client-side independently) still renders identically.

**Files:** `backend/src/services/settlement-export.service.ts`
**Verification.** `cd backend && npm test` green; tsc green; manual: multi-container trip export grouped correctly.
**Exit criteria.** FK-resolved grouping; legacy null-FK rows still appear; no print regression.
**Rollback.** `git revert` (no migration — column exists).

---

### Step 6 — Office UI: list & approve forwarder settlements (hoàn ứng)  ⚠️ CRITICAL
**ID:** D2 / C2 / F1 · **Size:** M · **Model:** default · **Depends on:** nothing (new files)

**Context brief.** Accountant feedback (section D): *"không hiện phần hoàn ứng... không duyệt được hoàn ứng này"* — cannot see or approve forwarder settlements. **Backend + hooks already exist but are orphaned (no UI):**
- Endpoints (RBAC-correct): `/advance-settlements/:id/check` (ADMIN/ACCOUNTANT), `/approve` (ADMIN/MANAGER), `/reject` — `backend/src/routes/financial/advances.routes.ts:52,58,64`.
- Hooks (defined, **zero page consumers**): `listAllAdvanceSettlements`, `useCheckAdvanceSettlement`, `useApproveAdvanceSettlement`, `useRejectAdvanceSettlement` — `useForwarderQueries.ts:176-203`.
- `AdminAdvancesPage.tsx` handles advance **requests** only (no settlement references); `/my-settlements` is forwarder-facing.

**Tasks.**
1. Create office-scoped page `AdminAdvanceSettlementsPage.tsx` (+ css) listing settlements via `listAllAdvanceSettlements()`, with Check / Approve / Reject buttons using the orphaned hooks.
2. Add a nav item for MANAGER + ACCOUNTANT in `Layout.tsx` (`section: 'financial'`).
3. Add the route in `App.tsx` (e.g. `/admin/advance-settlements`).
4. Show per-forwarder outstanding context alongside (reuse `useAdminAdvanceBalances`).
5. **RBAC guard:** FORWARDER must NOT reach this office page.

**Files:** `frontend/src/pages/AdminAdvanceSettlementsPage.tsx` (new) + `.css`, `frontend/src/components/Layout.tsx` (nav), `frontend/src/App.tsx` (route)
**Verification.** tsc + build green; `cd backend && npm test` green; manual: accountant lists + approves a settlement; forwarder cannot access.
**Exit criteria.** Accountant can list, check, approve, reject forwarder settlements from the office UI.
**Rollback.** `git revert` (all new files + nav/route lines).

---

### Step 7 — Polish: remove raw-ID leak in per-truck profit display  (optional)
**ID:** A2-nit · **Size:** S · **Model:** default · **Depends on:** nothing

**Context brief.** `ProfitPage.tsx:405` renders `Xe #{t.truckId}` — violates the project's "no raw IDs in UI" rule. F3 is otherwise fully done.

**Tasks.** Resolve each truck's license plate / code and render that instead of the numeric id.

**Files:** `frontend/src/pages/ProfitPage.tsx`
**Verification.** tsc + build green; manual: per-truck rows show plate/code, not `#id`.
**Rollback.** `git revert`.

---

## 2. Parallelism & ordering

```
Step 1 (V1 dashboard)            ─┐
Step 2 (B5 click-fill)            │
Step 3 (N6 customer)              ├── all file-independent → concurrent
Step 4 (N6 supplier)              │
Step 5 (F1-2b export FK)          │
Step 6 (settlement approval UI)   │   (new files + Layout.tsx/App.tsx — unique to this step)
Step 7 (profit raw-ID polish)    ─┘
```

No `blockedBy` edges. Suggested if serializing: **6 first** (closes the accountant blocker), then 1–5 and 7. One PR per step, or one combined "polish + settlement-approval" PR.

---

## 3. Cross-cutting invariants (every step)

- **Type-check:** `npx tsc --noEmit` — the 3 CI tsc commands (`shared/` test files intentionally excluded — see memory). Backend: `cd backend && npm test` (integration suites need Postgres+Redis + fresh `pnpm db:migrate`).
- **Build:** `pnpm build` green.
- **Money:** `round2dp()` / `computeTripTotals()`; VND, no decimals; never truncate a column (wrap/tooltip/card).
- **No raw IDs** in UI text — meaningful business labels only (Step 7 exists precisely to fix an existing violation).
- **RBAC:** steps 1–5, 7 reuse existing reads / are internal — no new Casbin policy. **Step 6** reuses existing RBAC-correct endpoints; ensure the new office page is office-role-gated and forwarder-blocked.
- **No migrations** in any step (all columns/tables/endpoints exist).
- **Code review:** `/code-review` (max) before each merge.
- **Commit, do not push** without explicit instruction (standing workflow).

---

## 4. Out of scope / open

- Nothing remains as a standalone epic (N1 tires is done).
- **Open customer question:** F2 "MTD" semantics — confirm whether month-to-*today* is required vs. the current full-salary-period computation (see §0 note).
- The 3 untracked design docs (`f3-per-vehicle-profit-design.md`, `n1-tire-module-design.md`, `v2-commission-payables-design.md`) describe **already-implemented** work — archive or delete after review.

---

## 5. Acceptance (whole blueprint)

Steps 1–7 merged (Step 6 mandatory); Dashboard AR card + forwarder click-fill + customer/supplier balance drill-downs + **accountant settlement approval** live; settlement export verified per-container; F2 MTD semantics confirmed with customer; full tsc/test/build green; `/code-review --max` clean on each PR. Feedback document `feedback202606.docx` then fully addressed.
