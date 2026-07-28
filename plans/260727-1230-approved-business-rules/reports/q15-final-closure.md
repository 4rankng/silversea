# Q15 Final Closure

Date: 2026-07-28
Lane: Q15 policy expansion after Q23 durable command boundary

## Scope closed

- Expanded the shared governance action catalog and backend policy catalog without introducing a second policy engine.
- Added missing public-boundary/idempotent salary-period adapters for close, reopen, and post-close adjustment request/check/approve flows.
- Added optimistic-version enforcement for salary-period adjustments and compatible service-side version checks for salary-period exclusions.
- Preserved existing native salary close/reopen and salary confirmation three-actor behavior.
- Added focused Q15 public tests for shared policy coverage and HTTP replay/stale-version salary-period routes.

## Files changed

- `shared/src/schemas/governance-action.ts`
- `backend/src/services/governance-policy.ts`
- `backend/src/services/idempotency.service.ts`
- `backend/src/services/salary-period-adjustment.service.ts`
- `backend/src/services/salary-period-close.service.ts`
- `backend/src/routes/salary.ts`
- `backend/src/tests/q15-governance-foundation.test.ts`
- `backend/src/tests/q15-salary-period-routes.test.ts`
- `backend/src/tests/q11-salary-post-close.test.ts`
- `backend/src/tests/m73-salary-period-close.test.ts`

## Acceptance coverage

- Covered missing policy kinds at the common governance boundary:
  - `TRIP_EXPENSE_APPROVAL`
  - `DEBT_OFFSET_APPROVAL`
  - `DEBT_OFFSET_CANCEL`
  - `ADVANCE_REQUEST_APPROVAL`
  - `SALARY_PERIOD_ADJUSTMENT`
  - `COMPANY_EXPENSE`
  - `PROFIT_DISTRIBUTION`
  - `TRIP_FINANCIAL_CHANGE`
  - `TRIP_FINANCIAL_CLOSE`
  - `ANCILLARY_REVENUE_CHANGE`
  - `FINANCIAL_EXCEPTION`
- Enforced maker/checker/approver separation and self-check/self-approve denial on added salary-period HTTP flows.
- Added stale-source and concurrent decision protection through expected-version checks at the public boundary for salary-period adjustment and compatible service checks for exclusions.
- Proved replay behavior for close, reopen, and adjustment request/check/approve HTTP endpoints.
- Preserved viewer/no-action and shared-catalog expectations through the existing Q15 governance foundation coverage.

## Known boundary left open

- Full HTTP parity for salary-period exclusion/exception routes is still blocked by explicit no-edit ownership on `backend/src/routes/config.ts`.
- This lane upgraded the exclusion service boundary to support expected-version checks without breaking current `config.ts` callers, but it did not move or rewrite those blocked routes.

## QA summary

- Green:
  - `qa/2026-07-28_q15-final_shared-typecheck-rerun.log`
  - `qa/2026-07-28_q15-final_shared-build.log`
  - `qa/2026-07-28_q15-final_route-test-rerun2.log`
  - `qa/2026-07-28_q15-final_backend-test-rerun3.log`
- Red preserved:
  - `qa/2026-07-28_q15-final_shared-typecheck.log` failed because the harness shell variable `status` is read-only under `zsh`; rerun used `rc`.
  - `qa/2026-07-28_q15-final_backend-test.log`
  - `qa/2026-07-28_q15-final_backend-test-rerun.log`
  - `qa/2026-07-28_q15-final_backend-test-rerun2.log`
  - `qa/2026-07-28_q15-final_route-test-isolated.log`
  - `qa/2026-07-28_q15-final_route-test-tap.log`
  - `qa/2026-07-28_q15-final_route-test-rerun.log`
- Blocked by unrelated baseline outside lane ownership:
  - `qa/2026-07-28_q15-final_backend-typecheck-rerun2.log`
  - Current blockers there are `backend/src/routes/app-settings.ts` duplicate function implementations and `backend/src/tests/q23-gps-job-commands.test.ts` type errors.

## Result

Q15 lane scope is implementation-complete for the owned salary/governance boundary. Remaining incomplete parity is isolated to blocked `config.ts` exclusion routes and unrelated backend typecheck baseline failures outside this lane.
