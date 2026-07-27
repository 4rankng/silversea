## Phase Implementation Report

### Executed Phase
- Phase: q15-maker-checker
- Plan: `plans/260727-1230-approved-business-rules/`
- Status: partial

### Files Modified
- `backend/src/services/approval.service.ts` (+39/-7 net repo diff; Q15 change at maker/approver guard for `debt_offsets`)
- `backend/src/services/advance.service.ts` (+53/-5 net repo diff; Q15 change at settlement check/approve separation)
- `backend/src/tests/m64-debt-offsets.test.ts` (+88/-9 net repo diff; Q15 self-approval and distinct-approver coverage)
- `backend/src/tests/forwarder-settlement-workflow.test.ts` (+118/-9 net repo diff; Q15 maker/checker/approver coverage)

### Tasks Completed
- [x] Enforced `debt_offsets.createdBy !== approver` for `APPROVED` transitions without changing rejection behavior
- [x] Enforced advance-settlement checker cannot equal forwarder
- [x] Enforced advance-settlement approval only from `CHECKED_BY_ACCOUNTANT`
- [x] Enforced advance-settlement approver must differ from both forwarder and checker
- [x] Preserved existing operational save/update flows (`create/update/adjust` paths remain unchanged)
- [x] Added focused Q15 tests for normal path, self-approval, checker/approver separation, rejection semantics, and debt-offset RBAC/self-approval

### Tests Status
- Focused Q15 tests: pass
  - `qa/2026-07-27_q15-maker-checker_backend-focused.log`
  - Red baseline captured first, then green rerun in same artifact
- Backend typecheck: fail, unrelated baseline
  - `qa/2026-07-27_q15-maker-checker_backend-typecheck.log`
  - Blocker: `backend/src/services/period-lock.service.ts:359` TS1354 (`readonly` modifier misuse)
- Backend full tests: fail, unrelated baseline
  - `qa/2026-07-27_q15-maker-checker_backend-test.log`
  - Blockers: period-lock / salary-period-close / q19 suites expecting `period_locks` relation and related setup outside Q15 ownership
- Lint: pass with existing warnings only
  - `qa/2026-07-27_q15-maker-checker_lint.log`
- Build: fail, same unrelated backend typecheck blocker
  - `qa/2026-07-27_q15-maker-checker_build.log`

### Issues Encountered
- Owned files were already dirty; changes were applied as a narrow Q15 delta on top of concurrent work, with no reverts.
- Repo-wide backend typecheck/build are currently blocked outside Q15 ownership by `period-lock.service.ts`.
- Repo-wide backend tests are currently blocked outside Q15 ownership by missing `period_locks` relation / period-lock setup in unrelated suites.

### Exact Uncovered Q15 Gaps Requiring Later Schema Work
- `trip_expenses` does not carry a durable office-side creator field, so true “creator cannot approve own money edit” enforcement cannot be generalized across all expense-originating money writes with current columns.
- Rejection history on advance requests / settlements still reuses approval columns (`approvedBy` / `approvedAt`). If SilverSea needs distinct rejector-vs-approver audit semantics, that requires dedicated reject fields or an approval-events table.
- Q15’s broader maker/checker/approver/viewer split for price, exception, period-close, and adjustment surfaces still needs explicit actor columns or an approval-event model on those tables; this slice only covered records that already had usable requester/forwarder/checker/creator fields.

### Next Steps
- Fix the unrelated `period-lock.service.ts` type error, then rerun backend typecheck and build.
- Apply migrations/setup required by the new period-lock/business-calendar work before treating full backend tests as a Q15 completion gate.
- If SilverSea wants full Q15 coverage beyond this slice, plan schema-backed actor/audit fields for the remaining money/exception/period-close surfaces.

Status: DONE_WITH_CONCERNS
Summary: Q15 maker/checker separation is implemented and focused-tested for advance requests, advance settlements, and debt offsets with no schema changes. Repo-wide backend typecheck/build/tests remain red for unrelated period-lock work outside this ownership boundary.
Concerns/Blockers: Full green repo QA is blocked by pre-existing `period-lock` code and missing DB relation/setup in unrelated suites, not by the Q15 slice.

## Controller integration follow-up

The frontend settlement workflow was aligned with the service invariant:

- a pending settlement can be edited and submitted for accountant check;
- the checking action no longer immediately calls approval;
- a checked settlement is read-only and exposes final approval only to a
  different ADMIN/ACCOUNTANT actor;
- the maker, checker, portal roles and legacy rows without checker identity do
  not receive the approval action;
- desktop and mobile list labels distinguish `Đã kiểm tra · Chờ phê duyệt`.

Evidence:

- `qa/2026-07-27_q15-settlement-review-ui_frontend-test.log` — full frontend
  suite green, including the role/actor policy.
- `qa/2026-07-27_q15-settlement-review-ui_frontend-typecheck.log` — preserves
  the initial test-enum type error and the green rerun.

Invalid status transitions in the advance workflow now return HTTP 409 so
first-valid-approval-wins conflicts are distinguishable from malformed input.
