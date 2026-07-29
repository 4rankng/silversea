---
title: Advance governance and settlement control flow research
generated_at: 2026-07-29
scope: Silversea advance requests, advance settlements, governance inbox, and source-page state reuse
status: complete
---

# Advance governance and settlement control flow research

## Summary

Silversea uses two different patterns around advances:

- `advance-requests` are maker-checker-governance objects. The admin route does not finalize them directly; it creates `governance_actions`, and the governance inbox later applies the request via `approveAdvanceRequest()` / `rejectAdvanceRequest()`.
- `advance-settlements` are mostly direct settlement records. Check, approve, reject, and ordinary updates mutate the settlement row immediately. Only corrections and reversals for already approved settlements are queued as governance actions.

That split is already reflected in the code and the UI. The main constraint is that the current client contract can list governance actions globally, but it cannot fetch governance actions by `subjectType` / `subjectId` yet. So the source page can show role-gated actions and a local post-submit notice, but not a reliable settlement-scoped active governance state without a new API surface or a broader overfetch/filter step.

## Contents

1. [Lifecycle and role ownership](#lifecycle-and-role-ownership)
2. [What creates governance records vs direct mutations](#what-creates-governance-records-vs-direct-mutations)
3. [Existing UI types and hooks to reuse](#existing-ui-types-and-hooks-to-reuse)
4. [Public-contract risks](#public-contract-risks)
5. [Regression tests required](#regression-tests-required)
6. [Recommendation](#recommendation)

## Lifecycle and role ownership

### Advance requests

- Forwarder submits the request from the portal, via the forwarder client path into `/finance/advance-requests/:id/approve|reject` on the office side.
- The route does `runIdempotent(... create: requestAdvanceRequestApprovalGovernance / requestAdvanceRequestRejectionGovernance ...)`, so the route itself creates a `governance_actions` row, not the final request mutation.
- Final application happens later in `applyAdvanceRequestGovernanceAction()`, which calls `approveAdvanceRequest()` or `rejectAdvanceRequest()` inside the governance transition flow.
- `approveAdvanceRequest()` directly mutates `advance_requests` to `APPROVED` and posts the `FORWARDER_ADVANCE` ledger entry.
- `rejectAdvanceRequest()` directly mutates `advance_requests` to `REJECTED` and does not post the advance ledger entry.

### Advance settlements

- Settlement creation is direct: `createAdvanceSettlement()` inserts the settlement and link rows, no governance record.
- `checkAdvanceSettlement()` is direct settlement mutation, but it is explicitly marked as deprecated compatibility for stale clients.
- `approveAdvanceSettlement()` is direct settlement mutation plus ledger posting and propagation of linked expense approvals.
- `rejectAdvanceSettlement()` is direct settlement mutation; no ledger posting.
- `updateAdvanceSettlement()` is direct mutation for `PENDING` and `CHECKED_BY_ACCOUNTANT` settlements.
- `adjustSettlementExpense()` is dual-path:
  - For pending / checked settlements: direct mutation of settlement expense link + settlement totals.
  - For approved settlements: creates a `governance_actions` row of kind `ADVANCE_SETTLEMENT_CORRECTION`, with no immediate settlement mutation.
- `requestAdvanceSettlementReversal()` on approved settlements creates a `governance_actions` row of kind `ADVANCE_SETTLEMENT_REVERSAL`, with no immediate reversal mutation.
- The governance inbox later applies those approved actions through `applyAdvanceSettlementGovernanceAction()`.

### Role ownership

- Office roles for advance-request decisions: `ADMIN` and `MANAGER` on the admin advances page.
- Office roles for settlement review: `ADMIN` and `ACCOUNTANT` on the settlement review page.
- Office roles for governance inbox processing: `ADMIN`, `MANAGER`, `ACCOUNTANT` via `/governance-actions`.
- Portal / forwarder roles do not get governance inbox access.

## What creates governance records vs direct mutations

```mermaid
flowchart LR
  A[AdminAdvancesPage submit] --> B[POST /finance/advance-requests/:id/approve|reject]
  B --> C[create governance_actions row]
  C --> D[GovernanceActionsPage checks/approves]
  D --> E[applyAdvanceRequestGovernanceAction]
  E --> F[advance_requests row + ledger]

  G[AdminAdvanceSettlementsPage / SettlementPrintPage] --> H[check / approve / reject / update settlement]
  H --> I[direct settlement row mutation]

  J[Approved settlement correction or reversal] --> K[create governance_actions row]
  K --> D
  D --> L[applyAdvanceSettlementGovernanceAction]
  L --> M[settlement row + settlement_expenses + ledger]
```

Direct mutation paths:

- `checkAdvanceSettlement()`
- `approveAdvanceSettlement()`
- `rejectAdvanceSettlement()`
- `updateAdvanceSettlement()` while settlement is still reviewable
- `adjustSettlementExpense()` while settlement is still reviewable

Governance-record paths:

- `requestAdvanceRequestApprovalGovernance()`
- `requestAdvanceRequestRejectionGovernance()`
- `adjustSettlementExpense()` when the settlement is already approved
- `requestAdvanceSettlementReversal()`

The inbox check/approve behavior is still generic and governed by `governance-transition.service.ts`: `checkGovernanceAction()` can return `RETURNED_FOR_EVIDENCE`, and `approveGovernanceActionWithAdapter()` applies the domain adapter before marking the action `APPROVED` / `appliedAt`.

## Existing UI types and hooks to reuse

### Already available

- `GovernanceActionRecord` in [`frontend/src/api/financialClient.ts`](/Users/dev/Documents/projects/silversea/frontend/src/api/financialClient.ts#L25-L61)
- `financialClient.getGovernanceActions()` / `checkGovernanceAction()` / `approveGovernanceAction()` / `rejectGovernanceAction()` in [`frontend/src/api/financialClient.ts`](/Users/dev/Documents/projects/silversea/frontend/src/api/financialClient.ts#L146-L172)
- `useGovernanceActions()` / `useCheckGovernanceAction()` / `useApproveGovernanceAction()` / `useRejectGovernanceAction()` in [`frontend/src/hooks/useFinancialQueries.ts`](/Users/dev/Documents/projects/silversea/frontend/src/hooks/useFinancialQueries.ts#L29-L77)
- `settlementReviewPermissions()` in [`frontend/src/pages/SettlementPrintPage.tsx`](/Users/dev/Documents/projects/silversea/frontend/src/pages/SettlementPrintPage.tsx#L95-L113)
- `governanceActionLabel()` and `ACTION_KIND_LABELS` in [`frontend/src/pages/GovernanceActionsPage.tsx`](/Users/dev/Documents/projects/silversea/frontend/src/pages/GovernanceActionsPage.tsx#L40-L90)
- `canRequestApprovedGovernance` rendering in [`frontend/src/pages/SettlementPrintPage.tsx`](/Users/dev/Documents/projects/silversea/frontend/src/pages/SettlementPrintPage.tsx#L477-L509)

### Constraint

The current client contract only exposes:

- `status`
- `limit`
- `offset`

It does **not** expose `subjectType`, `subjectId`, or `actionKind` filters, even though the backend schema accepts them in `governanceActionListQuerySchema`. That means the source page cannot currently fetch just “this settlement’s pending governance actions” through the existing client hook. Any source-page active-state panel would need either:

1. a new settlement-scoped endpoint / client filter contract, or
2. a broad queue fetch plus client-side filtering.

Option 1 is the clean fit. Option 2 is a workaround.

## Public-contract risks

1. `checkAdvanceSettlement()` is legacy compatibility, not the canonical path. The comment says new clients should call approve directly; a source-page UX that treats “check” as final would be wrong. See [`backend/src/services/advance.service.ts`](/Users/dev/Documents/projects/silversea/backend/src/services/advance.service.ts#L895-L950).
2. `SettlementPrintPage` already has local `governanceNotice` messaging, but that is only a post-submit notice. It does not reflect the current governance queue state.
3. `updateSettlementExpense` is the same endpoint for:
   - normal accountant edits on reviewable settlements, and
   - approved-settlement correction requests that create a governance action.
   A source page must gate on settlement status or it will mislabel a queued correction as already applied. See [`backend/src/routes/financial/advances.routes.ts`](/Users/dev/Documents/projects/silversea/backend/src/routes/financial/advances.routes.ts#L239-L297) and [`backend/src/services/advance.service.ts`](/Users/dev/Documents/projects/silversea/backend/src/services/advance.service.ts#L1203-L1453).
4. Governance labels are already centralized in `GovernanceActionsPage`. If the source page renders active actions, it should reuse those labels, not raw action kinds.
5. The current `useGovernanceActions` query key is broad. If a source-page implementation adds polling or refetching, it will be more expensive than a subject-scoped read.

## Regression tests required

### Already strong

- Settlement workflow invariants are covered in [`backend/src/tests/forwarder-settlement-workflow.test.ts`](/Users/dev/Documents/projects/silversea/backend/src/tests/forwarder-settlement-workflow.test.ts#L445-L711) and [`backend/src/tests/forwarder-settlement-workflow.test.ts`](/Users/dev/Documents/projects/silversea/backend/src/tests/forwarder-settlement-workflow.test.ts#L786-L1040):
  - self-check and self-approve rejection
  - check-before-approve requirement
  - update invalidates prior check
  - approved-settlement correction requires three actors
  - reversal requires governance
  - approved-settlement update/correction history remains append-only
- Governance inbox RBAC is covered in [`frontend/src/App.governance-actions-route.test.tsx`](/Users/dev/Documents/projects/silversea/frontend/src/App.governance-actions-route.test.tsx#L58-L76).
- Source-page role gating is covered in [`frontend/src/pages/settlement-review-policy.test.ts`](/Users/dev/Documents/projects/silversea/frontend/src/pages/settlement-review-policy.test.ts#L5-L61) and [`frontend/src/pages/financial-governance-ui.test.ts`](/Users/dev/Documents/projects/silversea/frontend/src/pages/financial-governance-ui.test.ts#L6-L30).

### Missing / should add if the source page starts showing active governance state

- A UI test for the settlement source page showing a pending governance badge / action card only when the user is an office reviewer and the settlement is approved.
- A client-contract test for any new subject-scoped governance fetch, so `subjectType=ADVANCE_SETTLEMENT` and `subjectId=<id>` cannot regress silently.
- A regression test that the source page does not treat a queued correction or reversal as already applied before the governance inbox approves it.
- If the implementation reuses the existing broad queue query, a performance-safe test or assertion that it does not overfetch repeatedly on render.

## Recommendation

Ranked by fit:

1. Add a settlement-scoped governance read contract and surface active state on `SettlementPrintPage`. Best fit. It matches the domain model and avoids broad queue overfetch.
2. If the contract cannot move now, reuse `useGovernanceActions()` plus client-side filtering as a stopgap. Acceptable, but weaker and harder to keep stable.
3. Do not infer active governance state from `governanceNotice` or from settlement status alone. That will drift from the real queue.

## Unresolved questions

- Should the active-state panel show only `PENDING_*` actions, or also `RETURNED_FOR_EVIDENCE` and `CANCELED` history?
- Should the source page show queue state for the exact settlement only, or also linked request / expense actions?
- If a new endpoint is added, should it live under `/finance/advance-settlements/:id/governance-actions` or be exposed through the existing settlement detail payload?

## References

- [`backend/src/routes/financial/advances.routes.ts`](/Users/dev/Documents/projects/silversea/backend/src/routes/financial/advances.routes.ts#L39-L68)
- [`backend/src/routes/financial/advances.routes.ts`](/Users/dev/Documents/projects/silversea/backend/src/routes/financial/advances.routes.ts#L107-L297)
- [`backend/src/services/advance.service.ts`](/Users/dev/Documents/projects/silversea/backend/src/services/advance.service.ts#L250-L352)
- [`backend/src/services/advance.service.ts`](/Users/dev/Documents/projects/silversea/backend/src/services/advance.service.ts#L360-L462)
- [`backend/src/services/advance.service.ts`](/Users/dev/Documents/projects/silversea/backend/src/services/advance.service.ts#L488-L580)
- [`backend/src/services/advance.service.ts`](/Users/dev/Documents/projects/silversea/backend/src/services/advance.service.ts#L765-L950)
- [`backend/src/services/advance.service.ts`](/Users/dev/Documents/projects/silversea/backend/src/services/advance.service.ts#L952-L1200)
- [`backend/src/services/advance.service.ts`](/Users/dev/Documents/projects/silversea/backend/src/services/advance.service.ts#L1203-L1739)
- [`backend/src/services/governance-transition.service.ts`](/Users/dev/Documents/projects/silversea/backend/src/services/governance-transition.service.ts#L171-L350)
- [`backend/src/services/governance-policy.ts`](/Users/dev/Documents/projects/silversea/backend/src/services/governance-policy.ts#L27-L53)
- [`frontend/src/api/financialClient.ts`](/Users/dev/Documents/projects/silversea/frontend/src/api/financialClient.ts#L25-L61)
- [`frontend/src/api/financialClient.ts`](/Users/dev/Documents/projects/silversea/frontend/src/api/financialClient.ts#L146-L172)
- [`frontend/src/hooks/useFinancialQueries.ts`](/Users/dev/Documents/projects/silversea/frontend/src/hooks/useFinancialQueries.ts#L29-L77)
- [`frontend/src/pages/AdminAdvancesPage.tsx`](/Users/dev/Documents/projects/silversea/frontend/src/pages/AdminAdvancesPage.tsx#L273-L450)
- [`frontend/src/pages/AdminAdvanceSettlementsPage.tsx`](/Users/dev/Documents/projects/silversea/frontend/src/pages/AdminAdvanceSettlementsPage.tsx#L351-L541)
- [`frontend/src/pages/GovernanceActionsPage.tsx`](/Users/dev/Documents/projects/silversea/frontend/src/pages/GovernanceActionsPage.tsx#L83-L495)
- [`frontend/src/pages/SettlementPrintPage.tsx`](/Users/dev/Documents/projects/silversea/frontend/src/pages/SettlementPrintPage.tsx#L95-L113)
- [`frontend/src/pages/SettlementPrintPage.tsx`](/Users/dev/Documents/projects/silversea/frontend/src/pages/SettlementPrintPage.tsx#L191-L331)
- [`frontend/src/pages/SettlementPrintPage.tsx`](/Users/dev/Documents/projects/silversea/frontend/src/pages/SettlementPrintPage.tsx#L477-L603)
- [`shared/src/schemas/governance-action.ts`](/Users/dev/Documents/projects/silversea/shared/src/schemas/governance-action.ts#L3-L117)
- [`backend/src/tests/forwarder-settlement-workflow.test.ts`](/Users/dev/Documents/projects/silversea/backend/src/tests/forwarder-settlement-workflow.test.ts#L445-L711)
- [`backend/src/tests/forwarder-settlement-workflow.test.ts`](/Users/dev/Documents/projects/silversea/backend/src/tests/forwarder-settlement-workflow.test.ts#L786-L1040)
- [`frontend/src/pages/settlement-review-policy.test.ts`](/Users/dev/Documents/projects/silversea/frontend/src/pages/settlement-review-policy.test.ts#L5-L61)
- [`frontend/src/pages/financial-governance-ui.test.ts`](/Users/dev/Documents/projects/silversea/frontend/src/pages/financial-governance-ui.test.ts#L6-L30)
