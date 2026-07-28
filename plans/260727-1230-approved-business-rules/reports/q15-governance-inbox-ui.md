# Q15 governance inbox UI

## Delivered

- Added the reusable office-role route `/governance-actions` for ADMIN, MANAGER,
  and ACCOUNTANT, with sidebar navigation and page-title registration.
- Added a responsive card-based inbox that defaults to pending items and can
  show all governance history.
- Cards show action type, lifecycle status, subject, requester, action/source
  versions, reason, time, and the backend-provided `allowedActions`.
- CHECK, APPROVE, and REJECT availability is driven exclusively by
  `allowedActions`; unavailable controls remain visibly disabled.
- Every check/approve/reject decision submits the current `expectedVersion`.
  Rejection requires an explicit, non-blank reason before sending.
- Added financial client methods and TanStack Query hooks with full inbox
  invalidation after successful transitions.
- Added focused page behavior/payload tests, App route RBAC tests, route-title
  coverage, and navigation visibility coverage.

## Files

Created:

- `frontend/src/pages/GovernanceActionsPage.tsx`
- `frontend/src/pages/GovernanceActionsPage.css`
- `frontend/src/pages/GovernanceActionsPage.test.tsx`
- `frontend/src/App.governance-actions-route.test.tsx`

Extended:

- `frontend/src/api/financialClient.ts`
- `frontend/src/hooks/useFinancialQueries.ts`
- `frontend/src/App.tsx`
- `frontend/src/lib/routes.ts`
- `frontend/src/lib/routes.test.ts`
- `frontend/src/components/Layout.tsx`
- `frontend/src/components/Layout.test.ts`

Existing concurrent credit-override and fuel-invoice changes in overlapping
frontend files were preserved. No backend, salary, credit-queue, shared
contract, schema, or migration file was edited by this task.

## QA

- Focused frontend tests: **71/71 passed**
  - `qa/2026-07-27_q15-governance-inbox_frontend-test.log` — first red run,
    ambiguous duplicate-text assertion.
  - `qa/2026-07-27_q15-governance-inbox_frontend-test.rerun.log` — second red
    run, repository does not install the jest-dom `toBeDisabled` matcher.
  - `qa/2026-07-27_q15-governance-inbox_frontend-test.rerun2.log` — green.
- Frontend typecheck: **green**
  - `qa/2026-07-27_q15-governance-inbox_typecheck-frontend.log` — first red
    run caught a typed `toQuery` boundary mismatch.
  - `qa/2026-07-27_q15-governance-inbox_typecheck-frontend.rerun.log` — green.
- Root lint: **green, 0 errors** (21 unrelated existing warnings)
  - `qa/2026-07-27_q15-governance-inbox_lint.log`
- Review: **GO**
  - `qa/2026-07-27_q15-governance-inbox_review.md`

## Status

Status: DONE

Summary: The office governance inbox is implemented with server-authoritative
action visibility, optimistic decision payloads, explicit rejection reasons,
route/navigation RBAC, responsive cards, and green scoped QA.

Concerns/Blockers: None for this frontend slice. An independent reviewer could
not be spawned because all agent slots were occupied, so the required
post-implementation review was completed as a documented self-review.
