## Phase Implementation Report

### Executed Phase
- Phase: `phase-05-payroll-attendance-and-close`
- Plan: `plans/260727-1230-approved-business-rules`
- Status: `completed_with_concerns`

### Files Modified
- `backend/src/services/salary-period-close.service.ts`
- `backend/src/services/governance-policy.ts`
- `backend/src/routes/salary.ts`
- `backend/src/routes/config.ts`
- `backend/src/tests/q11-salary-post-close.test.ts`
- `frontend/src/api/salaryClient.ts`
- `frontend/src/hooks/useSalaryQueries.ts`
- `frontend/src/pages/SalaryAttendancePage.tsx`
- `frontend/src/pages/salary-attendance-components.tsx`
- `frontend/src/pages/SalaryAttendancePage.test.tsx`

### Tasks Completed
- [x] Added salary-period close governance request/check/approve wrappers on top of the existing direct apply logic.
- [x] Added salary-period reopen governance request/check/approve wrappers with persisted original-version validation.
- [x] Reused the generic governance policy and transition services instead of introducing a parallel approval engine.
- [x] Added `SALARY_PERIOD_CLOSE` and `SALARY_PERIOD_REOPEN` governance policies with role-capability separation.
- [x] Changed public `/api/salary/periods/:period/close|reopen` endpoints to create governed requests instead of applying the period mutation directly.
- [x] Changed public `/api/salary-periods/:period/close|reopen` admin endpoints to create governed requests instead of applying the period mutation directly.
- [x] Added salary-scoped check/approve endpoints for close and reopen under both salary route surfaces.
- [x] Tightened direct apply helpers so governance approval carries the authoritative lifecycle version into the actual close/reopen mutation.
- [x] Added focused regression coverage proving maker request and checker step do not change period state, self-check/self-approve are rejected, stale governance-action versions fail, and approved close/reopen still apply correctly.
- [x] Preserved existing Q11/M7.3 lifecycle behavior for the already-approved post-close adjustment and readiness rules.
- [x] Added frontend salary-period governance types and client methods so close/reopen request, check, and approve calls match the new backend contract.
- [x] Added salary-period governance query/mutation hooks and invalidation so pending request state refreshes after request/check/approve transitions.
- [x] Changed Salary Attendance page actions from direct close/reopen wording to customer-operable request flows and blocked duplicate requests while one is pending.
- [x] Rendered active salary close/reopen governance requests with status, actor trail, and role-aware check/approve buttons driven by backend `allowedActions`.
- [x] Preserved the existing Q11 post-close adjustment surface and payslip-issued reopen blocking while adding the new governance list.
- [x] Updated frontend page tests to cover the new request button label, pending close governance queue rendering, and retained Q11 adjustment behavior.
- [x] Tightened salary-period reopen so blank/whitespace reopen reasons are rejected with HTTP 400 instead of silently falling back to a generated reason.
- [x] Added a required reopen-reason textarea on Salary Attendance, with inline validation before the governed reopen request is sent.
- [x] Passed the explicit reopen reason through the frontend client/hooks into both salary reopen route surfaces, while leaving close-request note behavior unchanged.
- [x] Added red→green regression proof for the backend blank-reopen-reason rejection and the frontend required-reopen-reason UI/payload behavior.

### Tests Status
- Backend focused tests: pass
  - `qa/2026-07-27_q15-salary-close-governance_backend-test.log`
- Backend typecheck: initial red then green rerun
  - `qa/2026-07-27_q15-salary-close-governance_backend-typecheck.log`
  - `qa/2026-07-27_q15-salary-close-governance_backend-typecheck.rerun.log`
- Frontend focused tests: pass
  - `qa/2026-07-27_q15-salary-close-governance_frontend-test.log`
- Frontend typecheck: pass
  - `qa/2026-07-27_q15-salary-close-governance_frontend-typecheck.log`
- Root lint: pass with warnings
  - `qa/2026-07-27_q15-salary-close-governance_lint.log`
- Backend focused reopen-reason red→green proof:
  - red: `qa/2026-07-27_q15-salary-reopen-reason_backend-test.red.log`
  - green: `qa/2026-07-27_q15-salary-reopen-reason_backend-test.green.log`
- Frontend focused reopen-reason red→green proof:
  - red: `qa/2026-07-27_q15-salary-reopen-reason_frontend-test.red.log`
  - green: `qa/2026-07-27_q15-salary-reopen-reason_frontend-test.green.log`
- Backend typecheck after reopen-reason fix: pass
  - `qa/2026-07-27_q15-salary-reopen-reason_backend-typecheck.log`
- Frontend typecheck after reopen-reason fix: pass
  - `qa/2026-07-27_q15-salary-reopen-reason_frontend-typecheck.log`
- Root lint after reopen-reason fix: pass with warnings
  - `qa/2026-07-27_q15-salary-reopen-reason_lint.log`

### Issues Encountered
- The first typecheck run failed on new route typing in `backend/src/routes/salary.ts` (`req.params.actionId` widened to `string | string[]` and nullable reopen version narrowing). The rerun is green after normalizing those values.
- The first frontend typecheck run failed because `salary-attendance-components.tsx` rendered `<Lock />` without importing the Lucide icon, so TypeScript bound `Lock` to the DOM global instead of the icon component.
- The first frontend page test run failed because `SalaryAttendancePage` now depends on the governance hooks while the test mock still exposed only the old salary hook surface.
- The reopen-reason acceptance gap reproduced exactly as expected before the fix: backend governance creation accepted a blank reopen reason, and the page had no required reopen-reason validation surface.
- Repo lint is green but still reports 21 warnings outside this slice. This did not block the governed close/reopen rollout.

### Next Steps
- Root controller should include these new salary close/reopen governance endpoints in the final integrated QA and staging verification.
- If the controller wants a cleaner root lint baseline, handle the remaining warnings as a separate hygiene pass rather than folding them into this governed close/reopen rollout.

Unresolved questions:
- None for the backend governance lane itself.
