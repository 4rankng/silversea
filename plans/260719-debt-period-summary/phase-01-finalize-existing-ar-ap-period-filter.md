---
phase: 1
title: "Finalize existing AR/AP period filter"
status: pending
priority: P1
dependencies: []
---

# Phase 1: Finalize existing AR/AP period filter

## Overview

Ship and QA the already-wired debt-detail period filter by preserving the existing server-side summary contract, clarifying the remaining semantics, and only changing the files needed for visible parity gaps.

## Requirements

- Functional:
  - Receivables detail (`/debt/:id`) and payables detail (`/payables/:id`) must each support `Theo tháng` and `Theo khoảng` filtering through the existing daisyUI control.
  - When a bounded period is active, the UI must show `Số dư đầu kỳ`, `Phát sinh trong kỳ`, and `Số dư cuối kỳ` above the filtered rows.
  - Historical opening/closing balances must continue to come from the full ledger history, not from the first/last visible row in the filtered table.
  - Linked supplier AP coverage on `/debt/:id` must be intentional: either leave it as current-balance-only or explicitly scope it to the active period. Recommended: keep it current-only because debt-offset flows use the live payable, not a period slice.
  - Statement export behavior must remain unchanged unless this phase explicitly adds period-aware exports.
- Non-functional:
  - Keep the ledger append-only and do not alter posting order semantics from `LedgerService.postEntry`: `backend/src/services/ledger.service.ts:111-147`.
  - Keep Vietnamese labels and existing daisyUI `d-` prefixed classes: `frontend/src/components/debt/PeriodFilter.tsx:12-13`, `frontend/src/components/debt/PeriodSummaryCards.tsx:8-16`.
  - No raw SQL; stay inside existing Drizzle/service/query patterns.

## Architecture

1. UI input:
   - `PeriodFilter` owns the month-vs-range affordance and resolves it into `{ dateFrom, dateTo }`: `frontend/src/components/debt/PeriodFilter.tsx:49-195`.
2. Page state:
   - `DebtDetailPage` and `PayableDetailPage` store the active period locally, derive `periodRange`, and feed it into the respective statement hooks before rendering the ledger table and summary cards: `frontend/src/pages/DebtDetailPage.tsx:50-60`, `frontend/src/pages/DebtDetailPage.tsx:577-592`, `frontend/src/pages/PayableDetailPage.tsx:62-71`, `frontend/src/pages/PayableDetailPage.tsx:370-385`.
3. Query/API contract:
   - `useCustomerStatement` and `useSupplierStatement` include the period in the React Query key and in the REST call: `frontend/src/hooks/useFinancialQueries.ts:16-24`, `frontend/src/hooks/useFinancialQueries.ts:90-98`, `frontend/src/api/financialClient.ts:55-63`.
4. Server summary:
   - Routes normalize incoming bounds, then `statement.service.ts` computes `periodSummary` before filtering visible rows. This ordering is the invariant that makes opening/closing balances historically correct: `backend/src/routes/financial/ledger.routes.ts:34-40`, `backend/src/routes/financial/payments.routes.ts:59-64`, `backend/src/services/statement.service.ts:103-152`, `backend/src/services/statement.service.ts:203-223`, `backend/src/services/statement.service.ts:460-480`.
5. Linked AP and export seams:
   - Linked supplier AP on the AR page is currently a separate all-time fetch: `frontend/src/pages/DebtDetailPage.tsx:127-140`.
   - Exports are separate direct-blob paths and do not currently mirror the active filter from the UI: `frontend/src/pages/DebtDetailPage.tsx:99-115`, `frontend/src/pages/PayableDetailPage.tsx:91-108`.

## Related Code Files

- Modify:
  - `frontend/src/pages/DebtDetailPage.tsx`
  - `frontend/src/pages/PayableDetailPage.tsx`
  - `frontend/src/components/debt/PeriodFilter.tsx` only if the default-state or helper copy changes
  - `frontend/src/components/debt/PeriodSummaryCards.tsx` only if wording/labels change
  - `backend/src/routes/financial/ledger.routes.ts` only if customer exports become period-aware
  - `backend/src/routes/financial/payments.routes.ts` only if supplier exports become period-aware from the UI path
  - `backend/src/tests/statement-period-summary.test.ts` for any additional historical-balance regression
  - frontend test files if the repo already has coverage around debt/payable detail components
- Reuse without change:
  - `frontend/src/hooks/useFinancialQueries.ts`
  - `frontend/src/api/financialClient.ts`
  - `backend/src/services/statement.service.ts`
  - `shared/src/types/index.ts`

## Implementation Steps

1. Lock scope before code:
   - Confirm the feature lives on detail pages (`/debt/:id`, `/payables/:id`), not the `/debt` summary list.
   - Confirm whether QA should treat the current-month default as intended or whether the pages must open unbounded/full-history to match `docs/flows/04-CONG_NO_VA_THANH_TOAN.md:100-104`.
2. Preserve the current server-side contract:
   - Do not move opening/closing balance math to the client.
   - Keep `periodSummary` additive and server-computed from full history before row filtering.
3. Resolve the linked AP scope intentionally:
   - Recommended implementation: keep the linked supplier card on `/debt/:id` current-balance-only and label/copy it accordingly, because its purpose is live offset visibility rather than period analysis.
   - Alternative only if requested: pass `periodRange` into `useSupplierStatement(linkedSupplierId, periodRange)` and update the card text/tests to make the AP slice explicitly period-scoped.
4. Decide export parity explicitly:
   - Default recommendation: preserve current all-time exports in this slice and document that on-screen filtering does not yet affect downloaded files.
   - Optional follow-up if accepted: thread `dateFrom/dateTo` through both export buttons and the customer export route so downloaded statements mirror the visible period.
5. Add/refresh verification:
   - Keep the existing backend summary tests.
   - Add cases only for the chosen semantics change: default-state behavior, linked AP period scope, and export range propagation if implemented.
   - Manually verify both pages under `admin / admin123` against `http://localhost:7173`.

## Success Criteria

- [ ] `/debt/:id` visibly exposes the period filter and summary row above `Chi tiết công nợ phải thu`.
- [ ] `/payables/:id` visibly exposes the period filter and summary row above `Chi tiết công nợ phải trả`.
- [ ] `periodSummary.openingBalance` still comes from the most-recent pre-period ledger balance, protected by backend tests.
- [ ] Linked supplier AP behavior on the AR page is explicit and tested/documented, not accidental.
- [ ] No regression is introduced in payment recording, dual-entity debt offset visibility, or existing statement exports.

## Test Matrix

- Backend unit:
  - `cd backend && pnpm test` with emphasis on `backend/src/tests/statement-period-summary.test.ts:25-155`.
- Frontend unit:
  - `cd frontend && pnpm test` only if page/component behavior changes and coverage is added around `PeriodFilter` or the detail pages.
- Build/type safety:
  - `pnpm build`
  - `pnpm lint` if touched files already participate cleanly in the repo-wide ESLint config.
- Manual QA:
  - Login `admin / admin123`.
  - Open `/debt`, drill into a customer, verify month filter, custom-range filter, summary cards, empty-range behavior, and payment flow still work.
  - Open `/payables/:id`, verify the same matrix plus supplier payment recording.
  - If export parity is in scope, verify downloaded files match the active period on both pages.

## Risk Assessment

- High: default-period behavior may make seeded historical data appear “missing” if the page opens on the current month.
  - Mitigation: choose one default intentionally and verify against seeded July 2026 data before QA signoff.
- Medium: changing the linked AP card to follow AR filters can make debt-offset operators read a period slice as the live payable.
  - Mitigation: keep it current-only unless the product explicitly wants period-scoped netting context.
- Medium: export parity changes accountant-visible artifacts.
  - Mitigation: keep exports unchanged in this phase unless parameterization is explicitly approved and tested.

## Rollback Plan

- Frontend-only rollback:
  - Revert detail-page changes in `DebtDetailPage.tsx` / `PayableDetailPage.tsx` / `PeriodFilter.tsx` and keep the existing backend contract untouched.
- Export rollback:
  - If range-aware exports are added and cause confusion, revert only the query-param threading and route forwarding; no data repair is needed.
- No ledger/data rollback:
  - This phase is read-path/UI only and must not post, mutate, or backfill ledger rows.
