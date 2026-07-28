## Phase Implementation Report

### Executed Phase
- Phase: q18-final-corrections
- Plan: plans/260727-1230-approved-business-rules
- Status: partial

### Files Modified
- backend/src/routes/financial/debt-offsets.routes.ts
- backend/src/routes/financial/advances.routes.ts
- backend/src/routes/expense.ts
- backend/src/services/debtOffset.service.ts
- backend/src/services/advance.service.ts
- backend/src/services/expense.service.ts
- backend/src/services/adjustment-governance.service.ts
- backend/src/tests/q23-approved-financial-idempotency.test.ts
- backend/src/tests/q23-expense-idempotency.test.ts

### Tasks Completed
- [x] Replaced direct debt-offset approve/cancel route mutations with governed request creation that requires `reason` and `expectedVersion`.
- [x] Replaced direct advance-request approval route mutation with governed request creation that requires `reason` and `expectedVersion`.
- [x] Routed material unpaid company-expense update/delete through governance actions and preserved direct idempotent behavior for non-financial edits and paid deletes.
- [x] Extended generic governance approval application to support `DEBT_OFFSET`, `ADVANCE_REQUEST`, and `COMPANY_EXPENSE` subjects without schema changes.
- [x] Added focused replay/concurrency coverage for governed advance approvals, debt-offset approve/cancel, and company-expense governed update/delete.
- [x] Fixed direct company-expense delete replay so the second call replays the stored snapshot after soft delete instead of returning `404`.

### Tests Status
- Type check: fail, unrelated baseline outside lane ownership. See `qa/2026-07-28_q18-final-corrections_backend-typecheck-rerun-2.log`.
- Unit tests: pass for owned surface. See `qa/2026-07-28_q18-final-corrections_backend-focused-test-rerun.log`.
- Integration tests: full backend suite still red outside owned files. See `qa/2026-07-28_q18-final-corrections_backend-test.log`.

### Issues Encountered
- Root-cause issues in owned surface were fixed:
  - direct expense delete replay short-circuited to `404` before idempotent replay could return the stored snapshot.
  - governed company-expense ledger assertion counted rows from a prior test sharing the same supplier.
  - nullable `approverId` needed explicit `?? undefined` handling in governed company-expense application.
- Repo-wide baseline blockers remain outside lane ownership:
  - `backend/src/services/aging.service.ts` is missing `isNull` imports.
  - `backend/src/services/customer-receivable-authority.service.ts` has existing nullability mismatches.
  - `backend/src/tests/q01-credit-override-routes.test.ts` is missing `and` import.
  - Full-suite stale fixtures now fail the tightened HTTP boundary:
    - `backend/src/tests/q15-debit-note-governance.test.ts` draft create helper expects `201` but receives `400`.
    - `backend/src/tests/final-q01-q02-q07-q08-coverage.test.ts` credit-override route expects `201` but receives `400` with `Idempotency-Key là bắt buộc cho thao tác vượt hạn mức tín dụng.`
    - `backend/src/tests/shipment-quick-create.test.ts` and `backend/src/tests/shipment-routes.test.ts` now fail at request boundaries with `400`/`401`, consistent with missing auth/idempotency/current-version fixture setup.

### Next Steps
- Update out-of-scope Q15 / shipment / credit-override fixtures to send the required `Idempotency-Key` and current-version headers where the bounded-command boundary now enforces them.
- Resolve unrelated backend typecheck baseline in aging/customer-receivable-authority/Q01 test files before claiming repo-wide green.
