---
title: "Debt detail period filter and summary parity"
description: "Lock down and QA the AR/AP detail month-range filter path, the server-computed period summary contract, and the remaining parity gaps."
status: pending
priority: P1
effort: 3h
branch: "main"
tags: [financial, debt, receivables, payables, qa]
blockedBy: []
blocks: []
created: "2026-07-19"
createdBy: "ck:plan"
source: skill
---

# Debt detail period filter and summary parity

## Overview

The requested month/range filter plus `Số dư đầu kỳ / Phát sinh trong kỳ / Số dư cuối kỳ` summary is already wired on both detail pages, not on the `/debt` list page. This plan is therefore a parity/ship plan, not a greenfield feature plan: preserve the existing historical-balance contract, decide the remaining UX semantics, and close the only visible gaps before QA handoff.

## Verified Current State

- `/debt/:id` already renders the daisyUI-backed period filter and summary cards above the receivables ledger table in the ledger workspace tab: `frontend/src/pages/DebtDetailPage.tsx:556-592`.
- `/payables/:id` already mirrors the same controls above the payable ledger table: `frontend/src/pages/PayableDetailPage.tsx:349-385`.
- The shared filter component already supports `Theo tháng` and `Theo khoảng`, resolves month/year into ISO bounds, and uses daisyUI `d-` classes: `frontend/src/components/debt/PeriodFilter.tsx:4-13`, `frontend/src/components/debt/PeriodFilter.tsx:49-195`.
- The frontend query path already threads `dateFrom/dateTo` into both statement hooks and query keys: `frontend/src/hooks/useFinancialQueries.ts:16-24`, `frontend/src/hooks/useFinancialQueries.ts:90-98`, `frontend/src/api/financialClient.ts:55-63`.
- Both backend statement routes already accept `dateFrom/dateTo`; `statement.service.ts` computes `periodSummary` before filtering visible rows, which is the required shape for historical opening/closing balances: `backend/src/routes/financial/ledger.routes.ts:34-40`, `backend/src/routes/financial/payments.routes.ts:59-64`, `backend/src/services/statement.service.ts:103-152`, `backend/src/services/statement.service.ts:203-223`, `backend/src/services/statement.service.ts:460-480`.
- The shared response types already expose additive `periodSummary` fields on customer and supplier statements: `shared/src/types/index.ts:1034-1059`.
- Historical-balance regression coverage already exists for the summary helper, including the “latest pre-period row, not oldest row” case and AR/AP sign conventions: `backend/src/tests/statement-period-summary.test.ts:25-139`.
- Two parity gaps remain:
  - The linked-supplier AP card on `/debt/:id` ignores the active AR period because it fetches `useSupplierStatement(linkedSupplierId)` without `periodRange`: `frontend/src/pages/DebtDetailPage.tsx:127-140`.
  - Export actions are still all-time from the UI; customer export also drops the range in the route handler: `frontend/src/pages/DebtDetailPage.tsx:99-115`, `frontend/src/pages/PayableDetailPage.tsx:91-108`, `backend/src/routes/financial/ledger.routes.ts:45-48`, `backend/src/routes/financial/payments.routes.ts:66-71`.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Finalize existing AR/AP period filter](./phase-01-finalize-existing-ar-ap-period-filter.md) | Pending |

## Dependencies

- No blocking unfinished plan exists under `./plans/`.
- Related historical notes under `docs/plans/` are informative only, not blockers: `docs/plans/debt-notice-completed-status-fix.md`, `docs/plans/carrier-badge-customer-pages.md`.

## Acceptance Criteria

- `/debt/:id` and `/payables/:id` each expose a visible month/range filter and a three-card summary immediately above the filtered detail rows.
- The server contract remains: `ledgerRows` contains only in-range rows, while `periodSummary` is computed from full ledger history so opening/closing balances stay correct for historical periods.
- Customer AR and supplier AP coverage are explicit:
  - Customer AR detail remains period-scoped on `/debt/:id`.
  - Supplier AP detail remains period-scoped on `/payables/:id`.
  - The linked supplier summary card on `/debt/:id` is either intentionally kept as current-balance-only or explicitly upgraded to mirror the active period; the plan assumes “current only” unless product scope expands.
- Existing statement export behavior stays unchanged unless parameterized as an explicit follow-up slice.
- No change violates append-only ledger rules, Vietnamese labeling, or the “no raw SQL” constraint.

## Scope Boundary

- In scope: AR/AP detail-page parity, period-summary correctness, linked-AP semantics, and QA/test coverage.
- Out of scope: changing aging algorithms, debt netting workflows, list-page `/debt` filters, ledger write behavior, or backfills/migrations.

## Key Risks

- Product mismatch: current code defaults both detail pages to the current month, while `docs/flows/04-CONG_NO_VA_THANH_TOAN.md:100-104` describes a full-history default. This must be resolved before QA signoff.
- Semantic mismatch: period-scoping the linked AP card could make the netting summary disagree with the live payable used by debt-offset workflows; leaving it current-only avoids that but needs explicit labeling.
- Export mismatch: parameterizing exports changes accountant-visible files; leaving exports all-time preserves behavior but means filtered on-screen data and downloaded files differ.
